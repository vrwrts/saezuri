import { Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DictLocale } from '../domain/locale.ts'
import { type ThemePref, useThemePreference } from '../hooks/useThemePreference.ts'
import { LanguageSelect } from './LanguageSelect.tsx'
import { SegmentedControl } from './SegmentedControl.tsx'

const THEMES: readonly ThemePref[] = ['light', 'dark', 'auto']

const MENU_ICON_PX = 16
const themeLabel = (t: ThemePref) => t.charAt(0).toUpperCase() + t.slice(1)

// Popover enter/exit duration; must stay in sync with the .menu-popover transition
// in index.css so the element is unmounted only after the exit finishes.
const PANEL_ANIM_MS = 160

/** Skip the enter/exit animation when the user asked to reduce motion — and in
 *  jsdom, which has no matchMedia, so the popover mounts/unmounts synchronously in
 *  tests. */
function animationsOff(): boolean {
  return typeof matchMedia === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface Props {
  /** Published display languages (from the dictionary index). */
  locales: readonly DictLocale[]
  /** Current display language, or null when nothing is published. */
  lang: DictLocale | null
  onLang: (locale: DictLocale) => void
}

/** Topbar settings: a menu button opening a soft popover card with the theme
 *  switcher (light/dark/auto) and the display-language dropdown. The card animates
 *  in and out from the button corner. */
export function SettingsMenu({ locales, lang, onLang }: Props) {
  const [open, setOpen] = useState(false)
  // `mounted` keeps the card in the DOM through its exit animation; `shown` drives
  // the `.is-open` transition (flipped a frame after mount so the entry plays).
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { theme, setTheme } = useThemePreference()

  useEffect(() => {
    if (open) {
      setMounted(true)
      if (animationsOff()) {
        setShown(true)
        return
      }
      // Two frames: let the browser paint the mounted (hidden) state before
      // flipping to `.is-open`, so the transition actually runs.
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setShown(false)
    if (animationsOff()) {
      setMounted(false)
      return
    }
    const timer = setTimeout(() => setMounted(false), PANEL_ANIM_MS)
    return () => clearTimeout(timer)
  }, [open])

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
        <Settings size={MENU_ICON_PX} />
      </button>
      {mounted && (
        <div className={`menu-popover${shown ? ' is-open' : ''}`} role="menu">
          <div className="menu-row" role="none">
            <span className="menu-label mono">theme</span>
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
              <span className="menu-label mono">language</span>
              <LanguageSelect locales={locales} value={lang} onChange={onLang} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
