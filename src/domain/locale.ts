// Browser-language → BirdNET-Go dictionary-locale mapping. Pure and dependency-free
// so both the browser (picking a display language) and the Node refresh service
// (reducing the station's configured locale) share one source of truth. No
// translations live here — only locale codes and the reduction rule.
//
// The 16 codes mirror BirdNET-Go's species-dictionary set
// (internal/speciesdict/data/*.json.gz). Region variants are intentionally absent:
// the dictionaries are keyed by base language, so `de-DE`/`pt-BR` reduce to
// `de`/`pt`.

export const SUPPORTED_DICT_LOCALES = [
  'cs',
  'da',
  'de',
  'en',
  'es',
  'fi',
  'fr',
  'hu',
  'it',
  'lv',
  'nb',
  'nl',
  'pl',
  'pt',
  'sk',
  'sv',
] as const

export type DictLocale = (typeof SUPPORTED_DICT_LOCALES)[number]

/** Reduce a BCP-47 tag to its dictionary base code. Lowercased, first subtag only
 *  (`de-DE`->`de`), with Norwegian folded onto `nb`: browsers send `no`
 *  (macrolanguage) or `nn` (Nynorsk), but the dictionary set uses `nb` (Bokmål). */
function baseSubtag(tag: string): string {
  const base = tag.toLowerCase().split('-')[0]
  if (base === 'no' || base === 'nn') return 'nb'
  return base
}

/** Map one language tag to a dictionary locale present in `available`, or null
 *  when it reduces to nothing available. `available` is expected to be a subset of
 *  SUPPORTED_DICT_LOCALES (the codes a build actually published). Pure. */
export function reduceToDictLocale(tag: string, available: readonly string[]): DictLocale | null {
  const base = baseSubtag(tag)
  return available.includes(base) ? (base as DictLocale) : null
}

/** First of the browser's ordered language preferences that maps to an available
 *  dictionary locale, or null when none do. Pure — pass navigator.languages in. */
export function pickDictionaryLocale(
  languages: readonly string[],
  available: readonly string[],
): DictLocale | null {
  for (const tag of languages) {
    const loc = reduceToDictLocale(tag, available)
    if (loc) return loc
  }
  return null
}

/** The browser's ordered language preferences, or [] when there is no navigator
 *  (Node/jsdom without one). Impure; kept apart so the pickers stay DOM-free. */
export function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  const langs = navigator.languages
  if (langs && langs.length > 0) return [...langs]
  return navigator.language ? [navigator.language] : []
}
