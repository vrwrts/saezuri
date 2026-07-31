// Small same-origin query-string helper shared by the Node refresh service's
// BirdNET-Go fetchers (src/server/birdnetDeps.ts). The browser no longer talks to
// BirdNET-Go at all — it reads only the static files Saezuri publishes (snapshot,
// manifest, species dictionaries, frames) — so there is deliberately NO browser
// fetch wrapper here anymore, and nginx no longer proxies /api/.

export type QueryValue = string | number | boolean | undefined | null

/** Build a query string, dropping undefined/null/empty so callers can pass sparse
 *  param objects without assembling URLs by hand. */
export function buildQuery(params: Record<string, QueryValue>): string {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    usp.append(key, String(value))
  }
  const qs = usp.toString()
  return qs ? `?${qs}` : ''
}
