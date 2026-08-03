import useSWR from 'swr'
import { DEFAULT_MANIFEST } from '../domain/defaultManifest.ts'
import type { LayoutManifest } from '../domain/manifest.ts'

// DEFAULT_MANIFEST lives in a React/SWR-free module so the Node refresh service
// can share it; re-exported here for existing importers.
export { DEFAULT_MANIFEST } from '../domain/defaultManifest.ts'

const MANIFEST_URL = '/layout-manifest.json'

// Poll on the same cadence as the species data (useRecentSpecies) so generated
// art replaces the fallback silhouette live.
const MANIFEST_POLL_MS = 30_000

async function fetchManifest(url: string): Promise<LayoutManifest> {
  // `cache: 'no-store'` bypasses the browser's heuristic HTTP cache: with no
  // explicit Cache-Control (older builds) a regenerated manifest could sit
  // stale in-cache for minutes, so two viewers saw new art at different times.
  // nginx now also sends `Cache-Control: no-cache`; this is the belt to that
  // suspenders, guaranteeing every poll actually revalidates.
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`manifest ${res.status}`)
  const data = (await res.json()) as LayoutManifest
  if (!data.masks || !data.fallbackKey || !(data.fallbackKey in data.masks)) {
    throw new Error('malformed manifest')
  }
  return data
}

/** Fetches /layout-manifest.json and re-polls it (see MANIFEST_POLL_MS) so art
 *  the refresh service generates on the fly appears without a reload. When the
 *  file is absent or malformed — a fresh checkout, or a build shipping no
 *  borrowed art — SWR keeps the built-in single-silhouette fallback so every
 *  species still packs and renders. */
export function useLayoutManifest(): LayoutManifest {
  const { data } = useSWR(MANIFEST_URL, fetchManifest, {
    fallbackData: DEFAULT_MANIFEST,
    refreshInterval: MANIFEST_POLL_MS,
  })
  return data
}
