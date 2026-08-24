import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FLIGHT_SUFFIX } from '../domain/asset.ts'
import { slugify } from '../domain/slug.ts'
import { loadNotes, noteFor, noteVersion, type SpeciesNotes } from './notes.ts'
import type { ArtRepair } from './reconcile.ts'

// Art queue: turns "this species has no cutout" into art. reconcile.ts decides *what*
// is missing; this decides how to get it.
//
// The unit of work is a POSE, not a species. A species with only its perched cutout is
// already fully renderable (see resolveArt), so the perched render is what lifts it off
// the fallback silhouette while the flight render only changes the 15% of appearances
// that roll for it — batching the pair would make the valuable render wait behind the
// cheap one.
//
// Two sources compose, in a fixed precedence: a ready-made cutout from the
// saezuri-illustrations repo (free, no key) first, and on-demand Gemini generation only
// for what the repo lacks. The repo is meant to be the state of the art, so it always
// wins; species notes tune the generation fallback and never override the repo.
//
// They run as independent LANES so a cheap repo download never queues behind an
// expensive render. The generate lane is serial and paces its own calls, because the
// constraint there is the image API's rate limit, not worker count.

/** '' = base (perched) pose, FLIGHT_SUFFIX = flight pose. Perched first: it is the
 *  pose that makes a species visible, so it should never wait behind flight. */
const POSE_SUFFIXES = ['', FLIGHT_SUFFIX] as const

const MISS_SOURCES = ['download', 'generate'] as const
type MissSource = (typeof MISS_SOURCES)[number]

// How long a source is left alone after it failed to supply a pose. Without this, every
// publish re-requests a 404 for every never-illustrated species — which is most of them
// — and the sweep spans every species we've ever heard.
//   download: the repo does gain art, just rarely; same TTL as the call archives.
//   generate: shorter, because a pose the model declined is worth retrying sooner than
//     one the repo simply lacks — but not every publish, which spends real quota.
const MISS_TTL_MS: Record<MissSource, number> = {
  download: 7 * 24 * 60 * 60 * 1000,
  generate: 24 * 60 * 60 * 1000,
}

/** Concurrent repo downloads. Network-only and cheap, so a small fixed fan-out; there
 *  is no rate limit to respect here, unlike the generate lane. */
const DOWNLOAD_CONCURRENCY = 4

/** Leading underscore keeps these out of the manifest's `*.png` scan, matching the
 *  `_fallback.png` convention. The legacy file held only the per-source misses; this
 *  one also carries provenance and the note each pose was drawn under, so it is read
 *  once to seed the new file rather than being kept in sync. */
const STATE_FILE = '_art-state.json'
const LEGACY_MISSES_FILE = '_misses.json'

const TAG = 'saezuri-generate'
const log = (msg: string) => console.log(`${TAG}: ${msg}`)
const logErr = (e: unknown) =>
  console.error(`${TAG}: ${e instanceof Error ? e.message : String(e)}`)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One pose of one species: the unit both lanes queue and dedupe on. `sci` is absent
 *  when the slug came off disk and we could not name its bird — downloadable by slug,
 *  but never generated, because we won't spend a Gemini call on a guessed name. */
interface PoseRequest extends ArtRepair {
  suffix: string
  /** Re-render even though the file exists — set only when a note changed. */
  force?: boolean
}

/** What we know about a pose we have already acted on. A cache, never a source of
 *  truth: disk decides whether art exists, and a missing or unreadable entry must
 *  degrade to "ask again", never to "skip this pose forever". */
interface PoseState {
  /** When the repo last returned a clean 404 for this pose. */
  downloadMissAt?: number
  /** When a generation run last finished without producing this pose. */
  generateMissAt?: number
  /** Where the file on disk came from. Gates note-driven regeneration: repo art is
   *  never replaced by a local render. */
  source?: 'repo' | 'generated'
  /** The note this pose was generated under, so a changed note can re-render it. */
  noteVer?: string
}

const MISS_FIELD: Record<MissSource, 'downloadMissAt' | 'generateMissAt'> = {
  download: 'downloadMissAt',
  generate: 'generateMissAt',
}

