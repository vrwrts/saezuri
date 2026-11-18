import type { MaskRecord } from '../domain/manifest.ts'
import { createPrng } from '../lib/prng.ts'

// Mask-aware nester, reimplemented in TypeScript from study of the AvianVisitors
// packer. Pure geometry over silhouettes: birds nest by their actual shape, not
// bounding boxes, so they cluster tightly without overlapping. No DOM, no React
// — fully unit-testable.

/** Viewport px per occupancy-grid cell. Smaller = tighter packing, slower. */
const GRID_STRIDE = 4

/** Grid-cell gap dilated around a name. Lighter than a bird's own pad: lettering is
 *  thin ink that already carries a gap of its own, and a bird-sized moat round every
 *  word would open the plate up. */
const LABEL_PAD = 1

/** x-coordinate assigned to a tile that could not be placed. */
const PARKED = -99999

/** A tile whose x is below this is considered off-screen / unplaced. */
const PARKED_THRESHOLD = -1000

export function isParked(t: { x: number }): boolean {
  return t.x < PARKED_THRESHOLD
}

export interface DecodedMask {
  w: number
  h: number
  /** Coordinates of the opaque cells only — collision cost scales with the
   *  silhouette area, not the bounding box. */
  cells: ReadonlyArray<readonly [number, number]>
}

/** A rectangle relative to its tile's top-left, in px. */
export interface LocalRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PlaceableTile {
  fullW: number
  fullH: number
  mask: DecodedMask
  x: number
  y: number
  /** The bird's name, as boxes along its lettering, which may reach past the tile.
   *  Reserved like the silhouette so no neighbour lands on the words. */
  labelCells?: readonly LocalRect[]
  /** Everything the lettering covers, for the viewport bounds. */
  labelBox?: LocalRect
}

const maskCache = new Map<string, DecodedMask>()

/** Decode a base64 1-bit mask (MSB-first, row-major) into a sparse cell list.
 *  A malformed record degrades to a solid rectangle rather than throwing, so a
 *  single bad mask can never blank the collage. */
export function decodeMask(rec: MaskRecord): DecodedMask {
  const { w, h } = rec
  let bytes: string
  try {
    bytes = atob(rec.bits)
  } catch {
    return solidMask(w, h)
  }
  const cells: Array<[number, number]> = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const b = bytes.charCodeAt(i >> 3)
      if ((b >> (7 - (i & 7))) & 1) cells.push([x, y])
    }
  }
  return { w, h, cells }
}

function solidMask(w: number, h: number): DecodedMask {
  const safeW = Math.max(1, w)
  const safeH = Math.max(1, h)
  const cells: Array<[number, number]> = []
  for (let y = 0; y < safeH; y++) for (let x = 0; x < safeW; x++) cells.push([x, y])
  return { w: safeW, h: safeH, cells }
}

/** Decode + memoize by manifest key (masks are stable for a session). */
export function decodeMaskCached(key: string, rec: MaskRecord): DecodedMask {
  const hit = maskCache.get(key)
  if (hit) return hit
  const decoded = decodeMask(rec)
  maskCache.set(key, decoded)
  return decoded
}

// The sparse `cells` list is ideal for the packer (cost scales with silhouette
// area) but the wrong shape for a point test. Build a dense lookup grid lazily,
// keyed on the mask's identity — decodeMaskCached keeps that object stable for
// the session, so each silhouette's grid is built at most once. This is the
// direct equivalent of AvianVisitors' lazily-built `_set` in maskHitTest.
const hitGridCache = new WeakMap<DecodedMask, Uint8Array>()

/** True if mask cell (mx,my) is opaque. Out-of-range is a miss. */
export function maskOpaqueAt(mask: DecodedMask, mx: number, my: number): boolean {
  if (mx < 0 || my < 0 || mx >= mask.w || my >= mask.h) return false
  let grid = hitGridCache.get(mask)
  if (!grid) {
    grid = new Uint8Array(mask.w * mask.h)
    for (const [x, y] of mask.cells) grid[y * mask.w + x] = 1
    hitGridCache.set(mask, grid)
  }
  return grid[my * mask.w + mx] === 1
}

