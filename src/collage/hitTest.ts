import type { LaidTile } from './layout.ts'
import { maskOpaqueAt } from './pack.ts'

// Silhouette-shaped pointer hit-testing, reimplemented in TypeScript from study
// of AvianVisitors' maskHitTest. The packer nests birds by shape, so their
// rectangular boxes overlap heavily — a plain CSS :hover (or per-tile mouse
// events) lights up whichever transparent corner happens to paint on top. Doing
// the test against the actual silhouette, container-side, is what makes hover
// land on the bird you're pointing at. Pure: no DOM, no React, unit-testable.

/**
 * Topmost tile whose silhouette actually covers (px, py), given in collage-
 * container coordinates. `tiles` is in paint order (later = on top), so we walk
 * back-to-front and return the first opaque hit. Returns null over a gap.
 */
export function hitTest(px: number, py: number, tiles: readonly LaidTile[]): LaidTile | null {
  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i]
    // Cheap bounding-box reject before the per-pixel mask lookup.
    if (px < t.x || py < t.y || px > t.x + t.w || py > t.y + t.h) continue
    // Map the cursor into the mask grid. The tile box shares the cutout's aspect
    // ratio (layout sizes it from `ar`), so object-fit:contain doesn't letterbox
    // and each axis maps independently.
    const mx = (((px - t.x) / t.w) * t.mask.w) | 0
    const my = (((py - t.y) / t.h) * t.mask.h) | 0
    if (maskOpaqueAt(t.mask, mx, my)) return t
  }
  return null
}