export interface GeneratorOptions {
  pythonBin: string
  workerScript: string
  assetsDir: string
  cacheDir: string
  /** GEMINI_API_KEY present — otherwise on-demand generation is skipped. */
  enabled: boolean
  /** Base URL for downloading pre-made cutouts (repo root; the illustrations dir is
   *  appended). Empty ⇒ download disabled. e.g. https://cdn.jsdelivr.net/gh/<repo>@<ref> */
  downloadBaseUrl: string
  /** Notes files, layered in order (bundled pipeline file first, operator's over it). */
  notesPaths: readonly string[]
  /** Gap between image-API calls. The generate lane owns the rate limit: it asks the
   *  pipeline for one pose at a time, so the pipeline's own inter-call sleep never
   *  applies here. */
  generateGapMs: number
  /** Called after art lands. Debounced by the caller — never awaited in a lane. */
  onGenerated: () => void | Promise<void>
  /** Whether the layout manifest currently describes a pose. Supplied by the caller
   *  because it already holds the manifest. Used only to diagnose art that is on disk
   *  yet never published, which otherwise fails completely silently. */
  isDescribed?: (stem: string) => boolean
}

const poseName = (suffix: string) => (suffix === FLIGHT_SUFFIX ? 'flight' : 'perched')
const describe = (pose: PoseRequest) => `${pose.sci ?? pose.slug} ${poseName(pose.suffix)}`

export class Generator {
  private dlQueue = new Map<string, PoseRequest>()
  private dlInFlight = new Set<string>()
  private dlBusy = false

  private genQueue = new Map<string, PoseRequest>()
  private genInFlight = new Set<string>()
  private genBusy = false

  private state = new Map<string, PoseState>()
  private stateLoaded = false
  private stateDirty = false
  private notes: SpeciesNotes = {}
  private notesLoadedAt = 0
  /** Keys already reported, so a warning isn't repeated every cycle. */
  private warned = new Set<string>()
  /** When a pose was first seen on disk but absent from the manifest. */
  private firstUndescribedMs = new Map<string, number>()

  constructor(private opts: GeneratorOptions) {}

  private get anySource(): boolean {
    return this.opts.enabled || Boolean(this.opts.downloadBaseUrl)
  }

  /** Enqueue a heard species for art acquisition. */
  enqueue(sci: string, com: string): void {
    const slug = slugify(sci)
    if (slug) this.request({ slug, sci, com })
  }

  /** Enqueue repairs planned by reconcile.ts. */
  enqueueRepairs(repairs: readonly ArtRepair[]): void {
    for (const r of repairs) this.request(r)
  }

  /** Cheap and idempotent: both lanes dedupe queued and in-flight stems, and each lane
   *  short-circuits on a pose already on disk or recently missed — so re-running this
   *  every publish costs no network. */
  private request(req: ArtRepair): void {
    if (!this.anySource || !req.slug) return
    for (const suffix of POSE_SUFFIXES) {
      const stem = `${req.slug}${suffix}`
      if (this.dlInFlight.has(stem) || this.dlQueue.has(stem)) continue
      if (this.genInFlight.has(stem) || this.genQueue.has(stem)) continue
      const pose: PoseRequest = { ...req, suffix }
      if (this.opts.downloadBaseUrl) this.dlQueue.set(stem, pose)
      else this.genQueue.set(stem, pose)
    }
    void this.drainDownloads()
    void this.drainGenerate()
  }

  private posePath(stem: string): string {
    return join(this.opts.assetsDir, `${stem}.png`)
  }

  /** Hand a pose to the generate lane. Claimed into the receiving lane's in-flight set
   *  BEFORE the caller releases it, so a publish landing in between can't see the pose
   *  as unowned and re-enqueue it.
   *
   *  A repair with no `sci` stops here: it is downloadable by slug, but naming its bird
   *  is guesswork and a Gemini call on a guessed name is worse than no art. */
  private handToGenerate(stem: string, pose: PoseRequest): void {
    if (!this.opts.enabled || !pose.sci) return
    if (this.genInFlight.has(stem) || this.genQueue.has(stem)) return
    this.genQueue.set(stem, pose)
    void this.drainGenerate()
  }

  // ---- download lane -------------------------------------------------------

