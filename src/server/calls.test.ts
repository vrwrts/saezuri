import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallManifest } from '../domain/calls.ts'
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

describe('CallLibrary', () => {
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
    expect(names).toContain('turdus-merula.mp3')
    expect(names).toContain('turdus-merula.json')
    const rec = JSON.parse(await readFile(join(callsDir, 'turdus-merula.json'), 'utf8'))
    expect(rec).toMatchObject({ ext: 'mp3', recordist: 'A. Recordist', license: 'CC BY-SA 4.0' })
    expect(rec.ver).toMatch(/^[0-9a-f]{8}$/)
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
    await until(has(callsDir, 'turdus-merula.mp3'), 'turdus-merula.mp3')
    expect(await readdir(callsDir)).toContain('turdus-merula.mp3')
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
    await until(has(callsDir, 'turdus-merula.mp3'), 'turdus-merula.mp3')

    expect(empty.calls).toHaveLength(1)
    expect(stocked.calls).toHaveLength(1)
    expect(await readdir(callsDir)).toContain('turdus-merula.mp3')
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
    expect(await readdir(callsDir)).toContain('turdus-merula.mp3')
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
    await until(has(callsDir, 'turdus-merula.wav'), 'BirdNET recording')

    const commons = stubProvider(async () => CANDIDATE, 'commons')
    new CallLibrary({
      callsDir,
      providers: [commons],
      maxPerCycle: 4,
      onAcquired: async () => {
        await publishCallManifest(htmlDir, callsDir)
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

    expect(commons.calls).toEqual(['Turdus merula'])
    expect(await readdir(callsDir)).toEqual(
      expect.arrayContaining(['turdus-merula.mp3', 'turdus-merula.json']),
    )
    expect(await readdir(callsDir)).toContain('turdus-merula.wav')
  })
})

describe('publishCallManifest', () => {
  it('publishes an empty manifest when nothing has been acquired', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const manifest = await publishCallManifest(htmlDir, join(htmlDir, 'assets', 'calls'))
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

    const { calls } = await publishCallManifest(htmlDir, callsDir, 'http://birdnet.local:8080/')
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

    const { calls } = await publishCallManifest(htmlDir, callsDir)
    expect(calls['turdus-merula']).not.toHaveProperty('sourceUrl')
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

    const { calls } = await publishCallManifest(htmlDir, callsDir)
    expect(calls).toEqual({})
  })

  it('skips audio whose credit is missing rather than serving it uncredited', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    await writeFile(join(callsDir, 'parus-major.mp3'), 'audio')

    const { calls } = await publishCallManifest(htmlDir, callsDir)
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

    const { calls } = await publishCallManifest(htmlDir, callsDir)
    expect(calls['parus-major']).toBeUndefined()
  })

  it('ignores the underscore-prefixed bookkeeping file', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    await writeFile(join(callsDir, '_misses.json'), JSON.stringify({ 'parus-major': Date.now() }))

    const { calls } = await publishCallManifest(htmlDir, callsDir)
    expect(calls).toEqual({})
  })
})
