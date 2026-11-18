import { describe, expect, it } from 'vitest'
import { arcLen, baselineOk, centredSpan, leanOf, type Pt, stack } from './geometry.ts'

const level: Pt[] = [
  [0, 0],
  [10, 0],
  [20, 0],
]

describe('arcLen', () => {
  it('sums the segment lengths', () => {
    expect(arcLen(level)).toBe(20)
    expect(
      arcLen([
        [0, 0],
        [3, 4],
      ]),
    ).toBe(5)
  })
})

describe('centredSpan', () => {
  it('is exactly the length asked for, centred on the run', () => {
    const span = centredSpan(level, 10)
    expect(arcLen(span)).toBeCloseTo(10, 6)
    expect(span[0][0]).toBeCloseTo(5, 6)
    expect(span[span.length - 1][0]).toBeCloseTo(15, 6)
  })

  it('carries on along the chord past a short run', () => {
    const span = centredSpan(level, 40)
    expect(arcLen(span)).toBeCloseTo(40, 6)
    expect(span[0]).toEqual([-10, 0])
    expect(span[span.length - 1][0]).toBeCloseTo(30, 6)
  })

  it('slides an overrunning span toward a point, but never off the run', () => {
    const span = centredSpan(level, 40, [100, 0])
    // Slack is 10 each side, so the start can move from -10 to 0 and no further.
    expect(span[0][0]).toBeCloseTo(0, 6)
  })

  it('smooths a kink out of the run it follows', () => {
    const kinked: Pt[] = [
      [0, 0],
      [20, 0],
      [23, -3],
      [26, 4],
      [46, 4],
    ]
    const span = centredSpan(kinked, 46)
    let worst = 0
    for (let i = 2; i < span.length; i++) {
      const a = Math.atan2(span[i - 1][1] - span[i - 2][1], span[i - 1][0] - span[i - 2][0])
      const b = Math.atan2(span[i][1] - span[i - 1][1], span[i][0] - span[i - 1][0])
      worst = Math.max(worst, Math.abs(((b - a) * 180) / Math.PI))
    }
    expect(worst).toBeLessThan(30)
    expect(arcLen(span)).toBeGreaterThanOrEqual(46 - 1e-6)
  })
})

describe('stack', () => {
  it('pushes a line the full distance off its base, toward the ascenders', () => {
    const up = stack(level, 1, 5, 20)
    for (const p of up) expect(p[1]).toBeCloseTo(-5, 6)
    const down = stack(level, -1, 5, 20)
    for (const p of down) expect(p[1]).toBeCloseTo(5, 6)
  })
})

describe('baselineOk', () => {
  it('accepts a gentle line', () => {
    expect(
      baselineOk([
        [0, 0],
        [10, 2],
        [20, 3],
      ]),
    ).toBe(true)
  })

  it('refuses a line steep enough to lay letters on their side', () => {
    expect(
      baselineOk([
        [0, 0],
        [5, 20],
      ]),
    ).toBe(false)
  })

  it('refuses a chevron between consecutive letters', () => {
    expect(
      baselineOk([
        [0, 0],
        [10, -7],
        [20, 0],
      ]),
    ).toBe(false)
  })

  it('refuses a line that folds back on itself', () => {
    expect(
      baselineOk([
        [0, 0],
        [10, 0],
        [8, 0],
        [20, 0],
      ]),
    ).toBe(false)
  })
})

describe('leanOf', () => {
  it('folds any heading to its lean off horizontal', () => {
    expect(leanOf(0)).toBe(0)
    expect(leanOf(180)).toBe(0)
    expect(leanOf(-30)).toBe(30)
    expect(leanOf(150)).toBe(30)
    expect(leanOf(90)).toBe(90)
  })
})
