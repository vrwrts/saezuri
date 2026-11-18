import {
  ASC_EM,
  BOW_WORTH,
  CURVED_STRAIGHTNESS,
  DESC_EM,
  LEAN_WORTH,
  LETTER_EM,
  MAX_BOW,
  MAX_LEAN_DEG,
  MAX_RUN_SHARE,
  MIN_RUN_EM,
  MIN_RUN_SAMPLES,
  NEAR_PX,
  OVERRUN_EM,
  RUN_SLOT_SHARE,
  SEAT_SHARE,
  SHORTLIST,
  STRAIGHT_STRAIGHTNESS,
  WRAPPED_STRAIGHTNESS,
} from './constants.ts'
import { leanOf, type Pt } from './geometry.ts'
import { type InkField, inkAt, inkDepth } from './ink.ts'

/** A stretch of the bird's own outline the name could ride. */
export interface Run {
  /** The run's outline points, tile px. */
  pts: Pt[]
  len: number
  /** Shortlist rank: coverage × straightness × lean. */
  q: number
  /** The run's shape alone (lean, bow, seat), which bounds a finished placement's
   *  worth from above: every other term of that worth is a share. */
  shape: number
  /** Share of the name the run itself carries (may exceed 1). */
  cover: number
  /** How much of its outline this run could grow into at the ordinary lean
   *  ceiling, which says whether the bird has an edge at all. */
  ledge: number
  /** The run grown along the outline to `cap` px, keeping every letter under `ceil`. */
  grow(cap: number, ceil: number): { pts: Pt[]; len: number }
}

/**
 * One number in 0..1 for how well an edge carries a name. Coverage (saturating at
 * one: more edge than the name needs buys nothing), straightness, and lean, each
 * normalised and multiplied, so a run has to be respectable at all three rather than
 * buy its way in on one.
 */
function edgeQuality(cover: number, straightness: number, lean: number): number {
  const s = Math.min(
    1,
    Math.max(
      0,
      (straightness - CURVED_STRAIGHTNESS) / (STRAIGHT_STRAIGHTNESS - CURVED_STRAIGHTNESS),
    ),
  )
  const l = Math.max(0, 1 - ((1 - LEAN_WORTH) * lean) / MAX_LEAN_DEG)
  return Math.min(1, cover) * s * l
}

/**
 * The runs a name could sit on, best first. Every (start, length) is scored, but
 * only the best run in each stretch of outline is kept. Several, because whether a
 * run is clear of the bird's own feet can only be known once the lettering is laid
 * on it.
 *
 * `nameEm` ranks runs; `fitEm` (the shortest line the name could break into) only
 * admits them, so a run half the name could ride still reaches the scorer. `minPx`
 * also only admits: the caller re-checks each run at the size it is trying.
 */
