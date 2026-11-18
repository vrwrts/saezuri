import type { DecodedMask, LocalRect } from '../pack.ts'
import {
  ADHERE_REACH_EM,
  ADHERE_SHARE,
  ASC_EM,
  ATTACH_POWER,
  BASELINE_SLACK_PX,
  BESIDE_REACH_EM,
  BREAK_WORTH,
  CAP_FRAC,
  CELL_CHUNK,
  CURL_LEDGE,
  CURL_MAX_DEG,
  DESC_EM,
  EVEN_BREAK,
  GAP_PX,
  LEADING_EM,
  LIFT_LADDER_EM,
  MAX_INK,
  MAX_LEAN_DEG,
  MAX_PX,
  MIN_RUN_EM,
  NEAR_PX,
  OVERRUN_EM,
  PARTIAL_HOLD,
  SHRINK_STEPS_PX,
  SNUG_ATTACH,
  SNUG_PAPER,
  TANGENT_MAX_DEG,
  TANGENT_REACH,
  TANGENT_STEP_DEG,
} from './constants.ts'
import { offsetRun, pickRuns, type Run } from './edges.ts'
import { arcLen, baselineOk, centredSpan, type Pt, stack } from './geometry.ts'
import { bandInk, hugShare, type InkField, inkField } from './ink.ts'
import { traceOutline } from './outline.ts'

/** Width of `text` in em of the label face. Injected so this module stays free of
 *  DOM and canvas: the browser and the e-ink renderer each measure their own way. */
export type MeasureEm = (text: string) => number

export interface LabelRow {
  /** Baseline, tile-local px, reading left to right. Exactly as long as the text. */
  pts: Pt[]
  text: string
}

export type LabelBox = LocalRect

export interface TileLabel {
  px: number
  rows: LabelRow[]
  /** Everything the glyphs cover, plus GAP_PX: what the label is drawn into. */
  box: LabelBox
  /** The same band in small boxes that follow the baseline: what the packer
   *  reserves, so the corners of a tilted name's bounding box stay free to nest in. */
  cells: LabelBox[]
}

export interface LabelOptions {
  measureEm: MeasureEm
  /** Smallest type that still reads on the target (the e-ink panel needs more). */
  minPx: number
}

interface Layout {
  rows: string[]
  em: number
}

/**
 * The name whole, then (if one qualifies) broken at its evenest space. Only at
 * spaces: a hyphen in a bird's name sits inside a compound, and "Great Black- /
 * backed Gull" reads as a line that ran out of room.
 */
export function breakName(name: string, measureEm: MeasureEm): Layout[] {
  const lays: Layout[] = [{ rows: [name], em: measureEm(name) }]
  let best: (Layout & { even: number }) | null = null
  for (let i = 1; i < name.length - 1; i++) {
    if (name[i] !== ' ') continue
    const a = name.slice(0, i)
    const b = name.slice(i + 1)
    const ea = measureEm(a)
    const eb = measureEm(b)
    const even = ea < eb ? ea / eb : eb / ea
    if (even < EVEN_BREAK) continue
    if (!best || even > best.even) best = { even, rows: [a, b], em: Math.max(ea, eb) }
  }
  if (best) lays.push({ rows: best.rows, em: best.em })
  return lays
}

/** One stretch of baseline swept across its ascenders and descenders, boxed. */
function sweepBox(pts: readonly Pt[], start: number, end: number, px: number): LabelBox {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = start; i <= end; i++) {
    const j = i ? i - 1 : Math.min(1, pts.length - 1)
    let dx = pts[i][0] - pts[j][0]
    let dy = pts[i][1] - pts[j][1]
    if (i === 0) {
      dx = -dx
      dy = -dy
    }
    const L = Math.hypot(dx, dy) || 1
    const nx = dy / L
    const ny = -dx / L
    for (const e of [-DESC_EM, ASC_EM]) {
      const bx = pts[i][0] + nx * e * px
      const by = pts[i][1] + ny * e * px
      x0 = Math.min(x0, bx)
      x1 = Math.max(x1, bx)
      y0 = Math.min(y0, by)
      y1 = Math.max(y1, by)
    }
  }
  return { x0: x0 - GAP_PX, y0: y0 - GAP_PX, x1: x1 + GAP_PX, y1: y1 + GAP_PX }
}

/** The whole label's box, every line at once: a broken name is one label, and
 *  boxing lines apart would leave the leading open for a neighbour to nest in. */
