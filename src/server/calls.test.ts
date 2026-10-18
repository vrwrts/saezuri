import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CallManifest, callPath } from '../domain/calls.ts'
import { birdnetProvider } from './callProviders/birdnet.ts'
import { parseCallProviders } from './callProviders/config.ts'
import type { CallCandidate, CallLookup, CallProvider } from './callProviders/types.ts'
import { CallLibrary, publishCallManifest } from './calls.ts'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  // Every download resolves to the same tiny payload unless a test says otherwise.
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': '4' }),
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const tmpDir = (p: string) => mkdtemp(join(tmpdir(), p))

const CANDIDATE: CallCandidate = {
  audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Turdus_merula.mp3',
  ext: 'mp3',
  recordist: 'A. Recordist',
  license: 'CC BY-SA 4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Turdus_merula.mp3',
  sourceName: 'Wikimedia Commons',
}

function stubProvider(
  impl: (sci: string) => Promise<CallCandidate | null>,
  name = 'stub',
): CallProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    name,
    calls,
    find: async ({ scientificName }) => {
      calls.push(scientificName)
      return impl(scientificName)
    },
  }
}

/** The library drains asynchronously off `enqueue`. Poll for the expected outcome
 *  rather than sleeping a fixed span, so the suite stays quick — and throw rather
 *  than return quietly on timeout, so a loaded machine reports "waited too long"
 *  instead of a baffling assertion failure further down. */
async function until(
  cond: () => boolean | Promise<boolean>,
  label = 'condition',
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)
}

