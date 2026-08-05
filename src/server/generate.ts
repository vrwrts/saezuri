import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FLIGHT_SUFFIX } from '../domain/asset.ts'
import { slugify } from '../domain/slug.ts'

// Art queue: turns "this species was heard but has no cutout" into art, via two
// sources that compose. For each heard species we FIRST try to download a ready-made
// cutout from the saezuri-illustrations repo (free, no key); only species the repo
// doesn't have fall back to on-demand Gemini generation (worker.py --generate), and
// only when a key is set. Deduped by slug, serialized, capped per batch. After a batch
// the manifest is rebuilt (so downloaded art is described even with no key) and
// onGenerated republishes. A no-op when neither source is available.

interface ArtRequest {
  sci: string
  com: string
}

// '' = base (perched) pose, FLIGHT_SUFFIX = flight pose.
const POSE_SUFFIXES = ['', FLIGHT_SUFFIX]

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
const logErr = (e: unknown) =>
  console.error(`${TAG}: ${e instanceof Error ? e.message : String(e)}`)

export class Generator {
  private queued = new Map<string, ArtRequest>()
  private inFlight = new Set<string>()
  private busy = false

  constructor(private opts: GeneratorOptions) {}

  /** Enqueue a species for art acquisition. No-ops when neither art source is
   *  available (no download URL and no Gemini key), already queued, or in flight. */
  enqueue(sci: string, com: string): void {
    if (!this.opts.enabled && !this.opts.downloadBaseUrl) return
    const slug = slugify(sci)
    if (!slug || this.inFlight.has(slug) || this.queued.has(slug)) return
    this.queued.set(slug, { sci, com })
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
      while (this.queued.size > 0) {
        const cap = this.opts.maxPerCycle > 0 ? this.opts.maxPerCycle : this.queued.size
        const batch = this.take(cap)
        for (const s of batch) this.inFlight.add(slugify(s.sci))
        try {
          // 1) Free pre-made art first (no key needed). A species is only "done" via
          //    download once BOTH poses are present; a partial pair still needs generation.
          const needGen: ArtRequest[] = []
          let downloadedAny = false
          for (const s of batch) {
            let complete = false
            if (this.opts.downloadBaseUrl) {
              const { got, complete: c } = await this.downloadArt(slugify(s.sci))
              if (got > 0) downloadedAny = true
              complete = c
            }
            if (!complete) needGen.push(s)
          }
          // 2) Generate whatever the repo didn't fully supply, only if a Gemini key is
          //    set. spawnGenerate ends with build_masks, so it rebuilds the manifest;
          //    pregen skips the pose(s) already on disk, so it only fills the gap.
          let generated = false
          if (this.opts.enabled && needGen.length > 0) {
            await this.spawnGenerate(needGen)
            generated = true
          }
          // 3) If we only downloaded, rebuild the manifest so the new art is described
          //    (no Gemini key needed). Then republish either way, BEFORE clearing
          //    inFlight, so a fresh detection sees the art and isn't re-enqueued.
          if (downloadedAny || generated) {
            if (downloadedAny && !generated) await this.rebuildManifest()
            await this.opts.onGenerated()
          }
        } catch (e) {
          logErr(e)
        } finally {
          for (const s of batch) this.inFlight.delete(slugify(s.sci))
        }
      }
    } finally {
      this.busy = false
    }
  }

  /** Download whichever poses the repo has for a slug into assetsDir, skipping poses
   *  already on disk. Returns how many new files landed (`got`) and whether the species
   *  is now `complete` (both poses present). A miss/error is non-fatal — the species
   *  just falls through to generation. Writes atomically (tmp + rename). */
  private async downloadArt(slug: string): Promise<{ got: number; complete: boolean }> {
    await mkdir(this.opts.assetsDir, { recursive: true })
    let got = 0
    for (const suffix of POSE_SUFFIXES) {
      const name = `${slug}${suffix}.png`
      const dest = join(this.opts.assetsDir, name)
      if (existsSync(dest)) continue
      try {
        const res = await fetch(`${this.opts.downloadBaseUrl}/illustrations/${name}`)
        if (!res.ok) continue // 404 == not in the repo; silent, expected for many species
        const buf = Buffer.from(await res.arrayBuffer())
        const tmp = `${dest}.tmp`
        await writeFile(tmp, buf)
        await rename(tmp, dest)
        got++
      } catch (e) {
        logErr(e) // network error — non-fatal, fall through to generation
      }
    }
    const complete =
      existsSync(join(this.opts.assetsDir, `${slug}.png`)) &&
      existsSync(join(this.opts.assetsDir, `${slug}${FLIGHT_SUFFIX}.png`))
    return { got, complete }
  }

  private spawnGenerate(batch: ArtRequest[]): Promise<void> {
    const args = [
      this.opts.workerScript,
      '--generate',
      ...batch.map((s) => `${s.sci}|${s.com}`),
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
