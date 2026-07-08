import { describe, expect, it } from 'vitest'
import { resolveWindow, WINDOW_PRESETS, ymd } from './window.ts'

describe('resolveWindow', () => {
  const now = Date.parse('2026-07-08T12:00:00Z')

  it('returns the all-time marker for ALL', () => {
    expect(resolveWindow('ALL', now)).toEqual({ kind: 'all' })
  })

  it('computes the absolute cutoff from the preset hours', () => {
    expect((resolveWindow('1H', now) as { sinceMs: number }).sinceMs).toBe(now - 3_600_000)
    expect((resolveWindow('24H', now) as { sinceMs: number }).sinceMs).toBe(now - 24 * 3_600_000)
    expect((resolveWindow('7D', now) as { hours: number }).hours).toBe(168)
  })

  it('pads the coarse date range by a day on each end', () => {
    const w = resolveWindow('24H', now)
    if (w.kind !== 'range') throw new Error('expected range window')
    // startDate <= endDate, and the range brackets the cutoff.
    expect(w.startDate <= w.endDate).toBe(true)
    expect(w.startDate).toBe(ymd(w.sinceMs - 24 * 3_600_000))
    expect(w.endDate).toBe(ymd(now + 24 * 3_600_000))
  })

  it('covers every preset', () => {
    for (const p of WINDOW_PRESETS) expect(resolveWindow(p, now)).toBeTruthy()
  })
})

describe('ymd', () => {
  it('formats local date parts with zero padding', () => {
    // Build the expected value the same way (local time) to stay tz-agnostic.
    const d = new Date(Date.parse('2026-01-05T00:00:00Z'))
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    expect(ymd(Date.parse('2026-01-05T00:00:00Z'))).toBe(expected)
  })
})