export function labelBounds(rows: readonly LabelRow[], px: number): LabelBox {
  const boxes = rows.map((r) => sweepBox(r.pts, 0, r.pts.length - 1, px))
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  }
}

export function labelCells(rows: readonly LabelRow[], px: number): LabelBox[] {
  const cells: LabelBox[] = []
  for (const { pts } of rows) {
    if (pts.length === 1) cells.push(sweepBox(pts, 0, 0, px))
    // Each stretch starts on the previous one's last point, so the boxes share an
    // edge and leave no gap in the band.
    for (let start = 0; start < pts.length - 1; start += CELL_CHUNK) {
      cells.push(sweepBox(pts, start, Math.min(pts.length - 1, start + CELL_CHUNK), px))
    }
  }
  return cells
}

/**
 * Last resort, and why no bird goes bare: a straight line tangent to the silhouette.
 * Every shape has one at every angle on both sides, and with the whole em band
 * outside the supporting line the lettering is clear of ink by construction rather
 * than by test. Angle and side are picked by how much of the name has bird beside
 * it, discounted as the line rakes.
 */
function tangentSpan(f: InkField, px: number, want: number): Pt[] | null {
  const { cells } = f.mask
  if (cells.length === 0) return null
  const sx = f.W / f.mask.w
  const sy = f.H / f.mask.h
  let cx = 0
  let cy = 0
  for (const [x, y] of cells) {
    cx += (x + 0.5) * sx
    cy += (y + 0.5) * sy
  }
  cx /= cells.length
  cy /= cells.length
  let best: { score: number; pts: Pt[] } | null = null
  for (let k = -TANGENT_MAX_DEG; k <= TANGENT_MAX_DEG; k += TANGENT_STEP_DEG) {
    const th = (k * Math.PI) / 180
    const ux = Math.cos(th)
    const uy = Math.sin(th)
    // Where the ascenders point.
    const nx = uy
    const ny = -ux
    let hi = -Infinity
    let lo = Infinity
    for (const [x, y] of cells) {
      const d = (x + 0.5) * sx * nx + (y + 0.5) * sy * ny
      hi = Math.max(hi, d)
      lo = Math.min(lo, d)
    }
    const half = (Math.abs(nx) * sx) / 2 + (Math.abs(ny) * sy) / 2
    const t = cx * ux + cy * uy
    // Above the bird only the descenders reach back toward it; below it the whole
    // ascender does.
    for (const c of [hi + half + NEAR_PX + DESC_EM * px, lo - half - NEAR_PX - ASC_EM * px]) {
      const pts: Pt[] = [
        [c * nx + (t - want / 2) * ux, c * ny + (t - want / 2) * uy],
        [c * nx + (t + want / 2) * ux, c * ny + (t + want / 2) * uy],
      ]
      const score = hugShare(f, pts, px, ADHERE_REACH_EM) / (1 + Math.abs(k) / TANGENT_MAX_DEG)
      if (!best || score > best.score) best = { score, pts }
    }
  }
  return best?.pts ?? null
}

interface Setting {
  rows: LabelRow[]
  /** Share of the lettering with bird beside it. */
  att: number
  /** Fresh paper reserved outside the tile, as a share of the tile. */
  lost: number
}

interface Plan extends Setting {
  px: number
  merit: number
  run: Run
  lay: Layout
}

/**
 * Choose the line this bird's name rides and the baselines to set it on.
 *
 * Pass one: the whole name on one line, on the first run (best first) whose
 * lettering clears the ink and stays beside the bird. If that comes out snug and
 * cheap on paper, it stands. Pass two, for the birds pass one served badly (usually a
 * name that took a short level stub off a crown and overran both ends): every run is
 * laid out in full, with the name free to break in two, and the finished lettering is
 * scored on how much of it has bird beside it above all. If no run clears at any
 * size down to SHRINK_STEPS_PX below the cap, the name goes on a tangent line.
 */
