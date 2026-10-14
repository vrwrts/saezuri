import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallManifest, CallRecord } from '../domain/calls.ts'
import { slugify } from '../domain/slug.ts'
import type { CallDetection, CallLookup, CallProvider } from './callProviders/types.ts'
import { USER_AGENT } from './userAgent.ts'

// Mirrors the art Generator — deduped by slug, serialized, capped per batch —
// because it has the same shape of problem: an audio lookup per newly-heard
// species that must not stampede.
//
// Each recording is stored as two files: the audio, and a `<slug>.json` sidecar
// holding its CallRecord and private cache provenance. The sidecar sits beside
// the audio so the two travel in the same persistent volume.

/** Without a memory of misses every publish cycle would repeat settled lookups. */
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Politeness gap between provider lookups. */
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

interface StoredCallRecord extends CallRecord {
  provider?: string
  sourceKey?: string
}

export class CallLibrary {
  private lookupBySlug = new Map<string, CallLookup>()
  private inFlightSlugs = new Set<string>()
  private busy = false
  private missedAtByKey = new Map<string, number>()
  private missesLoaded = false

  constructor(private opts: CallLibraryOptions) {}

  get enabled(): boolean {
    return this.opts.providers.length > 0
  }

  enqueue(scientificName: string, detections: readonly CallDetection[] = []): void {
    if (!this.enabled) return
    const slug = slugify(scientificName)
    if (!slug || this.inFlightSlugs.has(slug)) return
    this.lookupBySlug.set(slug, { scientificName, detections })
    void this.drain()
  }

