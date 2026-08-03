import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isComplete } from '../domain/asset.ts'
import { DEFAULT_MANIFEST } from '../domain/defaultManifest.ts'
import { fetchWindowRows, type LoadDeps, loadSpecies } from '../domain/load.ts'
import { type DictLocale, SUPPORTED_DICT_LOCALES } from '../domain/locale.ts'
import type { LayoutManifest } from '../domain/manifest.ts'
import type { Snapshot } from '../domain/snapshot.ts'
import type { Species } from '../domain/species.ts'
import { type RangeWindow, resolveWindow, type WindowSegment } from '../domain/window.ts'
import { makeNodeDeps } from './birdnetDeps.ts'
import { publishDictionaries } from './dictionaries.ts'
import { Generator } from './generate.ts'
import { buildSnapshot, loadManifest, writeSnapshot } from './publish.ts'
import { frameSignature, renderFrame, writeFrame } from './render.ts'
import { DetectionStore } from './store.ts'
import { runDetectionStream } from './stream.ts'
import { watchAssetRemovals } from './watchAssets.ts'

const ALL_SEGMENTS: readonly WindowSegment[] = ['1h', '12h', '24h', '7d', 'all']

// Coalesce a burst of cutout removals (e.g. `rm *.png`) into a single heal, and
// how long to wait before re-arming the watcher after an error / a not-yet-created
// assets dir. Internal reliability timings, not operator knobs.
const ASSET_HEAL_DEBOUNCE_MS = 2_000
const ASSET_WATCH_REARM_MS = 1_000

// Resolve a comma-separated env override to the subset of `all` it names (in
// `all`'s order). Unknown codes are dropped; an empty or all-unknown list falls
// back to the full set.
function parseCsvSubset<T extends string>(raw: string | undefined, all: readonly T[]): T[] {
  if (!raw) return [...all]
  const wanted = new Set(raw.split(',').map((s) => s.trim().toLowerCase()))
  const out = all.filter((v) => wanted.has(v))
  return out.length > 0 ? out : [...all]
}

// The refresh service: owns the BirdNET-Go relationship and publishes the
// per-window snapshot and e-ink frames nginx serves. It holds the SSE detection
// stream, keeps a rolling 7d store, and republishes — debounced on new
// detections, plus a slow aging tick so windows roll forward on their own.

const TAG = 'saezuri-refresh'
const log = (msg: string) => console.log(`${TAG}: ${msg}`)
const logErr = (where: string, e: unknown) =>
  console.error(`${TAG}: ${where} failed: ${e instanceof Error ? e.message : String(e)}`)

interface Config {
  baseUrl: string
  token?: string
  htmlDir: string
  agingIntervalMs: number
  summaryIntervalMs: number
  publishDebounceMs: number
  geminiEnabled: boolean
  downloadBaseUrl: string
  pythonBin: string
  workerScript: string
  assetsDir: string
  cacheDir: string
  maxPerCycle: number
  frameWidth: number
  frameHeight: number
  frameBg: string
  frameShadow: boolean
  frameWindows: WindowSegment[]
  dictLocales: DictLocale[]
}

function intEnv(name: string, def: number): number {
  const raw = process.env[name]
  if (!raw) return def
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : def
}

function readConfig(): Config {
  const baseUrl = (process.env.BIRDNETGO_URL ?? '').trim()
  if (!baseUrl) throw new Error('BIRDNETGO_URL is required')
  const htmlDir = (process.env.FRAME_HTML_DIR ?? '/usr/share/nginx/html').trim()
  // Free pre-made art source: the repo root for downloads (generate.ts appends
  // /illustrations/<slug>.png). Default is jsDelivr over the public illustrations
  // repo; an empty ILLUSTRATIONS_REPO disables it; ILLUSTRATIONS_BASE_URL overrides
  // (e.g. a local http.server in tests).
  const illustrationsRepo = (
    process.env.ILLUSTRATIONS_REPO ?? 'vrwrts/saezuri-illustrations'
  ).trim()
  const illustrationsRef = (process.env.ILLUSTRATIONS_REF ?? 'main').trim()
  const downloadBaseUrl =
    (process.env.ILLUSTRATIONS_BASE_URL ?? '').trim() ||
    (illustrationsRepo
      ? `https://cdn.jsdelivr.net/gh/${illustrationsRepo}@${illustrationsRef}`
      : '')
  return {
    baseUrl,
    token: (process.env.BIRDNETGO_TOKEN ?? '').trim() || undefined,
    htmlDir,
    agingIntervalMs: intEnv('AGING_INTERVAL_MS', 120_000),
    summaryIntervalMs: intEnv('SUMMARY_INTERVAL_MS', 1_800_000),
    publishDebounceMs: intEnv('PUBLISH_DEBOUNCE_MS', 20_000),
    geminiEnabled: Boolean((process.env.GEMINI_API_KEY ?? '').trim()),
    downloadBaseUrl,
    pythonBin: (process.env.PYTHON_BIN ?? 'python3').trim(),
    workerScript: (process.env.WORKER_SCRIPT ?? '/opt/saezuri/pipeline/worker.py').trim(),
    assetsDir: join(htmlDir, 'assets', 'illustrations'),
    cacheDir: (process.env.CACHE_DIR ?? '/var/cache/saezuri').trim(),
    maxPerCycle: intEnv('GENERATE_MAX_PER_CYCLE', 4),
    frameWidth: intEnv('FRAME_WIDTH', 800),
    frameHeight: intEnv('FRAME_HEIGHT', 480),
    frameBg: (process.env.FRAME_BG ?? '#fcfcfb').trim(),
    frameShadow: (process.env.FRAME_SHADOW ?? '1').trim() !== '0',
    frameWindows: parseCsvSubset(process.env.FRAME_WINDOWS, ALL_SEGMENTS),
    // Operators can narrow the dictionary set (disk/bandwidth) via SPECIES_DICT_LOCALES.
    dictLocales: parseCsvSubset(process.env.SPECIES_DICT_LOCALES, SUPPORTED_DICT_LOCALES),
  }
}

