// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LayoutManifest } from '../domain/manifest.ts'
import { DEFAULT_MANIFEST, useLayoutManifest } from './useLayoutManifest.ts'

// A well-formed manifest distinct from DEFAULT_MANIFEST by its extra species key.
const REAL_MANIFEST: LayoutManifest = {
  dims: { _fallback: [10, 10], 'Turdus merula': [20, 20] },
  masks: {
    _fallback: { w: 1, h: 1, bits: 'AA==' },
    'Turdus merula': { w: 1, h: 1, bits: 'AA==' },
  },
  fallbackKey: '_fallback',
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    // focusThrottleInterval/dedupingInterval: 0 let the revalidation test trigger
    // a re-fetch immediately after mount instead of being throttled or deduped.
    <SWRConfig
      value={{
        provider: () => new Map(),
        shouldRetryOnError: false,
        focusThrottleInterval: 0,
        dedupingInterval: 0,
      }}
    >
      {children}
    </SWRConfig>
  )
}

describe('useLayoutManifest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the fetched manifest when it loads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => REAL_MANIFEST }))

    const { result } = renderHook(() => useLayoutManifest(), { wrapper })

    await waitFor(() => expect('Turdus merula' in result.current.masks).toBe(true))
  })

  it('keeps the built-in fallback when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))

    const { result } = renderHook(() => useLayoutManifest(), { wrapper })

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current).toEqual(DEFAULT_MANIFEST)
    expect(Object.keys(result.current.masks)).toEqual(['_fallback'])
  })

  it('picks up newly generated art on revalidation', async () => {
    // First load has only the fallback; the worker adds a species before the
    // next revalidation, so a re-fetch must surface it (no page reload).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => DEFAULT_MANIFEST })
      .mockResolvedValue({ ok: true, json: async () => REAL_MANIFEST })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useLayoutManifest(), { wrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect('Turdus merula' in result.current.masks).toBe(false)

    // A focus event triggers SWR's revalidation (enabled now that the manifest
    // is polled rather than fetched once).
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect('Turdus merula' in result.current.masks).toBe(true))
  })
})
