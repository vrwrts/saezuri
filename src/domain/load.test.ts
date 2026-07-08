import { describe, expect, it, vi } from 'vitest'
import type { DetectionResponse, PaginatedResponse, SpeciesSummary } from '../api/types.ts'
import { type LoadDeps, loadSpecies } from './load.ts'
import { resolveWindow } from './window.ts'

const now = Date.parse('2026-07-08T12:00:00Z')

function det(id: number, sci: string, tsMs: number): DetectionResponse {
  return {
    id,
    date: '2026-07-08',
    time: '12:00:00',
    timestamp: new Date(tsMs).toISOString(),
    beginTime: '',
    endTime: '',
    scientificName: sci,
    commonName: sci,
    confidence: 0.9,
    verified: 'unverified',
    locked: false,
  }
}

function page(
  data: DetectionResponse[],
  total: number,
  offset: number,
  limit: number,
): PaginatedResponse<DetectionResponse> {
  return {
    data,
    total,
    limit,
    offset,
    current_page: Math.floor(offset / limit) + 1,
    total_pages: Math.ceil(total / limit),
  }
}

describe('loadSpecies — ALL window', () => {
  it('reads the pre-aggregated summary', async () => {
    const summary: SpeciesSummary[] = [
      { scientific_name: 'Turdus merula', common_name: 'Blackbird', count: 5 },
    ]
    const deps: LoadDeps = {
      getDetections: vi.fn(),
      getSpeciesSummary: vi.fn().mockResolvedValue(summary),
    }
    const result = await loadSpecies(
      resolveWindow('ALL', now),
      { summaryLimit: 50 },
      undefined,
      deps,
    )
    expect(deps.getDetections).not.toHaveBeenCalled()
    expect(deps.getSpeciesSummary).toHaveBeenCalledWith({ limit: 50 }, undefined)
    expect(result.species[0]).toMatchObject({ sci: 'Turdus merula', n: 5 })
    expect(result.truncated).toBe(false)
  })
})

describe('loadSpecies — bounded window', () => {
  it('stops paging once a page predates the cutoff', async () => {
    const win = resolveWindow('1H', now) // cutoff = 11:00Z
    const inWindow = det(1, 'Turdus merula', Date.parse('2026-07-08T11:30:00Z'))
    const oldRow = det(2, 'Parus major', Date.parse('2026-07-08T09:00:00Z')) // before cutoff
    const getDetections = vi.fn().mockResolvedValueOnce(page([inWindow, oldRow], 500, 0, 1000)) // oldest predates cutoff → stop
    const deps: LoadDeps = { getDetections, getSpeciesSummary: vi.fn() }

    const result = await loadSpecies(win, { pageSize: 1000 }, undefined, deps)
    expect(getDetections).toHaveBeenCalledTimes(1)
    expect(result.truncated).toBe(false)
    // Only the in-window row survives aggregation.
    expect(result.species).toHaveLength(1)
    expect(result.species[0].sci).toBe('Turdus merula')
  })

  it('flags truncation when the page cap is hit before covering the window', async () => {
    const win = resolveWindow('7D', now)
    // Every page is full and stays within the window, so it never naturally stops.
    const fullPage = Array.from({ length: 2 }, (_, i) => det(i, 'Turdus merula', now - 1000))
    const getDetections = vi.fn().mockResolvedValue(page(fullPage, 10_000, 0, 2))
    const deps: LoadDeps = { getDetections, getSpeciesSummary: vi.fn() }

    const result = await loadSpecies(win, { pageSize: 2, maxPages: 3 }, undefined, deps)
    expect(getDetections).toHaveBeenCalledTimes(3)
    expect(result.truncated).toBe(true)
  })

  it('stops when the result set is exhausted (short page)', async () => {
    const win = resolveWindow('24H', now)
    const row = det(1, 'Turdus merula', now - 1000)
    const getDetections = vi.fn().mockResolvedValueOnce(page([row], 1, 0, 1000)) // short page
    const deps: LoadDeps = { getDetections, getSpeciesSummary: vi.fn() }

    const result = await loadSpecies(win, {}, undefined, deps)
    expect(getDetections).toHaveBeenCalledTimes(1)
    expect(result.truncated).toBe(false)
  })
})
