import type { DictLocale } from './locale.ts'

// Manifest of the species-name dictionaries the refresh service publishes. Written
// to /species-dict/index.json and read by the browser to know which display
// languages are available. Kept in a React/SWR-free module
// so both the Node service (writer) and the browser hooks (reader) share the shape.

export interface DictionaryIndex {
  /** Dictionary locale codes a `/species-dict/<code>.json` file exists for. */
  locales: DictLocale[]
}
