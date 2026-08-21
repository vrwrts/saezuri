import useSWR from 'swr'
import { type CallManifest, EMPTY_CALL_MANIFEST } from '../domain/calls.ts'
import { withBase } from '../lib/basePath.ts'

const CALL_MANIFEST_URL = withBase('/calls-manifest.json')

// Same cadence as the layout manifest, for the same reason: a recording the
// refresh service acquires on the fly should become playable without a reload.
const CALL_MANIFEST_POLL_MS = 30_000

// No recordings is a steady state, not a failure — a deployment may have acquired
// none yet, or have acquisition switched off. Resolving rather than rejecting keeps
// SWR from treating that normal case as an error and retrying it forever. (Hence the
// difference from useLayoutManifest, where a malformed manifest really is broken.)
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

export function useCallManifest(): CallManifest {
  const { data } = useSWR(CALL_MANIFEST_URL, fetchCallManifest, {
    fallbackData: EMPTY_CALL_MANIFEST,
    refreshInterval: CALL_MANIFEST_POLL_MS,
  })
  return data
}
