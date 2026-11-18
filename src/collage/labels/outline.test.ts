import { describe, expect, it } from 'vitest'
import { traceOutline } from './outline.ts'
import { discMask, lMask, solidMask } from './testMasks.ts'

describe('traceOutline', () => {
  it.each([
    ['rectangle', solidMask(40, 30)],
    ['disc', discMask(40)],
    ['L', lMask(40)],
  ])('traces a closed, evenly spaced loop round a %s', (_, mask) => {
    const pts = traceOutline(mask)
    expect(pts).not.toBeNull()
    const loop = pts ?? []
    const gaps = loop.map((p, i) => {
      const q = loop[(i + 1) % loop.length]
      return Math.hypot(q[0] - p[0], q[1] - p[1])
    })
    // Closed: the last point is as near the first as neighbours are to each other.
    expect(Math.max(...gaps)).toBeLessThan(3)
    for (const [x, y] of loop) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(mask.w)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(mask.h)
    }
  })

  it('goes all the way round the shape', () => {
    const pts = traceOutline(solidMask(40, 30)) ?? []
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(35)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(25)
  })

  it('refuses a shape too small to letter along', () => {
    expect(traceOutline(solidMask(2, 2))).toBeNull()
    expect(traceOutline({ w: 5, h: 5, cells: [] })).toBeNull()
  })

  it('memoises per mask', () => {
    const mask = discMask(30)
    expect(traceOutline(mask)).toBe(traceOutline(mask))
  })
})
