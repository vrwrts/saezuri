import { type DecodedMask, maskOpaqueAt } from '../pack.ts'
import { MIN_OUTLINE_SAMPLES, OUTLINE_SMOOTH, OUTLINE_STEP } from './constants.ts'
import type { Pt } from './geometry.ts'

// Clockwise from west. The Moore walk needs a fixed rotation order to keep the
// silhouette on one side as it goes round.
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
]

function neighbourIndex(dx: number, dy: number): number {
  for (let k = 0; k < NEIGHBOURS.length; k++) {
    if (NEIGHBOURS[k][0] === dx && NEIGHBOURS[k][1] === dy) return k
  }
  return 0
}

/** Mask cells per traced boundary cell is at most 8, so this bounds a walk that
 *  failed to close (a malformed mask) without cutting off a real one. */
const WALK_GUARD_PER_CELL = 8

const cache = new WeakMap<DecodedMask, Pt[] | null>()

/**
 * The silhouette's outer boundary as an ordered, closed loop of points in mask-cell
 * coordinates (cell centres), evenly resampled and lightly smoothed. Ordered rather
 * than a per-column profile because a flying bird's longest straight edge is a
 * wing's leading edge, which no column profile can see. Traces the first connected
 * piece only. Null when the shape is too small to letter along.
 *
 * In mask space, so one trace serves the tile at any size; memoised on the mask's
 * identity, which decodeMaskCached keeps stable.
 */
export function traceOutline(mask: DecodedMask): Pt[] | null {
  if (cache.has(mask)) return cache.get(mask) ?? null
  const result = trace(mask)
  cache.set(mask, result)
  return result
}

function trace(mask: DecodedMask): Pt[] | null {
  if (mask.cells.length === 0) return null
  // decodeMask emits cells in row-major order, so the first is top-most, left-most:
  // its west neighbour is guaranteed empty, which is where the walk starts looking.
  const [sx, sy] = mask.cells[0]
  const boundary: Pt[] = [[sx, sy]]
  let bx = sx
  let by = sy
  let cx = sx - 1
  let cy = sy
  const guard = mask.cells.length * WALK_GUARD_PER_CELL
  for (let step = 0; step < guard; step++) {
    const from = neighbourIndex(cx - bx, cy - by)
    let found = false
    for (let t = 1; t <= NEIGHBOURS.length; t++) {
      const j = (from + t) % NEIGHBOURS.length
      const nx = bx + NEIGHBOURS[j][0]
      const ny = by + NEIGHBOURS[j][1]
      if (maskOpaqueAt(mask, nx, ny)) {
        const back = NEIGHBOURS[(j + NEIGHBOURS.length - 1) % NEIGHBOURS.length]
        cx = bx + back[0]
        cy = by + back[1]
        bx = nx
        by = ny
        found = true
        break
      }
    }
    if (!found) break
    if (bx === sx && by === sy && boundary.length > 2) break
    boundary.push([bx, by])
  }

  const spaced: Pt[] = [boundary[0]]
  let acc = 0
  for (let i = 1; i < boundary.length; i++) {
    acc += Math.hypot(boundary[i][0] - boundary[i - 1][0], boundary[i][1] - boundary[i - 1][1])
    if (acc >= OUTLINE_STEP) {
      spaced.push(boundary[i])
      acc = 0
    }
  }
  const n = spaced.length
  if (n < MIN_OUTLINE_SAMPLES) return null

  const smooth: Pt[] = []
  const span = 2 * OUTLINE_SMOOTH + 1
  for (let i = 0; i < n; i++) {
    let ax = 0
    let ay = 0
    for (let d = -OUTLINE_SMOOTH; d <= OUTLINE_SMOOTH; d++) {
      const q = spaced[(i + d + n) % n]
      ax += q[0]
      ay += q[1]
    }
    // +0.5: a cell's ink spans [x, x+1), so its centre is the honest position.
    smooth.push([ax / span + 0.5, ay / span + 0.5])
  }
  return smooth
}
