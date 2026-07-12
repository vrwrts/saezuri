import { apiGet } from './client.ts'
import type { DetectionResponse, PaginatedResponse, SpeciesSummary } from './types.ts'

// Endpoint wrappers. Each is a thin, typed call — no business logic. Windowing
// and aggregation live in the domain layer.

export interface DetectionsQuery {
  /** "hourly" | "species" | "search" | "all" (default path when omitted). */
  queryType?: string
  /** "YYYY-MM-DD" (inclusive). Presence routes to the date-range query path. */
  startDate?: string
  endDate?: string
  /** Page size; server default 100, max 1000. */
  numResults?: number
  offset?: number
  /** Only "date_desc" avoids the extra advanced-routing cost for plain lists,
   *  but any date-range query already routes advanced, so date_desc is free. */
  sortBy?:
    | 'date_desc'
    | 'date_asc'
    | 'species_asc'
    | 'species_desc'
    | 'confidence_asc'
    | 'confidence_desc'
  /** Minimum confidence filter, 0.0–1.0. */
  confidence?: number
  includeWeather?: boolean
}

/** GET /api/v2/detections — paginated detection list/search. */
export function getDetections(
  query: DetectionsQuery,
  signal?: AbortSignal,
): Promise<PaginatedResponse<DetectionResponse>> {
  return apiGet<PaginatedResponse<DetectionResponse>>(
    '/detections',
    {
      queryType: query.queryType,
      start_date: query.startDate,
      end_date: query.endDate,
      numResults: query.numResults,
      offset: query.offset,
      sortBy: query.sortBy,
      confidence: query.confidence,
      includeWeather: query.includeWeather,
    },
    signal,
  )
}

export interface SpeciesSummaryQuery {
  startDate?: string
  endDate?: string
  limit?: number
}

/** GET /api/v2/analytics/species/summary — top species by count (sorted desc,
 *  false-positives excluded). Omit dates for all-time. */
export function getSpeciesSummary(
  query: SpeciesSummaryQuery = {},
  signal?: AbortSignal,
): Promise<SpeciesSummary[]> {
  return apiGet<SpeciesSummary[]>(
    '/analytics/species/summary',
    { start_date: query.startDate, end_date: query.endDate, limit: query.limit },
    signal,
  )
}
