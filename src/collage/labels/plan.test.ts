import { describe, expect, it } from 'vitest'
import type { DecodedMask } from '../pack.ts'
import { MAX_INK } from './constants.ts'
import { arcLen, baselineOk } from './geometry.ts'
import { bandInk, inkField } from './ink.ts'
import { breakName, labelBounds, planTileLabel } from './plan.ts'
import { discMask, fakeMeasureEm, lMask, perchedBirdMask, solidMask } from './testMasks.ts'

const opts = { measureEm: fakeMeasureEm, minPx: 9 }

const shapes: Array<[string, DecodedMask, number, number]> = [
  ['rectangle', solidMask(60, 40), 150, 100],
  ['disc', discMask(50), 110, 110],
  ['L', lMask(50), 120, 120],
  ['perched bird', perchedBirdMask(), 160, 124],
  ['small bird', perchedBirdMask(), 70, 54],
  ['tall narrow bird', solidMask(20, 60), 40, 120],
]

describe('breakName', () => {
  it('offers the whole name first, then the evenest break at a space', () => {
    const lays = breakName('Northern Mockingbird', fakeMeasureEm)
    expect(lays[0].rows).toEqual(['Northern Mockingbird'])
    expect(lays[1].rows).toEqual(['Northern', 'Mockingbird'])
  })

  it('never breaks at a hyphen', () => {
    expect(breakName('Black-capped', fakeMeasureEm)).toHaveLength(1)
  })

  it('refuses a break that leaves a stub', () => {
    expect(breakName('Ou Bird-of-paradise', fakeMeasureEm)).toHaveLength(1)
  })
})

describe('planTileLabel', () => {
  it.each(shapes)('names every %s, with baselines as long as their text', (_, mask, W, H) => {
    const label = planTileLabel(mask, W, H, 'Western Bluebird', opts)
    expect(label).not.toBeNull()
    for (const row of label?.rows ?? []) {
      expect(arcLen(row.pts)).toBeGreaterThanOrEqual(fakeMeasureEm(row.text) * (label?.px ?? 0))
      // Read left to right.
      expect(row.pts[row.pts.length - 1][0]).toBeGreaterThan(row.pts[0][0])
    }
  })

  it.each(shapes)('keeps the lettering on a %s off the ink and legible', (_, mask, W, H) => {
    const label = planTileLabel(mask, W, H, 'Western Bluebird', opts)
    if (!label) throw new Error('no label')
    const f = inkField(mask, W, H)
    for (const row of label.rows) {
      expect(bandInk(f, row.pts, label.px)).toBeLessThanOrEqual(MAX_INK)
      expect(baselineOk(row.pts, 90)).toBe(true)
    }
    expect(label.px).toBeGreaterThanOrEqual(opts.minPx)
  })

  it('reserves cells inside the label box that together span it', () => {
    const label = planTileLabel(perchedBirdMask(), 160, 124, 'House Finch', opts)
    if (!label) throw new Error('no label')
    expect(label.box).toEqual(labelBounds(label.rows, label.px))
    for (const c of label.cells) {
      expect(c.x0).toBeGreaterThanOrEqual(label.box.x0 - 1e-9)
      expect(c.x1).toBeLessThanOrEqual(label.box.x1 + 1e-9)
      expect(c.y0).toBeGreaterThanOrEqual(label.box.y0 - 1e-9)
      expect(c.y1).toBeLessThanOrEqual(label.box.y1 + 1e-9)
    }
    expect(Math.min(...label.cells.map((c) => c.x0))).toBeCloseTo(label.box.x0, 6)
    expect(Math.max(...label.cells.map((c) => c.x1))).toBeCloseTo(label.box.x1, 6)
  })

  it('is deterministic', () => {
    const a = planTileLabel(perchedBirdMask(), 160, 124, 'Song Sparrow', opts)
    const b = planTileLabel(perchedBirdMask(), 160, 124, 'Song Sparrow', opts)
    expect(a).toEqual(b)
  })

  it('respects a larger minimum size, as the e-ink frames ask for', () => {
    const label = planTileLabel(perchedBirdMask(), 70, 54, 'Song Sparrow', { ...opts, minPx: 11 })
    expect(label?.px).toBeGreaterThanOrEqual(11)
  })

  it('gives up only on a shape with no outline', () => {
    expect(planTileLabel({ w: 4, h: 4, cells: [] }, 40, 40, 'Nobody', opts)).toBeNull()
    expect(planTileLabel(solidMask(40, 30), 80, 60, '', opts)).toBeNull()
  })
})
