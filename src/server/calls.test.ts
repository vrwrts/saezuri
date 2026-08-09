import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallCandidate, CallProvider } from './callProviders/types.ts'
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
): CallProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    name: 'stub',
    calls,
    find: async (sci) => {
      calls.push(sci)
      return impl(sci)
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
    const empty = stubProvider(async () => null)
    const stocked = stubProvider(async () => CANDIDATE)
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
})

describe('publishCallManifest', () => {
  it('publishes an empty manifest when nothing has been acquired', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const manifest = await publishCallManifest(htmlDir, join(htmlDir, 'assets', 'calls'))
    expect(manifest).toEqual({ calls: {} })
    const written = JSON.parse(await readFile(join(htmlDir, 'calls-manifest.json'), 'utf8'))
    expect(written).toEqual({ calls: {} })
  })

  it('describes each recording that has both its audio and its credit', async () => {
    const htmlDir = await tmpDir('saezuri-html-')
    const callsDir = await tmpDir('saezuri-calls-')
    await writeFile(join(callsDir, 'turdus-merula.mp3'), 'audio')
    await writeFile(
      join(callsDir, 'turdus-merula.json'),
      JSON.stringify({
        ext: 'mp3',
        ver: 'abc',
        recordist: 'A',
        license: 'CC0 1.0',
        sourceUrl: 'x',
        sourceName: 'y',
      }),
    )

    const { calls } = await publishCallManifest(htmlDir, callsDir)
    expect(calls['turdus-merula']).toMatchObject({ ext: 'mp3', license: 'CC0 1.0' })
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