class Refresher {
  private store = new DetectionStore()
  private manifest: LayoutManifest = DEFAULT_MANIFEST
  private allSpecies: Species[] = []
  private lastSummaryMs = 0
  private pendingPublish?: ReturnType<typeof setTimeout>
  private generator: Generator
  private lastFrameSig = new Map<WindowSegment, string>()
  private publishing = false
  private publishQueued = false

  constructor(
    private cfg: Config,
    private deps: LoadDeps,
  ) {
    this.generator = new Generator({
      pythonBin: cfg.pythonBin,
      workerScript: cfg.workerScript,
      assetsDir: cfg.assetsDir,
      cacheDir: cfg.cacheDir,
      maxPerCycle: cfg.maxPerCycle,
      enabled: cfg.geminiEnabled,
      downloadBaseUrl: cfg.downloadBaseUrl,
      // Reload the manifest + republish so the freshly-acquired art appears.
      onGenerated: () => this.safe('publish', () => this.publish()),
    })
  }

  /** Re-seed the store from a single 7d backfill (covers 1h/12h/24h/7d). */
  private async backfill(): Promise<void> {
    const now = Date.now()
    const w7 = resolveWindow('7D', now) as RangeWindow
    const { rows, covered } = await fetchWindowRows(w7, {}, undefined, this.deps)
    this.store.seed(rows, covered, w7.sinceMs)
    log(`backfilled ${rows.length} detections (covered=${covered})`)
  }

  private async refreshSummary(): Promise<void> {
    const res = await loadSpecies(resolveWindow('ALL'), {}, undefined, this.deps)
    this.allSpecies = res.species
    this.lastSummaryMs = Date.now()
  }

  /** Download + publish BirdNET-Go's species-name dictionaries as static files so
   *  the browser can localize display names without ever touching BirdNET-Go. */
  private async publishDicts(): Promise<void> {
    await publishDictionaries({
      baseUrl: this.cfg.baseUrl,
      token: this.cfg.token,
      htmlDir: this.cfg.htmlDir,
      locales: this.cfg.dictLocales,
    })
  }

  /** Serialize publishes so overlapping triggers (aging tick, debounce,
   *  reconnect, post-generation) never race on the shared *.tmp files. A trigger
   *  arriving mid-publish coalesces into one trailing re-run. */
  private async publish(): Promise<void> {
    if (this.publishing) {
      this.publishQueued = true
      return
    }
    this.publishing = true
    try {
      do {
        this.publishQueued = false
        await this.doPublish()
      } while (this.publishQueued)
    } finally {
      this.publishing = false
    }
  }

  /** Rebuild the manifest view, write the snapshot, then render the frames. */
  private async doPublish(): Promise<void> {
    const now = Date.now()
    this.store.prune(now)
    if (now - this.lastSummaryMs >= this.cfg.summaryIntervalMs) {
      try {
        await this.refreshSummary()
      } catch (e) {
        logErr('summary', e)
      }
    }
    this.manifest = await loadManifest(this.cfg.htmlDir)
    this.enqueueMissingArt(now)
    const snapshot = buildSnapshot({
      store: this.store,
      allSpecies: this.allSpecies,
      manifest: this.manifest,
      now,
    })
    // Manifest first, then the snapshot, then the frames — a client (or the
    // frame) never references art the manifest doesn't yet describe.
    await writeSnapshot(this.cfg.htmlDir, snapshot)
    await this.renderFrames(snapshot)
  }

