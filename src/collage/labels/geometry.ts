import { BASELINE_STEP_PX, MAX_LEAN_DEG } from './constants.ts'

/** A point in tile-local px. */
export type Pt = [number, number]

export function arcLen(pts: readonly Pt[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  }
  return total
}

/** `from` moved `d` further away from `toward`, along the line between them. */
export function nudge(from: Pt, toward: Pt, d: number): Pt {
  const dx = from[0] - toward[0]
  const dy = from[1] - toward[1]
  const L = Math.hypot(dx, dy) || 1
  return [from[0] + (dx / L) * d, from[1] + (dy / L) * d]
}

/** Push both ends out along their own headings until the polyline is `want` long.
 *  Sampling a curve into chords shortens it, and a textPath shorter than its
 *  string drops glyphs off the end. */
function padToLength(pts: Pt[], want: number): Pt[] {
  const pad = (want - arcLen(pts)) / 2
  if (pad > 0 && pts.length > 1) {
    pts[0] = nudge(pts[0], pts[1], pad)
    pts[pts.length - 1] = nudge(pts[pts.length - 1], pts[pts.length - 2], pad)
  }
  return pts
}

/**
 * A span exactly `want` long, cut from `pts` around its arc midpoint and carried on
 * in a straight line along the run's chord where the run is shorter. The chord, not
 * the tangent at each end: end tangents read the resampling and splay apart, and an
 * overrun several times the run's length multiplies that into a wild miss.
 *
 * `toward` (the tile centre) only matters when the name is longer than the run.
 * Every offset within the overrun keeps the whole run under the lettering, so it
 * costs nothing to slide toward the tile, where the reserved paper is less likely
 * to block a neighbour.
 */
export function centredSpan(pts: readonly Pt[], want: number, toward?: Pt): Pt[] {
  const seg: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    seg.push(d)
    total += d
  }
  if (total <= 0) return pts.map((p) => [p[0], p[1]])

  const head = pts[0]
  const tail = pts[pts.length - 1]
  const cx = tail[0] - head[0]
  const cy = tail[1] - head[1]
  const cL = Math.hypot(cx, cy) || 1

  const onRun = (t: number): Pt => {
    let acc = 0
    for (let k = 0; k < seg.length; k++) {
      if (acc + seg[k] >= t) {
        const f = seg[k] > 0 ? (t - acc) / seg[k] : 0
        return [
          pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f,
          pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f,
        ]
      }
      acc += seg[k]
    }
    return [tail[0], tail[1]]
  }
  const at = (t: number): Pt => {
    if (t < 0) return [head[0] + (cx / cL) * t, head[1] + (cy / cL) * t]
    if (t > total) return [tail[0] + (cx / cL) * (t - total), tail[1] + (cy / cL) * (t - total)]
    return onRun(t)
  }

  let mid = total / 2
  if (toward && want > total) {
    const slack = (want - total) / 2
    const u = (((toward[0] - head[0]) * cx + (toward[1] - head[1]) * cy) / (cL * cL)) * total
    mid = Math.max(mid - slack, Math.min(mid + slack, u))
  }
  const steps = Math.max(2, Math.round(want / BASELINE_STEP_PX))
  const out: Pt[] = []
  for (let i = 0; i <= steps; i++) out.push(at(mid - want / 2 + (want * i) / steps))
  return padToLength(out, want)
}

/**
 * A finished baseline pushed `d` further off the bird (`away` = +1 toward the
 * lettering's ascenders, −1 toward its descenders): how every line of a broken name
 * after the first is made. Each vertex moves along the bisector of its two segments,
 * far enough that both segments end up `d` from the originals; an averaged normal
 * would leave bends closer than `d` and let one line's ascenders into the other's
 * descenders.
 */
export function stack(base: readonly Pt[], away: number, d: number, want: number): Pt[] {
  const n = base.length
  const nx: number[] = []
  const ny: number[] = []
  for (let i = 1; i < n; i++) {
    const dx = base[i][0] - base[i - 1][0]
    const dy = base[i][1] - base[i - 1][1]
    const L = Math.hypot(dx, dy) || 1
    nx.push((dy / L) * away)
    ny.push((-dx / L) * away)
  }
  // Floor on the bisector's cosine. Baselines never turn as far as MAX_LEAN_DEG in
  // one step, so this is arithmetic safety, not a mitre limit.
  const MIN_MITRE_COS = 0.5
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const j = i ? i - 1 : 0
    const k = i < n - 1 ? i : n - 2
    let mx = nx[j] + nx[k]
    let my = ny[j] + ny[k]
    const L = Math.hypot(mx, my) || 1
    mx /= L
    my /= L
    const m = Math.max(MIN_MITRE_COS, mx * nx[j] + my * ny[j])
    out.push([base[i][0] + (mx * d) / m, base[i][1] + (my * d) / m])
  }
  return padToLength(out, want)
}

/**
 * Whether a baseline can carry a name. Three ways it can't, all properties of the
 * line as drawn rather than of the run it came from (offsetting a run sharpens its
 * curves): a segment leaning past `ceil` lays a letter on its side; a turn of
 * MAX_LEAN_DEG between neighbours puts a chevron in the word; and a segment running
 * backwards along the chord, where an offset folded over itself, stacks letters.
 */
export function baselineOk(pts: readonly Pt[], ceil = MAX_LEAN_DEG): boolean {
  const ax = pts[pts.length - 1][0] - pts[0][0]
  const ay = pts[pts.length - 1][1] - pts[0][1]
  let prev: number | null = null
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0]
    const dy = pts[i][1] - pts[i - 1][1]
    if (dx * ax + dy * ay <= 0) return false
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (prev !== null && Math.abs(deg - prev) >= MAX_LEAN_DEG) return false
    prev = deg
    if (leanOf(deg) >= ceil) return false
  }
  return true
}

/** A heading in degrees folded to its lean off horizontal, 0..90. */
export function leanOf(deg: number): number {
  const a = Math.abs(deg) % 180
  return a > 90 ? 180 - a : a
}
