import { withBase } from '../lib/basePath.ts'
import { slugify } from './slug.ts'

// The refresh service caches one recording per detected species and
// describes it here, so the browser plays audio from Saezuri's own origin like
// every other asset and never reaches the source directly.
//
// Archive recordings carry attribution alongside the play control. A station's
// own BirdNET-Go clip has no archive licence or named recordist, and its source
// link is shown only when a browser-reachable BirdNET-Go URL is configured.

export const CALLS_BASE = withBase('/assets/calls')

export interface CallRecord {
  /** Archives serve mixed formats and we re-encode nothing — re-encoding a
   *  CC-ND recording would make it a derivative — so it varies per species. */
  ext: string
  /** Short content hash; see `imagePath` in asset.ts for the `?v=` convention. */
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

export function callPath(scientificName: string, rec: CallRecord): string {
  const url = `${CALLS_BASE}/${slugify(scientificName)}.${rec.ext}`
  return rec.ver ? `${url}?v=${rec.ver}` : url
}

/** Null is the ordinary case, not a failure — a species may have no saved
 *  station clip or free-licensed archive recording. */
export function callFor(manifest: CallManifest, scientificName: string): CallRecord | null {
  return manifest.calls[slugify(scientificName)] ?? null
}
