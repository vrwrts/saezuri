import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeNodeDeps } from './birdnetDeps.ts'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [], total: 0 }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function calledUrl(): string {
  return fetchMock.mock.calls[0][0] as string
}
function calledInit(): { headers: Record<string, string> } {
  return fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
}

describe('makeNodeDeps', () => {
  it('builds the detections URL with mapped params and a bearer header', async () => {
    const deps = makeNodeDeps('http://host:8080/', 'secret')
    await deps.getDetections({
      queryType: 'all',
      startDate: '2026-07-01',
      endDate: '2026-07-08',
      numResults: 1000,
      offset: 0,
      sortBy: 'date_desc',
    })

    const url = calledUrl()
    expect(url.startsWith('http://host:8080/api/v2/detections?')).toBe(true)
    expect(url).toContain('start_date=2026-07-01')
    expect(url).toContain('end_date=2026-07-08')
    expect(url).toContain('numResults=1000')
    expect(url).toContain('sortBy=date_desc')
    expect(calledInit().headers.Authorization).toBe('Bearer secret')
  })

  it('omits the Authorization header when no token is given', async () => {
    const deps = makeNodeDeps('http://host:8080')
    await deps.getSpeciesSummary({ limit: 2000 })

    expect(calledUrl()).toBe('http://host:8080/api/v2/analytics/species/summary?limit=2000')
    expect(calledInit().headers.Authorization).toBeUndefined()
  })

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' })
    const deps = makeNodeDeps('http://host:8080')
    await expect(deps.getSpeciesSummary()).rejects.toThrow(/503/)
  })
})
