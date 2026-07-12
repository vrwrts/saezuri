import { getDetections, getSpeciesSummary } from '../api/endpoints.ts'
import type { DetectionResponse } from '../api/types.ts'
import {
  aggregateDetections,
  detectionInstantMs,
  type Species,
  speciesFromSummary,
} from './species.ts'
import type { ResolvedWindow } from './window.ts'

// Turns a resolved window into a Species[]. For bounded windows it pages
// /detections newest-first and stops as soon as the window is covered (or a
// safety cap is hit); for ALL it reads the pre-aggregated summary. The API
// calls are injected so the policy (pagination, early-stop, truncation) is
// unit-testable without a network.

export interface LoadOptions {
  /** Rows per page; server max is 1000. */
  pageSize?: number
  /** Safety cap on pages fetched for a bounded window. */
  maxPages?: number
  /** Species cap for the ALL-time window. */
  summaryLimit?: number
}

export interface LoadResult {
  species: Species[]
  /** True when the page cap was hit before the window was fully covered. */
  truncated: boolean
}

export interface LoadDeps {
  getDetections: typeof getDetections
  getSpeciesSummary: typeof getSpeciesSummary
}

const DEFAULTS = {
  pageSize: 1000,
  maxPages: 10,
  summaryLimit: 100,
} as const

const defaultDeps: LoadDeps = { getDetections, getSpeciesSummary }

export async function loadSpecies(
  window: ResolvedWindow,
  options: LoadOptions = {},
  signal?: AbortSignal,
  deps: LoadDeps = defaultDeps,
): Promise<LoadResult> {
  if (window.kind === 'all') {
    const rows = await deps.getSpeciesSummary(
      { limit: options.summaryLimit ?? DEFAULTS.summaryLimit },
      signal,
    )
    return { species: speciesFromSummary(rows), truncated: false }
  }

  const pageSize = options.pageSize ?? DEFAULTS.pageSize
  const maxPages = options.maxPages ?? DEFAULTS.maxPages
  const rows: DetectionResponse[] = []
  let offset = 0
  let covered = false

  for (let page = 0; page < maxPages; page++) {
    const res = await deps.getDetections(
      {
        queryType: 'all',
        startDate: window.startDate,
        endDate: window.endDate,
        numResults: pageSize,
        offset,
        sortBy: 'date_desc',
      },
      signal,
    )
    rows.push(...res.data)
    offset += res.data.length

    // The window is covered once the oldest row on this page predates the
    // cutoff (rows arrive newest-first), or we've consumed the whole result.
    const oldest = res.data.at(-1)
    const oldestMs = oldest ? detectionInstantMs(oldest) : null
    const pastCutoff = oldestMs !== null && oldestMs < window.sinceMs
    const exhausted = res.data.length < pageSize || (res.total > 0 && offset >= res.total)
    if (pastCutoff || exhausted) {
      covered = true
      break
    }
  }

  const species = aggregateDetections(rows, { sinceMs: window.sinceMs })
  return { species, truncated: !covered }
}
