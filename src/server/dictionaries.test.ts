import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publishDictionaries } from './dictionaries.ts'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json })
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) })
const tmpHtmlDir = () => mkdtemp(join(tmpdir(), 'saezuri-dict-'))

describe('publishDictionaries', () => {
  it('writes a file per fetched locale, an index, and the station default', async () => {
    const htmlDir = await tmpHtmlDir()
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/species/dictionary/de'))
        return Promise.resolve(ok({ 'Turdus merula': 'Amsel' }))
      if (url.endsWith('/species/dictionary/nl'))
        return Promise.resolve(ok({ 'Turdus merula': 'Merel' }))
      if (url.endsWith('/settings/dashboard')) return Promise.resolve(ok({ locale: 'nl' }))
      return Promise.resolve(notFound())
    })

    const index = await publishDictionaries({
      baseUrl: 'http://bng:8080',
      htmlDir,
      locales: ['de', 'nl'],
    })

    expect(index).toEqual({ locales: ['de', 'nl'], default: 'nl' })
    const de = JSON.parse(await readFile(join(htmlDir, 'species-dict', 'de.json'), 'utf8'))
    expect(de['Turdus merula']).toBe('Amsel')
    const written = JSON.parse(await readFile(join(htmlDir, 'species-dict', 'index.json'), 'utf8'))
    expect(written).toEqual({ locales: ['de', 'nl'], default: 'nl' })
  })

  it('skips locales the backend does not have (404)', async () => {
    const htmlDir = await tmpHtmlDir()
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/species/dictionary/de') ? ok({ x: 'y' }) : notFound()),
    )

    const index = await publishDictionaries({
      baseUrl: 'http://bng:8080',
      htmlDir,
      locales: ['de', 'nl'],
    })

    expect(index.locales).toEqual(['de'])
    expect(index.default).toBeNull()
    await expect(readFile(join(htmlDir, 'species-dict', 'nl.json'), 'utf8')).rejects.toThrow()
  })

  it('sends the bearer token when configured', async () => {
    const htmlDir = await tmpHtmlDir()
    fetchMock.mockResolvedValue(notFound())
    await publishDictionaries({
      baseUrl: 'http://bng:8080',
      token: 'secret',
      htmlDir,
      locales: ['de'],
    })
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer secret')
  })
})
