// Wire types for the BirdNET-Go /api/v2 endpoints Saezuri consumes.
//
// Derived from the Go response structs (not from captured fixtures — none
// existed at authoring time; validate against fixtures/ as they land):
//   - detections: internal/api/v2/detections/detections.go  (camelCase JSON)
//   - analytics:  internal/api/v2/analytics/analytics.go     (snake_case JSON)
// BirdNET-Go build: rolling nightly circa 2025-07 (v2 API).
//
// Casing is deliberately mixed by the backend — detections are camelCase,
// analytics are snake_case. Mirror each exactly; do not "normalize" here.
// Keep this file the single source of truth so a v2 shape change is a
// one-file fix (CLAUDE.md data contract).

/** Audio source of a detection. Force-nulled by the server for
 *  unauthenticated clients, so always treat as possibly absent. */
export interface SourceInfo {
  id: string
  type?: string
  displayName?: string
}

/** Weather block, only present when a request passes includeWeather=true.
 *  Saezuri does not use it today; typed loosely so it never breaks parsing. */
export interface WeatherInfo {
  weatherIcon: string
  weatherMain?: string
  description?: string
  temperature?: number
  [key: string]: unknown
}

/** A single detection, as returned by GET /api/v2/detections (inside the
 *  paginated envelope) and GET /api/v2/detections/recent (bare array). */
export interface DetectionResponse {
  id: number
  /** Station-local calendar date, "YYYY-MM-DD". */
  date: string
  /** Station-local wall-clock time, "HH:MM:SS" (no timezone). */
  time: string
  /** RFC3339 with offset, e.g. "2025-07-13T09:09:54+03:00". Preferred for
   *  windowing; omitempty on the wire, so may be absent. */
  timestamp?: string
  beginTime: string
  endTime: string
  /** eBird-style short code; omitempty and unreliable — never key on it. */
  speciesCode?: string
  /** Canonical species join key. */
  scientificName: string
  /** Localized display name — presentation only, NOT a stable key. */
  commonName: string
  /** 0.0–1.0. */
  confidence: number
  verified: 'correct' | 'false_positive' | 'unverified'
  locked: boolean
  clipName?: string
  modelType?: string
  source?: SourceInfo | null
  weather?: WeatherInfo
  timeOfDay?: string
}

/** Envelope wrapping list endpoints such as GET /api/v2/detections. */
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
  current_page: number
  total_pages: number
}

/** A species row from GET /api/v2/analytics/species/summary, already sorted
 *  by count descending with false-positives excluded. Confidence/heard fields
 *  are omitempty on the wire, hence optional. Note: first_heard/last_heard are
 *  RFC3339 on THIS endpoint (they are time-only on species/daily). */
export interface SpeciesSummary {
  scientific_name: string
  common_name: string
  species_code?: string
  count: number
  first_heard?: string
  last_heard?: string
  avg_confidence?: number
  max_confidence?: number
  thumbnail_url?: string
}

/** Shape of a BirdNET-Go error body (apicore.ErrorResponse). Fields are
 *  best-effort; the client also carries the HTTP status separately. */
export interface ErrorResponse {
  error?: string
  message?: string
  correlationId?: string
  code?: number
}
