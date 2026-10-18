import { withBase } from '../lib/basePath.ts'
import { slugify } from './slug.ts'

// The refresh service caches one recording per detected species and
// describes it here, so the browser plays audio from Saezuri's own origin like
// every other asset and never reaches the source directly.
//
// Archive attribution is a licence obligation, not decoration: CC licences
// require the recordist be credited wherever the recording plays, so the UI
// must show the credit alongside the play control. A station's own BirdNET-Go
// clip needs no archive licence or named recordist; its source link is shown
// only when a browser-reachable BirdNET-Go URL is configured.

export const CALLS_BASE = withBase('/assets/calls')

export interface CallRecord {
  /** Immutable content-versioned basename; absent on legacy caches and dev tones. */
  audioFile?: string
  /** Archives serve mixed formats and we re-encode nothing — re-encoding a
   *  CC-ND recording would make it a derivative — so it varies per species. */
  ext: string
  /** Content hash; legacy caches may carry a shorter fingerprint. */
  ver: string
  /** Empty when the archive names none. */
  recordist: string
  license?: string
  licenseUrl?: string
  /** Absent when the source has no browser-reachable recording page. */
  sourceUrl?: string
  sourceName: string
}

export interface CallManifest {
  calls: Record<string, CallRecord>
}

export const EMPTY_CALL_MANIFEST: CallManifest = { calls: {} }

export function callFilename(slug: string, rec: CallRecord): string {
  return rec.audioFile ?? `${slug}.${rec.ext}`
}

export function callPath(scientificName: string, rec: CallRecord): string {
  const url = `${CALLS_BASE}/${callFilename(slugify(scientificName), rec)}`
  return rec.ver ? `${url}?v=${rec.ver}` : url
}

/** Null is the ordinary case, not a failure — a species may have no saved
 *  station clip or free-licensed archive recording. */
export function callFor(manifest: CallManifest, scientificName: string): CallRecord | null {
  return manifest.calls[slugify(scientificName)] ?? null
}
