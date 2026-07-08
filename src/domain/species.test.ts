import { describe, expect, it } from 'vitest'
import type { DetectionResponse } from '../api/types.ts'
import { aggregateDetections, detectionInstantMs, speciesFromSummary } from './species.ts'

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

  it('keeps the most-recent common name and the max confidence', () => {
    const merula = aggregateDetections(rows, { sinceMs: since }).find(
      (s) => s.sci === 'Turdus merula',
    )
    expect(merula?.com).toBe('Blackbird') // from the newer id 1
    expect(merula?.maxConfidence).toBe(0.9)
  })

  it('sorts by count descending', () => {
    const out = aggregateDetections(rows, { sinceMs: since })
    expect(out[0].sci).toBe('Turdus merula')
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
        last_heard: '2026-07-08T11:00:00Z',
      },
      { scientific_name: 'Parus major', common_name: 'Great Tit', count: 10 },
    ])
    expect(out[0]).toMatchObject({
      sci: 'Turdus merula',
      com: 'Blackbird',
      n: 42,
      maxConfidence: 0.99,
    })
    expect(out[0].lastSeenMs).toBe(Date.parse('2026-07-08T11:00:00Z'))
    expect(out[1].lastSeenMs).toBeUndefined()
  })
})
