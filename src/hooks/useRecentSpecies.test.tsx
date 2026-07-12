// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSpecies } from '../domain/load.ts'
import { useRecentSpecies } from './useRecentSpecies.ts'

vi.mock('../domain/load.ts', () => ({ loadSpecies: vi.fn() }))
const mockLoad = vi.mocked(loadSpecies)

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

describe('useRecentSpecies', () => {
  beforeEach(() => {
    mockLoad.mockReset()
  })

  it('surfaces the loaded species and truncated flag', async () => {
    mockLoad.mockResolvedValue({
      species: [{ sci: 'Turdus merula', com: 'Blackbird', n: 3 }],
      truncated: true,
    })

    const { result } = renderHook(() => useRecentSpecies('24H'), { wrapper })

    await waitFor(() => expect(result.current.species).toHaveLength(1))
    expect(result.current.species[0].sci).toBe('Turdus merula')
    expect(result.current.truncated).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('exposes the error and keeps species empty on failure', async () => {
    mockLoad.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useRecentSpecies('1H'), { wrapper })

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error?.message).toBe('offline')
    expect(result.current.species).toEqual([])
  })
})