/** Everything a tile draws, bird and name, relative to its top-left. */
export function tileExtent(t: PlaceableTile): LocalRect {
  const b = t.labelBox
  if (!b) return { x0: 0, y0: 0, x1: t.fullW, y1: t.fullH }
  return {
    x0: Math.min(0, b.x0),
    y0: Math.min(0, b.y0),
    x1: Math.max(t.fullW, b.x1),
    y1: Math.max(t.fullH, b.y1),
  }
}

/** Spiral step per ring, as a fraction of the tile's short side (floored at GRID_STRIDE). */
const SEARCH_STEP_FRAC = 0.05

/** After the first ring with a valid spot, scan this many extra steps outward so a
 *  slightly better placement just beyond it can still win. */
const RING_LOOKAHEAD_STEPS = 2

/** Angular samples per ring: at least this many, growing with radius (one more per
 *  RADIUS_PX_PER_SAMPLE) so wider rings keep a similar arc spacing. */
const MIN_RING_SAMPLES = 36
const RADIUS_PX_PER_SAMPLE = 1.6

/** Random tie-break added to placement cost (× step), so equal-cost spots don't all
 *  collapse onto one angle. */
const JITTER_FRAC = 0.5

function centerOfMass(tiles: readonly PlaceableTile[]): { x: number; y: number } {
  let x = 0
  let y = 0
  let area = 0
  for (const p of tiles) {
    const a = p.fullW * p.fullH
    x += (p.x + p.fullW / 2) * a
    y += (p.y + p.fullH / 2) * a
    area += a
  }
  return { x: x / area, y: y / area }
}

/**
 * Assign each tile an (x, y) top-left in viewport coords. Places the largest
 * tile at center, then spirals outward in elliptical rings (stretched by
 * xBias/yBias), stopping at the first ring with any non-colliding position and
 * choosing, within it, the spot nearest the running center-of-mass — organic
 * clustering rather than fixed directions. A tile that cannot fit is parked
 * off-screen instead of overlapping. Mutates and returns `tiles`.
 */
