import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { birdnetProvider } from './birdnet.ts'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

const lookup = {
  scientificName: 'Turdus merula',
  detections: [
    { id: 42, clipName: 'newest.mp3' },
    { id: 21, clipName: 'older.wav' },
  ],
}

describe('birdnetProvider.find', () => {
  it('downloads the newest detection recording with the configured token', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    )

    const found = await birdnetProvider('http://birdnet:8080/', 'secret').find(lookup)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://birdnet:8080/api/v2/media/audio?id=42')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret')
    expect(found).toMatchObject({
      ext: 'mp3',
      sourceKey: '42',
      sourceName: 'BirdNET-Go',
    })
    expect(found).not.toHaveProperty('sourceUrl')
    expect([...((found?.bytes ?? []) as Uint8Array)]).toEqual([1, 2, 3])
  })

  it('uses the next newest recording when BirdNET-Go no longer has the first', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(
      new Response(new Uint8Array([4, 5]), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      }),
    )

    const found = await birdnetProvider('http://birdnet:8080').find(lookup)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://birdnet:8080/api/v2/media/audio?id=42',
      'http://birdnet:8080/api/v2/media/audio?id=21',
    ])
    expect(found).toMatchObject({ ext: 'wav', sourceKey: '21' })
  })

  it('bounds how many missing recordings one lookup probes', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
    const detections = Array.from({ length: 20 }, (_, index) => ({
      id: 100 - index,
      clipName: `${100 - index}.wav`,
    }))

    const found = await birdnetProvider('http://birdnet:8080').find({
      scientificName: 'Turdus merula',
      detections,
    })

    expect(found).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })

  it('accepts BirdNET-Go Opus recordings', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { 'content-type': 'audio/ogg' },
      }),
    )

    const found = await birdnetProvider('http://birdnet:8080').find({
      scientificName: 'Turdus merula',
      detections: [{ id: 42, clipName: 'newest.opus' }],
    })

    expect(found).toMatchObject({ ext: 'opus', sourceKey: '42' })
  })

  it('cancels a recording rejected from its declared size', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    fetchMock.mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          'content-length': String(16 * 1024 * 1024 + 1),
          'content-type': 'audio/wav',
        },
      }),
    )

    const found = await birdnetProvider('http://birdnet:8080').find({
      scientificName: 'Turdus merula',
      detections: [{ id: 42, clipName: 'newest.wav' }],
    })

    expect(found).toBeNull()
    expect(cancelled).toBe(true)
  })

  it('throws on a pending clip so the lookup remains retryable', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 503, headers: { 'retry-after': '12' } }),
    )

    await expect(birdnetProvider('http://birdnet:8080').find(lookup)).rejects.toThrow(
      /503.*retry-after 12/,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops before re-downloading the currently cached recording', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))

    const found = await birdnetProvider('http://birdnet:8080').find({
      ...lookup,
      current: { provider: 'birdnet', sourceKey: '21' },
    })

    expect(found).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('id=42')
  })

  it('does not cache an authentication failure as a missing clip', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }))

    await expect(birdnetProvider('http://birdnet:8080').find(lookup)).rejects.toThrow('birdnet 401')
  })

  it('does not treat a non-audio success response as a missing clip', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    fetchMock.mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }),
    )

    await expect(birdnetProvider('http://birdnet:8080').find(lookup)).rejects.toThrow(
      'birdnet 200 non-audio response',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cancelled).toBe(true)
  })
})
