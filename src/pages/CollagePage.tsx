import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Collage } from '../collage/Collage.tsx'
import { CollageLoading } from '../components/CollageLoading.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { ErrorBoundary } from '../components/ErrorBoundary.tsx'
import { Header } from '../components/Header.tsx'
import { SettingsMenu } from '../components/SettingsMenu.tsx'
import { WindowPicker } from '../components/WindowPicker.tsx'
import { mockSpecies } from '../dev/mock.ts'
import { localizeCommonNames, type Species } from '../domain/species.ts'
import { pathToPreset, presetToSegment, type WindowPreset } from '../domain/window.ts'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import { useDictionaryIndex } from '../hooks/useDictionaryIndex.ts'
import { useLanguagePreference } from '../hooks/useLanguagePreference.ts'
import { useLayoutManifest } from '../hooks/useLayoutManifest.ts'
import { useRecentSpecies } from '../hooks/useRecentSpecies.ts'
import { useSpeciesDictionary } from '../hooks/useSpeciesDictionary.ts'
import { collagePath } from '../routes.ts'

// Hold the loading indicator back so a quick window switch doesn't flash it
// (see useDelayedFlag).
const LOADING_INDICATOR_DELAY_MS = 1000

// When VITE_MOCK=1, species come from the local manifest instead of a live
// BirdNET-Go, so the collage can be demoed without a backend.
const USE_MOCK = import.meta.env.VITE_MOCK === '1'

/** The collage for a single time window, addressed by URL (`/1h`, `/24h`, …).
 *  The window preset lives entirely in the path — this component derives it from
 *  the `:window` route param and navigates to change it, so a window is
 *  shareable, bookmarkable, and survives reload. */
export default function CollagePage() {
  const { window: windowParam } = useParams()
  const preset = pathToPreset(windowParam ?? '')

  // Unknown window in the URL: send it to the default rather than rendering
  // nothing. The route table also catches `/` and unknown paths, but this
  // guards a segment that looked like a window but isn't (e.g. `/2h`).
  if (!preset) return <Navigate to={collagePath('24H')} replace />
  // Canonicalize casing so the address bar matches the picker (`/1H` -> `/1h`).
  if (windowParam !== presetToSegment(preset)) {
    return <Navigate to={collagePath(preset)} replace />
  }

  return <CollageView preset={preset} />
}

function CollageView({ preset }: { preset: WindowPreset }) {
  const navigate = useNavigate()
  const manifest = useLayoutManifest()
  const live = useRecentSpecies(preset)
  // Localization is a non-blocking overlay on top of the snapshot: a slow or absent
  // dictionary never gates the collage — names just swap in once it arrives.
  const { locales, default: defaultLocale } = useDictionaryIndex()
  const { lang, setLang } = useLanguagePreference(locales, defaultLocale)
  const dict = useSpeciesDictionary(lang)
  const baseSpecies: Species[] = USE_MOCK ? mockSpecies(manifest) : live.species
  const species = useMemo(() => localizeCommonNames(baseSpecies, dict), [baseSpecies, dict])

  // The first snapshot fetch shows the loading indicator instead of the empty
  // nest; once loaded, switching windows is instant (one file, all windows), so
  // this stays false. Mock mode synthesizes species synchronously — no loading.
  const loading = USE_MOCK ? false : live.loading

  // `loading` gates the collage either way; this only decides whether the
  // indicator shows during it.
  const showLoadingIndicator = useDelayedFlag(loading, LOADING_INDICATOR_DELAY_MS)

  // `species` arrives pre-gated to illustrated-only from the snapshot; `heard`
  // and `notIllustrated` describe the withheld tail. Mock species are all
  // illustrated, so nothing is withheld.
  const heard = USE_MOCK ? species.length : live.heard
  const notIllustrated = USE_MOCK ? 0 : live.notIllustrated

  // Distinguish a genuinely empty window from one where birds were heard but
  // none is illustrated yet (e.g. right after a new species, or a container with
  // no generated art).
  const emptyState =
    species.length === 0 && heard > 0 ? (
      <EmptyState
        fallbackKey={manifest.fallbackKey}
        message={`heard ${heard} species — none illustrated yet`}
      />
    ) : (
      <EmptyState fallbackKey={manifest.fallbackKey} />
    )

  return (
    <div className="stage">
      <div className="topbar">
        <SettingsMenu locales={locales} lang={lang} onLang={setLang} />
      </div>

      <Header eyebrow="around here" title="recently heard" />

      <div className="controls">
        <WindowPicker value={preset} onChange={(p) => navigate(collagePath(p))} />
      </div>

      <main className="view">
        {loading ? (
          showLoadingIndicator && <CollageLoading />
        ) : (
          <ErrorBoundary>
            <Collage
              species={species}
              manifest={manifest}
              blossomKey={preset}
              emptyState={emptyState}
            />
          </ErrorBoundary>
        )}
      </main>

      <footer className="status mono">
        <StatusLine
          loading={loading}
          count={species.length}
          notIllustrated={notIllustrated}
          truncated={!USE_MOCK && live.truncated}
          error={!USE_MOCK ? live.error : null}
        />
        <span className="wordmark">Saezuri · さえずり</span>
      </footer>
    </div>
  )
}

interface StatusProps {
  loading: boolean
  count: number
  notIllustrated: number
  truncated: boolean
  error: Error | null
}

function StatusLine({ loading, count, notIllustrated, truncated, error }: StatusProps) {
  // Mid-load the count is not yet meaningful (it would read "0 species"); the
  // centered indicator carries the state, so the status line stays quiet.
  if (loading) return null
  // The browser reads a static snapshot now, not BirdNET-Go directly, so a
  // failure means the snapshot is unavailable/stale, not the backend.
  if (error) return <span className="status-warn">waiting for data — {error.message}</span>
  const parts: string[] = [`${count} species`]
  if (notIllustrated > 0) parts.push(`${notIllustrated} awaiting art`)
  if (truncated) parts.push('window truncated')
  return <span>{parts.join(' · ')}</span>
}
