import type { DecodedMask } from '../pack.ts'

// Synthetic silhouettes for the label tests: shapes that exercise each tier of the
// planner without depending on the gitignored placeholder art.

function fromPredicate(w: number, h: number, on: (x: number, y: number) => boolean): DecodedMask {
  const cells: Array<[number, number]> = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) cells.push([x, y])
  return { w, h, cells }
}

export function solidMask(w: number, h: number): DecodedMask {
  return fromPredicate(w, h, () => true)
}

export function discMask(size: number): DecodedMask {
  const r = size / 2
  return fromPredicate(size, size, (x, y) => (x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 <= r * r)
}

export function lMask(size: number): DecodedMask {
  const arm = Math.round(size / 3)
  return fromPredicate(size, size, (x, y) => x < arm || y >= size - arm)
}

/** An oval body with two thin legs hanging below it: the shape whose feet a name
 *  set under the bird must not be threaded through. */
export function perchedBirdMask(w = 90, h = 70): DecodedMask {
  const bodyH = Math.round(h * 0.7)
  const cx = w / 2
  const cy = bodyH / 2
  return fromPredicate(w, h, (x, y) => {
    const inBody = ((x + 0.5 - cx) / (w / 2)) ** 2 + ((y + 0.5 - cy) / (bodyH / 2)) ** 2 <= 1
    const leg = y >= bodyH - 2 && (x === Math.round(w * 0.4) || x === Math.round(w * 0.6))
    return inBody || leg
  })
}

/** Width in em with every character half an em wide: deterministic, font-free. */
export const fakeMeasureEm = (text: string) => text.length * 0.5
