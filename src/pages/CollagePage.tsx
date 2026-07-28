import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Collage } from '../collage/Collage.tsx'
import { CollageLoading } from '../components/CollageLoading.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { ErrorBoundary } from '../components/ErrorBoundary.tsx'
import { Header } from '../components/Header.tsx'
import { ThemeToggle } from '../components/ThemeToggle.tsx'
import { WindowPicker } from '../components/WindowPicker.tsx'
import { mockSpecies } from '../dev/mock.ts'
import type { Species } from '../domain/species.ts'
import { pathToPreset, presetToSegment, type WindowPreset } from '../domain/window.ts'
import { useDelayedFlag } from '../hooks/useDelayedFlag.ts'
import { useLayoutManifest } from '../hooks/useLayoutManifest.ts'
import { useRecentSpecies } from '../hooks/useRecentSpecies.ts'
import { collagePath } from '../routes.ts'

// A fast window switch resolves in well under a second; showing the loading
// indicator immediately makes it flash jarringly. Hold it back so only a
// genuinely slow load ever surfaces it.
const LOADING_INDICATOR_DELAY_MS = 1000

// When VITE_MOCK=1, species come from the local manifest instead of a live
// BirdNET-Go, so the collage can be demoed without a backend.
const USE_MOCK = import.meta.env.VITE_MOCK === '1'

/** The collage for a single time window, addressed by URL (`/collage/1h`,
 *  `/collage/24h`, …). The window preset lives entirely in the path — this
 *  component derives it from the `:window` route param and navigates to change
 *  it, so a window is shareable, bookmarkable, and survives reload. */
export default function CollagePage() {
  const { window: windowParam } = useParams()
  const preset = pathToPreset(windowParam ?? '')

  // Unknown window in the URL: send it to the default rather than rendering
  // nothing. The route table also catches `/` and non-collage paths, but this
  // guards a segment that looked like a window but isn't (e.g. `/collage/2h`).
  if (!preset) return <Navigate to={collagePath('24H')} replace />
  // Canonicalize casing so the address bar matches the picker (`/collage/1H` ->
  // `/collage/1h`).
  if (windowParam !== presetToSegment(preset)) {
    return <Navigate to={collagePath(preset)} replace />
  }

  return <CollageView preset={preset} />
}

function CollageView({ preset }: { preset: WindowPreset }) {
  const navigate = useNavigate()
  const manifest = useLayoutManifest()
  const live = useRecentSpecies(preset)
  const species: Species[] = USE_MOCK ? mockSpecies(manifest) : live.species

  // The first snapshot fetch shows the loading indicator instead of the empty
  // nest; once loaded, switching windows is instant (one file, all windows), so
  // this stays false. Mock mode synthesizes species synchronously — no loading.
  const loading = USE_MOCK ? false : live.loading

  // Suppress the indicator for the first second of loading — a quick load shows
  // nothing rather than a jarring flash. `loading` still gates the collage, so
  // the view stays blank until either the data arrives or the delay elapses.
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
      <div className="controls">
        <WindowPicker value={preset} onChange={(p) => navigate(collagePath(p))} />
        <ThemeToggle />
      </div>

      <Header eyebrow="around here" title="recently heard" />

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
  notIllustrated: number
  truncated: boolean
  error: Error | null
}

function StatusLine({ loading, notIllustrated, truncated, error }: StatusProps) {
  // The species count has moved out of the footer to free the band for
  // navigation; the status line now stays empty in the normal case and only
  // surfaces on a problem (loading, error) or a caveat (awaiting art, truncated).
  if (loading) return null
  // The browser reads a static snapshot now, not BirdNET-Go directly, so a
  // failure means the snapshot is unavailable/stale, not the backend.
  if (error) return <span className="status-warn">waiting for data — {error.message}</span>
  const parts: string[] = []
  if (notIllustrated > 0) parts.push(`${notIllustrated} awaiting art`)
  if (truncated) parts.push('window truncated')
  if (parts.length === 0) return null
  return <span>{parts.join(' · ')}</span>
}
