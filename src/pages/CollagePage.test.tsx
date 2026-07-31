// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'

// The window preset now lives in the URL; these tests exercise the URL <-> window
// wiring in isolation. The data hooks are stubbed so nothing fetches, and Collage
// is stubbed because it uses ResizeObserver (absent in jsdom) and is irrelevant
// to routing — the active tab reflects the resolved window.
vi.mock('../hooks/useRecentSpecies.ts', () => ({
  useRecentSpecies: () => ({ species: [], truncated: false, error: null, loading: false }),
}))
vi.mock('../hooks/useLayoutManifest.ts', () => ({
  useLayoutManifest: () => ({ dims: {}, masks: {}, fallbackKey: '_fallback' }),
}))
// Localization hooks stubbed too, so the routing tests never fetch a dictionary
// (jsdom's navigator.language would otherwise resolve a locale and request one).
vi.mock('../hooks/useDictionaryIndex.ts', () => ({
  useDictionaryIndex: () => ({ locales: [], default: null, loading: false }),
}))
vi.mock('../hooks/useLanguagePreference.ts', () => ({
  useLanguagePreference: () => ({ lang: null, setLang: () => {} }),
}))
vi.mock('../hooks/useSpeciesDictionary.ts', () => ({
  useSpeciesDictionary: () => new Map(),
}))
vi.mock('../collage/Collage.tsx', () => ({ Collage: () => null }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function activeTab() {
  return screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')
}

describe('CollagePage routing', () => {
  it('activates the window named by the URL', () => {
    renderAt('/7d')
    expect(activeTab()).toHaveTextContent('7D')
  })

  it('redirects the bare root to the default window', () => {
    renderAt('/')
    expect(activeTab()).toHaveTextContent('24H')
  })

  it('redirects an unknown window to the default', () => {
    renderAt('/nonsense')
    expect(activeTab()).toHaveTextContent('24H')
  })

  it('navigates to a new URL when a window tab is clicked', () => {
    renderAt('/24h')
    fireEvent.click(screen.getByRole('tab', { name: '1H' }))
    expect(activeTab()).toHaveTextContent('1H')
  })
})
