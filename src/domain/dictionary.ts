import type { DictLocale } from './locale.ts'

// Manifest of the species-name dictionaries the refresh service publishes. Written
// to /species-dict/index.json and read by the browser to know which display
// languages are available and which to preselect. Kept in a React/SWR-free module
// so both the Node service (writer) and the browser hooks (reader) share the shape.

export interface DictionaryIndex {
  /** Dictionary locale codes a `/species-dict/<code>.json` file exists for. */
  locales: DictLocale[]
  /** The station's configured BirdNET locale, reduced to a dictionary code — the
   *  fallback preselect when the browser's language isn't published. Null when the
   *  station locale isn't one of the dictionary languages (or couldn't be read). */
  default: DictLocale | null
}
