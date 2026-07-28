// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Snapshot } from '../domain/snapshot.ts'
import { useRecentSpecies } from './useRecentSpecies.ts'

// Fresh cache per render and no retry, so a rejection surfaces immediately
// instead of triggering SWR's exponential backoff.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
    >
      {children}
    </SWRConfig>
  )
}

function snapshot(): Snapshot {
  return {
    generatedAt: 1,
    windows: {
      '1h': { species: [], truncated: false, notIllustrated: 0, heard: 0 },
      '12h': { species: [], truncated: false, notIllustrated: 0, heard: 0 },
      '24h': {
        species: [{ sci: 'Turdus merula', com: 'Blackbird', n: 3 }],
        truncated: true,
        notIllustrated: 2,
        heard: 3,
      },
      '7d': { species: [], truncated: false, notIllustrated: 0, heard: 0 },
      all: { species: [], truncated: false, notIllustrated: 0, heard: 0 },
    },
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useRecentSpecies', () => {
  it('selects the active window from the snapshot, with gating counts', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => snapshot() })

    const { result } = renderHook(() => useRecentSpecies('24H'), { wrapper })

    await waitFor(() => expect(result.current.species).toHaveLength(1))
    expect(result.current.species[0].sci).toBe('Turdus merula')
    expect(result.current.truncated).toBe(true)
    expect(result.current.notIllustrated).toBe(2)
    expect(result.current.heard).toBe(3)
    expect(result.current.error).toBeNull()
    // One shared snapshot request, fetched with no-store so caches never skew.
    expect(fetchMock).toHaveBeenCalledWith('/snapshot.json', { cache: 'no-store' })
  })

  it('reports loading on the first fetch, then clears it', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => snapshot() })

    const { result } = renderHook(() => useRecentSpecies('24H'), { wrapper })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('exposes the error and keeps species empty on failure', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useRecentSpecies('1H'), { wrapper })

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error?.message).toBe('offline')
    expect(result.current.species).toEqual([])
  })
})
