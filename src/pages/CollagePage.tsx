import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Collage } from '../collage/Collage.tsx'
import { CollageLoading } from '../components/CollageLoading.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { ErrorBoundary } from '../components/ErrorBoundary.tsx'
import { Header } from '../components/Header.tsx'
import { ThemeToggle } from '../components/ThemeToggle.tsx'
import { WindowPicker } from '../components/WindowPicker.tsx'
import { mockSpecies } from '../dev/mock.ts'
import { hasArt } from '../domain/asset.ts'
import type { Species } from '../domain/species.ts'
import { pathToPreset, presetToSegment, type WindowPreset } from '../domain/window.ts'
import { useLayoutManifest } from '../hooks/useLayoutManifest.ts'
import { useRecentSpecies } from '../hooks/useRecentSpecies.ts'
import { collagePath } from '../routes.ts'

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

  // A window's first fetch shows the loading indicator instead of the empty
  // nest; cached windows resolve synchronously so this is false for them. Mock
  // mode synthesizes species synchronously, so it never has a loading phase.
  const loading = USE_MOCK ? false : live.loading

  const notIllustrated = useMemo(
    () => species.filter((s) => !hasArt(manifest, s.sci)).length,
    [species, manifest],
  )

  return (
    <div className="stage">
      <div className="topbar">
        <ThemeToggle />
      </div>

      <Header eyebrow="around here" title="recently heard" />

      <div className="controls">
        <WindowPicker value={preset} onChange={(p) => navigate(collagePath(p))} />
      </div>

      <main className="view">
        {loading ? (
          <CollageLoading />
        ) : (
          <ErrorBoundary>
            <Collage
              species={species}
              manifest={manifest}
              blossomKey={preset}
              emptyState={<EmptyState fallbackKey={manifest.fallbackKey} />}
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
  if (error) return <span className="status-warn">can’t reach BirdNET-Go — {error.message}</span>
  const parts: string[] = [`${count} species`]
  if (notIllustrated > 0) parts.push(`${notIllustrated} not yet illustrated`)
  if (truncated) parts.push('window truncated')
  return <span>{parts.join(' · ')}</span>
}
