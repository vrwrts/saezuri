// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpeciesDictionary } from './useSpeciesDictionary.ts'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
    >
      {children}
    </SWRConfig>
  )
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('useSpeciesDictionary', () => {
  it('fetches the selected locale and builds the map (cacheable)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ 'Turdus merula': 'Amsel' }) })
    const { result } = renderHook(() => useSpeciesDictionary('de'), { wrapper })
    await waitFor(() => expect(result.current.get('Turdus merula')).toBe('Amsel'))
    // Single-arg call ⇒ NOT `cache: 'no-store'` (the snapshot's skew guard): the
    // dictionary is immutable and safe to HTTP-cache.
    expect(fetchMock).toHaveBeenCalledWith('/species-dict/de.json')
  })

  it('does not fetch when no locale is selected', async () => {
    const { result } = renderHook(() => useSpeciesDictionary(null), { wrapper })
    await waitFor(() => expect(result.current.size).toBe(0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an empty map on 404 (older backend / missing locale)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
    const { result } = renderHook(() => useSpeciesDictionary('de'), { wrapper })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current.size).toBe(0)
  })
})
