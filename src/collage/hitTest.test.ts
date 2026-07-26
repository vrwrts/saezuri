import { describe, expect, it } from 'vitest'
import { hitTest } from './hitTest.ts'
import type { LaidTile } from './layout.ts'
import type { DecodedMask } from './pack.ts'

/** Build a mask of the given cell dims, opaque where `on(x,y)` is true. */
function mask(w: number, h: number, on: (x: number, y: number) => boolean): DecodedMask {
  const cells: Array<[number, number]> = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) cells.push([x, y])
  return { w, h, cells }
}
const solid = (w: number, h: number) => mask(w, h, () => true)

/** A placed tile; only x/y/w/h/mask/sci matter to the hit-tester. */
function laidTile(
  sci: string,
  x: number,
  y: number,
  w: number,
  h: number,
  m: DecodedMask,
): LaidTile {
  return {
    sci,
    com: sci,
    n: 1,
    key: sci,
    imageUrl: '',
    illustrated: true,
    pose: 1,
    mask: m,
    ar: w / h,
    x,
    y,
    w,
    h,
    parked: false,
  }
}

describe('hitTest', () => {
  it('hits a point inside the silhouette', () => {
    const t = laidTile('a', 0, 0, 100, 100, solid(10, 10))
    expect(hitTest(50, 50, [t])).toBe(t)
  })

  it('misses a transparent part of the box', () => {
    // Opaque only in the left half (mask x < 5).
    const t = laidTile(
      'a',
      0,
      0,
      100,
      100,
      mask(10, 10, (x) => x < 5),
    )
    expect(hitTest(10, 50, [t])).toBe(t) // mx=1 → opaque
    expect(hitTest(90, 50, [t])).toBeNull() // mx=9 → transparent
  })

  it('returns null outside every box', () => {
    const t = laidTile('a', 10, 10, 50, 50, solid(10, 10))
    expect(hitTest(5, 5, [t])).toBeNull()
    expect(hitTest(100, 100, [t])).toBeNull()
    expect(hitTest(0, 0, [])).toBeNull()
  })

  it('lets the topmost (later-in-array) opaque tile win', () => {
    const a = laidTile('a', 0, 0, 100, 100, solid(10, 10))
    const b = laidTile('b', 0, 0, 100, 100, solid(10, 10))
    expect(hitTest(50, 50, [a, b])?.sci).toBe('b')
  })

  it('falls through a transparent topmost tile to the opaque bird beneath', () => {
    const under = laidTile('under', 0, 0, 100, 100, solid(10, 10)) // opaque everywhere
    const over = laidTile(
      'over',
      0,
      0,
      100,
      100,
      mask(10, 10, (x) => x < 5),
    ) // left half only
    const tiles = [under, over] // `over` paints on top
    expect(hitTest(10, 50, tiles)?.sci).toBe('over') // over is opaque here
    expect(hitTest(90, 50, tiles)?.sci).toBe('under') // over transparent → under wins
  })
})
