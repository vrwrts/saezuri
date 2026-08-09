import { slugify } from './slug.ts'

// The refresh service caches one reference recording per detected species and
// describes it here, so the browser plays audio from Saezuri's own origin like
// every other asset and never reaches the archive directly.
//
// Attribution is not decoration: every recording carries a CC licence requiring
// the recordist be credited wherever it is played. That is why the credit fields
// are required rather than optional, and why the UI renders them alongside the
// play control.

export const CALLS_BASE = '/assets/calls'

export interface CallRecord {
  /** Archives serve mixed formats and we re-encode nothing — re-encoding a
   *  CC-ND recording would make it a derivative — so it varies per species. */
  ext: string
  /** Short content hash; see `imagePath` in asset.ts for the `?v=` convention. */
  ver: string
  /** Empty when the archive names none. */
  recordist: string
  license: string
  licenseUrl?: string
  sourceUrl: string
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

/** Null is the ordinary case, not a failure — most species have no
 *  free-licensed recording in the archives. */
export function callFor(manifest: CallManifest, scientificName: string): CallRecord | null {
  return manifest.calls[slugify(scientificName)] ?? null
}
