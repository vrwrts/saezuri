import { useMemo } from 'react'
import useSWR from 'swr'
import type { DictLocale } from '../domain/locale.ts'

const EMPTY: ReadonlyMap<string, string> = new Map()

// Cacheable like the index (NOT `no-store`): the dictionary is immutable-ish, so the
// browser's ETag/max-age handling is enough and SWR revalidation stays off below.
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
