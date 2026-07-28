import useSWR from 'swr'
import type { Snapshot, WindowSnapshot } from '../domain/snapshot.ts'
import type { Species } from '../domain/species.ts'
import { presetToSegment, type WindowPreset } from '../domain/window.ts'

const SNAPSHOT_URL = '/snapshot.json'

// The snapshot is a small static file the refresh service rewrites whenever new
// detections land; poll it briskly so every viewer converges within one
// interval (the fix for the old per-client heuristic-cache skew).
const SNAPSHOT_POLL_MS = 12_000

export interface RecentSpecies {
  /** Illustrated species in the window (already gated server-side), by count. */
  species: Species[]
  /** True when the source paging hit its cap before covering the window. */
  truncated: boolean
  /** Distinct species heard in the window that lack art (withheld from `species`). */
  notIllustrated: number
  /** Distinct species heard in the window (illustrated + withheld). */
  heard: number
  error: Error | null
  /** True only on the very first snapshot fetch. One file covers every window,
   *  so switching windows never re-loads. */
  loading: boolean
}

const EMPTY: WindowSnapshot = { species: [], truncated: false, notIllustrated: 0, heard: 0 }

async function fetchSnapshot(url: string): Promise<Snapshot> {
  // no-store so a freshly-published snapshot is never served from cache (see the
  // matching Cache-Control on nginx). Keeps all viewers in lockstep.
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`snapshot ${res.status}`)
  return (await res.json()) as Snapshot
}

/** Reads the server-published snapshot and selects the active window. The
 *  refresh service computes and gates the species set once for everyone, so the
 *  browser no longer calls BirdNET-Go and every viewer sees the same thing. */
export function useRecentSpecies(preset: WindowPreset): RecentSpecies {
  const { data, error, isLoading } = useSWR(SNAPSHOT_URL, fetchSnapshot, {
    refreshInterval: SNAPSHOT_POLL_MS,
  })
  const w = data?.windows[presetToSegment(preset)] ?? EMPTY
  return {
    species: w.species,
    truncated: w.truncated,
    notIllustrated: w.notIllustrated,
    heard: w.heard,
    error: (error as Error | undefined) ?? null,
    loading: isLoading,
  }
}