  private take(n: number): Array<[string, CallLookup]> {
    const out: Array<[string, CallLookup]> = []
    for (const entry of this.lookupBySlug) {
      this.lookupBySlug.delete(entry[0])
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
      while (this.lookupBySlug.size > 0) {
        const cap = this.opts.maxPerCycle > 0 ? this.opts.maxPerCycle : this.lookupBySlug.size
        const batch = this.take(cap)
        for (const [slug] of batch) this.inFlightSlugs.add(slug)
        let acquired = 0
        try {
          for (const [slug, lookup] of batch) {
            if (await this.acquire(slug, lookup)) acquired++
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
  private async acquire(slug: string, lookup: CallLookup): Promise<boolean> {
    const existing = await this.readStored(slug)
    // Sidecars from before provider provenance identify Commons by source name;
    // recognizing them avoids re-downloading every cached call on upgrade.
    const currentProvider =
      existing?.provider ?? (existing?.sourceName === 'Wikimedia Commons' ? 'commons' : undefined)
    const currentIndex = this.opts.providers.findIndex((p) => p.name === currentProvider)

    for (const [index, provider] of this.opts.providers.entries()) {
      if (existing && currentIndex >= 0 && index > currentIndex) break
      const sourceKey = provider.sourceKey?.(lookup)
      // Older releases keyed Commons misses by slug, so retain that shape and
      // avoid repeating all settled archive lookups once after an upgrade.
      const missKey = sourceKey
        ? `${provider.name}:${slug}:${sourceKey}`
        : provider.name === 'commons'
          ? slug
          : `${provider.name}:${slug}`
      const missedAt = this.missedAtByKey.get(missKey)
      if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) {
        if (index === currentIndex) return false
        continue
      }
      if (index === currentIndex && (!sourceKey || sourceKey === existing?.sourceKey)) return false

      try {
        await sleep(this.opts.lookupGapMs ?? DEFAULT_LOOKUP_GAP_MS)
        const found = await provider.find({
          ...lookup,
          current: existing
            ? { provider: currentProvider ?? '', sourceKey: existing.sourceKey }
            : undefined,
        })
        if (!found) {
          this.missedAtByKey.set(missKey, Date.now())
          if (index === currentIndex) return false
          continue
        }
        const bytes = found.bytes
          ? Buffer.from(found.bytes)
          : found.audioUrl
            ? await download(found.audioUrl)
            : null
        if (!bytes) {
          this.missedAtByKey.set(missKey, Date.now())
          continue
        }

        await mkdir(this.opts.callsDir, { recursive: true })
        const record: StoredCallRecord = {
          ext: found.ext,
          ver: contentHash(bytes),
          recordist: found.recordist,
          license: found.license,
          licenseUrl: found.licenseUrl,
          sourceUrl: found.sourceUrl,
          sourceName: found.sourceName,
          provider: provider.name,
          sourceKey: found.sourceKey,
        }
        // Audio before sidecar: the manifest scan keys off the sidecar, so this
        // order leaves a half-finished acquisition invisible rather than
        // published without its audio.
        await writeAtomic(join(this.opts.callsDir, `${slug}.${found.ext}`), bytes)
        await writeAtomic(join(this.opts.callsDir, `${slug}.json`), JSON.stringify(record))
        this.missedAtByKey.delete(missKey)
        log(
          `${lookup.scientificName}: ${found.sourceName}${found.license ? ` (${found.license})` : ''}`,
        )
        return true
      } catch (e) {
        // Not a settled miss by contract (see CallProvider.find), so leave it
        // unrecorded and let the next cycle try again.
        logErr(e)
        return false
      }
    }

    return false
  }

  private async readStored(slug: string): Promise<StoredCallRecord | null> {
    try {
      return JSON.parse(
        await readFile(join(this.opts.callsDir, `${slug}.json`), 'utf8'),
      ) as StoredCallRecord
    } catch {
      return null
    }
  }

  private async loadMisses(): Promise<void> {
    if (this.missesLoaded) return
    this.missesLoaded = true
    try {
      const raw = await readFile(join(this.opts.callsDir, MISSES_FILE), 'utf8')
      const data = JSON.parse(raw) as Record<string, number>
      for (const [slug, at] of Object.entries(data)) {
        if (typeof at === 'number') this.missedAtByKey.set(slug, at)
      }
    } catch {
      // Absent or unreadable: start empty and rebuild it.
    }
  }

  private async saveMisses(): Promise<void> {
    const cutoff = Date.now() - MISS_TTL_MS
    for (const [key, at] of this.missedAtByKey) {
      if (at <= cutoff) this.missedAtByKey.delete(key)
    }
    try {
      await mkdir(this.opts.callsDir, { recursive: true })
      await writeAtomic(
        join(this.opts.callsDir, MISSES_FILE),
        JSON.stringify(Object.fromEntries(this.missedAtByKey)),
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
  birdnetUiBaseUrl?: string,
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
      const rec = JSON.parse(await readFile(join(callsDir, name), 'utf8')) as StoredCallRecord
      if (!rec?.ext || !rec.sourceName) continue
      if (rec.provider !== 'birdnet' && (!rec.license || !rec.sourceUrl)) continue
      if (!existsSync(join(callsDir, `${slug}.${rec.ext}`))) continue
      const { provider: _provider, sourceKey: _sourceKey, ...published } = rec
      if (rec.provider === 'birdnet') {
        // Detection links are opt-in and derived from the browser-reachable base;
        // never leak a stale or provider-supplied URL from the private sidecar.
        const { sourceUrl: _storedSourceUrl, ...birdnetCall } = published
        calls[slug] =
          birdnetUiBaseUrl && rec.sourceKey
            ? {
                ...birdnetCall,
                sourceUrl: `${birdnetUiBaseUrl.replace(/\/+$/, '')}/ui/detections/${encodeURIComponent(rec.sourceKey)}`,
              }
            : birdnetCall
      } else {
        calls[slug] = published
      }
    } catch {
      // Malformed sidecar — skip it rather than fail the whole publish.
    }
  }

  const manifest: CallManifest = { calls }
  await writeAtomic(join(htmlDir, 'calls-manifest.json'), JSON.stringify(manifest))
  return manifest
}
