import type { QueryValue } from '../api/client.ts'
import type { DetectionsQuery, SpeciesSummaryQuery } from '../api/endpoints.ts'
import type { DetectionResponse, PaginatedResponse, SpeciesSummary } from '../api/types.ts'
import type { LoadDeps } from '../domain/load.ts'
import { birdnetFetch } from './birdnet.ts'

async function nodeApiGet<T>(
  baseUrl: string,
  token: string | undefined,
  path: string,
  params: Record<string, QueryValue>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await birdnetFetch(baseUrl, token, path, { params, signal })
  if (!res.ok) throw new Error(`BirdNET-Go ${res.status} ${res.statusText} for ${path}`)
  return (await res.json()) as T
}

/** Build a LoadDeps that fetches from a BirdNET-Go base URL server-side, so the
 *  domain layer (fetchWindowRows / loadSpecies) runs unchanged in the service.
 *  The param-name mapping mirrors src/api/endpoints.ts exactly. */
export function makeNodeDeps(baseUrl: string, token?: string): LoadDeps {
  return {
    getDetections(query: DetectionsQuery, signal?: AbortSignal) {
      return nodeApiGet<PaginatedResponse<DetectionResponse>>(
        baseUrl,
        token,
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
    },
    getSpeciesSummary(query: SpeciesSummaryQuery = {}, signal?: AbortSignal) {
      return nodeApiGet<SpeciesSummary[]>(
        baseUrl,
        token,
        '/analytics/species/summary',
        { start_date: query.startDate, end_date: query.endDate, limit: query.limit },
        signal,
      )
    },
  }
}
