import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FLIGHT_SUFFIX } from '../domain/asset.ts'
import { slugify } from '../domain/slug.ts'
import type { ArtRepair } from './reconcile.ts'

// Art queue: turns "this species was heard but has no cutout" into art, via two
// sources that compose. For each heard species we FIRST try to download a ready-made
// cutout from the saezuri-illustrations repo (free, no key); only species the repo
// doesn't have fall back to on-demand Gemini generation (worker.py --generate), and
// only when a key is set. Deduped by slug, serialized, capped per batch. After a batch
// the manifest is rebuilt (so downloaded art is described even with no key) and
// onGenerated republishes. A no-op when neither source is available.

type ArtRequest = ArtRepair

// '' = base (perched) pose, FLIGHT_SUFFIX = flight pose.
const POSE_SUFFIXES = ['', FLIGHT_SUFFIX]

const MISS_SOURCES = ['download', 'generate'] as const
type MissSource = (typeof MISS_SOURCES)[number]

// How long a source is left alone after it failed to supply a pose. Without this,
// every publish re-requests a 404 for every never-illustrated species — which is most
// of them — and the sweep now spans every species we've ever heard.
//   download: the repo does gain art, just rarely; same TTL as the call archives.
//   generate: shorter, because a pose the model declined is worth retrying sooner than
//     one the repo simply lacks — but not every publish, which spends real quota.
const MISS_TTL_MS: Record<MissSource, number> = {
  download: 7 * 24 * 60 * 60 * 1000,
  generate: 24 * 60 * 60 * 1000,
}

/** Leading underscore keeps it out of the manifest scan, matching the
 *  `_fallback.png` convention in the illustrations dir. */
const MISSES_FILE = '_misses.json'

export interface GeneratorOptions {
  pythonBin: string
  workerScript: string
  assetsDir: string
  cacheDir: string
  /** Max species per pipeline invocation (0 = no cap). */
  maxPerCycle: number
  /** GEMINI_API_KEY present — otherwise on-demand generation is skipped. */
  enabled: boolean
  /** Base URL for downloading pre-made cutouts (repo root; the illustrations dir is
   *  appended). Empty ⇒ download disabled. e.g. https://cdn.jsdelivr.net/gh/<repo>@<ref> */
  downloadBaseUrl: string
  /** Called after each batch completes (reload manifest + republish). */
  onGenerated: () => void | Promise<void>
}

const TAG = 'saezuri-generate'
const log = (msg: string) => console.log(`${TAG}: ${msg}`)
const logErr = (e: unknown) =>
  console.error(`${TAG}: ${e instanceof Error ? e.message : String(e)}`)

export class Generator {
  private queued = new Map<string, ArtRequest>()
  private inFlight = new Set<string>()
  private busy = false
  /** Pose file stem -> when that source last failed to supply it. Keyed per pose, not
   *  per species, so a half-supplied pair backs off only on the pose that's absent; and
   *  kept per source, because "the repo doesn't have it" says nothing about whether the
   *  model can draw it. */
  private misses: Record<MissSource, Map<string, number>> = {
    download: new Map(),
    generate: new Map(),
  }
  private missesLoaded = false
  private missesDirty = false

  constructor(private opts: GeneratorOptions) {}

  /** Enqueue a species for art acquisition. No-ops when neither art source is
   *  available (no download URL and no Gemini key), already queued, or in flight. */
  enqueue(sci: string, com: string): void {
    const slug = slugify(sci)
    if (slug) this.request({ slug, sci, com })
  }

  /** Enqueue repairs planned by reconcile.ts. A repair with no `sci` is a cutout
   *  found on disk whose species we couldn't name: downloadable by slug, but never
   *  generated — we won't spend a Gemini call on a name we guessed. */
  enqueueRepairs(repairs: readonly ArtRepair[]): void {
    for (const r of repairs) this.request(r)
  }

  private request(req: ArtRequest): void {
    if (!this.opts.enabled && !this.opts.downloadBaseUrl) return
    if (this.inFlight.has(req.slug) || this.queued.has(req.slug)) return
    this.queued.set(req.slug, req)
    void this.drain()
  }