export function pickRuns(
  outline: readonly Pt[],
  f: InkField,
  nameEm: number,
  fitEm: number,
  maxPx: number,
  minPx: number,
): Run[] {
  const P: Pt[] = outline.map((q) => [(q[0] / f.mask.w) * f.W, (q[1] / f.mask.h) * f.H])
  const n = P.length
  const wrap = (v: number) => ((v % n) + n) % n
  const seg: number[] = []
  let hoop = 0
  for (let i = 0; i < n; i++) {
    const b = P[(i + 1) % n]
    seg.push(Math.hypot(b[0] - P[i][0], b[1] - P[i][1]))
    hoop += seg[i]
  }

  // How steeply a letter standing at each outline point would lean, read across one
  // letter's width: on a textPath a glyph stands on the local tangent, so a run with
  // a level chord can still end in letters on their side. Never narrower than one
  // sample each way, or a large tile reads the resampling instead of the bird.
  const lean: number[] = []
  const halfLetter = Math.max(3, LETTER_EM * maxPx) / 2 / (hoop / n)
  const arm = Math.max(1, Math.min(Math.round(n / 4), Math.round(halfLetter)))
  for (let i = 0; i < n; i++) {
    const a = P[wrap(i - arm)]
    const b = P[wrap(i + arm)]
    lean.push(leanOf((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI))
  }

  const slack = 2 * OVERRUN_EM
  const minRun = MIN_RUN_EM * minPx
  const slot = Math.max(1, Math.round(n * RUN_SLOT_SHARE))
  type Cand = { i: number; L: number; len: number; q: number; cover: number; shape: number }
  const best: Array<Cand | undefined> = []

  for (let i = 0; i < n; i++) {
    let len = 0
    let tilt = lean[i]
    for (let L = 1; L < n * MAX_RUN_SHARE; L++) {
      len += seg[wrap(i + L - 1)]
      tilt = Math.max(tilt, lean[wrap(i + L)])
      // The running maximum only grows: nothing longer from here comes back under.
      if (tilt >= MAX_LEAN_DEG) break
      if (L < MIN_RUN_SAMPLES) continue
      const a0 = P[i]
      const a1 = P[wrap(i + L)]
      const cx = a1[0] - a0[0]
      const cy = a1[1] - a0[1]
      const chord = Math.hypot(cx, cy)
      if (chord < len * WRAPPED_STRAIGHTNESS) break
      // Wandering, but maybe not for good: a crown dips here and recovers ahead.
      if (chord < len * CURVED_STRAIGHTNESS || len < minRun) continue
      // Length is cashed in for size only where even the overrun can't cover it.
      const px = fitEm <= slack ? maxPx : Math.min(maxPx, Math.floor(len / (fitEm - slack)))
      if (px < minPx) continue
      const cover = len / (nameEm * px)
      const q = edgeQuality(cover, chord / len, tilt)
      if (q <= 0) continue
      const g = (i / slot) | 0
      const held = best[g]
      if (held && q <= held.q) continue
      // Chord over arc misses an S that wanders back; the bow at the quarters catches it.
      let bow = 0
      for (let k = 1; k <= 3; k++) {
        const m = P[wrap(i + Math.round((L * k) / 4))]
        const t = ((m[0] - a0[0]) * cx + (m[1] - a0[1]) * cy) / (chord * chord)
        bow = Math.max(bow, Math.hypot(m[0] - a0[0] - cx * t, m[1] - a0[1] - cy * t) / chord)
      }
      if (bow > MAX_BOW) continue
      // The final choice judges straightness by bow, not chord over arc: the latter
      // sums sampling noise and charges a short run twice for being short.
      const bend = 1 - ((1 - BOW_WORTH) * bow) / MAX_BOW
      best[g] = { i, L, len, q, cover, shape: bend * edgeQuality(1, 1, tilt) }
    }
  }

  const list = best.filter((c): c is Cand => c !== undefined)
  list.sort((a, b) => b.q - a.q)
  const top = list.slice(0, SHORTLIST)

  function follow(i0: number, L0: number, ceil: number, cap: number) {
    let a = i0
    let b = i0 + L0
    let len = 0
    let fwd = 0
    let back = 0
    for (let k = 0; k < L0; k++) len += seg[wrap(i0 + k)]
    // Grow whichever side has grown less, so the lettering stays centred on the
    // chosen run rather than sliding along the bird as one side runs out.
    while (len < cap && b - a < n - 1) {
      const okF = lean[wrap(b + 1)] <= ceil
      const okB = lean[wrap(a - 1)] <= ceil
      if (!okF && !okB) break
      let s: number
      if (okF && (!okB || fwd <= back)) {
        s = seg[wrap(b)]
        b++
        fwd += s
      } else {
        a--
        s = seg[wrap(a)]
        back += s
      }
      len += s
    }
    const pts: Pt[] = []
    for (let k = a; k <= b; k++) pts.push(P[wrap(k)])
    return { pts, len }
  }

  // Depth per outline sample, shared between overlapping runs: the probe is the
  // costly part and there are only ever as many probes as samples.
  const cap = Math.max(f.W, f.H)
  const depth = new Map<number, number>()
  const depthAt = (idx: number) => {
    let d = depth.get(idx)
    if (d === undefined) {
      const a = P[wrap(idx - 1)]
      const b = P[wrap(idx + 1)]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const dL = Math.hypot(dx, dy) || 1
      d = inkDepth(f, P[idx], dx / dL, dy / dL, cap)
      depth.set(idx, d)
    }
    return d
  }
  // The median, because a run that leaves the body for its last samples is still
  // a run along the body.
  const seats = top.map((c) => {
    const ds: number[] = []
    for (let m = 0; m <= c.L; m++) ds.push(depthAt(wrap(c.i + m)))
    ds.sort((x, y) => x - y)
    return ds[ds.length >> 1]
  })
  const deepest = Math.max(0, ...seats)

  return top.map((c, k) => {
    const pts: Pt[] = []
    for (let m = 0; m <= c.L; m++) pts.push(P[wrap(c.i + m)])
    const seat = deepest > 0 ? Math.min(1, seats[k] / (SEAT_SHARE * deepest)) : 1
    return {
      pts,
      len: c.len,
      q: c.q,
      cover: c.cover,
      shape: c.shape * seat,
      ledge: follow(c.i, c.L, MAX_LEAN_DEG, nameEm * maxPx).len,
      grow: (growCap: number, ceil: number) => follow(c.i, c.L, ceil, growCap),
    }
  })
}

/** Probe depths, in em, for deciding which side of a run is open paper: summed down
 *  the whole run over the depth the lettering will occupy. One shallow probe reads a
 *  heron's thin bill as open beneath and lays the name through its neck. */
const SIDE_PROBES_EM = [0.35, 0.7, 1.05] as const
/** Window, in em, over which each point's normal is read. Fixed in em rather than
 *  samples, or on a small bird the normal turns with every wobble and the offset
 *  line folds back through itself. */
const NORMAL_WINDOW_EM = 0.6

/**
 * The run pushed off the silhouette, every point along its own outward normal so a
 * curving edge keeps an even gap. Letters grow upward from the baseline, so when the
 * name sits under the bird the baseline must clear a whole ascender; above it, only
 * the descenders. The run's steepest point sets the gap for all of it. `liftEm`
 * buys extra clearance after a try landed on ink. `under` tells the caller which
 * way to stack a second line.
 */
export function offsetRun(
  run: readonly Pt[],
  f: InkField,
  px: number,
  liftEm: number,
): { pts: Pt[]; under: boolean } {
  const n = run.length
  let arc = 0
  for (let i = 1; i < n; i++)
    arc += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1])
  const win = Math.max(2, Math.round((px * NORMAL_WINDOW_EM * (n - 1)) / (arc || 1)))
  const nx: number[] = []
  const ny: number[] = []
  let plus = 0
  let minus = 0
  for (let i = 0; i < n; i++) {
    const a = run[Math.max(0, i - win)]
    const b = run[Math.min(n - 1, i + win)]
    const vx = -(b[1] - a[1])
    const vy = b[0] - a[0]
    const L = Math.hypot(vx, vy) || 1
    nx.push(vx / L)
    ny.push(vy / L)
    for (const em of SIDE_PROBES_EM) {
      const d = em * px
      if (inkAt(f, run[i][0] + (vx / L) * d, run[i][1] + (vy / L) * d)) plus++
      if (inkAt(f, run[i][0] - (vx / L) * d, run[i][1] - (vy / L) * d)) minus++
    }
  }
  const side = plus <= minus ? 1 : -1
  let down = 0
  let lean = 0
  for (let i = 0; i < n; i++) {
    down = Math.max(down, ny[i] * side)
    lean += ny[i] * side
  }
  const gap = NEAR_PX + px * (DESC_EM + (ASC_EM - DESC_EM) * down + liftEm)
  const pts: Pt[] = run.map((p, i) => [p[0] + nx[i] * side * gap, p[1] + ny[i] * side * gap])
  return { pts, under: lean > 0 }
}