  private async drainDownloads(): Promise<void> {
    if (this.dlBusy) return
    this.dlBusy = true
    try {
      await this.loadState()
      while (this.dlQueue.size > 0) {
        const batch: Array<[string, PoseRequest]> = []
        for (const entry of this.dlQueue) {
          this.dlQueue.delete(entry[0])
          this.dlInFlight.add(entry[0])
          batch.push(entry)
          if (batch.length >= DOWNLOAD_CONCURRENCY) break
        }
        let landed = 0
        try {
          const got = await Promise.all(batch.map(([s, p]) => this.acquireFromRepo(s, p)))
          landed = got.filter(Boolean).length
          await this.saveState()
        } catch (e) {
          logErr(e)
        } finally {
          for (const [stem] of batch) this.dlInFlight.delete(stem)
        }
        if (landed > 0) {
          // Downloaded art still needs its silhouette built: unlike the generate lane,
          // nothing has run the pipeline for it, and the browser only sees art the
          // manifest describes. Once per batch, not per pose, since it rescans the dir.
          await this.safeRebuild()
          void this.opts.onGenerated()
        }
      }
    } finally {
      this.dlBusy = false
    }
  }

  /** True when a new file landed from the repo. A miss or an error is non-fatal — the
   *  pose just falls through to the generate lane. */
  private async acquireFromRepo(stem: string, pose: PoseRequest): Promise<boolean> {
    if (await this.settleExisting(stem, pose)) return false

    if (this.backedOff('download', stem)) {
      this.handToGenerate(stem, pose)
      return false
    }

    try {
      const res = await fetch(`${this.opts.downloadBaseUrl}/illustrations/${stem}.png`)
      if (!res.ok) {
        this.recordMiss('download', stem, 'not in the illustrations repo; retrying in 7d')
        this.handToGenerate(stem, pose)
        return false
      }
      await mkdir(this.opts.assetsDir, { recursive: true })
      await writeAtomic(this.posePath(stem), Buffer.from(await res.arrayBuffer()))
      this.forgetMisses(stem)
      this.setState(stem, { source: 'repo' })
      log(`${describe(pose)}: repo`)
      return true
    } catch (e) {
      // Transient by assumption (DNS, reset, CDN blip): leave the miss unrecorded so
      // the next cycle retries, exactly as the call library does for a thrown lookup.
      logErr(e)
      return false
    }
  }

  // ---- generate lane -------------------------------------------------------

  private async drainGenerate(): Promise<void> {
    if (this.genBusy) return
    this.genBusy = true
    try {
      await this.loadState()
      while (this.genQueue.size > 0) {
        const entry = this.genQueue.entries().next()
        if (entry.done) break
        const [stem, pose] = entry.value
        this.genQueue.delete(stem)
        this.genInFlight.add(stem)
        let landed = false
        try {
          landed = await this.generatePose(stem, pose)
          await this.saveState()
        } catch (e) {
          // A pipeline failure is transient by assumption (rate limit, restart), so no
          // miss is recorded and the next sweep retries — mirrors CallProvider.
          logErr(e)
        } finally {
          this.genInFlight.delete(stem)
        }
        if (landed) void this.opts.onGenerated()
      }
    } finally {
      this.genBusy = false
    }
  }

  /** True when a new file landed from generation. */
  private async generatePose(stem: string, pose: PoseRequest): Promise<boolean> {
    if (!this.opts.enabled || !pose.sci) return false
    if (!pose.force) {
      if (await this.settleExisting(stem, pose)) return false
      if (this.backedOff('generate', stem)) return false
    }

    const note = noteFor(await this.getNotes(), pose.sci)
    // Pace the calls here rather than in the pipeline: it is invoked once per pose, so
    // its own inter-call sleep never fires.
    if (this.opts.generateGapMs > 0) await sleep(this.opts.generateGapMs)

    // A forced re-render overwrites a file that is already there, so its presence
    // afterwards proves nothing — the mtime is what distinguishes a new render from the
    // old one surviving a failed attempt. Getting this wrong would record the failure
    // as success under the new note and never retry it.
    const beforeMs = pose.force ? mtimeMs(this.posePath(stem)) : undefined
    const startedMs = Date.now()
    await this.spawn([
      this.opts.workerScript,
      '--generate',
      `${pose.sci}|${pose.com ?? pose.sci}`,
      '--poses',
      pose.suffix === FLIGHT_SUFFIX ? '2' : '1',
      '--assets-dir',
      this.opts.assetsDir,
      '--cache-dir',
      this.opts.cacheDir,
      ...this.opts.notesPaths.flatMap((p) => ['--notes', p]),
      ...(pose.force ? ['--force'] : []),
    ])

    const secs = Math.round((Date.now() - startedMs) / 1000)
    const afterMs = mtimeMs(this.posePath(stem))
    if (afterMs === undefined || afterMs === beforeMs) {
      this.recordMiss('generate', stem, `generation produced nothing (${secs}s); retrying in 24h`)
      return false
    }
    this.forgetMisses(stem)
    this.setState(stem, { source: 'generated', noteVer: noteVersion(note) })
    log(`${describe(pose)}: generated (${secs}s${note ? ', +note' : ''})`)
    return true
  }

