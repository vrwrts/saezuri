import { describe, expect, it } from 'vitest'
import { fakeMeasureEm, perchedBirdMask } from './labels/testMasks.ts'
import {
  computeLayout,
  type LaidTile,
  type LayoutInput,
  layoutSignature,
  tuning,
} from './layout.ts'
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

describe('computeLayout with names', () => {
  const labels = { measureEm: fakeMeasureEm, minPx: 9 }
  const birds = [
    'Western Bluebird',
    'House Finch',
    'Anna’s Hummingbird',
    'Song Sparrow',
    'Bushtit',
  ].map((com, i) => ({ ...input(`s${i}`, (i + 1) * 4), com, mask: perchedBirdMask(), ar: 90 / 70 }))

  it('names every bird and keeps birds and names inside the viewport', () => {
    const tiles = computeLayout(birds, VP, { labels })
    for (const t of tiles) {
      expect(t.parked).toBe(false)
      expect(t.label).toBeDefined()
      const box = t.label?.box ?? { x0: 0, y0: 0, x1: 0, y1: 0 }
      expect(t.x + Math.min(0, box.x0)).toBeGreaterThanOrEqual(-1)
      expect(t.y + Math.min(0, box.y0)).toBeGreaterThanOrEqual(-1)
      expect(t.x + Math.max(t.w, box.x1)).toBeLessThanOrEqual(VP.width + 1)
      expect(t.y + Math.max(t.h, box.y1)).toBeLessThanOrEqual(VP.height + 1)
    }
  })

  it('leaves the layout exactly as it was when names are off', () => {
    expect(computeLayout(birds, VP, {})).toEqual(computeLayout(birds, VP))
    expect(computeLayout(birds, VP).some((t) => 'label' in t)).toBe(false)
  })

  it('is deterministic', () => {
    expect(computeLayout(birds, VP, { labels })).toEqual(computeLayout(birds, VP, { labels }))
  })
})

function tile(sci: string, n: number, overrides: Partial<LaidTile> = {}): LaidTile {
  return { ...input(sci, n), x: 0, y: 0, w: 10, h: 10, parked: false, ...overrides }
}

describe('layoutSignature', () => {
  const base = [tile('a', 3), tile('b', 1), tile('c', 5)]

  it('is stable for the same species, counts, and art keys', () => {
    expect(layoutSignature(base)).toBe(layoutSignature([tile('a', 3), tile('b', 1), tile('c', 5)]))
  })

  it('ignores tile order', () => {
    expect(layoutSignature(base)).toBe(layoutSignature([tile('c', 5), tile('a', 3), tile('b', 1)]))
  })

  it('ignores pixel coordinates, so it holds across a resize', () => {
    const moved = base.map((t) => ({ ...t, x: t.x + 100, y: t.y + 40, w: t.w * 2, h: t.h * 2 }))
    expect(layoutSignature(moved)).toBe(layoutSignature(base))
  })

  it('changes when a detection count changes', () => {
    expect(layoutSignature([tile('a', 3)])).not.toBe(layoutSignature([tile('a', 4)]))
  })

  it('changes when a species enters or leaves', () => {
    expect(layoutSignature(base)).not.toBe(layoutSignature([tile('a', 3), tile('b', 1)]))
  })

  it('ignores the common name without labels, but not with them', () => {
    const label = { px: 12, rows: [], box: { x0: 0, y0: 0, x1: 1, y1: 1 }, cells: [] }
    expect(layoutSignature([tile('a', 3, { com: 'Amsel' })])).toBe(
      layoutSignature([tile('a', 3, { com: 'Blackbird' })]),
    )
    expect(layoutSignature([tile('a', 3, { com: 'Amsel', label })])).not.toBe(
      layoutSignature([tile('a', 3, { com: 'Blackbird', label })]),
    )
  })

  it('changes when the resolved art key changes (fallback→art, perched→flight)', () => {
    expect(layoutSignature([tile('a', 3, { key: 'a' })])).not.toBe(
      layoutSignature([tile('a', 3, { key: 'a-2' })]),
    )
  })
})
