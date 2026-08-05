import useSWR from 'swr'
import type { DictionaryIndex } from '../domain/dictionary.ts'

const INDEX_URL = '/species-dict/index.json'
const EMPTY: DictionaryIndex = { locales: [], default: null }

// Immutable-ish resource: the index changes only when the refresh service
// republishes (a backend upgrade / locale-set change), so we fetch once and let
// the HTTP layer (ETag + short max-age) handle any later freshness — no polling,
// no focus/reconnect revalidation, no retry storm against a backend that 404s the
// endpoint. Unlike the snapshot we do NOT pass `cache: 'no-store'`: the index is
// safe to cache.
async function fetchIndex(url: string): Promise<DictionaryIndex> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`dictionary index ${res.status}`)
  const data = (await res.json()) as Partial<DictionaryIndex>
  return { locales: data.locales ?? [], default: data.default ?? null }
}

/** Reads /species-dict/index.json: which display languages the backend published
 *  and which to preselect. Empty (no languages) when the file is absent — an older
 *  BirdNET-Go build, or dictionaries turned off — so the UI simply falls back to the
 *  station's own names. */
export function useDictionaryIndex(): DictionaryIndex & { loading: boolean } {
  const { data, isLoading } = useSWR(INDEX_URL, fetchIndex, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  })
  return { ...(data ?? EMPTY), loading: isLoading }
}
