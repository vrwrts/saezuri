import { type DecodedMask, maskOpaqueAt } from '../pack.ts'
import { ASC_EM, DESC_EM, LETTER_EM, MAX_INK, NEAR_PX } from './constants.ts'
import type { Pt } from './geometry.ts'

/** A silhouette drawn at a given tile size, queried in tile px. */
export interface InkField {
  mask: DecodedMask
  W: number
  H: number
  /** Mask cells per tile px along the finer axis: what sets how densely the ink
   *  tests must sample so they can't step over a one-cell claw. */
  res: number
}

export function inkField(mask: DecodedMask, W: number, H: number): InkField {
  return { mask, W, H, res: Math.max(mask.w / W, mask.h / H) }
}

export function inkAt(f: InkField, x: number, y: number): boolean {
  return maskOpaqueAt(f.mask, Math.floor((x / f.W) * f.mask.w), Math.floor((y / f.H) * f.mask.h))
}

// inkDepth: where a probe first steps into the bird, how far it may look, and how
// many consecutive misses end it. Small gaps are stepped over because a diagonal
// edge stair-steps at roughly one mask cell per tile px, and stopping at the first
// miss would read every slope as thin.
const DEPTH_START_PX = 1.5
const DEPTH_STEP_PX = 0.5
const DEPTH_MAX_MISSES = 4

/**
 * How much bird is under one point of the outline: how far a probe pushed inward
 * along the normal stays in ink. A bill or a leg reads a few px, a mantle tens. The
 * inward side is found by probing both ways, since the trace's winding depends on
 * where its first cell happened to fall.
 */
export function inkDepth(f: InkField, p: Pt, tx: number, ty: number, cap: number): number {
  const nx = ty
  const ny = -tx
  for (const s of [1, -1]) {
    if (!inkAt(f, p[0] + nx * s * DEPTH_START_PX, p[1] + ny * s * DEPTH_START_PX)) continue
    let miss = 0
    let d = DEPTH_START_PX
    for (; d <= cap; d += DEPTH_STEP_PX) {
      if (inkAt(f, p[0] + nx * s * d, p[1] + ny * s * d)) miss = 0
      else if (++miss > DEPTH_MAX_MISSES) break
    }
    return d - miss * DEPTH_STEP_PX
  }
  return 0
}

/** Fewest rows the ink test sweeps across the em band, whatever the mask density. */
const MIN_BAND_ROWS = 11

/**
 * The most silhouette any one letter-width of lettering on `pts` would sit on, as a
 * share of the em band. The worst window, not the mean, because one claw through one
 * letter ruins the name while barely moving an average. The band is swept across
 * each segment's own normal, since on a textPath a glyph's "up" turns with the path.
 * Sampling along the arc at twice the mask density, so rounding can't skip a cell.
 * Returns early once past MAX_INK: callers only ever ask whether it exceeds that.
 */
export function bandInk(f: InkField, pts: readonly Pt[], px: number): number {
  const rows = Math.max(MIN_BAND_ROWS, Math.ceil((ASC_EM + DESC_EM) * px * f.res) + 1)
  const step = Math.min(1, 1 / (2 * f.res))
  const hits: number[] = []
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const dx = pts[i][0] - ax
    const dy = pts[i][1] - ay
    const d = Math.hypot(dx, dy)
    if (d < 1e-6) continue
    const ux = dx / d
    const uy = dy / d
    const n = Math.max(1, Math.round(d / step))
    for (let j = 0; j < n; j++) {
      const qx = ax + (dx * j) / n
      const qy = ay + (dy * j) / n
      let hit = 0
      for (let r = 0; r < rows; r++) {
        const e = (-DESC_EM + ((ASC_EM + DESC_EM) * r) / (rows - 1)) * px
        if (inkAt(f, qx + uy * e, qy - ux * e)) hit++
      }
      hits.push(hit / rows)
    }
  }
  // No geometry is not clean geometry.
  if (hits.length === 0) return 1
  const win = Math.max(2, Math.round((px * LETTER_EM) / step))
  let sum = 0
  if (hits.length <= win) {
    for (const h of hits) sum += h
    return sum / hits.length
  }
  let worst = 0
  for (let i = 0; i < hits.length; i++) {
    sum += hits[i]
    if (i >= win) sum -= hits[i - win]
    if (i >= win - 1 && sum / win > worst) worst = sum / win
    if (worst > MAX_INK) return worst
  }
  return worst
}

const HUG_PROBE_STEP_PX = 2

/**
 * Share of the lettering on `pts` that has bird within `reachEm` of it, probing both
 * ways along each segment's normal. Pushing a name off ink has an end state where it
 * floats free of the drawing, and an ink test can't tell that from a good placement;
 * this can.
 */
export function hugShare(f: InkField, pts: readonly Pt[], px: number, reachEm: number): number {
  const reach = px * reachEm + NEAR_PX
  let near = 0
  let all = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const dx = pts[i][0] - ax
    const dy = pts[i][1] - ay
    const L = Math.hypot(dx, dy)
    if (L < 1e-6) continue
    const nx = -dy / L
    const ny = dx / L
    const n = Math.max(1, Math.round(L))
    for (let j = 0; j < n; j++) {
      const x = ax + (dx * j) / n
      const y = ay + (dy * j) / n
      all++
      for (let d = 0; d <= reach; d += HUG_PROBE_STEP_PX) {
        if (inkAt(f, x + nx * d, y + ny * d) || inkAt(f, x - nx * d, y - ny * d)) {
          near++
          break
        }
      }
    }
  }
  return all ? near / all : 0
}
