import { useEffect, useRef, useState } from 'react'
import type { DictLocale } from '../domain/locale.ts'
import { type ThemePref, useThemePreference } from '../hooks/useThemePreference.ts'
import { LanguageSelect } from './LanguageSelect.tsx'
import { SegmentedControl } from './SegmentedControl.tsx'

const THEMES: readonly ThemePref[] = ['light', 'dark', 'auto']
const themeLabel = (t: ThemePref) => t.charAt(0).toUpperCase() + t.slice(1)

interface Props {
  /** Published display languages (from the dictionary index). */
  locales: readonly DictLocale[]
  /** Current display language, or null when nothing is published. */
  lang: DictLocale | null
  onLang: (locale: DictLocale) => void
}

/** Topbar settings: a menu button opening a popover with the theme switcher
 *  (light/dark/auto) and the display-language dropdown. Replaces the old bare
 *  light/dark toggle. */
export function SettingsMenu({ locales, lang, onLang }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { theme, setTheme } = useThemePreference()

  // Close on outside-click and Escape; Escape returns focus to the button.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          <div className="menu-row" role="none">
            <span className="menu-label mono">Theme</span>
            <SegmentedControl
              values={THEMES}
              value={theme}
              onChange={setTheme}
              renderLabel={themeLabel}
              ariaLabel="Theme"
              variant="radiogroup"
            />
          </div>
          {locales.length > 0 && (
            <div className="menu-row" role="none">
              <span className="menu-label mono">Language</span>
              <LanguageSelect locales={locales} value={lang} onChange={onLang} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
