import type { ErrorResponse } from './types.ts'

// Thin typed fetch wrapper over the BirdNET-Go API. All calls are same-origin
// and relative: nginx (prod) / the Vite proxy (dev) forwards /api/ to the
// configured BIRDNETGO_URL. There is intentionally NO auth logic here — nginx
// injects any token, so the browser never handles credentials.

export const API_BASE = '/api/v2'

/** Error thrown by the client for non-2xx responses or transport failures.
 *  Carries the HTTP status and, when available, the parsed BirdNET-Go body. */
export class ApiError extends Error {
  readonly status: number
  readonly body?: ErrorResponse
  constructor(message: string, status: number, body?: ErrorResponse) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export type QueryValue = string | number | boolean | undefined | null

/** Build a query string, dropping undefined/null so callers can pass sparse
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

/** GET a JSON endpoint under /api/v2. Throws ApiError on failure. */
export async function apiGet<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  signal?: AbortSignal,
): Promise<T> {
  const url = `${API_BASE}${path}${buildQuery(params)}`
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(`Network error requesting ${path}`, 0)
  }

  if (!res.ok) {
    const body = await safeParseError(res)
    const detail = body?.message ?? body?.error
    throw new ApiError(
      `${res.status} ${res.statusText} from ${path}${detail ? `: ${detail}` : ''}`,
      res.status,
      body,
    )
  }

  return (await res.json()) as T
}

async function safeParseError(res: Response): Promise<ErrorResponse | undefined> {
  try {
    return (await res.json()) as ErrorResponse
  } catch {
    return undefined
  }
}
