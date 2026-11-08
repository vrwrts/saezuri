import { useCallback, useEffect, useState } from 'react'
import {
  browserLanguages,
  type DictLocale,
  type DisplayLanguage,
  pickDictionaryLocale,
} from '../domain/locale.ts'

const STORAGE_KEY = 'saezuri:lang'

function storedLang(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Resolve the display language from a saved preference, then the browser's
 *  preferred published dictionary. When no browser language is published,
 *  use the station's own names instead of an unrelated dictionary. */
export function resolveInitialLang(locales: readonly DictLocale[]): DisplayLanguage {
  const stored = storedLang()
  if (stored === 'station') return 'station'
  if (stored && locales.includes(stored as DictLocale)) return stored as DictLocale

  return pickDictionaryLocale(browserLanguages(), locales) ?? 'station'
}

/** The remembered display-language choice, plus a setter that persists it
 *  (like the theme). */
export function useLanguagePreference(locales: readonly DictLocale[]): {
  lang: DisplayLanguage
  setLang: (locale: DisplayLanguage) => void
} {
  const [lang, setLangState] = useState<DisplayLanguage>(() => resolveInitialLang(locales))

  useEffect(() => {
    setLangState(resolveInitialLang(locales))
  }, [locales])

  const setLang = useCallback((locale: DisplayLanguage) => {
    setLangState(locale)
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      // Ignore private-mode storage failures; the choice still holds for the session.
    }
  }, [])

  return { lang, setLang }
}
