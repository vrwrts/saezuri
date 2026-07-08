import { type DecodedMask, isParked, maskPack, type PlaceableTile } from './pack.ts'

// Count-driven sizing + packing, reimplemented from study of AvianVisitors'
// renderCollage. Pure: takes species already resolved to art (mask + aspect +
// count) and a viewport, returns placed tiles with pixel rects. Tile size
// tracks detection count only, matching the look.

/** Grid-cell gap dilated around every silhouette (eased on narrow screens). */
export const COLLAGE_PAD = 3

/** Count-dependent knobs. Density steps down as the plate gets busier. */
export function tuning(nSpecies: number) {
  return {
    // Soft area budget the whole cluster aims to fill, as a fraction of the
    // viewport. Lower = sparser, more packing headroom.
    packingBudgetFrac: nSpecies <= 4 ? 0.46 : nSpecies <= 12 ? 0.4 : nSpecies <= 24 ? 0.34 : 0.28,
    // Sub-linear count→area so a loud bird reads bigger without dwarfing the rest.
    countExp: 0.65,
    // Floor so even a single-detection bird stays legible.
    minTileAreaFrac: nSpecies <= 8 ? 0.01 : nSpecies <= 20 ? 0.0075 : 0.0055,
    // Wider clusters for landscape viewports.
    ellipseAspectBias: 2.1,
  }
}

/** Per-species render input: art + geometry the packer needs. */
export interface LayoutInput {
  sci: string
  com: string
  n: number
  key: string
  imageUrl: string
  illustrated: boolean
  pose: 1 | 2
  mask: DecodedMask
  /** Aspect ratio w/h. */
  ar: number
}

export interface LaidTile extends LayoutInput {
  x: number
  y: number
  w: number
  h: number
  parked: boolean
}

export interface Viewport {
  width: number
  height: number
}

interface PackTile extends PlaceableTile {
  score: number
  area: number
  ar: number
  src: LayoutInput
}

function clusterBounds(tiles: readonly PlaceableTile[]) {
  let L = Infinity
  let R = -Infinity
  let T = Infinity
  let B = -Infinity
  for (const t of tiles) {
    if (isParked(t)) continue
    if (t.x < L) L = t.x
    if (t.x + t.fullW > R) R = t.x + t.fullW
    if (t.y < T) T = t.y
    if (t.y + t.fullH > B) B = t.y + t.fullH
  }
  return { L, R, T, B }
}

export function computeLayout(inputs: readonly LayoutInput[], vp: Viewport): LaidTile[] {
  const W = vp.width
  const H = vp.height
  if (inputs.length === 0 || W <= 0 || H <= 0) return []

  const T = tuning(inputs.length)
  const vpArea = W * H
  const budget = vpArea * T.packingBudgetFrac
  const minArea = vpArea * T.minTileAreaFrac

  // Step 1: count-weighted score.
  const tiles: PackTile[] = inputs.map((inp) => ({
    fullW: 0,
    fullH: 0,
    x: 0,
    y: 0,
    mask: inp.mask,
    ar: inp.ar,
    score: Math.max(1, inp.n || 1) ** T.countExp,
    area: 0,
    src: inp,
  }))

  // Step 2: normalise so sum(area) ≈ budget, floored at minArea.
  const sumScore = tiles.reduce((a, t) => a + t.score, 0) || 1
  for (const t of tiles) t.area = Math.max(minArea, (budget * t.score) / sumScore)
  // Squeeze any over-budget remainder out of the larger tiles only, so the
  // floor on rare birds stays intact.
  const sumA = tiles.reduce((a, t) => a + t.area, 0)
  if (sumA > budget) {
    const fixedSum = tiles.filter((t) => t.area <= minArea + 1e-9).reduce((a, t) => a + t.area, 0)
    const flexSum = sumA - fixedSum
    const flexBudget = Math.max(0, budget - fixedSum)
    const shrink = flexSum > 0 ? Math.min(1, flexBudget / flexSum) : 1
    for (const t of tiles) if (t.area > minArea + 1e-9) t.area *= shrink
  }

  // Step 3: width/height from area + aspect.
  for (const t of tiles) {
    t.fullW = Math.sqrt(t.area * t.ar)
    t.fullH = t.fullW / t.ar
  }

  const narrow = W <= 700
  const xBias = narrow ? 1 : T.ellipseAspectBias
  const yBias = narrow ? 1.7 : 1
  const pad = narrow ? Math.max(1, COLLAGE_PAD - 1) : COLLAGE_PAD

  let placed = maskPack(tiles, W, H, xBias, yBias, pad)
  let b = clusterBounds(placed)

  // Scale-to-fit: shrink + repack until nothing overflows or is parked.
  for (let iter = 0; iter < 10; iter++) {
    const missing = placed.some((t) => isParked(t))
    const overflow = b.L < 0 || b.T < 0 || b.R > W || b.B > H
    if (!missing && !overflow) break
    let scale = 0.93
    if (overflow) {
      const clW = b.R - b.L
      const clH = b.B - b.T
      const sx = (W * 0.96) / Math.max(clW, W * 0.96)
      const sy = (H * 0.94) / Math.max(clH, H * 0.94)
      scale = Math.min(scale, sx, sy)
    }
    for (const t of tiles) {
      t.fullW *= scale
      t.fullH *= scale
    }
    placed = maskPack(tiles, W, H, xBias, yBias, pad)
    b = clusterBounds(placed)
  }

  // Re-centre the cluster so a small one doesn't drift off the spiral's bias.
  const dx = W / 2 - (b.L + b.R) / 2
  const dy = H / 2 - (b.T + b.B) / 2
  if (Number.isFinite(dx) && Number.isFinite(dy) && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
    for (const t of placed) {
      if (!isParked(t)) {
        t.x += dx
        t.y += dy
      }
    }
  }

  return placed.map((t) => ({
    ...t.src,
    x: t.x,
    y: t.y,
    w: t.fullW,
    h: t.fullH,
    parked: isParked(t),
  }))
}
