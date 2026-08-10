import { USER_AGENT } from '../userAgent.ts'
import type { CallCandidate, CallProvider } from './types.ts'

// Commons only accepts free licences (CC0 / BY / BY-SA — NC and ND are not
// permitted on the platform), so unlike a general archive there is no
// per-recording licence filtering to do here: anything we find may be cached and
// re-served, provided we carry the credit. It also mirrors a large slice of
// xeno-canto, which is where most of the bird audio on Commons comes from.

const API = 'https://commons.wikimedia.org/w/api.php'

const SEARCH_LIMIT = 8

/** Longer than this is a soundscape, not a callable reference snippet. */
const MAX_DURATION_S = 90
/** ...and the deployment re-serves whatever it caches, so cap the size too. */
const MAX_BYTES = 12 * 1024 * 1024

/** A safelist, because Commons also hosts formats browsers won't decode. */
const PLAYABLE_EXT = new Set(['mp3', 'ogg', 'oga', 'opus', 'wav', 'flac', 'm4a'])

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
}

interface ExtValue {
  value?: string
}
interface ImageInfo {
  url?: string
  mime?: string
  size?: number
  duration?: number
  descriptionurl?: string
  extmetadata?: Record<string, ExtValue>
}
interface Page {
  title?: string
  /** Search rank; `generator=search` does not guarantee array order. */
  index?: number
  imageinfo?: ImageInfo[]
}
interface CommonsResponse {
  batchcomplete?: boolean
  query?: { pages?: Page[] }
}

/** extmetadata values are HTML fragments — `Artist` is typically a wiki user
 *  link — so they must be reduced to text before they can be shown as a credit. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#0?39|nbsp);/g, (m) => ENTITIES[m] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Commons serves .ogg as `application/ogg` rather than an audio/* type. */
function isAudio(mime: string | undefined): boolean {
  return !!mime && (mime.startsWith('audio/') || mime === 'application/ogg')
}

function playableExtensionOf(url: string): string | null {
  const path = url.split('?')[0]
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  const ext = path.slice(dot + 1).toLowerCase()
  return PLAYABLE_EXT.has(ext) ? ext : null
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** A text search also matches files that merely *mention* the species — a
 *  recording of a different bird whose description cites this one. Playing the
 *  wrong bird is worse than playing nothing on a display whose whole point is
 *  identification, so precision wins over reach. */
export function titleMatches(title: string, scientificName: string): boolean {
  return normalize(title).includes(normalize(scientificName))
}

export function toCandidate(page: Page, scientificName: string): CallCandidate | null {
  if (!page.title || !titleMatches(page.title, scientificName)) return null
  const info = page.imageinfo?.[0]
  if (!info?.url || !info.descriptionurl || !isAudio(info.mime)) return null

  const ext = playableExtensionOf(info.url)
  if (!ext) return null
  if (info.size !== undefined && info.size > MAX_BYTES) return null
  if (info.duration !== undefined && info.duration > MAX_DURATION_S) return null

  const meta = info.extmetadata ?? {}
  // Without a stated licence we cannot credit it correctly, so we may not
  // republish it. Drop rather than guess.
  const license = plainText(meta.LicenseShortName?.value ?? '')
  if (!license) return null

  return {
    audioUrl: info.url,
    ext,
    recordist: plainText(meta.Artist?.value ?? ''),
    license,
    licenseUrl: plainText(meta.LicenseUrl?.value ?? '') || undefined,
    sourceUrl: info.descriptionurl,
    sourceName: 'Wikimedia Commons',
  }
}

export function selectCandidate(
  data: CommonsResponse,
  scientificName: string,
): CallCandidate | null {
  // A search with no hits omits `query` entirely rather than returning an empty list.
  const byRank = [...(data.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  for (const page of byRank) {
    const candidate = toCandidate(page, scientificName)
    if (candidate) return candidate
  }
  return null
}

export function commonsProvider(): CallProvider {
  return {
    name: 'commons',
    async find(scientificName, signal) {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        // `generator=search` feeds the hits straight into imageinfo, so a lookup
        // is one round trip rather than a search followed by a file query.
        generator: 'search',
        gsrnamespace: '6',
        gsrsearch: `${scientificName} filetype:audio`,
        gsrlimit: String(SEARCH_LIMIT),
        prop: 'imageinfo',
        iiprop: 'url|mime|size|extmetadata',
      })

      const res = await fetch(`${API}?${params}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal,
      })
      // Transient, so throw per the CallProvider contract. Publish cycles are
      // minutes apart, which is already more backoff than a Retry-After asks for.
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = res.headers.get('retry-after')
        throw new Error(`commons ${res.status}${retryAfter ? ` (retry-after ${retryAfter})` : ''}`)
      }
      if (!res.ok) return null

      return selectCandidate((await res.json()) as CommonsResponse, scientificName)
    },
  }
}