  /** A failed rebuild must not abort the lane — the art is on disk either way, and the
   *  next publish or heal will rebuild. */
  private async safeRebuild(): Promise<void> {
    try {
      await this.rebuildManifest()
    } catch (e) {
      logErr(e)
    }
  }

  // ---- shared decisions ----------------------------------------------------

  /** Decide what to do about a pose whose file is already on disk. Returns true when
   *  the pose needs no further work in the calling lane. */
  private async settleExisting(stem: string, pose: PoseRequest): Promise<boolean> {
    if (!existsSync(this.posePath(stem))) return false

    // Whatever a source concluded before, the pose is here now.
    this.forgetMisses(stem)

    const st = this.state.get(stem)
    // Art that predates this bookkeeping: assume the repo, the safer of the two, so an
    // unknown file is never force-replaced by a local render.
    const source = st?.source ?? 'repo'
    if (st?.source === undefined) this.setState(stem, { source })

    const note = pose.sci ? noteFor(await this.getNotes(), pose.sci) : undefined
    if (source === 'generated' && st?.noteVer !== noteVersion(note)) {
      if (this.opts.enabled && pose.sci) {
        log(`${describe(pose)}: note changed, re-rendering`)
        this.handToGenerate(stem, { ...pose, force: true })
        return true
      }
    } else if (source === 'repo' && note !== undefined && !this.warned.has(`note:${stem}`)) {
      this.warned.add(`note:${stem}`)
      log(
        `${describe(pose)}: has a note but its art came from the illustrations repo, which ` +
          `takes precedence — if the repo's art is wrong, contribute the note upstream`,
      )
    }

    this.checkDescribed(stem, pose)
    return true
  }

  /** Surface the one failure that is otherwise completely silent: a pose whose file is
   *  on disk but which the manifest build rejects (a truncated download, a corrupt
   *  PNG). Nothing downloads it — the file is there — and nothing generates it — the
   *  pair looks complete — so it is re-requested forever with no progress and no log.
   *
   *  Gated on elapsed time rather than a number of sightings. The caller tests a
   *  manifest it reloads only when publishing, so a pose that just landed is legitimately
   *  absent from it for a while — and a burst of detections could otherwise rack up
   *  sightings within that window and cry corruption about perfectly good art. */
  private checkDescribed(stem: string, pose: PoseRequest): void {
    const isDescribed = this.opts.isDescribed
    if (!isDescribed || this.warned.has(`undescribed:${stem}`)) return
    if (isDescribed(stem)) {
      this.firstUndescribedMs.delete(stem)
      return
    }
    const firstMs = this.firstUndescribedMs.get(stem)
    if (firstMs === undefined) {
      this.firstUndescribedMs.set(stem, Date.now())
      return
    }
    if (Date.now() - firstMs < UNDESCRIBED_GRACE_MS) return
    this.warned.add(`undescribed:${stem}`)
    log(
      `${describe(pose)}: ${stem}.png is on disk but the layout manifest keeps rejecting it — ` +
        `the file is probably corrupt; delete it to re-acquire`,
    )
  }

  /** Notes are re-read periodically rather than cached for the process lifetime, so an
   *  operator editing the file sees the effect without a restart. */
  private async getNotes(): Promise<SpeciesNotes> {
    const now = Date.now()
    if (now - this.notesLoadedAt < NOTES_TTL_MS) return this.notes
    this.notes = await loadNotes(this.opts.notesPaths)
    this.notesLoadedAt = now
    return this.notes
  }

  // ---- miss bookkeeping ----------------------------------------------------

  /** True when this source recently failed to supply this pose. */
  private backedOff(source: MissSource, stem: string): boolean {
    const at = this.state.get(stem)?.[MISS_FIELD[source]]
    return at !== undefined && Date.now() - at < MISS_TTL_MS[source]
  }

