import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallManifest, CallRecord } from '../domain/calls.ts'
import { slugify } from '../domain/slug.ts'
import type { CallProvider } from './callProviders/types.ts'
import { USER_AGENT } from './userAgent.ts'

// Mirrors the art Generator — deduped by slug, serialized, capped per batch —
// because it has the same shape of problem: a third-party lookup per newly-heard
// species that must not stampede.
//
// Each recording is stored as two files: the audio, and a `<slug>.json` sidecar
// holding its CallRecord. The sidecar sits beside the audio rather than in the
// cache dir because the credit is a licence obligation, so it has to travel in
// the same volume as the file it credits. Separate them and an upgrade could
// leave us serving audio we can no longer attribute.

/** Archives do gain recordings, but rarely — and without a memory of misses every
 *  publish cycle would re-query every silent species, which is most of them. */
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Politeness gap between third-party lookups. */
const DEFAULT_LOOKUP_GAP_MS = 250

/** Leading underscore keeps it out of the manifest scan, matching the
 *  `_fallback.png` convention in the illustrations dir. */
const MISSES_FILE = '_misses.json'

const TAG = 'saezuri-calls'
const log = (msg: string) => console.log(`${TAG}: ${msg}`)
const logErr = (e: unknown) =>
  console.error(`${TAG}: ${e instanceof Error ? e.message : String(e)}`)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

/** Over the bytes rather than the URL, so a recording re-uploaded to the same
 *  URL still busts the immutable cache. */
function contentHash(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('hex').slice(0, 8)
}

export interface CallLibraryOptions {
  callsDir: string
  /** Tried in order; the first to answer wins. Empty ⇒ acquisition is off. */
  providers: readonly CallProvider[]
  /** 0 = no cap. */
  maxPerCycle: number
  /** Called only after a batch that acquired something. */
  onAcquired: () => void | Promise<void>
  lookupGapMs?: number
}

export class CallLibrary {
  private scientificNameBySlug = new Map<string, string>()
  private inFlightSlugs = new Set<string>()
  private busy = false
  private missedAtBySlug = new Map<string, number>()
  private missesLoaded = false

  constructor(private opts: CallLibraryOptions) {}

  get enabled(): boolean {
    return this.opts.providers.length > 0
  }

  enqueue(scientificName: string): void {
    if (!this.enabled) return
    const slug = slugify(scientificName)
    if (!slug || this.inFlightSlugs.has(slug) || this.scientificNameBySlug.has(slug)) return
    this.scientificNameBySlug.set(slug, scientificName)
    void this.drain()
  }

  private take(n: number): Array<[string, string]> {
    const out: Array<[string, string]> = []
    for (const entry of this.scientificNameBySlug) {
      this.scientificNameBySlug.delete(entry[0])
      out.push(entry)
      if (out.length >= n) break
    }
    return out
  }

