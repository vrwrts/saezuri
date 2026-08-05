import { useEffect, useState } from 'react'

// The saved theme *preference*: light / dark, or `auto` (follow the OS). The
// resolved value is written to `data-theme` on <html>, which drives the tokens in
// shared/theme.css. The initial value is applied pre-paint by the inline script in
// index.html (it already treats `auto`/unset as "follow the OS"), so this hook only
// handles subsequent changes and live OS-scheme flips while in `auto`.

export type ThemePref = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'saezuri:theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function storedTheme(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'auto') return v
  } catch {
    // ignore private-mode storage failures
  }
  return 'auto'
}

/** `auto` follows the OS via matchMedia, which is absent in jsdom — so it resolves
 *  to light there. */
function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'auto') {
    return typeof matchMedia !== 'undefined' && matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
  }
  return pref
}

export function useThemePreference(): { theme: ThemePref; setTheme: (pref: ThemePref) => void } {
  const [theme, setTheme] = useState<ThemePref>(storedTheme)

  useEffect(() => {
    const apply = () => document.documentElement.setAttribute('data-theme', resolveTheme(theme))
    apply()
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // ignore private-mode storage failures; the theme still applies for the session
    }
    // While following the OS, re-resolve when the system scheme flips.
    if (theme !== 'auto' || typeof matchMedia === 'undefined') return
    const mq = matchMedia(DARK_QUERY)
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  return { theme, setTheme }
}
