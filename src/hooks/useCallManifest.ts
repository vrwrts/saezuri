import useSWR from 'swr'
import { type CallManifest, EMPTY_CALL_MANIFEST } from '../domain/calls.ts'

const CALL_MANIFEST_URL = '/calls-manifest.json'

// Same cadence as the layout manifest, for the same reason: a recording the
// refresh service acquires on the fly should become playable without a reload.
const CALL_MANIFEST_POLL_MS = 30_000

// No recordings is a steady state, not a failure: a deployment may have acquired
// none yet, or have acquisition switched off entirely. So a missing or unreadable
// file resolves to the empty manifest rather than rejecting — otherwise SWR would
// treat the normal case as an error and retry it on a backoff forever. (This is
// why it differs from useLayoutManifest, where a malformed manifest really is
// broken and worth retrying.)
async function fetchCallManifest(url: string): Promise<CallManifest> {
  // `cache: 'no-store'` for the reason spelled out in useLayoutManifest.
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return EMPTY_CALL_MANIFEST
  try {
    const data = (await res.json()) as CallManifest
    // A dev server (or a misconfigured nginx) answers an unknown path with the
    // SPA index.html at 200, so a well-formed body is not a given.
    if (!data || typeof data.calls !== 'object' || data.calls === null) {
      return EMPTY_CALL_MANIFEST
    }
    return data
  } catch {
    return EMPTY_CALL_MANIFEST
  }
}

/** Fetches /calls-manifest.json and re-polls it (see CALL_MANIFEST_POLL_MS), so a
 *  recording the refresh service acquires appears without a reload. Absent ⇒ the
 *  empty manifest, and the UI simply offers no playback. */
export function useCallManifest(): CallManifest {
  const { data } = useSWR(CALL_MANIFEST_URL, fetchCallManifest, {
    fallbackData: EMPTY_CALL_MANIFEST,
    refreshInterval: CALL_MANIFEST_POLL_MS,
  })
  return data
}
