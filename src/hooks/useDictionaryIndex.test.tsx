// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDictionaryIndex } from './useDictionaryIndex.ts'

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

describe('useDictionaryIndex', () => {
  it('parses the published index (cacheable fetch)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ locales: ['de', 'nl'], default: 'en' }),
    })
    const { result } = renderHook(() => useDictionaryIndex(), { wrapper })
    await waitFor(() => expect(result.current.locales).toEqual(['de', 'nl']))
    expect(result.current.default).toBe('en')
    // Single-arg call ⇒ no `cache: 'no-store'`; the index is safe to HTTP-cache.
    expect(fetchMock).toHaveBeenCalledWith('/species-dict/index.json')
  })

  it('is empty when the index is absent (404)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
    const { result } = renderHook(() => useDictionaryIndex(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.locales).toEqual([])
    expect(result.current.default).toBeNull()
  })
})
