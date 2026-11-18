import type { Pt } from '../collage/labels/geometry.ts'

// Canvas has no textPath, so the e-ink renderer sets a name along its baseline one
// grapheme at a time, the way an SVG textPath does: each glyph's midpoint sits on
// the path and the glyph turns to the path's tangent there.

export interface PlacedGlyph {
  text: string
  /** Where the glyph's horizontal centre meets the baseline. */
  x: number
  y: number
  /** Radians. */
  angle: number
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The point and heading `d` px along a polyline, continuing straight past its ends. */
function along(pts: readonly Pt[], d: number): { x: number; y: number; angle: number } {
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const dx = pts[i][0] - ax
    const dy = pts[i][1] - ay
    const L = Math.hypot(dx, dy)
    if (L === 0) continue
    if (acc + L >= d || i === pts.length - 1) {
      const t = (d - acc) / L
      return { x: ax + dx * t, y: ay + dy * t, angle: Math.atan2(dy, dx) }
    }
    acc += L
  }
  const [x, y] = pts[0] ?? [0, 0]
  return { x, y, angle: 0 }
}

/**
 * Each grapheme of `text`, centred as a run on `pts`. Advances come from measuring
 * each prefix rather than each glyph alone, so kerning between neighbours survives
 * the glyphs being drawn one by one. Graphemes rather than code units, so a letter
 * and its combining accent are never split.
 */
export function placeGlyphs(
  pts: readonly Pt[],
  text: string,
  measure: (s: string) => number,
): PlacedGlyph[] {
  let arc = 0
  for (let i = 1; i < pts.length; i++) {
    arc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  }
  const start = (arc - measure(text)) / 2
  const out: PlacedGlyph[] = []
  let prefix = ''
  let before = 0
  for (const { segment } of segmenter.segment(text)) {
    prefix += segment
    const after = measure(prefix)
    const at = along(pts, start + (before + after) / 2)
    out.push({ text: segment, ...at })
    before = after
  }
  return out
}
