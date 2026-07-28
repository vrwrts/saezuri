import type { DetectionResponse } from '../api/types.ts'
import { aggregateDetections, detectionInstantMs, type Species } from '../domain/species.ts'

// In-memory rolling store of recent detections for the refresh service. Seeded
// once per (re)connect from a 7d backfill and then fed live by the SSE stream;
// every bounded window (1h/12h/24h/7d) is derived from it by re-aggregating the
// same rows at a moving cutoff — so a window ages out on its own with no extra
// BirdNET-Go call. The all-time window is not stored here (it comes from the
// summary endpoint on a slow cadence).
//
// Backfill (REST DetectionResponse) and stream events (normalized to the same
// shape) both land here, so aggregation reuses the exact browser logic
// (aggregateDetections) — one source of truth.

/** Retention span; matches the widest bounded preset (7D). */
export const STORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export class DetectionStore {
  private rows: DetectionResponse[] = []
  private ids = new Set<number>()
  // How far back we are confident the store is complete. A window whose cutoff
  // is older than this is flagged truncated. Set on seed from the 7d backfill.
  private oldestReachedMs = Number.POSITIVE_INFINITY

  /** Replace contents from a backfill of the widest bounded window. `covered`
   *  is the paging result: true ⇒ we reached the window cutoff, so we are
   *  complete back to `windowSinceMs`; false ⇒ the page cap was hit, so we are
   *  only complete back to the oldest row we did fetch. */
  seed(rows: readonly DetectionResponse[], covered: boolean, windowSinceMs: number): void {
    this.rows = []
    this.ids.clear()
    for (const r of rows) this.push(r)
    if (covered) {
      this.oldestReachedMs = windowSinceMs
    } else {
      let oldest = Number.POSITIVE_INFINITY
      for (const r of this.rows) {
        const t = detectionInstantMs(r)
        if (t !== null && t < oldest) oldest = t
      }
      this.oldestReachedMs = oldest
    }
  }

  /** Append a live detection (from the stream). Deduped by id against the
   *  backfill overlap. Returns true if it was new. */
  add(row: DetectionResponse): boolean {
    return this.push(row)
  }

  private push(row: DetectionResponse): boolean {
    if (this.ids.has(row.id)) return false
    this.ids.add(row.id)
    this.rows.push(row)
    return true
  }

  /** Drop detections older than STORE_WINDOW_MS before `now`. */
  prune(now: number): void {
    const cutoff = now - STORE_WINDOW_MS
    const kept: DetectionResponse[] = []
    this.ids.clear()
    for (const r of this.rows) {
      const t = detectionInstantMs(r)
      if (t !== null && t >= cutoff) {
        kept.push(r)
        this.ids.add(r.id)
      }
    }
    this.rows = kept
  }

  /** Aggregate the stored rows into windowed species (count desc). */
  aggregate(sinceMs: number): Species[] {
    return aggregateDetections(this.rows, { sinceMs })
  }

  /** True when the window reaches further back than the store is complete. */
  truncated(sinceMs: number): boolean {
    return sinceMs < this.oldestReachedMs
  }

  get size(): number {
    return this.rows.length
  }
}
