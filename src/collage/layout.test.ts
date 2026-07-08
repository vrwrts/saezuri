import { describe, expect, it } from 'vitest'
import { computeLayout, type LayoutInput, tuning } from './layout.ts'
import type { DecodedMask } from './pack.ts'

function solidMask(w: number, h: number): DecodedMask {
  const cells: Array<[number, number]> = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y])
  return { w, h, cells }
}

function input(sci: string, n: number): LayoutInput {
  return {
    sci,
    com: sci,
    n,
    key: sci,
    imageUrl: `/assets/illustrations/${sci}.png`,
    illustrated: true,
    pose: 1,
    mask: solidMask(10, 10),
    ar: 1,
  }
}

const VP = { width: 900, height: 650 }

describe('tuning', () => {
  it('loosens the budget for small plates and tightens for busy ones', () => {
    expect(tuning(3).packingBudgetFrac).toBeGreaterThan(tuning(30).packingBudgetFrac)
    expect(tuning(50).countExp).toBe(0.65)
  })
})

describe('computeLayout', () => {
  it('returns nothing for empty input or a zero viewport', () => {
    expect(computeLayout([], VP)).toEqual([])
    expect(computeLayout([input('a', 1)], { width: 0, height: 0 })).toEqual([])
  })

  it('places all tiles on-screen and within the viewport', () => {
    const tiles = computeLayout(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((s, i) => input(s, (i + 1) * 3)),
      VP,
    )
    expect(tiles).toHaveLength(6)
    for (const t of tiles) {
      expect(t.parked).toBe(false)
      expect(t.x).toBeGreaterThanOrEqual(-1)
      expect(t.y).toBeGreaterThanOrEqual(-1)
      expect(t.x + t.w).toBeLessThanOrEqual(VP.width + 1)
      expect(t.y + t.h).toBeLessThanOrEqual(VP.height + 1)
    }
  })

  it('sizes tiles by detection count', () => {
    const tiles = computeLayout([input('loud', 200), input('quiet', 1)], VP)
    const area = (sci: string) => {
      const t = tiles.find((tile) => tile.sci === sci)
      if (!t) throw new Error(`tile ${sci} not found`)
      return t.w * t.h
    }
    expect(area('loud')).toBeGreaterThan(area('quiet'))
  })

  it('is deterministic', () => {
    const inputs = ['a', 'b', 'c'].map((s, i) => input(s, i + 1))
    const first = computeLayout(inputs, VP).map((t) => [t.sci, Math.round(t.x), Math.round(t.y)])
    const again = computeLayout(inputs, VP).map((t) => [t.sci, Math.round(t.x), Math.round(t.y)])
    expect(first).toEqual(again)
  })
})
