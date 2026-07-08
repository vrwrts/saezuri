import type { DetectionResponse, SpeciesSummary } from '../api/types.ts'

// The domain entity the collage renders. Keyed by scientific name; the common
// name rides along for display only. `n` is the detection count in the active
// window — the single value that drives tile size.
export interface Species {
  /** scientificName — canonical key. */
  sci: string
  /** commonName — localized display label. */
  com: string
  /** Detection count in the active window. */
  n: number
  /** Most recent detection instant (epoch ms), for tie-breaks / tooltip. */
  lastSeenMs?: number
  /** Highest confidence seen in the window, 0.0–1.0. */
  maxConfidence?: number
}

export interface AggregateOptions {
  /** Keep only detections at/after this absolute instant. */
  sinceMs: number
  /** Drop verified === "false_positive" (default true). */
  excludeFalsePositives?: boolean
  /** Optional confidence floor, 0.0–1.0 (default none). */
  minConfidence?: number
}

/** Resolve a detection's absolute instant. Prefers the RFC3339 `timestamp`;
 *  falls back to `date`+`time` parsed as local wall-clock. Returns null when
 *  neither yields a valid date. */
export function detectionInstantMs(d: DetectionResponse): number | null {
  if (d.timestamp) {
    const t = Date.parse(d.timestamp)
    if (!Number.isNaN(t)) return t
  }
  if (d.date && d.time) {
    const t = Date.parse(`${d.date}T${d.time}`)
    if (!Number.isNaN(t)) return t
  }
  return null
}

/** Group detections by scientific name and count them, keeping the most-recent
 *  common name as the display label. Output is sorted by count desc, then by
 *  recency desc, so consumers get a stable, meaningful order. */
export function aggregateDetections(
  detections: readonly DetectionResponse[],
  opts: AggregateOptions,
): Species[] {
  const excludeFP = opts.excludeFalsePositives ?? true
  const byKey = new Map<string, Species>()

  for (const d of detections) {
    if (!d.scientificName) continue
    if (excludeFP && d.verified === 'false_positive') continue
    if (opts.minConfidence !== undefined && d.confidence < opts.minConfidence) continue

    const instant = detectionInstantMs(d)
    if (instant === null || instant < opts.sinceMs) continue

    const existing = byKey.get(d.scientificName)
    if (!existing) {
      byKey.set(d.scientificName, {
        sci: d.scientificName,
        com: d.commonName,
        n: 1,
        lastSeenMs: instant,
        maxConfidence: d.confidence,
      })
      continue
    }
    existing.n += 1
    if (d.confidence > (existing.maxConfidence ?? 0)) existing.maxConfidence = d.confidence
    // Adopt the label from the most recent detection.
    if (instant > (existing.lastSeenMs ?? -Infinity)) {
      existing.lastSeenMs = instant
      existing.com = d.commonName
    }
  }

  return sortSpecies([...byKey.values()])
}

/** Map pre-aggregated summary rows (used for the ALL-time window) into the
 *  same Species shape. */
export function speciesFromSummary(rows: readonly SpeciesSummary[]): Species[] {
  const mapped = rows.map((r): Species => {
    const lastSeenMs = r.last_heard ? Date.parse(r.last_heard) : NaN
    return {
      sci: r.scientific_name,
      com: r.common_name,
      n: r.count,
      lastSeenMs: Number.isNaN(lastSeenMs) ? undefined : lastSeenMs,
      maxConfidence: r.max_confidence,
    }
  })
  return sortSpecies(mapped)
}

function sortSpecies(species: Species[]): Species[] {
  return species.sort((a, b) => b.n - a.n || (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0))
}
