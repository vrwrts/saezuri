import { describe, expect, it } from 'vitest'
import type { DetectionResponse } from '../api/types.ts'
import {
  aggregateDetections,
  detectionInstantMs,
  localizeCommonNames,
  type Species,
  speciesFromSummary,
} from './species.ts'

function det(over: Partial<DetectionResponse>): DetectionResponse {
  return {
    id: 1,
    date: '2026-07-08',
    time: '12:00:00',
    beginTime: '2026-07-08T12:00:00Z',
    endTime: '2026-07-08T12:00:03Z',
    scientificName: 'Turdus merula',
    commonName: 'Blackbird',
    confidence: 0.9,
    verified: 'unverified',
    locked: false,
    ...over,
  }
}

const since = Date.parse('2026-07-08T11:00:00Z')

describe('detectionInstantMs', () => {
  it('prefers the RFC3339 timestamp', () => {
    expect(detectionInstantMs(det({ timestamp: '2026-07-08T11:30:00Z' }))).toBe(
      Date.parse('2026-07-08T11:30:00Z'),
    )
  })
  it('falls back to date + time when no timestamp', () => {
    const ms = detectionInstantMs(
      det({ timestamp: undefined, date: '2026-07-08', time: '11:30:00' }),
    )
    expect(ms).toBe(Date.parse('2026-07-08T11:30:00'))
  })
  it('returns null when nothing parses', () => {
    expect(detectionInstantMs(det({ timestamp: 'nope', date: '', time: '' }))).toBeNull()
  })
})

describe('aggregateDetections', () => {
  const rows = [
    det({
      id: 1,
      scientificName: 'Turdus merula',
      commonName: 'Blackbird',
      timestamp: '2026-07-08T11:55:00Z',
      confidence: 0.9,
    }),
    det({
      id: 2,
      scientificName: 'Turdus merula',
      commonName: 'Common Blackbird',
      timestamp: '2026-07-08T11:40:00Z',
      confidence: 0.8,
    }),
    det({
      id: 3,
      scientificName: 'Parus major',
      commonName: 'Great Tit',
      timestamp: '2026-07-08T11:50:00Z',
      confidence: 0.7,
    }),
    det({ id: 4, scientificName: 'Turdus merula', timestamp: '2026-07-08T10:00:00Z' }), // before cutoff
    det({
      id: 5,
      scientificName: 'Corvus corax',
      verified: 'false_positive',
      timestamp: '2026-07-08T11:59:00Z',
    }),
  ]

  it('groups by scientific name, counts, and honors the cutoff', () => {
    const out = aggregateDetections(rows, { sinceMs: since })
    const merula = out.find((s) => s.sci === 'Turdus merula')
    expect(merula?.n).toBe(2) // id 4 excluded (before cutoff)
    expect(out.find((s) => s.sci === 'Parus major')?.n).toBe(1)
  })

  it('excludes false positives by default', () => {
    const out = aggregateDetections(rows, { sinceMs: since })
    expect(out.find((s) => s.sci === 'Corvus corax')).toBeUndefined()
  })

  it('keeps the most-recent common name', () => {
    const merula = aggregateDetections(rows, { sinceMs: since }).find(
      (s) => s.sci === 'Turdus merula',
    )
    expect(merula?.com).toBe('Blackbird') // from the newer id 1
  })

  it('sorts by count descending', () => {
    const out = aggregateDetections(rows, { sinceMs: since })
    expect(out[0].sci).toBe('Turdus merula')
  })

  it('spans the window from the earliest to the latest kept detection', () => {
    const merula = aggregateDetections(rows, { sinceMs: since }).find(
      (s) => s.sci === 'Turdus merula',
    )
    // id 4 (10:00) falls before the cutoff, so the span starts at id 2 (11:40).
    expect(merula?.firstSeenMs).toBe(Date.parse('2026-07-08T11:40:00Z'))
    expect(merula?.lastSeenMs).toBe(Date.parse('2026-07-08T11:55:00Z'))
  })

  it('collapses the span to one instant for a single detection', () => {
    const tit = aggregateDetections(rows, { sinceMs: since }).find((s) => s.sci === 'Parus major')
    expect(tit?.firstSeenMs).toBe(tit?.lastSeenMs)
  })

  it('can apply a confidence floor', () => {
    const out = aggregateDetections(rows, { sinceMs: since, minConfidence: 0.85 })
    expect(out.find((s) => s.sci === 'Turdus merula')?.n).toBe(1) // only the 0.9 row
    expect(out.find((s) => s.sci === 'Parus major')).toBeUndefined()
  })
})

describe('speciesFromSummary', () => {
  it('maps snake_case summary rows into Species', () => {
    const out = speciesFromSummary([
      {
        scientific_name: 'Turdus merula',
        common_name: 'Blackbird',
        count: 42,
        max_confidence: 0.99,
        first_heard: '2026-01-02T07:30:00Z',
        last_heard: '2026-07-08T11:00:00Z',
      },
      { scientific_name: 'Parus major', common_name: 'Great Tit', count: 10 },
    ])
    expect(out[0]).toMatchObject({
      sci: 'Turdus merula',
      com: 'Blackbird',
      n: 42,
    })
    expect(out[0].lastSeenMs).toBe(Date.parse('2026-07-08T11:00:00Z'))
    // Only on the all-time window is this a true first-ever; see Species.firstSeenMs.
    expect(out[0].firstSeenMs).toBe(Date.parse('2026-01-02T07:30:00Z'))
    expect(out[1].lastSeenMs).toBeUndefined()
    expect(out[1].firstSeenMs).toBeUndefined()
  })
})

describe('localizeCommonNames', () => {
  const base: Species[] = [
    { sci: 'Turdus merula', com: 'Common Blackbird', n: 5 },
    { sci: 'Parus major', com: 'Great Tit', n: 3 },
  ]

  it('overlays com by scientific name', () => {
    const dict = new Map([['Turdus merula', 'Amsel']])
    const out = localizeCommonNames(base, dict)
    expect(out[0].com).toBe('Amsel')
    expect(out[0]).toMatchObject({ sci: 'Turdus merula', n: 5 })
  })

  it('falls back per-species to the original name on a miss', () => {
    const dict = new Map([['Turdus merula', 'Amsel']])
    const out = localizeCommonNames(base, dict)
    // Parus major is absent from the dictionary → keeps its original name…
    expect(out[1].com).toBe('Great Tit')
    // …and its object identity, since nothing changed.
    expect(out[1]).toBe(base[1])
  })

  it('returns the same array reference for an empty or absent dictionary', () => {
    expect(localizeCommonNames(base, new Map())).toBe(base)
    expect(localizeCommonNames(base, null)).toBe(base)
    expect(localizeCommonNames(base, undefined)).toBe(base)
  })

  it('does not mutate the input', () => {
    const dict = new Map([['Turdus merula', 'Amsel']])
    localizeCommonNames(base, dict)
    expect(base[0].com).toBe('Common Blackbird')
  })
})