  private async drain(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.loadMisses()
      while (this.scientificNameBySlug.size > 0) {
        const cap =
          this.opts.maxPerCycle > 0 ? this.opts.maxPerCycle : this.scientificNameBySlug.size
        const batch = this.take(cap)
        for (const [slug] of batch) this.inFlightSlugs.add(slug)
        let acquired = 0
        try {
          for (const [slug, sci] of batch) {
            if (await this.acquire(slug, sci)) acquired++
          }
          await this.saveMisses()
          // Republish before clearing inFlight, so a detection arriving mid-flight
          // sees the finished manifest rather than re-queueing the same species.
          if (acquired > 0) await this.opts.onAcquired()
        } catch (e) {
          logErr(e)
        } finally {
          for (const [slug] of batch) this.inFlightSlugs.delete(slug)
        }
      }
    } finally {
      this.busy = false
    }
  }

  /** True when a new recording landed on disk. */
  private async acquire(slug: string, sci: string): Promise<boolean> {
    if (existsSync(join(this.opts.callsDir, `${slug}.json`))) return false
    const missedAt = this.missedAtBySlug.get(slug)
    if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) return false

    for (const provider of this.opts.providers) {
      try {
        await sleep(this.opts.lookupGapMs ?? DEFAULT_LOOKUP_GAP_MS)
        const found = await provider.find(sci)
        if (!found) continue
        const bytes = await download(found.audioUrl)
        if (!bytes) continue

        await mkdir(this.opts.callsDir, { recursive: true })
        const record: CallRecord = {
          ext: found.ext,
          ver: contentHash(bytes),
          recordist: found.recordist,
          license: found.license,
          licenseUrl: found.licenseUrl,
          sourceUrl: found.sourceUrl,
          sourceName: found.sourceName,
        }
        // Audio before sidecar: the manifest scan keys off the sidecar, so this
        // order leaves a half-finished acquisition invisible rather than
        // published without its audio.
        await writeAtomic(join(this.opts.callsDir, `${slug}.${found.ext}`), bytes)
        await writeAtomic(join(this.opts.callsDir, `${slug}.json`), JSON.stringify(record))
        this.missedAtBySlug.delete(slug)
        log(`${sci}: ${found.sourceName} (${found.license})`)
        return true
      } catch (e) {
        // Transient by contract (see CallProvider.find), so leave the miss
        // unrecorded and let the next cycle try again.
        logErr(e)
        return false
      }
    }

    this.missedAtBySlug.set(slug, Date.now())
    return false
  }

  private async loadMisses(): Promise<void> {
    if (this.missesLoaded) return
    this.missesLoaded = true
    try {
      const raw = await readFile(join(this.opts.callsDir, MISSES_FILE), 'utf8')
      const data = JSON.parse(raw) as Record<string, number>
      for (const [slug, at] of Object.entries(data)) {
        if (typeof at === 'number') this.missedAtBySlug.set(slug, at)
      }
    } catch {
      // Absent or unreadable: start empty and rebuild it.
    }
  }

  private async saveMisses(): Promise<void> {
    try {
      await mkdir(this.opts.callsDir, { recursive: true })
      await writeAtomic(
        join(this.opts.callsDir, MISSES_FILE),
        JSON.stringify(Object.fromEntries(this.missedAtBySlug)),
      )
    } catch (e) {
      logErr(e) // non-fatal: we just re-query after a restart
    }
  }
}

/** Size is already bounded when the candidate is chosen; this guards the case
 *  where the archive's stated size and what it actually serves disagree. */
async function download(audioUrl: string, maxBytes = 16 * 1024 * 1024): Promise<Buffer | null> {
  const res = await fetch(audioUrl, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) return null
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > maxBytes) return null
  const bytes = Buffer.from(await res.arrayBuffer())
  return bytes.byteLength > maxBytes || bytes.byteLength === 0 ? null : bytes
}

/** Disk is the source of truth, as it is for the layout manifest: a sidecar with
 *  no audio (or vice versa) is skipped rather than published half-credited. */
export async function publishCallManifest(
  htmlDir: string,
  callsDir: string,
): Promise<CallManifest> {
  const calls: Record<string, CallRecord> = {}
  let names: string[] = []
  try {
    names = await readdir(callsDir)
  } catch {
    // Nothing acquired yet — still publish, so the browser gets {} not a 404.
  }

  for (const name of names) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue
    const slug = name.slice(0, -'.json'.length)
    try {
      const rec = JSON.parse(await readFile(join(callsDir, name), 'utf8')) as CallRecord
      if (!rec?.ext || !rec.license || !rec.sourceUrl) continue
      if (!existsSync(join(callsDir, `${slug}.${rec.ext}`))) continue
      calls[slug] = rec
    } catch {
      // Malformed sidecar — skip it rather than fail the whole publish.
    }
  }

  const manifest: CallManifest = { calls }
  await writeAtomic(join(htmlDir, 'calls-manifest.json'), JSON.stringify(manifest))
  return manifest
}
