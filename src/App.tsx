import { useMemo, useState } from 'react'
import { Collage } from './collage/Collage.tsx'
import { EmptyState } from './components/EmptyState.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { Header } from './components/Header.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { WindowPicker } from './components/WindowPicker.tsx'
import { mockSpecies } from './dev/mock.ts'
import { hasArt } from './domain/asset.ts'
import type { Species } from './domain/species.ts'
import type { WindowPreset } from './domain/window.ts'
import { useLayoutManifest } from './hooks/useLayoutManifest.ts'
import { useRecentSpecies } from './hooks/useRecentSpecies.ts'

// When VITE_MOCK=1, species come from the local manifest instead of a live
// BirdNET-Go, so the collage can be demoed without a backend.
const USE_MOCK = import.meta.env.VITE_MOCK === '1'

export default function App() {
  const [windowPreset, setWindowPreset] = useState<WindowPreset>('24H')
  const manifest = useLayoutManifest()
  const live = useRecentSpecies(windowPreset)
  const species: Species[] = USE_MOCK ? mockSpecies(manifest) : live.species

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
        <WindowPicker value={windowPreset} onChange={setWindowPreset} />
      </div>

      <main className="view">
        <ErrorBoundary>
          <Collage
            species={species}
            manifest={manifest}
            emptyState={<EmptyState fallbackKey={manifest.fallbackKey} />}
          />
        </ErrorBoundary>
      </main>

      <footer className="status mono">
        <StatusLine
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
  count: number
  notIllustrated: number
  truncated: boolean
  error: Error | null
}

function StatusLine({ count, notIllustrated, truncated, error }: StatusProps) {
  if (error) return <span className="status-warn">can’t reach BirdNET-Go — {error.message}</span>
  const parts: string[] = [`${count} species`]
  if (notIllustrated > 0) parts.push(`${notIllustrated} not yet illustrated`)
  if (truncated) parts.push('window truncated')
  return <span>{parts.join(' · ')}</span>
}
