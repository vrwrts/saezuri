import type { MaskRecord } from '../domain/manifest.ts'
import { createPrng } from '../lib/prng.ts'

// Mask-aware nester, reimplemented in TypeScript from study of the AvianVisitors
// packer. Pure geometry over silhouettes: birds nest by their actual shape, not
// bounding boxes, so they cluster tightly without overlapping. No DOM, no React
// — fully unit-testable.

/** Viewport px per occupancy-grid cell. Smaller = tighter packing, slower. */
const GRID_STRIDE = 4

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

export interface PlaceableTile {
  fullW: number
  fullH: number
  mask: DecodedMask
  x: number
  y: number
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

  function collides(tile: T, tx: number, ty: number): boolean {
    const cells = tile.mask.cells
    for (let i = 0; i < cells.length; i++) {
      const [x0, y0, x1, y1] = cellRange(tile, tx, ty, cells[i])
      for (let gy = y0; gy <= y1; gy++) {
        const off = gy * GW
        for (let gx = x0; gx <= x1; gx++) if (grid[off + gx]) return true
      }
    }
    return false
  }

  function stamp(tile: T, tx: number, ty: number): void {
    const cells = tile.mask.cells
    for (let i = 0; i < cells.length; i++) {
      const [x0, y0, x1, y1] = cellRange(tile, tx, ty, cells[i])
      // Dilate the footprint by `pad` cells so the next bird can't pack right
      // up against this one. collides() stays unpadded, so the gap is added once.
      let gy0 = y0 - pad
      let gy1 = y1 + pad
      let gx0 = x0 - pad
      let gx1 = x1 + pad
      if (gy0 < 0) gy0 = 0
      if (gx0 < 0) gx0 = 0
      if (gy1 >= GH) gy1 = GH - 1
      if (gx1 >= GW) gx1 = GW - 1
      for (let gy = gy0; gy <= gy1; gy++) {
        const off = gy * GW
        for (let gx = gx0; gx <= gx1; gx++) grid[off + gx] = 1
      }
    }
  }

  const offGrid = (tile: T, tx: number, ty: number): boolean =>
    tx < 0 || ty < 0 || tx + tile.fullW > W || ty + tile.fullH > H

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

    let comX = 0
    let comY = 0
    let comW = 0
    for (const p of placed) {
      const a = p.fullW * p.fullH
      comX += (p.x + p.fullW / 2) * a
      comY += (p.y + p.fullH / 2) * a
      comW += a
    }
    comX /= comW
    comY /= comW

    let best: { x: number; y: number } | null = null
    let bestCost = Infinity
    const step = Math.max(GRID_STRIDE, Math.min(t.fullW, t.fullH) * 0.05)
    const maxR = Math.max(W, H)
    let foundRing = -1
    const phase = rand() * Math.PI * 2

    for (let r = 0; r <= maxR; r += step) {
      if (foundRing >= 0 && r > foundRing + step * 2) break
      const samples = Math.max(36, Math.floor(r / 1.6))
      for (let k = 0; k < samples; k++) {
        const theta = phase + (k / samples) * Math.PI * 2
        const px = cx + r * xBias * Math.cos(theta) - t.fullW / 2
        const py = cy + r * yBias * Math.sin(theta) - t.fullH / 2
        if (offGrid(t, px, py)) continue
        if (collides(t, px, py)) continue
        const dxx = px + t.fullW / 2 - comX
        const dyy = py + t.fullH / 2 - comY
        const cost = Math.hypot(dxx / xBias, dyy / yBias) + rand() * step * 0.5
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