  /** Enqueue any recently-heard species missing a complete illustration pair, so gaps
   *  fill on startup / after art is deleted — not only when a species is next heard
   *  live (onDetection). Cheap + idempotent: the generator dedupes in-flight/queued
   *  slugs and `isComplete` skips species that already have both poses. */
  private enqueueMissingArt(now: number): void {
    const since = (resolveWindow('7D', now) as RangeWindow).sinceMs
    for (const s of this.store.aggregate(since)) {
      if (!isComplete(this.manifest, s.sci)) this.generator.enqueue(s.sci, s.com)
    }
  }

  /** Rebuild the manifest from disk and republish, so a vanished cutout drops out
   *  of the masks and its species is re-enqueued rather than 404ing (see
   *  watchAssets.ts). */
  private async heal(): Promise<void> {
    await this.generator.rebuildManifest()
    await this.publish()
  }

  /** Render the e-ink PNG for each configured window, skipping any whose species
   *  + manifest fingerprint is unchanged so the file (and its mtime) stays put —
   *  no needless e-ink refresh. A canvas failure for one window is isolated. */
  private async renderFrames(snapshot: Snapshot): Promise<void> {
    for (const seg of this.cfg.frameWindows) {
      const species = snapshot.windows[seg].species
      const sig = frameSignature(species, this.manifest)
      if (this.lastFrameSig.get(seg) === sig) continue
      try {
        const png = await renderFrame(species, this.manifest, {
          width: this.cfg.frameWidth,
          height: this.cfg.frameHeight,
          background: this.cfg.frameBg,
          shadow: this.cfg.frameShadow,
          assetsDir: this.cfg.assetsDir,
        })
        await writeFrame(this.cfg.htmlDir, seg, png)
        this.lastFrameSig.set(seg, sig)
      } catch (e) {
        logErr(`frame:${seg}`, e)
      }
    }
  }

  private async safe(where: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (e) {
      logErr(where, e)
    }
  }

  /** Coalesce a burst of detections into one trailing publish per debounce
   *  window, so a dawn chorus doesn't rewrite the snapshot on every event. */
  private schedulePublish(): void {
    if (this.pendingPublish) return
    this.pendingPublish = setTimeout(() => {
      this.pendingPublish = undefined
      void this.safe('publish', () => this.publish())
    }, this.cfg.publishDebounceMs)
  }

  async run(): Promise<void> {
    const artSource =
      [this.cfg.downloadBaseUrl && 'download', this.cfg.geminiEnabled && 'generate']
        .filter(Boolean)
        .join('+') || 'none'
    log(`starting; publishing to ${this.cfg.htmlDir} (art source: ${artSource})`)
    await this.safe('rebuild', () => this.generator.rebuildManifest())
    await this.safe('summary', () => this.refreshSummary())
    // Refresh the dictionaries on the slow summary cadence so a backend upgrade is
    // picked up without a restart.
    await this.safe('dictionaries', () => this.publishDicts())
    setInterval(() => {
      void this.safe('dictionaries', () => this.publishDicts())
    }, this.cfg.summaryIntervalMs)

    // Aging tick: republish so bounded windows shed detections that age past
    // their cutoff even when nothing new is heard (re-counts the store, no fetch).
    setInterval(() => {
      void this.safe('aging', () => this.publish())
    }, this.cfg.agingIntervalMs)

    // Keep reacting to art deleted at runtime, not just at the next restart.
    await this.safe('assets-dir', async () => {
      await mkdir(this.cfg.assetsDir, { recursive: true })
    })
    watchAssetRemovals(this.cfg.assetsDir, () => void this.safe('heal', () => this.heal()), {
      debounceMs: ASSET_HEAL_DEBOUNCE_MS,
      rearmMs: ASSET_WATCH_REARM_MS,
      onError: logErr,
    })

    // The detection stream is the primary signal; it reconnects and re-backfills
    // until aborted (see stream.ts).
    await runDetectionStream(
      { baseUrl: this.cfg.baseUrl, token: this.cfg.token },
      {
        onConnect: async () => {
          log('stream connected')
          await this.safe('backfill', () => this.backfill())
          await this.safe('publish', () => this.publish())
        },
        onDetection: (row) => {
          if (this.store.add(row)) this.schedulePublish()
          if (!isComplete(this.manifest, row.scientificName)) {
            this.generator.enqueue(row.scientificName, row.commonName)
          }
        },
        // The server closes the stream every ~30 min (and any blip drops it);
        // undici surfaces that as `terminated`. It's expected and self-healing —
        // the loop reconnects and re-backfills — so log it as a reconnect, not a
        // failure.
        onError: (e) =>
          log(`stream disconnected (${e instanceof Error ? e.message : String(e)}); reconnecting`),
      },
    )
  }
}

async function main(): Promise<void> {
  const cfg = readConfig()
  const deps = makeNodeDeps(cfg.baseUrl, cfg.token)
  await new Refresher(cfg, deps).run()
}

void main().catch((e) => {
  logErr('startup', e)
  process.exitCode = 1
})
