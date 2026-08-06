import { slugify } from './slug.ts'

// Per-species reference calls. The refresh service fetches one recording per
// detected species from a third-party archive, caches it on this deployment's
// own disk, and describes it here — so the browser plays audio from Saezuri's
// own origin like every other asset, never from the archive directly.
//
// Attribution is not decoration: every recording carries a CC licence requiring
// the recordist be credited wherever it is played. `by` / `lic` / `src` are
// therefore required, and the UI must render them alongside the play control.

/** Where cached recordings are served from (mirrors ILLUSTRATIONS_BASE). */
export const CALLS_BASE = '/assets/calls'

export interface CallRecord {
  /** Published file extension, e.g. 'mp3' | 'ogg'. Archives serve mixed formats
   *  and we re-encode nothing (re-encoding a CC-ND recording would make it a
   *  derivative), so the format is carried per species rather than assumed. */
  ext: string
  /** Short content hash; see `imagePath` in asset.ts for the `?v=` convention. */
  ver: string
  /** Recordist. May be empty when the archive records none. */
  by: string
  /** Licence name, e.g. 'CC BY-SA 4.0'. */
  lic: string
  licUrl?: string
  /** Canonical page for the recording, linked from the credit. */
  src: string
  /** Archive it came from, e.g. 'Wikimedia Commons'. */
  srcName: string
}

export interface CallManifest {
  /** slug -> the one cached recording for that species. */
  calls: Record<string, CallRecord>
}

export const EMPTY_CALL_MANIFEST: CallManifest = { calls: {} }

/** Same-origin URL for a species' cached recording. */
export function callPath(scientificName: string, rec: CallRecord): string {
  const url = `${CALLS_BASE}/${slugify(scientificName)}.${rec.ext}`
  return rec.ver ? `${url}?v=${rec.ver}` : url
}

/** The cached recording for a species, or null when there is none — the common
 *  case, since most species have no free-licensed recording in the archives. */
export function callFor(manifest: CallManifest, scientificName: string): CallRecord | null {
  return manifest.calls[slugify(scientificName)] ?? null
}
