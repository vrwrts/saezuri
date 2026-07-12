import useSWR from 'swr'
import { loadSpecies } from '../domain/load.ts'
import type { Species } from '../domain/species.ts'
import { resolveWindow, type WindowPreset } from '../domain/window.ts'

/** Matches AvianVisitors' collage poll cadence. */
const DEFAULT_POLL_MS = 30_000

export interface RecentSpecies {
  species: Species[]
  /** True when the fetch hit its page cap before covering the window. */
  truncated: boolean
  error: Error | null
}

/** Polls BirdNET-Go for the active window's per-species counts. SWR pauses
 *  polling while the tab is hidden, revalidates on focus and reconnect, dedups
 *  concurrent requests, and swaps to a window's cached data instantly when the
 *  preset changes. The fetcher resolves the window fresh each poll so the time
 *  range stays current. */
export function useRecentSpecies(preset: WindowPreset): RecentSpecies {
  const { data, error } = useSWR(
    ['recent-species', preset],
    () => loadSpecies(resolveWindow(preset)),
    { refreshInterval: DEFAULT_POLL_MS },
  )

  return {
    species: data?.species ?? [],
    truncated: data?.truncated ?? false,
    error: (error as Error | undefined) ?? null,
  }
}
