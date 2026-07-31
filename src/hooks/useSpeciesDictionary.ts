import { useMemo } from 'react'
import useSWR from 'swr'
import type { DictLocale } from '../domain/locale.ts'

const EMPTY: ReadonlyMap<string, string> = new Map()

// Same immutable-resource config as the index: fetch the chosen locale's dictionary
// once and cache it (ETag + short max-age handle freshness). NOT `no-store` — the
// dictionary is safe to cache, and a reload 304-revalidates cheaply.
async function fetchDictionary(url: string): Promise<Record<string, string>> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`dictionary ${res.status}`)
  return (await res.json()) as Record<string, string>
}

/** Fetches the scientific-name → localized-common-name map for one display
 *  language. `null` locale (nothing selected / no dictionaries) means no fetch and
 *  an empty map, so the caller falls back to the station's own names. Any
 *  404/error also yields an empty map — never throws into the tree. */
export function useSpeciesDictionary(locale: DictLocale | null): ReadonlyMap<string, string> {
  const { data } = useSWR(locale ? `/species-dict/${locale}.json` : null, fetchDictionary, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  })
  return useMemo(() => (data ? new Map(Object.entries(data)) : EMPTY), [data])
}