  private recordMiss(source: MissSource, stem: string, reason: string): void {
    // Log only the transition into backoff, so a permanent gap says its piece once
    // rather than on every sweep.
    if (this.state.get(stem)?.[MISS_FIELD[source]] === undefined) log(`${stem}.png: ${reason}`)
    this.setState(stem, { [MISS_FIELD[source]]: Date.now() })
  }

  /** The pose landed, so neither source's verdict stands any more. */
  private forgetMisses(stem: string): void {
    const st = this.state.get(stem)
    if (!st) return
    if (st.downloadMissAt === undefined && st.generateMissAt === undefined) return
    this.setState(stem, { downloadMissAt: undefined, generateMissAt: undefined })
  }

  // ---- state persistence ---------------------------------------------------

  private setState(stem: string, patch: PoseState): void {
    this.state.set(stem, { ...this.state.get(stem), ...patch })
    this.stateDirty = true
  }

  private async loadState(): Promise<void> {
    if (this.stateLoaded) return
    this.stateLoaded = true
    try {
      const raw = await readFile(join(this.opts.assetsDir, STATE_FILE), 'utf8')
      const data: unknown = JSON.parse(raw)
      if (data === null || typeof data !== 'object' || Array.isArray(data)) return
      for (const [stem, value] of Object.entries(data)) {
        if (value === null || typeof value !== 'object') continue
        const v = value as PoseState
        this.state.set(stem, {
          downloadMissAt: typeof v.downloadMissAt === 'number' ? v.downloadMissAt : undefined,
          generateMissAt: typeof v.generateMissAt === 'number' ? v.generateMissAt : undefined,
          source: v.source === 'repo' || v.source === 'generated' ? v.source : undefined,
          noteVer: typeof v.noteVer === 'string' ? v.noteVer : undefined,
        })
      }
      return
    } catch {
      // Absent or unreadable: fall through to the legacy file, then start empty. Costs
      // one round of repo probes, which is why this must never be authoritative.
    }
    await this.seedFromLegacyMisses()
  }

  /** Carry over the backoff recorded by the previous format, so upgrading doesn't
   *  re-probe the repo for every species we already know it lacks. */
  private async seedFromLegacyMisses(): Promise<void> {
    try {
      const raw = await readFile(join(this.opts.assetsDir, LEGACY_MISSES_FILE), 'utf8')
      const data = JSON.parse(raw) as Partial<Record<MissSource, Record<string, number>>>
      let seeded = 0
      for (const source of MISS_SOURCES) {
        for (const [stem, at] of Object.entries(data[source] ?? {})) {
          if (typeof at !== 'number') continue
          this.state.set(stem, { ...this.state.get(stem), [MISS_FIELD[source]]: at })
          seeded++
        }
      }
      if (seeded > 0) {
        this.stateDirty = true
        log(`carried over ${seeded} recorded gap(s) from ${LEGACY_MISSES_FILE}`)
      }
    } catch {
      // No legacy file either: start empty.
    }
  }

  private async saveState(): Promise<void> {
    if (!this.stateDirty) return
    this.stateDirty = false
    try {
      await mkdir(this.opts.assetsDir, { recursive: true })
      await writeAtomic(
        join(this.opts.assetsDir, STATE_FILE),
        JSON.stringify(Object.fromEntries(this.state)),
      )
    } catch (e) {
      logErr(e) // non-fatal: we just re-probe after a restart
    }
  }

  // ---- pipeline invocations ------------------------------------------------

  /** Ensure a manifest (and the fallback silhouette) exist without generating art, so
   *  the browser always fetches a real manifest file. */
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

  /** Rebuild the manifest, first cutting out any render an older pipeline version left
   *  on the magenta ground. Those files are invisible to everything else: nothing
   *  re-mattes them and the download path won't overwrite them. */
  repairAndRebuildManifest(): Promise<void> {
    return this.spawn([
      this.opts.workerScript,
      '--repair',
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

/** How long a pose may sit on disk undescribed by the manifest before that is treated
 *  as corruption rather than as the manifest not having caught up. Comfortably longer
 *  than a manifest rebuild, and shorter than the aging tick that re-asks for it. */
const UNDESCRIBED_GRACE_MS = 60_000

/** How long a loaded notes set is reused before being re-read from disk. Short enough
 *  that an edit is picked up promptly, long enough that a burst of poses doesn't re-read
 *  the file per pose. */
const NOTES_TTL_MS = 10_000

/** Modification time in ms, or undefined when the file isn't there. */
function mtimeMs(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs
  } catch {
    return undefined
  }
}

async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}
