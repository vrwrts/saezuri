// Typed request-parameter shapes for the BirdNET-Go /api/v2 endpoints the Node
// refresh service consumes (see src/server/birdnetDeps.ts, which does the actual
// fetching, and src/domain/load.ts, which is param-mapped to match). The browser
// no longer calls BirdNET-Go — it reads Saezuri's published static files — so
// there are no fetch wrappers here, only the shared query types.

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

export interface SpeciesSummaryQuery {
  startDate?: string
  endDate?: string
  limit?: number
}
