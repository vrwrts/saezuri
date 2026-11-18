import { describe, expect, it } from 'vitest'
import { type DecodedMask, decodeMask, isParked, maskPack, type PlaceableTile } from './pack.ts'

/** A fully-opaque mask of the given cell dimensions. */
function solidMask(w: number, h: number): DecodedMask {
  const cells: Array<[number, number]> = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y])
  return { w, h, cells }
}

function tile(fullW: number, fullH: number, mask = solidMask(10, 10)): PlaceableTile {
  return { fullW, fullH, mask, x: 0, y: 0 }
}

function boxesOverlap(a: PlaceableTile, b: PlaceableTile): boolean {
  return !(
    a.x + a.fullW <= b.x ||
    b.x + b.fullW <= a.x ||
    a.y + a.fullH <= b.y ||
    b.y + b.fullH <= a.y
  )
}

describe('decodeMask', () => {
  it('decodes MSB-first packed bits into sparse cells', () => {
    // One byte 0x81 = 0b1000_0001 → bits 0 and 7 set on an 8x1 mask.
    const m = decodeMask({ w: 8, h: 1, bits: btoa(String.fromCharCode(0x81)) })
    expect(m.cells).toEqual([
      [0, 0],
      [7, 0],
    ])
  })
})

describe('maskPack', () => {
  it('places non-overlapping tiles inside the viewport', () => {
    const tiles = [tile(120, 90), tile(100, 100), tile(80, 120)]
    const placed = maskPack(tiles, 800, 600, 2.1, 1, 3)
    for (const t of placed) expect(isParked(t)).toBe(false)
    // Every pair is disjoint (solid masks ⇒ bbox disjoint ⇒ masks disjoint).
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(boxesOverlap(placed[i], placed[j])).toBe(false)
  })

  it('is deterministic for identical inputs', () => {
    const a = maskPack([tile(120, 90), tile(100, 100)], 800, 600, 2.1, 1, 3)
    const b = maskPack([tile(120, 90), tile(100, 100)], 800, 600, 2.1, 1, 3)
    expect(a.map((t) => [t.x, t.y])).toEqual(b.map((t) => [t.x, t.y]))
  })

  it('keeps every other tile off a label it reserves', () => {
    // A strip under the first bird, reaching well past its sides.
    const label = { x0: -40, y0: 104, x1: 140, y1: 130 }
    const named: PlaceableTile = { ...tile(100, 100), labelCells: [label], labelBox: label }
    const others = Array.from({ length: 8 }, () => tile(70, 70))
    const placed = maskPack([named, ...others], 800, 600, 2.1, 1, 3)
    const strip = { x: named.x + label.x0, y: named.y + label.y0 }
    for (const t of placed) {
      if (t === named || isParked(t)) continue
      const clear =
        t.x + t.fullW <= strip.x ||
        t.x >= strip.x + (label.x1 - label.x0) ||
        t.y + t.fullH <= strip.y ||
        t.y >= strip.y + (label.y1 - label.y0)
      expect(clear).toBe(true)
    }
  })

  it('keeps a label inside the viewport, not just its bird', () => {
    // The anchor (largest tile) is centred unconditionally; the named tile is placed
    // by the search, which must keep its wide label on-screen too.
    const label = { x0: -120, y0: 0, x1: 170, y1: 20 }
    const named: PlaceableTile = { ...tile(50, 50), labelCells: [label], labelBox: label }
    maskPack([tile(150, 150), named], 500, 400, 2.1, 1, 3)
    expect(isParked(named)).toBe(false)
    expect(named.x + label.x0).toBeGreaterThanOrEqual(0)
    expect(named.x + label.x1).toBeLessThanOrEqual(500)
  })

  it('parks a tile that cannot fit rather than overlapping', () => {
    // First tile fills the viewport; the second has nowhere to go.
    const placed = maskPack([tile(780, 580), tile(400, 400)], 800, 600, 2.1, 1, 3)
    const parked = placed.filter((t) => isParked(t))
    expect(parked.length).toBe(1)
  })
})
