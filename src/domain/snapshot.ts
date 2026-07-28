import type { Species } from './species.ts'
import type { WindowSegment } from './window.ts'

// The published collage snapshot: per-window species the browser and the e-ink
// frames both render, computed once by the refresh service instead of per
// client. Written to /snapshot.json (served no-cache) alongside the manifest.
//
// `species` is already gated to illustrated-only and sorted by count desc, so
// the browser renders it directly — no manifest join needed to decide what
// shows. `heard` and `notIllustrated` carry the withheld tail so the UI can
// distinguish "nothing heard" from "heard, not illustrated yet" and show a
// "N awaiting art" note.

export interface WindowSnapshot {
  /** Illustrated species in the window, sorted by `n` desc. */
  species: Species[]
  /** True when the source paging hit its cap before covering the window. */
  truncated: boolean
  /** Distinct species heard in the window that lack art (withheld from `species`). */
  notIllustrated: number
  /** Distinct species heard in the window (illustrated + withheld). */
  heard: number
}

export interface Snapshot {
  /** Epoch ms the snapshot was produced; lets the UI flag a stale service. */
  generatedAt: number
  windows: Record<WindowSegment, WindowSnapshot>
}
