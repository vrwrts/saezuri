// Time-window presets for the collage. A bounded window resolves to a coarse
// server-side date range (to limit rows scanned) plus a precise absolute
// cutoff `sinceMs`. The date range is intentionally padded by a day on each
// end so it survives timezone skew between the browser and the station and
// midnight boundaries; the exact windowing is done client-side against each
// detection's absolute `timestamp`, so the padding never over-counts.
//
// ALL is special: counting the entire history client-side is unbounded, so it
// is served by the pre-aggregated analytics/species/summary endpoint instead.

export type WindowPreset = '1H' | '12H' | '24H' | '7D' | 'ALL'

export const WINDOW_PRESETS: readonly WindowPreset[] = ['1H', '12H', '24H', '7D', 'ALL']

const HOURS: Record<Exclude<WindowPreset, 'ALL'>, number> = {
  '1H': 1,
  '12H': 12,
  '24H': 24,
  '7D': 24 * 7,
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Padding on each end of the coarse date range to absorb tz skew. */
const DATE_MARGIN_MS = DAY_MS

export interface RangeWindow {
  kind: 'range'
  /** Window length in hours. */
  hours: number
  /** Absolute cutoff: keep detections with timestamp >= sinceMs. */
  sinceMs: number
  /** Coarse "YYYY-MM-DD" bounds (station-local, browser-approximated). */
  startDate: string
  endDate: string
}

export interface AllWindow {
  kind: 'all'
}

export type ResolvedWindow = RangeWindow | AllWindow

/** Local-time "YYYY-MM-DD" for a given epoch-ms instant. */
export function ymd(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function resolveWindow(preset: WindowPreset, now: number = Date.now()): ResolvedWindow {
  if (preset === 'ALL') return { kind: 'all' }
  const hours = HOURS[preset]
  const sinceMs = now - hours * 60 * 60 * 1000
  return {
    kind: 'range',
    hours,
    sinceMs,
    startDate: ymd(sinceMs - DATE_MARGIN_MS),
    endDate: ymd(now + DATE_MARGIN_MS),
  }
}