  private take(n: number): ArtRequest[] {
    const out: ArtRequest[] = []
    for (const [slug, sp] of this.queued) {
      this.queued.delete(slug)
      out.push(sp)
      if (out.length >= n) break
    }
    return out
  }

  private async drain(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.loadMisses()
      while (this.queued.size > 0) {
        const cap = this.opts.maxPerCycle > 0 ? this.opts.maxPerCycle : this.queued.size
        const batch = this.take(cap)
        for (const s of batch) this.inFlight.add(s.slug)
        try {
          // 1) Free pre-made art first (no key needed). A species is only "done" via
          //    download once BOTH poses are present; a partial pair still needs generation.
          const needGen: ArtRequest[] = []
          let downloadedAny = false
          for (const s of batch) {
            let complete = this.isComplete(s.slug)
            if (!complete && this.opts.downloadBaseUrl) {
              const { got, complete: c } = await this.downloadArt(s.slug)
              if (got > 0) downloadedAny = true
              complete = c
            }
            // No `sci` means the slug came off disk unnamed — downloadable, never generated.
            if (!complete && s.sci && this.worthGenerating(s.slug)) needGen.push(s)
          }
          // 2) Generate whatever the repo didn't fully supply, only if a Gemini key is
          //    set. spawnGenerate ends with build_masks, so it rebuilds the manifest;
          //    pregen skips the pose(s) already on disk, so it only fills the gap.
          let generated = false
          if (this.opts.enabled && needGen.length > 0) {
            await this.spawnGenerate(needGen)
            generated = true
            this.recordGenerationGaps(needGen)
          }
          // 3) If we only downloaded, rebuild the manifest so the new art is described
          //    (no Gemini key needed). Then republish either way, BEFORE clearing
          //    inFlight, so a fresh detection sees the art and isn't re-enqueued.
          if (downloadedAny || generated) {
            if (downloadedAny && !generated) await this.rebuildManifest()
            await this.opts.onGenerated()
          }
        } catch (e) {
          // A pipeline failure is transient by assumption (rate limit, restart), so
          // no miss is recorded and the next sweep retries — mirrors CallProvider.
          logErr(e)
        } finally {
          for (const s of batch) this.inFlight.delete(s.slug)
          await this.saveMisses()
        }
      }
    } finally {
      this.busy = false
    }
  }

  private posePath(stem: string): string {
    return join(this.opts.assetsDir, `${stem}.png`)
  }

  private isComplete(slug: string): boolean {
    return POSE_SUFFIXES.every((suffix) => existsSync(this.posePath(`${slug}${suffix}`)))
  }

  /** True when this source recently failed to supply this pose. */
  private backedOff(source: MissSource, stem: string): boolean {
    const at = this.misses[source].get(stem)
    return at !== undefined && Date.now() - at < MISS_TTL_MS[source]
  }

  private recordMiss(source: MissSource, stem: string, reason: string): void {
    // Log only the transition into backoff, so a permanent gap says its piece once
    // rather than on every sweep.
    if (!this.misses[source].has(stem)) log(`${stem}.png: ${reason}`)
    this.misses[source].set(stem, Date.now())
    this.missesDirty = true
  }

  /** The pose landed, so neither source's verdict stands any more. */
  private forgetMisses(stem: string): void {
    for (const source of MISS_SOURCES) {
      if (this.misses[source].delete(stem)) this.missesDirty = true
    }
  }

  /** True while at least one absent pose is still worth asking the model for. Without
   *  this, a species the model keeps declining would be regenerated every publish. */
  private worthGenerating(slug: string): boolean {
    return POSE_SUFFIXES.some((suffix) => {
      const stem = `${slug}${suffix}`
      return !existsSync(this.posePath(stem)) && !this.backedOff('generate', stem)
    })
  }

  /** After a generation run, any pose still absent is one the model didn't produce
   *  (worker.py exits 0 on a partial run so the batch isn't aborted). */
  private recordGenerationGaps(batch: readonly ArtRequest[]): void {
    for (const s of batch) {
      for (const suffix of POSE_SUFFIXES) {
        const stem = `${s.slug}${suffix}`
        if (existsSync(this.posePath(stem))) this.forgetMisses(stem)
        else this.recordMiss('generate', stem, 'generation produced nothing; retrying in 24h')
      }
    }
  }

  /** Download whichever poses the repo has for a slug into assetsDir, skipping poses
   *  already on disk or recently missed. Returns how many new files landed (`got`) and
   *  whether the species is now `complete` (both poses present). A miss/error is
   *  non-fatal — the species just falls through to generation. Writes atomically. */
  private async downloadArt(slug: string): Promise<{ got: number; complete: boolean }> {
    await mkdir(this.opts.assetsDir, { recursive: true })
    let got = 0
    for (const suffix of POSE_SUFFIXES) {
      const stem = `${slug}${suffix}`
      const dest = this.posePath(stem)
      if (existsSync(dest)) continue
      if (this.backedOff('download', stem)) continue
      try {
        const res = await fetch(`${this.opts.downloadBaseUrl}/illustrations/${stem}.png`)
        if (!res.ok) {
          this.recordMiss('download', stem, 'not in the illustrations repo; retrying in 7d')
          continue
        }
        const buf = Buffer.from(await res.arrayBuffer())
        const tmp = `${dest}.tmp`
        await writeFile(tmp, buf)
        await rename(tmp, dest)
        this.forgetMisses(stem)
        got++
        log(`downloaded ${stem}.png`)
      } catch (e) {
        logErr(e) // network error — transient, no miss recorded; fall through to generation
      }
    }
    return { got, complete: this.isComplete(slug) }
  }

  private spawnGenerate(batch: ArtRequest[]): Promise<void> {
    log(`generating ${batch.map((s) => s.sci).join(', ')}`)
    const args = [
      this.opts.workerScript,
      '--generate',
      ...batch.map((s) => `${s.sci}|${s.com ?? s.sci}`),
      '--assets-dir',
      this.opts.assetsDir,
      '--cache-dir',
      this.opts.cacheDir,
    ]
    return this.spawn(args)
  }

  /** Ensure a manifest (and the fallback silhouette) exist without generating art,
   *  so the browser always fetches a real manifest file. */
  rebuildManifest(): Promise<void> {
    return this.spawn([
      this.opts.workerScript,
      '--rebuild',
      '--assets-dir',
      this.opts.assetsDir,
      '--cache-dir',
      this.opts.cacheDir,
    ])
  }

  private async loadMisses(): Promise<void> {
    if (this.missesLoaded) return
    this.missesLoaded = true
    try {
      const raw = await readFile(join(this.opts.assetsDir, MISSES_FILE), 'utf8')
      const data = JSON.parse(raw) as Partial<Record<MissSource, Record<string, number>>>
      for (const source of MISS_SOURCES) {
        for (const [stem, at] of Object.entries(data[source] ?? {})) {
          if (typeof at === 'number') this.misses[source].set(stem, at)
        }
      }
    } catch {
      // Absent or unreadable: start empty and rebuild it. Deleting the file is also
      // the documented way to force an immediate retry of every known gap.
    }
  }

  private async saveMisses(): Promise<void> {
    if (!this.missesDirty) return
    this.missesDirty = false
    try {
      await mkdir(this.opts.assetsDir, { recursive: true })
      const path = join(this.opts.assetsDir, MISSES_FILE)
      const tmp = `${path}.tmp`
      await writeFile(
        tmp,
        JSON.stringify({
          download: Object.fromEntries(this.misses.download),
          generate: Object.fromEntries(this.misses.generate),
        }),
      )
      await rename(tmp, path)
    } catch (e) {
      logErr(e) // non-fatal: we just re-attempt after a restart
    }
  }

  private spawn(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.pythonBin, args, { stdio: 'inherit', env: process.env })
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`${this.opts.pythonBin} exited ${code}`)),
      )
    })
  }
}