function planLabel(
  outline: readonly Pt[],
  f: InkField,
  name: string,
  measureEm: MeasureEm,
  maxPx: number,
  minPx: number,
): { px: number; rows: LabelRow[] } | null {
  const { W, H } = f
  const lays = breakName(name, measureEm)
  const nameEm = lays[0].em
  const floorPx = Math.max(minPx, maxPx - SHRINK_STEPS_PX)
  const runs = pickRuns(outline, f, nameEm, lays[lays.length - 1].em, maxPx, floorPx)
  const mid: Pt = [W / 2, H / 2]
  const slack = 2 * OVERRUN_EM

  const spill = (rows: LabelRow[], px: number) => {
    const b = labelBounds(rows, px)
    return Math.max(-b.x0, -b.y0, b.x1 - W, b.y1 - H)
  }
  const lost = (rows: LabelRow[], px: number) => {
    const b = labelBounds(rows, px)
    const ox = Math.max(0, Math.min(b.x1, W) - Math.max(b.x0, 0))
    const oy = Math.max(0, Math.min(b.y1, H) - Math.max(b.y0, 0))
    return ((b.x1 - b.x0) * (b.y1 - b.y0) - ox * oy) / (W * H)
  }

  // Lay one setting of the name on one run, climbing the lift ladder until the
  // lettering is legal, clear of ink, and still beside the bird.
  function set(
    runPts: readonly Pt[],
    px: number,
    lay: Layout,
    ceil = MAX_LEAN_DEG,
  ): Setting | null {
    const n = lay.rows.length
    const want = lay.rows.map((r) => measureEm(r) * px + BASELINE_SLACK_PX)
    let wide = 0
    for (let r = 1; r < n; r++) if (want[r] > want[wide]) wide = r
    for (const lift of LIFT_LADDER_EM) {
      const off = offsetRun(runPts, f, px, lift)
      // Rank counts outward from the line against the bird.
      const ranks = lay.rows.map((_, r) => (off.under ? r : n - 1 - r))
      // The widest line rides the run at its own rank's clearance and the others
      // stack off it, so it's the long line that follows the bird most closely.
      let p =
        ranks[wide] > 0 ? offsetRun(runPts, f, px, lift + ranks[wide] * LEADING_EM).pts : off.pts
      if (p[p.length - 1][0] < p[0][0]) p = p.slice().reverse()
      const arc = arcLen(p)
      const away = off.under ? -1 : 1
      // Every line is cut from the widest line's span before it's pushed out, so
      // the lines centre on each other and a short one can't run past a long one.
      const spread = (base: Pt[]): LabelRow[] =>
        lay.rows.map((text, r) => {
          const d = (ranks[r] - ranks[wide]) * LEADING_EM * px
          const core = r === wide ? base : centredSpan(base, want[r])
          return { pts: d ? stack(core, away, d, want[r]) : core, text }
        })
      const tries = [spread(centredSpan(p, want[wide]))]
      if (want[wide] > arc) {
        const alt = spread(centredSpan(p, want[wide], mid))
        if (spill(alt, px) < spill(tries[0], px)) tries.unshift(alt)
        else tries.push(alt)
      }
      for (const rows of tries) {
        const good = rows.every(
          (row, r) =>
            baselineOk(row.pts, ceil) &&
            bandInk(f, row.pts, px) <= MAX_INK &&
            // Only the stretch the edge supports must hug the bird; past it the name
            // is out in open paper on purpose.
            hugShare(
              f,
              centredSpan(row.pts, Math.min(want[r], arc)),
              px,
              ADHERE_REACH_EM + lift + ranks[r] * LEADING_EM,
            ) >= ADHERE_SHARE,
        )
        if (good) return { rows, att: hugRows(f, rows, px), lost: lost(rows, px) }
      }
    }
    return null
  }

  const hold = (run: Run) => PARTIAL_HOLD + (1 - PARTIAL_HOLD) * Math.min(1, run.cover)
  const merit = (run: Run, lay: Layout, got: Setting) =>
    ((run.shape * hold(run) * got.att ** ATTACH_POWER) / (1 + got.lost)) *
    (lay.rows.length > 1 ? BREAK_WORTH : 1)
  // Attachment, paper, and the break handicap are shares that can only bring a plan
  // down, so this bounds it from above and lets pass two stop early, exactly.
  const bound = (run: Run) => run.shape * hold(run)
  const planned = (run: Run, lay: Layout, px: number, got: Setting): Plan => ({
    ...got,
    px,
    run,
    lay,
    merit: merit(run, lay, got),
  })
  const fits = (run: Run, lay: Layout, px: number, broken: boolean) => {
    if (run.len < MIN_RUN_EM * px) return false
    // A name that fits across its own drawing isn't broken: the second line can only
    // sit further off, so breaking must buy something one line can't.
    if (broken && nameEm * px <= W) return false
    return !(lay.em > slack && run.len < (lay.em - slack) * px)
  }
  const snug = (p: Plan | null) => p !== null && p.att >= SNUG_ATTACH && p.lost <= SNUG_PAPER

  // A bird whose edge can't carry CURL_LEDGE of its name has a name that leaves the
  // drawing however it's aimed, so let it follow the bird round, a degree of lean at
  // a time. Judged after the choice and kept only if no less attached, so it can't
  // change which run wins or make a placement worse.
  function curl(p: Plan): Plan {
    const widest = p.lay.rows.reduce((a, b) => (measureEm(b) > measureEm(a) ? b : a))
    const want = measureEm(widest) * p.px + BASELINE_SLACK_PX
    if (p.run.ledge >= CURL_LEDGE * want) return p
    let ceil = MAX_LEAN_DEG
    let grown: { pts: Pt[]; len: number }
    do {
      ceil++
      grown = p.run.grow(want, ceil)
    } while (grown.len < want && ceil < CURL_MAX_DEG)
    let got = set(grown.pts, p.px, p.lay, ceil)
    if ((!got || got.att < p.att) && ceil < CURL_MAX_DEG) {
      got = set(p.run.grow(want, CURL_MAX_DEG).pts, p.px, p.lay, CURL_MAX_DEG)
    }
    if (!got || got.att < p.att) return p
    return { ...p, ...got }
  }

  const order = runs.map((_, k) => k).sort((a, b) => bound(runs[b]) - bound(runs[a]))
  for (let px = maxPx; px >= floorPx; px--) {
    let best: Plan | null = null
    const triedPlain = new Set<Run>()
    for (const run of runs) {
      if (!fits(run, lays[0], px, false)) continue
      triedPlain.add(run)
      const got = set(run.pts, px, lays[0])
      if (got) {
        best = planned(run, lays[0], px, got)
        break
      }
    }
    if (snug(best)) return curl(best as Plan)
    // Pass two may not sell attachment back for a straighter run; once attachment is
    // snug there's nothing left to protect, so the floor stops there.
    const floor = best ? Math.min(SNUG_ATTACH, best.att) : 0
    for (const k of order) {
      if (snug(best)) break
      const run = runs[k]
      if (best && bound(run) <= best.merit) break
      for (let j = 0; j < lays.length; j++) {
        const lay = lays[j]
        if (j === 0 && triedPlain.has(run)) continue
        if (!fits(run, lay, px, j > 0)) continue
        const got = set(run.pts, px, lay)
        if (!got || got.att < floor) continue
        if (!best || merit(run, lay, got) > best.merit) best = planned(run, lay, px, got)
      }
    }
    if (best) return curl(best)
  }

  // Keyed on width: a tangent line is near level, so the name runs across the bird.
  const tanPx = Math.max(minPx, Math.min(maxPx, Math.floor((TANGENT_REACH * W) / nameEm)))
  const pts = tangentSpan(f, tanPx, nameEm * tanPx + BASELINE_SLACK_PX)
  return pts ? { px: tanPx, rows: [{ pts, text: name }] } : null
}

