import type { DictLocale, DisplayLanguage } from '../domain/locale.ts'

interface Props {
  locales: readonly DictLocale[]
  value: DisplayLanguage
  onChange: (locale: DisplayLanguage) => void
}

/** A locale's name in its own language (endonym), title-cased. Uses the browser's
 *  Intl.DisplayNames — no bundled name table — and falls back to the raw code. */
function endonym(code: DictLocale): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code)
    if (name) return name.charAt(0).toUpperCase() + name.slice(1)
  } catch {
    // Intl.DisplayNames unsupported / unknown code — fall back to the code.
  }
  return code
}

/** Native styled dropdown of the published display languages, plus the station's
 *  own names. Hidden when no dictionaries are published. */
export function LanguageSelect({ locales, value, onChange }: Props) {
  if (locales.length === 0) return null

  return (
    <select
      className="lang-select mono"
      aria-label="Display language"
      value={value}
      onChange={(e) => onChange(e.target.value as DisplayLanguage)}
    >
      <option value="station">Station language</option>
      {locales.map((code) => (
        <option key={code} value={code}>
          {endonym(code)}
        </option>
      ))}
    </select>
  )
}
