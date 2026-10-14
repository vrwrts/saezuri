import { describe, expect, it } from 'vitest'
import type { DetectionResponse } from '../api/types.ts'
import { DetectionStore } from './store.ts'

const now = Date.parse('2026-07-08T12:00:00Z')
const H = 3_600_000
const D = 24 * H

function det(
  id: number,
  sci: string,
  tsMs: number,
  verified: DetectionResponse['verified'] = 'unverified',
): DetectionResponse {
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
    verified,
    locked: false,
  }
}

function counts(species: { sci: string; n: number }[]): Record<string, number> {
  return Object.fromEntries(species.map((s) => [s.sci, s.n]))
}

describe('DetectionStore', () => {
  it('aggregates stored rows at a moving window cutoff', () => {
    const s = new DetectionStore()
    s.seed(
      [
        det(1, 'Turdus merula', now - 0.5 * H),
        det(2, 'Turdus merula', now - 2 * H),
        det(3, 'Parus major', now - 0.5 * H),
      ],
      true,
      now - 7 * D,
    )

    expect(counts(s.aggregate(now - 1 * H))).toEqual({ 'Turdus merula': 1, 'Parus major': 1 })
    expect(counts(s.aggregate(now - 3 * H))).toEqual({ 'Turdus merula': 2, 'Parus major': 1 })
    // count desc puts the louder bird first
    expect(s.aggregate(now - 3 * H)[0].sci).toBe('Turdus merula')
  })

  it('dedups by id across backfill/stream overlap', () => {
    const s = new DetectionStore()
    s.seed([det(1, 'Turdus merula', now - H)], true, now - 7 * D)
    expect(s.add(det(1, 'Turdus merula', now - H))).toBe(false)
    expect(s.add(det(2, 'Parus major', now - H))).toBe(true)
    expect(s.size).toBe(2)
  })

  it('prunes rows older than the retention window', () => {
    const s = new DetectionStore()
    s.seed([det(1, 'A', now - 1 * H), det(2, 'B', now - 8 * D)], false, now - 7 * D)
    expect(s.size).toBe(2)
    s.prune(now)
    expect(s.size).toBe(1)
  })

  it('flags truncation only for cutoffs older than coverage', () => {
    const partial = new DetectionStore()
    // Backfill stopped at the cap; oldest row reached is 2h ago.
    partial.seed([det(1, 'A', now - 2 * H)], false, now - 7 * D)
    expect(partial.truncated(now - 1 * H)).toBe(false) // within reach
    expect(partial.truncated(now - 5 * H)).toBe(true) // older than reach

    const full = new DetectionStore()
    full.seed([det(1, 'A', now - 2 * H)], true, now - 7 * D)
    expect(full.truncated(now - 7 * D)).toBe(false) // covered to the cutoff
  })

  it('returns playable detections for a species newest-first', () => {
    const s = new DetectionStore()
    s.seed(
      [
        { ...det(1, 'Turdus merula', now - 2 * H), clipName: 'older.wav' },
        { ...det(2, 'Turdus merula', now - H), clipName: 'newest.mp3' },
        { ...det(3, 'Turdus merula', now - 0.5 * H), clipName: '' },
        { ...det(4, 'Turdus merula', now - 0.25 * H, 'false_positive'), clipName: 'false.wav' },
        { ...det(5, 'Parus major', now - 0.1 * H), clipName: 'other.wav' },
      ],
      true,
      now - 7 * D,
    )

    expect(s.recordingsFor('Turdus merula', now - 3 * H)).toEqual([
      { id: 2, clipName: 'newest.mp3' },
      { id: 1, clipName: 'older.wav' },
    ])
  })
})