function hugRows(f: InkField, rows: readonly LabelRow[], px: number): number {
  let near = 0
  let all = 0
  for (const row of rows) {
    const L = arcLen(row.pts)
    near += hugShare(f, row.pts, px, BESIDE_REACH_EM) * L
    all += L
  }
  return all ? near / all : 0
}

/** The largest type a tile of this size takes. */
export function labelCap(W: number, H: number, minPx: number): number {
  return Math.max(minPx, Math.round(Math.min(MAX_PX, Math.sqrt(W * H) * CAP_FRAC)))
}

/** Plan `text` around a silhouette drawn at W×H. Null only when the mask has no
 *  outline worth the name (empty or a few cells). */
export function planTileLabel(
  mask: DecodedMask,
  W: number,
  H: number,
  text: string,
  { measureEm, minPx }: LabelOptions,
): TileLabel | null {
  if (!text || W <= 0 || H <= 0) return null
  const outline = traceOutline(mask)
  if (!outline) return null
  const f = inkField(mask, W, H)
  const plan = planLabel(outline, f, text, measureEm, labelCap(W, H, minPx), minPx)
  if (!plan) return null
  return {
    px: plan.px,
    rows: plan.rows,
    box: labelBounds(plan.rows, plan.px),
    cells: labelCells(plan.rows, plan.px),
  }
}
