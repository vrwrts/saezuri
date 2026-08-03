import { buildQuery, type QueryValue } from '../api/client.ts'

// The refresh service is the sole BirdNET-Go client — every call it makes goes
// through here. The optional bearer token is attached as a header and never
// logged; the browser never reaches BirdNET-Go, only the static files we publish.
export function birdnetFetch(
  baseUrl: string,
  token: string | undefined,
  path: string,
  opts: { accept?: string; params?: Record<string, QueryValue>; signal?: AbortSignal } = {},
): Promise<Response> {
  const query = opts.params ? buildQuery(opts.params) : ''
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v2${path}${query}`
  const headers: Record<string, string> = { Accept: opts.accept ?? 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url, { headers, signal: opts.signal })
}
