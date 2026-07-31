import { useCallback, useEffect, useState } from 'react'
import { browserLanguages, type DictLocale, pickDictionaryLocale } from '../domain/locale.ts'

const STORAGE_KEY = 'saezuri:lang'

function storedLang(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Resolve the display language from the published set: a remembered valid choice
 *  wins; else the browser's language if published; else the station default if
 *  published; else English if published; else the first published language. Returns
 *  null only when nothing is published (so the caller hides the control and shows
 *  the station's own names). */
export function resolveInitialLang(
  locales: readonly DictLocale[],
  defaultLocale: DictLocale | null,
): DictLocale | null {
  if (locales.length === 0) return null
  const stored = storedLang()
  if (stored && locales.includes(stored as DictLocale)) return stored as DictLocale
  const browser = pickDictionaryLocale(browserLanguages(), locales)
  if (browser) return browser
  if (defaultLocale && locales.includes(defaultLocale)) return defaultLocale
  if (locales.includes('en')) return 'en'
  return locales[0]
}

/** The remembered display-language choice, plus a setter that persists it (like the
 *  theme). Preselects from the browser / station default the first time, recomputes
 *  when the published set arrives or changes, and always keeps a valid selection
 *  (or null when nothing is published). */
export function useLanguagePreference(
  locales: readonly DictLocale[],
  defaultLocale: DictLocale | null,
): { lang: DictLocale | null; setLang: (locale: DictLocale) => void } {
  const [lang, setLangState] = useState<DictLocale | null>(null)

  // `locales` arrives asynchronously (index.json) and can change (backend upgrade /
  // narrowed set). Keep an explicit valid choice; otherwise re-resolve.
  useEffect(() => {
    setLangState((cur) =>
      cur && locales.includes(cur) ? cur : resolveInitialLang(locales, defaultLocale),
    )
  }, [locales, defaultLocale])

  const setLang = useCallback((locale: DictLocale) => {
    setLangState(locale)
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      // Ignore private-mode storage failures; the choice still holds for the session.
    }
  }, [])

  return { lang, setLang }
}
