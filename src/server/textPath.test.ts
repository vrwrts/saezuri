import { describe, expect, it } from 'vitest'
import type { Pt } from '../collage/labels/geometry.ts'
import { placeGlyphs } from './textPath.ts'

const tenPerChar = (s: string) => s.length * 10

describe('placeGlyphs', () => {
  it('centres the run on a straight baseline, one glyph per advance', () => {
    const line: Pt[] = [
      [0, 50],
      [100, 50],
    ]
    const g = placeGlyphs(line, 'abc', tenPerChar)
    // 30px of text on 100px of line starts at 35; glyph centres at 40, 50, 60.
    expect(g.map((p) => p.x)).toEqual([40, 50, 60])
    for (const p of g) {
      expect(p.y).toBe(50)
      expect(p.angle).toBe(0)
    }
  })

  it('turns each glyph to the tangent where it sits', () => {
    const bent: Pt[] = [
      [0, 0],
      [30, 0],
      [30, 30],
    ]
    const g = placeGlyphs(bent, 'abcdef', tenPerChar)
    expect(g[0].angle).toBe(0)
    expect(g[5].angle).toBeCloseTo(Math.PI / 2, 6)
  })

  it('keeps a letter and its combining accent together', () => {
    const line: Pt[] = [
      [0, 0],
      [100, 0],
    ]
    const g = placeGlyphs(line, 'Blé', (s) => [...s].length * 10)
    expect(g.map((p) => p.text)).toEqual(['B', 'l', 'é'])
  })

  it('places by prefix width, so kerning between neighbours is kept', () => {
    const line: Pt[] = [
      [0, 0],
      [100, 0],
    ]
    // "AV" kerns 4px tighter than its letters' widths summed.
    const kerned = (s: string) => s.length * 10 - (s.includes('AV') ? 4 : 0)
    const g = placeGlyphs(line, 'AV', kerned)
    expect(g[1].x - g[0].x).toBeCloseTo(8, 6)
  })
})
