import { useCallback, useEffect, useRef, useState } from 'react'
import { type LoadOptions, loadSpecies } from '../domain/load.ts'
import type { Species } from '../domain/species.ts'
import { resolveWindow, type WindowPreset } from '../domain/window.ts'

/** Matches AvianVisitors' collage poll cadence. */
export const DEFAULT_POLL_MS = 30_000

export interface UseRecentSpecies {
  species: Species[]
  loading: boolean
  error: Error | null
  /** True when the fetch hit its page cap before covering the window. */
  truncated: boolean
  /** Epoch ms of the last successful load. */
  asOf: number | null
  /** Force an immediate refetch. */
  refresh: () => void
}

export interface UseRecentSpeciesOptions extends LoadOptions {
  pollMs?: number
}

/** Polls BirdNET-Go for the active window's per-species counts. Pauses while
 *  the tab is hidden and refetches immediately on re-focus and on window
 *  change. In-flight requests are aborted when superseded or on unmount. */
export function useRecentSpecies(
  preset: WindowPreset,
  options: UseRecentSpeciesOptions = {},
): UseRecentSpecies {
  const { pollMs = DEFAULT_POLL_MS, ...loadOptions } = options

  const [species, setSpecies] = useState<Species[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [asOf, setAsOf] = useState<number | null>(null)

  // Keep the latest load options in a ref so the polling effect doesn't need
  // to re-subscribe when a caller passes a fresh (but equivalent) options
  // object each render.
  const loadOptionsRef = useRef(loadOptions)
  loadOptionsRef.current = loadOptions

  const abortRef = useRef<AbortController | null>(null)

  const runLoad = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const win = resolveWindow(preset)
      const result = await loadSpecies(win, loadOptionsRef.current, controller.signal)
      if (controller.signal.aborted) return
      setSpecies(result.species)
      setTruncated(result.truncated)
      setError(null)
      setAsOf(Date.now())
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError'))
        return
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [preset])

  useEffect(() => {
    void runLoad()

    const interval = setInterval(() => {
      if (!document.hidden) void runLoad()
    }, pollMs)

    const onVisibility = () => {
      if (!document.hidden) void runLoad()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      abortRef.current?.abort()
    }
  }, [runLoad, pollMs])

  return { species, loading, error, truncated, asOf, refresh: () => void runLoad() }
}
