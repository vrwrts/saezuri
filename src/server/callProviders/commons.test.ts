import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commonsProvider, plainText, selectCandidate, titleMatches } from './commons.ts'

// Captured from the live API (see fixtures/README.md), so these pin the real
// response shape rather than an assumed one.
const searchFixture = JSON.parse(
  await readFile('fixtures/commons-audio-search.json', 'utf8'),
) as never
const emptyFixture = JSON.parse(await readFile('fixtures/commons-audio-none.json', 'utf8')) as never

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const respond = (json: unknown, init: { status?: number; headers?: Headers } = {}) => ({
  ok: (init.status ?? 200) < 400,
  status: init.status ?? 200,
  headers: init.headers ?? new Headers(),
  json: async () => json,
})

describe('plainText', () => {
  it('reduces the HTML that extmetadata carries to a bare credit', () => {
    expect(
      plainText('Oona Räisänen (<a href="https://example.invalid" class="extiw">Mysid</a>)'),
    ).toBe('Oona Räisänen (Mysid)')
  })

  it('decodes the entities that survive tag stripping', () => {
    expect(plainText('Bob &amp; Alice&#039;s &quot;recording&quot;')).toBe(
      'Bob & Alice\'s "recording"',
    )
  })
})

describe('titleMatches', () => {
  it('accepts the naming conventions Commons actually uses', () => {
    expect(titleMatches('File:Turdus merula 2.ogg', 'Turdus merula')).toBe(true)
    expect(
      titleMatches('File:Sitta europaea - Eurasian Nuthatch XC433160.mp3', 'Sitta europaea'),
    ).toBe(true)
    expect(titleMatches('File:Turdus_merula_song.mp3', 'Turdus merula')).toBe(true)
  })

  it('rejects a recording of another bird that merely mentions this one', () => {
    expect(titleMatches('File:Erithacus rubecula song.ogg', 'Turdus merula')).toBe(false)
  })
})

describe('selectCandidate', () => {
  it('picks the best-ranked usable recording and carries its credit', () => {
    const found = selectCandidate(searchFixture, 'Turdus merula')
    expect(found).not.toBeNull()
    expect(found?.sourceName).toBe('Wikimedia Commons')
    expect(found?.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)
    expect(found?.license).toBeTruthy()
    // .ogg is served as application/ogg, which still has to be recognised as audio.
    expect(['ogg', 'mp3', 'oga', 'opus', 'wav', 'flac', 'm4a']).toContain(found?.ext)
  })

  it('returns null for a search with no hits (the response omits `query`)', () => {
    expect(selectCandidate(emptyFixture, 'Zosterops nehrkorni')).toBeNull()
  })

  it('honours search rank rather than array order', () => {
    const pages = [
      { title: 'File:Turdus merula b.mp3', index: 2, imageinfo: [info('b.mp3')] },
      { title: 'File:Turdus merula a.mp3', index: 1, imageinfo: [info('a.mp3')] },
    ]
    const found = selectCandidate({ query: { pages } }, 'Turdus merula')
    expect(found?.audioUrl).toContain('a.mp3')
  })

  it('skips a recording with no stated licence — it could not be credited', () => {
    const pages = [
      {
        title: 'File:Turdus merula x.mp3',
        index: 1,
        imageinfo: [info('x.mp3', { license: null })],
      },
    ]
    expect(selectCandidate({ query: { pages } }, 'Turdus merula')).toBeNull()
  })

  it('skips soundscapes and oversized files', () => {
    const long = [
      {
        title: 'File:Turdus merula l.mp3',
        index: 1,
        imageinfo: [info('l.mp3', { duration: 600 })],
      },
    ]
    expect(selectCandidate({ query: { pages: long } }, 'Turdus merula')).toBeNull()

    const big = [
      {
        title: 'File:Turdus merula h.mp3',
        index: 1,
        imageinfo: [info('h.mp3', { size: 99 * 1024 * 1024 })],
      },
    ]
    expect(selectCandidate({ query: { pages: big } }, 'Turdus merula')).toBeNull()
  })

  it('skips formats a browser cannot be relied on to play', () => {
    const pages = [
      {
        title: 'File:Turdus merula m.mid',
        index: 1,
        imageinfo: [info('m.mid', { mime: 'audio/midi' })],
      },
    ]
    expect(selectCandidate({ query: { pages } }, 'Turdus merula')).toBeNull()
  })

  it('accepts a recording whose archive names no recordist', () => {
    const pages = [
      {
        title: 'File:Turdus merula n.mp3',
        index: 1,
        imageinfo: [info('n.mp3', { recordist: null })],
      },
    ]
    expect(selectCandidate({ query: { pages } }, 'Turdus merula')?.recordist).toBe('')
  })
})

describe('commonsProvider.find', () => {
  it('identifies itself per Wikimedia policy', async () => {
    fetchMock.mockResolvedValue(respond(emptyFixture))
    await commonsProvider().find('Turdus merula')
    const [, opts] = fetchMock.mock.calls[0]
    // A generic or absent agent is answered with 403.
    expect(opts.headers['User-Agent']).toMatch(/^Saezuri\/\S+ \(https?:\/\/\S+\)$/)
  })

  it('throws on a rate limit so the caller retries instead of caching a miss', async () => {
    fetchMock.mockResolvedValue(
      respond({}, { status: 429, headers: new Headers({ 'retry-after': '30' }) }),
    )
    await expect(commonsProvider().find('Turdus merula')).rejects.toThrow(/429.*retry-after 30/)
  })

  it('throws on a server error for the same reason', async () => {
    fetchMock.mockResolvedValue(respond({}, { status: 503 }))
    await expect(commonsProvider().find('Turdus merula')).rejects.toThrow(/503/)
  })

  it('resolves null on a client error — a settled answer, not a transient one', async () => {
    fetchMock.mockResolvedValue(respond({}, { status: 400 }))
    await expect(commonsProvider().find('Turdus merula')).resolves.toBeNull()
  })
})

/** A minimal imageinfo entry shaped like the live API's. */
function info(
  file: string,
  over: {
    license?: string | null
    recordist?: string | null
    duration?: number
    size?: number
    mime?: string
  } = {},
) {
  const meta: Record<string, { value: string }> = {}
  if (over.license !== null) meta.LicenseShortName = { value: over.license ?? 'CC BY-SA 4.0' }
  if (over.recordist !== null) meta.Artist = { value: over.recordist ?? 'A. Recordist' }
  return {
    url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`,
    mime: over.mime ?? 'audio/mpeg',
    size: over.size ?? 1_000_000,
    duration: over.duration ?? 20,
    descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
    extmetadata: meta,
  }
}