/** Let the queue drain when the expectation is that *nothing* happens. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50))
}

const has = (dir: string, name: string) => async () => (await readdir(dir)).includes(name)

async function storedAudioPath(callsDir: string, slug = 'turdus-merula'): Promise<string> {
  const rec = JSON.parse(await readFile(join(callsDir, `${slug}.json`), 'utf8'))
  const url = new URL(callPath(slug, rec), 'http://saezuri')
  return join(callsDir, url.pathname.split('/').at(-1) as string)
}

const hasAudio = (callsDir: string) => async () => {
  try {
    await readFile(await storedAudioPath(callsDir))
    return true
  } catch {
    return false
  }
}

describe('CallLibrary', () => {
  it.each([
    false,
    true,
  ])('starts the grace period when an aged current recording is replaced (station disabled: %s)', async (disableStation) => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    const birdnet: CallProvider = {
      name: 'birdnet',
      sourceKey: ({ detections }) => String(detections[0]?.id),
      find: async ({ detections }) => ({
        bytes: new Uint8Array([detections[0].id]),
        ext: 'mp3',
        recordist: '',
        sourceName: 'BirdNET-Go',
        sourceKey: String(detections[0].id),
      }),
    }
    let acquired = false
    new CallLibrary({
      callsDir,
      providers: [birdnet],
      maxPerCycle: 4,
      lookupGapMs: 0,
      onAcquired: () => {
        acquired = true
      },
    }).enqueue('Turdus merula', [{ id: 42, clipName: 'old.mp3' }])
    await until(() => acquired, 'original station acquisition')
    await publishCallManifest(htmlDir, callsDir, ['birdnet'])
    const previousAudio = await storedAudioPath(callsDir)
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(previousAudio, old, old)
    const beforeRetirement = Date.now()
    const providers = disableStation ? [stubProvider(async () => CANDIDATE, 'commons')] : [birdnet]
    let bytesBeforePublish: Buffer | null = null
    acquired = false
    new CallLibrary({
      callsDir,
      providers,
      maxPerCycle: 4,
      lookupGapMs: 0,
      onAcquired: async () => {
        bytesBeforePublish = await readFile(previousAudio).catch(() => null)
        await publishCallManifest(
          htmlDir,
          callsDir,
          providers.map((p) => p.name),
        )
        acquired = true
      },
    }).enqueue('Turdus merula', [{ id: 43, clipName: 'new.mp3' }])
    await until(() => acquired, 'replacement and publication')
    expect(bytesBeforePublish).toEqual(Buffer.from([42]))
    expect(await readFile(previousAudio)).toEqual(Buffer.from([42]))
    const { mtimeMs } = await stat(previousAudio)
    expect(mtimeMs).toBeGreaterThanOrEqual(beforeRetirement - 1)
    expect(await readFile(await storedAudioPath(callsDir))).toEqual(
      Buffer.from(disableStation ? [1, 2, 3, 4] : [43]),
    )
  })

  it.each([
    false,
    true,
  ])('retires expired unreferenced versions conservatively (unreadable metadata: %s)', async (unreadableMetadata) => {
    const callsDir = await tmpDir('saezuri-calls-')
    const current = `turdus-merula.${'a'.repeat(64)}.mp3`
    const expired = `turdus-merula.${'b'.repeat(64)}.mp3`
    const recent = `turdus-merula.${'c'.repeat(64)}.mp3`
    const legacy = 'turdus-merula.wav'
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    for (const name of [current, expired, recent, legacy]) {
      await writeFile(join(callsDir, name), name)
      if (name !== recent) await utimes(join(callsDir, name), old, old)
    }
    await writeFile(
      join(callsDir, 'turdus-merula.json'),
      JSON.stringify({
        audioFile: current,
        ext: 'mp3',
        ver: 'a'.repeat(64),
        recordist: '',
        sourceName: 'BirdNET-Go',
        provider: 'birdnet',
        sourceKey: '42',
      }),
    )
    if (unreadableMetadata) await writeFile(join(callsDir, 'other-species.json'), '{')
    const acquired = vi.fn()
    new CallLibrary({
      callsDir,
      providers: [stubProvider(async () => CANDIDATE, 'commons')],
      maxPerCycle: 4,
      lookupGapMs: 0,
      onAcquired: acquired,
    }).enqueue('Parus major')
    await until(() => acquired.mock.calls.length === 1, 'acquisition and retirement')
    const names = await readdir(callsDir)
    expect(names).toEqual(expect.arrayContaining([current, recent, legacy]))
    expect(names.includes(expired)).toBe(unreadableMetadata)
    expect(await readFile(await storedAudioPath(callsDir, 'parus-major'))).toEqual(
      Buffer.from([1, 2, 3, 4]),
    )
  })

  it.each([
    false,
    true,
  ])('preserves published audio and provenance through same-format replacement (failed sidecar: %s)', async (failSidecar) => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    const slug = 'turdus-merula'
    const legacy = { ...CANDIDATE, ver: 'legacy', provider: 'commons' }
    await writeFile(join(callsDir, `${slug}.mp3`), 'archive bytes')
    await writeFile(join(callsDir, `${slug}.json`), JSON.stringify(legacy))
    const initial = await publishCallManifest(htmlDir, callsDir, ['birdnet', 'commons'])
    const diskPath = (url: string) =>
      join(callsDir, new URL(url, 'http://saezuri').pathname.split('/').at(-1) as string)
    const oldUrl = callPath('Turdus merula', initial.calls[slug])
    if (failSidecar) await mkdir(join(callsDir, `${slug}.json.tmp`))
    const birdnet = stubProvider(
      async () => ({
        bytes: Buffer.from('station bytes'),
        ext: 'mp3',
        sourceKey: '42',
        recordist: '',
        sourceName: 'BirdNET-Go',
      }),
      'birdnet',
    )
    const opts = {
      callsDir,
      providers: [birdnet],
      maxPerCycle: 4,
      lookupGapMs: 0,
      onAcquired: () => {},
    }
    new CallLibrary(opts).enqueue('Turdus merula', [{ id: 42, clipName: 'station.mp3' }])
    await until(has(callsDir, '_misses.json'), 'completed acquisition batch')

    expect(await readFile(diskPath(oldUrl), 'utf8')).toBe('archive bytes')
    if (failSidecar) {
      const stored = JSON.parse(await readFile(join(callsDir, `${slug}.json`), 'utf8'))
      expect(stored).toEqual(legacy)
      const disabled = await publishCallManifest(htmlDir, callsDir, ['commons'])
      expect(disabled.calls[slug].sourceName).toBe('Wikimedia Commons')
      expect(
        await readFile(diskPath(callPath('Turdus merula', disabled.calls[slug])), 'utf8'),
      ).toBe('archive bytes')
      await rm(join(callsDir, `${slug}.json.tmp`), { recursive: true })
      await rm(join(callsDir, '_misses.json'))
      new CallLibrary(opts).enqueue('Turdus merula', [{ id: 42, clipName: 'station.mp3' }])
      await until(has(callsDir, '_misses.json'), 'retried acquisition batch')
    }

    const published = await publishCallManifest(htmlDir, callsDir, ['birdnet'])
    const newUrl = callPath('Turdus merula', published.calls[slug])
    expect(newUrl).not.toBe(oldUrl)
    expect(diskPath(newUrl)).not.toBe(diskPath(oldUrl))
    expect(await readFile(diskPath(oldUrl), 'utf8')).toBe('archive bytes')
    expect(await readFile(diskPath(newUrl), 'utf8')).toBe('station bytes')
    expect((await publishCallManifest(htmlDir, callsDir, ['commons'])).calls).toEqual({})
  })

  it('caches the audio and its credit side by side', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    const provider = stubProvider(async () => CANDIDATE)
    const lib = new CallLibrary({
      callsDir,
      providers: [provider],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    })

    lib.enqueue('Turdus merula')
    await until(has(callsDir, 'turdus-merula.json'), 'turdus-merula.json')

    const names = await readdir(callsDir)
    expect(names).toContain('turdus-merula.json')
    const rec = JSON.parse(await readFile(join(callsDir, 'turdus-merula.json'), 'utf8'))
    expect(rec).toMatchObject({ ext: 'mp3', recordist: 'A. Recordist', license: 'CC BY-SA 4.0' })
    expect(rec.ver).toMatch(/^[0-9a-f]{64}$/)
    expect(rec.audioFile).toBe(`turdus-merula.${rec.ver}.mp3`)
    expect(await readFile(await storedAudioPath(callsDir))).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  it('does nothing at all when no providers are configured', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    const lib = new CallLibrary({
      callsDir,
      providers: [],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    })
    lib.enqueue('Turdus merula')
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not re-fetch a species it already has', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    const provider = stubProvider(async () => CANDIDATE)
    const opts = {
      callsDir,
      providers: [provider],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    }

    const first = new CallLibrary(opts)
    first.enqueue('Turdus merula')
    await until(has(callsDir, 'turdus-merula.json'), 'turdus-merula.json')

    const second = new CallLibrary(opts)
    second.enqueue('Turdus merula')
    await settle()

    expect(provider.calls).toEqual(['Turdus merula'])
  })

  it('remembers a miss so the publish cycle stops re-querying silent species', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    const provider = stubProvider(async () => null)
    const opts = {
      callsDir,
      providers: [provider],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    }

    const first = new CallLibrary(opts)
    first.enqueue('Zosterops nehrkorni')
    await until(has(callsDir, '_misses.json'), '_misses.json')
    expect(provider.calls).toHaveLength(1)

    // Persisted, so even a restart doesn't re-ask.
    const second = new CallLibrary(opts)
    second.enqueue('Zosterops nehrkorni')
    await settle()
    expect(provider.calls).toHaveLength(1)
  })

  it('prunes expired detection-specific misses when saving', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    await writeFile(
      join(callsDir, '_misses.json'),
      JSON.stringify({
        'birdnet:turdus-merula:1': Date.now() - 8 * 24 * 60 * 60 * 1000,
        'birdnet:turdus-merula:2': Date.now(),
      }),
    )
    const provider = stubProvider(async () => null, 'birdnet')
    const lib = new CallLibrary({
      callsDir,
      providers: [provider],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    })

    lib.enqueue('Parus major')
    await until(() => provider.calls.length === 1, 'provider lookup')
    await until(async () => {
      const misses = JSON.parse(await readFile(join(callsDir, '_misses.json'), 'utf8'))
      return 'birdnet:parus-major' in misses
    }, 'saved misses')

    const misses = JSON.parse(await readFile(join(callsDir, '_misses.json'), 'utf8'))
    expect(misses).not.toHaveProperty('birdnet:turdus-merula:1')
    expect(misses).toHaveProperty('birdnet:turdus-merula:2')
  })

  it('does not remember a transient failure as a miss', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    let attempt = 0
    const provider = stubProvider(async () => {
      attempt++
      if (attempt === 1) throw new Error('commons 429')
      return CANDIDATE
    })
    const opts = {
      callsDir,
      providers: [provider],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    }

    const first = new CallLibrary(opts)
    first.enqueue('Turdus merula')
    await until(() => attempt === 1, 'first lookup attempt')
    await settle()
    expect(await readdir(callsDir)).not.toContain('turdus-merula.mp3')

    // A rate limit must leave the species retryable, not written off for a week.
    const second = new CallLibrary(opts)
    second.enqueue('Turdus merula')
    await until(hasAudio(callsDir), 'cached audio')
  })

  it('falls through to the next provider when the first has nothing', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    const empty = stubProvider(async () => null, 'empty')
    const stocked = stubProvider(async () => CANDIDATE, 'stocked')
    const lib = new CallLibrary({
      callsDir,
      providers: [empty, stocked],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    })

    lib.enqueue('Turdus merula')
    await until(hasAudio(callsDir), 'cached audio')

    expect(empty.calls).toHaveLength(1)
    expect(stocked.calls).toHaveLength(1)
    expect(await readFile(await storedAudioPath(callsDir))).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  it.each([
    401,
    503,
    'network',
  ] as const)('falls back to Commons after a BirdNET %s failure and upgrades after recovery', async (failure) => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    let recovered = false
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('http://birdnet.local/')) {
        if (!recovered) {
          if (failure === 'network') throw new Error('connection refused')
          return new Response(null, { status: failure })
        }
        return new Response(new Uint8Array([9, 8, 7]), {
          headers: { 'content-type': 'audio/wav' },
        })
      }
      return new Response(new Uint8Array([1, 2, 3, 4]))
    })
    const commons = stubProvider(async () => CANDIDATE, 'commons')
    const providers = parseCallProviders('birdnet,commons')
    let published = 0
    const opts = {
      callsDir,
      providers: [birdnetProvider('http://birdnet.local'), commons],
      maxPerCycle: 4,
      lookupGapMs: 0,
      onAcquired: async () => {
        await publishCallManifest(htmlDir, callsDir, providers)
        published++
      },
    }
    const detections = [{ id: 42, clipName: 'station.wav' }]

    new CallLibrary(opts).enqueue('Turdus merula', detections)
    await until(() => published === 1, 'published Commons fallback')
    const fallback = JSON.parse(await readFile(join(htmlDir, 'calls-manifest.json'), 'utf8'))
    expect(fallback.calls['turdus-merula']).toMatchObject({
      sourceName: 'Wikimedia Commons',
      license: CANDIDATE.license,
    })
    expect(JSON.parse(await readFile(join(callsDir, '_misses.json'), 'utf8'))).toEqual({})

    // Reload the persisted cache: a transient failure must not prevent retrying
    // the preferred provider even after the fallback has been saved.
    recovered = true
    new CallLibrary(opts).enqueue('Turdus merula', detections)
    await until(() => published === 2, 'published station recording after recovery')
    const restored = JSON.parse(await readFile(join(htmlDir, 'calls-manifest.json'), 'utf8'))
    expect(restored.calls['turdus-merula']).toMatchObject({
      ext: 'wav',
      sourceName: 'BirdNET-Go',
    })
    expect(commons.calls).toEqual(['Turdus merula'])
    expect(
      fetchMock.mock.calls.filter(([url]) => url.startsWith('http://birdnet.local/')),
    ).toHaveLength(2)
  })

  it('tries the next provider when downloading a candidate throws', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    fetchMock.mockRejectedValueOnce(new Error('download connection reset'))
    const first = stubProvider(async () => CANDIDATE, 'first')
    const second = stubProvider(
      async () => ({ ...CANDIDATE, bytes: new Uint8Array([9, 8, 7]) }),
      'second',
    )
    const onAcquired = vi.fn()
    new CallLibrary({
      callsDir,
      providers: [first, second],
      maxPerCycle: 4,
      lookupGapMs: 0,
      onAcquired,
    }).enqueue('Turdus merula')
    await until(() => onAcquired.mock.calls.length === 1, 'download fallback')
    const record = JSON.parse(await readFile(join(callsDir, 'turdus-merula.json'), 'utf8'))
    expect(record.provider).toBe('second')
    expect(JSON.parse(await readFile(join(callsDir, '_misses.json'), 'utf8'))).toEqual({})
  })

  it('republishes only when something was actually acquired', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    const onAcquired = vi.fn()
    const provider = stubProvider(async () => null)
    const lib = new CallLibrary({
      callsDir,
      providers: [provider],
      maxPerCycle: 4,
      onAcquired,
      lookupGapMs: 0,
    })

    lib.enqueue('Zosterops nehrkorni')
    await until(() => provider.calls.length === 1, 'provider lookup')
    await settle()

    expect(onAcquired).not.toHaveBeenCalled()
  })

  it('keeps a BirdNET recording until a newer detection is available', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    const find = vi.fn(
      async ({ detections }: CallLookup): Promise<CallCandidate> => ({
        bytes: new Uint8Array([detections[0].id]),
        ext: 'wav',
        sourceKey: String(detections[0].id),
        recordist: '',
        sourceUrl: 'https://github.com/tphakala/birdnet-go',
        sourceName: 'BirdNET-Go',
      }),
    )
    const provider: CallProvider = {
      name: 'birdnet',
      sourceKey: ({ detections }) => String(detections[0]?.id),
      find,
    }
    const opts = {
      callsDir,
      providers: [provider],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    }

    new CallLibrary(opts).enqueue('Turdus merula', [{ id: 42, clipName: 'first.wav' }])
    await until(has(callsDir, 'turdus-merula.json'), 'first BirdNET recording')
    const firstAudioPath = await storedAudioPath(callsDir)

    new CallLibrary(opts).enqueue('Turdus merula', [{ id: 42, clipName: 'first.wav' }])
    await settle()
    expect(find).toHaveBeenCalledTimes(1)

    new CallLibrary(opts).enqueue('Turdus merula', [{ id: 43, clipName: 'new.wav' }])
    await until(async () => {
      const rec = JSON.parse(await readFile(join(callsDir, 'turdus-merula.json'), 'utf8'))
      return rec.sourceKey === '43'
    }, 'newer BirdNET recording')

    expect(find).toHaveBeenCalledTimes(2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await readFile(firstAudioPath)).toEqual(Buffer.from([42]))
    expect(await readFile(await storedAudioPath(callsDir))).toEqual(Buffer.from([43]))
    expect(await storedAudioPath(callsDir)).not.toBe(firstAudioPath)
  })

  it('upgrades a cached Commons call when BirdNET is configured first', async () => {
    const callsDir = await tmpDir('saezuri-calls-')
    const commons = stubProvider(async () => CANDIDATE, 'commons')
    const birdnet: CallProvider = {
      name: 'birdnet',
      sourceKey: ({ detections }) => String(detections[0]?.id),
      find: async () => ({
        bytes: new Uint8Array([9, 8, 7]),
        ext: 'wav',
        sourceKey: '42',
        recordist: '',
        sourceUrl: 'https://github.com/tphakala/birdnet-go',
        sourceName: 'BirdNET-Go',
      }),
    }

    new CallLibrary({
      callsDir,
      providers: [commons],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    }).enqueue('Turdus merula')
    await until(has(callsDir, 'turdus-merula.json'), 'Commons recording')
    const commonsAudioPath = await storedAudioPath(callsDir)

    new CallLibrary({
      callsDir,
      providers: [birdnet, commons],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    }).enqueue('Turdus merula', [{ id: 42, clipName: 'station.wav' }])
    await until(async () => {
      const rec = JSON.parse(await readFile(join(callsDir, 'turdus-merula.json'), 'utf8'))
      return rec.provider === 'birdnet'
    }, 'BirdNET upgrade')

    expect(commons.calls).toEqual(['Turdus merula'])
    expect(await readFile(commonsAudioPath)).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  it('replaces a cached BirdNET recording when only Commons remains configured', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    const birdnet: CallProvider = {
      name: 'birdnet',
      sourceKey: ({ detections }) => String(detections[0]?.id),
      find: async () => ({
        bytes: new Uint8Array([9, 8, 7]),
        ext: 'wav',
        sourceKey: '42',
        recordist: '',
        sourceName: 'BirdNET-Go',
      }),
    }

    new CallLibrary({
      callsDir,
      providers: [birdnet],
      maxPerCycle: 4,
      onAcquired: () => {},
      lookupGapMs: 0,
    }).enqueue('Turdus merula', [{ id: 42, clipName: 'station.wav' }])
    await until(hasAudio(callsDir), 'BirdNET recording')
    const stationAudioPath = await storedAudioPath(callsDir)

    const find = vi.fn(async (_lookup: CallLookup) => CANDIDATE)
    const commons: CallProvider = { name: 'commons', find }
    new CallLibrary({
      callsDir,
      providers: [commons],
      maxPerCycle: 4,
      onAcquired: async () => {
        await publishCallManifest(htmlDir, callsDir, ['commons'])
      },
      lookupGapMs: 0,
    }).enqueue('Turdus merula')
    await until(async () => {
      try {
        const manifest = JSON.parse(
          await readFile(join(htmlDir, 'calls-manifest.json'), 'utf8'),
        ) as CallManifest
        return manifest.calls['turdus-merula']?.ext === 'mp3'
      } catch {
        return false
      }
    }, 'published Commons replacement')

    expect(find).toHaveBeenCalledWith({
      scientificName: 'Turdus merula',
      detections: [],
      current: undefined,
    })
    expect(await readFile(await storedAudioPath(callsDir))).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(await readFile(stationAudioPath)).toEqual(Buffer.from([9, 8, 7]))
  })
})

describe('publishCallManifest', () => {
  it('requires the exact versioned audio file instead of falling back to legacy bytes', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    const rec = {
      ext: 'mp3',
      ver: 'content-hash',
      audioFile: 'turdus-merula.content-hash.mp3',
      recordist: '',
      provider: 'birdnet',
      sourceKey: '42',
      sourceName: 'BirdNET-Go',
    }
    await writeFile(join(callsDir, 'turdus-merula.mp3'), 'legacy archive')
    await writeFile(join(callsDir, 'turdus-merula.json'), JSON.stringify(rec))
    expect((await publishCallManifest(htmlDir, callsDir, ['birdnet'])).calls).toEqual({})
    await writeFile(join(callsDir, rec.audioFile), 'station audio')
    await publishCallManifest(htmlDir, callsDir, ['birdnet'])
    const published = JSON.parse(await readFile(join(htmlDir, 'calls-manifest.json'), 'utf8'))
    expect(published.calls['turdus-merula'].audioFile).toBe(rec.audioFile)
    expect(published.calls['turdus-merula']).not.toHaveProperty('provider')
    expect(published.calls['turdus-merula']).not.toHaveProperty('sourceKey')
    expect(await readFile(await storedAudioPath(callsDir), 'utf8')).toBe('station audio')
  })

  it('publishes an empty manifest when nothing has been acquired', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const manifest = await publishCallManifest(htmlDir, join(htmlDir, 'assets', 'calls'), [])
    expect(manifest).toEqual({ calls: {} })
    const written = JSON.parse(await readFile(join(htmlDir, 'calls-manifest.json'), 'utf8'))
    expect(written).toEqual({ calls: {} })
  })

  it('publishes a BirdNET recording with its detection-page link', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    await writeFile(join(callsDir, 'turdus-merula.mp3'), 'audio')
    await writeFile(
      join(callsDir, 'turdus-merula.json'),
      JSON.stringify({
        ext: 'mp3',
        ver: 'abc',
        recordist: '',
        sourceName: 'BirdNET-Go',
        provider: 'birdnet',
        sourceKey: '42',
      }),
    )

    const { calls } = await publishCallManifest(
      htmlDir,
      callsDir,
      ['birdnet'],
      'http://birdnet.local:8080/',
    )
    expect(calls['turdus-merula']).toMatchObject({
      ext: 'mp3',
      sourceUrl: 'http://birdnet.local:8080/ui/detections/42',
    })
    expect(calls['turdus-merula']).not.toHaveProperty('provider')
    expect(calls['turdus-merula']).not.toHaveProperty('sourceKey')
  })

  it('publishes BirdNET audio without a source link when no UI base URL is configured', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    await writeFile(join(callsDir, 'turdus-merula.flac'), 'audio')
    await writeFile(
      join(callsDir, 'turdus-merula.json'),
      JSON.stringify({
        ext: 'flac',
        ver: 'abc',
        recordist: '',
        sourceName: 'BirdNET-Go',
        provider: 'birdnet',
        sourceKey: '42',
      }),
    )

    const { calls } = await publishCallManifest(htmlDir, callsDir, ['birdnet'])
    expect(calls['turdus-merula']).not.toHaveProperty('sourceUrl')
  })

  it.each([
    'commons',
    '',
  ])('unpublishes cached station calls with CALL_PROVIDERS=%s even when no replacement is found', async (rawProviders) => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    const birdnet = stubProvider(
      async () => ({
        bytes: new Uint8Array([9, 8, 7]),
        ext: 'wav',
        sourceKey: '42',
        recordist: '',
        sourceName: 'BirdNET-Go',
      }),
      'birdnet',
    )
    let acquired = false
    new CallLibrary({
      callsDir,
      providers: [birdnet],
      maxPerCycle: 4,
      lookupGapMs: 0,
      onAcquired: () => {
        acquired = true
      },
    }).enqueue('Turdus merula', [{ id: 42, clipName: 'station.wav' }])
    await until(() => acquired, 'saved station recording')
    const enabled = await publishCallManifest(htmlDir, callsDir, ['birdnet', 'commons'])
    expect(enabled.calls['turdus-merula']).toBeDefined()

    // Archive caches, including pre-provenance sidecars, retain their existing
    // publication behavior when acquisition is disabled.
    await writeFile(join(callsDir, 'parus-major.mp3'), 'archive audio')
    await writeFile(
      join(callsDir, 'parus-major.json'),
      JSON.stringify({ ...CANDIDATE, ver: 'archive' }),
    )
    const providers = parseCallProviders(rawProviders)
    const commons = stubProvider(async () => null, 'commons')
    const onAcquired = vi.fn()
    new CallLibrary({
      callsDir,
      providers: providers.map(() => commons),
      maxPerCycle: 4,
      lookupGapMs: 0,
      onAcquired,
    }).enqueue('Turdus merula')
    if (providers.length) {
      await until(async () => {
        const misses = JSON.parse(await readFile(join(callsDir, '_misses.json'), 'utf8'))
        return 'turdus-merula' in misses
      }, 'settled Commons miss')
    }
    await publishCallManifest(htmlDir, callsDir, providers, 'http://birdnet.local')
    const written = JSON.parse(await readFile(join(htmlDir, 'calls-manifest.json'), 'utf8'))
    expect(written.calls['turdus-merula']).toBeUndefined()
    expect(written.calls['parus-major']).toMatchObject({
      sourceName: 'Wikimedia Commons',
      license: CANDIDATE.license,
    })
    expect(commons.calls).toHaveLength(providers.length)
    expect(onAcquired).not.toHaveBeenCalled()

    const reenabled = await publishCallManifest(htmlDir, callsDir, ['birdnet'])
    expect(reenabled.calls['turdus-merula']).toBeDefined()
    expect(birdnet.calls).toHaveLength(1)
  })

  it('skips Commons and legacy audio when required attribution is incomplete', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    await writeFile(join(callsDir, 'parus-major.mp3'), 'audio')
    await writeFile(
      join(callsDir, 'parus-major.json'),
      JSON.stringify({
        ext: 'mp3',
        ver: 'abc',
        recordist: 'A',
        sourceName: 'Wikimedia Commons',
        provider: 'commons',
      }),
    )
    await writeFile(join(callsDir, 'corvus-corone.mp3'), 'audio')
    await writeFile(
      join(callsDir, 'corvus-corone.json'),
      JSON.stringify({
        ext: 'mp3',
        ver: 'def',
        recordist: 'B',
        license: 'CC0 1.0',
        sourceName: 'Wikimedia Commons',
      }),
    )

    const { calls } = await publishCallManifest(htmlDir, callsDir, ['commons'])
    expect(calls).toEqual({})
  })

  it('skips audio whose credit is missing rather than serving it uncredited', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    await writeFile(join(callsDir, 'parus-major.mp3'), 'audio')

    const { calls } = await publishCallManifest(htmlDir, callsDir, ['commons'])
    expect(calls['parus-major']).toBeUndefined()
  })

  it('skips a credit whose audio is missing', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    await writeFile(
      join(callsDir, 'parus-major.json'),
      JSON.stringify({
        ext: 'mp3',
        ver: 'a',
        recordist: 'A',
        license: 'CC0 1.0',
        sourceUrl: 'x',
        sourceName: 'y',
      }),
    )

    const { calls } = await publishCallManifest(htmlDir, callsDir, ['commons'])
    expect(calls['parus-major']).toBeUndefined()
  })

  it('ignores the underscore-prefixed bookkeeping file', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    await writeFile(join(callsDir, '_misses.json'), JSON.stringify({ 'parus-major': Date.now() }))

    const { calls } = await publishCallManifest(htmlDir, callsDir, ['commons'])
    expect(calls).toEqual({})
  })
})
