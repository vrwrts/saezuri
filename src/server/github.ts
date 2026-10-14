import { USER_AGENT } from './userAgent.ts'

// The handful of GitHub REST calls the contribute command needs, over plain fetch. The
// container ships neither git nor gh, and a branch of new files is a few Git-data API
// calls — far less to trust than an SDK for the same job.

const API = 'https://api.github.com'
const API_VERSION = '2022-11-28'
/** GitHub's maximum page size; the listings we page through are all small. */
const PER_PAGE = 100

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string,
  ) {
    super(`GitHub ${status} on ${path}: ${detail}`)
  }
}

export interface GitHubClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>
  /** GET every page of a list endpoint. */
  paginate<T>(path: string): Promise<T[]>
}

/** `token` is optional: reads of a public repo work without one, at a far lower rate
 *  limit, which is enough for a dry run. */
export function gitHubClient(token: string | undefined, fetchImpl = fetch): GitHubClient {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': USER_AGENT,
  }
  if (token) headers.Authorization = `Bearer ${token}`

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const err = (await res.json()) as { message?: string; errors?: unknown }
        detail = [err.message, err.errors && JSON.stringify(err.errors)].filter(Boolean).join(' ')
      } catch {
        // Not JSON: the status text is all there is.
      }
      throw new GitHubError(res.status, path, detail)
    }
    return (res.status === 204 ? undefined : await res.json()) as T
  }

  async function paginate<T>(path: string): Promise<T[]> {
    const sep = path.includes('?') ? '&' : '?'
    const all: T[] = []
    for (let page = 1; ; page++) {
      const items = await request<T[]>('GET', `${path}${sep}per_page=${PER_PAGE}&page=${page}`)
      all.push(...items)
      if (items.length < PER_PAGE) return all
    }
  }

  return { request, paginate }
}
