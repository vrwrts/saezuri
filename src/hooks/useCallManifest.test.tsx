// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CallManifest } from '../domain/calls.ts'
import { useCallManifest } from './useCallManifest.ts'

const MANIFEST: CallManifest = {
  calls: {
    'turdus-merula': {
      ext: 'mp3',
      ver: 'a1',
      by: 'A. Recordist',
      lic: 'CC BY-SA 4.0',
      src: 'https://commons.wikimedia.org/wiki/File:Example.mp3',
      srcName: 'Wikimedia Commons',
    },
  },
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
  )
}

describe('useCallManifest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the fetched manifest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MANIFEST }))

    const { result } = renderHook(() => useCallManifest(), { wrapper })

    await waitFor(() => expect('turdus-merula' in result.current.calls).toBe(true))
  })

  // The next three are the same steady state — no recordings — reached three
  // ways. None is an error, so none may leave SWR retrying on a backoff.
  it('resolves empty when the file is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCallManifest(), { wrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current.calls).toEqual({})
  })

  it('resolves empty when the body is not JSON (an SPA index.html at 200)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCallManifest(), { wrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current.calls).toEqual({})
  })

  it('resolves empty when the JSON has no calls map', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCallManifest(), { wrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current.calls).toEqual({})
  })
})