export function maskPack<T extends PlaceableTile>(
  tiles: T[],
  W: number,
  H: number,
  xBias: number,
  yBias: number,
  pad: number,
): T[] {
  const GW = Math.ceil(W / GRID_STRIDE) + 2
  const GH = Math.ceil(H / GRID_STRIDE) + 2
  const grid = new Uint8Array(GW * GH)

  function cellRange(tile: T, tx: number, ty: number, c: readonly [number, number]) {
    const sx = tile.fullW / tile.mask.w
    const sy = tile.fullH / tile.mask.h
    let x0 = ((tx + c[0] * sx) / GRID_STRIDE) | 0
    let y0 = ((ty + c[1] * sy) / GRID_STRIDE) | 0
    let x1 = ((tx + (c[0] + 1) * sx) / GRID_STRIDE) | 0
    let y1 = ((ty + (c[1] + 1) * sy) / GRID_STRIDE) | 0
    if (x0 < 0) x0 = 0
    if (y0 < 0) y0 = 0
    if (x1 >= GW) x1 = GW - 1
    if (y1 >= GH) y1 = GH - 1
    return [x0, y0, x1, y1] as const
  }

  function rectRange(r: LocalRect, tx: number, ty: number) {
    return [
      Math.max(0, ((tx + r.x0) / GRID_STRIDE) | 0),
      Math.max(0, ((ty + r.y0) / GRID_STRIDE) | 0),
      Math.min(GW - 1, ((tx + r.x1) / GRID_STRIDE) | 0),
      Math.min(GH - 1, ((ty + r.y1) / GRID_STRIDE) | 0),
    ] as const
  }

  function hits(range: readonly [number, number, number, number]): boolean {
    const [x0, y0, x1, y1] = range
    for (let gy = y0; gy <= y1; gy++) {
      const off = gy * GW
      for (let gx = x0; gx <= x1; gx++) if (grid[off + gx]) return true
    }
    return false
  }

  // Dilate each stamped range so the next bird can't pack right up against this
  // one. collides() stays undilated, so the gap is added once.
  function fill(range: readonly [number, number, number, number], dilate: number): void {
    const [x0, y0, x1, y1] = range
    const gy0 = Math.max(0, y0 - dilate)
    const gy1 = Math.min(GH - 1, y1 + dilate)
    const gx0 = Math.max(0, x0 - dilate)
    const gx1 = Math.min(GW - 1, x1 + dilate)
    for (let gy = gy0; gy <= gy1; gy++) {
      const off = gy * GW
      for (let gx = gx0; gx <= gx1; gx++) grid[off + gx] = 1
    }
  }

  function collides(tile: T, tx: number, ty: number): boolean {
    const cells = tile.mask.cells
    for (let i = 0; i < cells.length; i++) if (hits(cellRange(tile, tx, ty, cells[i]))) return true
    for (const r of tile.labelCells ?? []) if (hits(rectRange(r, tx, ty))) return true
    return false
  }

  function stamp(tile: T, tx: number, ty: number): void {
    const cells = tile.mask.cells
    for (let i = 0; i < cells.length; i++) fill(cellRange(tile, tx, ty, cells[i]), pad)
    for (const r of tile.labelCells ?? []) fill(rectRange(r, tx, ty), LABEL_PAD)
  }

  const offGrid = (tile: T, tx: number, ty: number): boolean => {
    const b = tileExtent(tile)
    return tx + b.x0 < 0 || ty + b.y0 < 0 || tx + b.x1 > W || ty + b.y1 > H
  }

  const cx = W / 2
  const cy = H / 2
  // Largest first so the cluster grows around the anchor.
  tiles.sort((a, b) => b.fullW * b.fullH - a.fullW * a.fullH)
  const placed: T[] = []
  const rand = createPrng()

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    if (i === 0) {
      t.x = cx - t.fullW / 2
      t.y = cy - t.fullH / 2
      stamp(t, t.x, t.y)
      placed.push(t)
      continue
    }

    const com = centerOfMass(placed)

    let best: { x: number; y: number } | null = null
    let bestCost = Infinity
    const step = Math.max(GRID_STRIDE, Math.min(t.fullW, t.fullH) * SEARCH_STEP_FRAC)
    const maxR = Math.max(W, H)
    let foundRing = -1
    const phase = rand() * Math.PI * 2

    for (let r = 0; r <= maxR; r += step) {
      if (foundRing >= 0 && r > foundRing + step * RING_LOOKAHEAD_STEPS) break
      const samples = Math.max(MIN_RING_SAMPLES, Math.floor(r / RADIUS_PX_PER_SAMPLE))
      for (let k = 0; k < samples; k++) {
        const theta = phase + (k / samples) * Math.PI * 2
        const px = cx + r * xBias * Math.cos(theta) - t.fullW / 2
        const py = cy + r * yBias * Math.sin(theta) - t.fullH / 2
        if (offGrid(t, px, py)) continue
        if (collides(t, px, py)) continue
        const dxx = px + t.fullW / 2 - com.x
        const dyy = py + t.fullH / 2 - com.y
        const cost = Math.hypot(dxx / xBias, dyy / yBias) + rand() * step * JITTER_FRAC
        if (cost < bestCost) {
          bestCost = cost
          best = { x: px, y: py }
        }
      }
      if (best && foundRing < 0) foundRing = r
    }

    if (best) {
      t.x = best.x
      t.y = best.y
      stamp(t, best.x, best.y)
    } else {
      t.x = PARKED
      t.y = PARKED
    }
    placed.push(t)
  }

  return placed
}
