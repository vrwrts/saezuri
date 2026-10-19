import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Mock the pipeline subprocess: record argv, resolve immediately (code 0). Lets us
// assert what was asked of the pipeline without needing Python. A hook lets a test
// simulate the render actually landing (or failing to).
const spawnCalls: string[][] = []
const spawnAtMs: number[] = []
let onSpawn: ((args: string[]) => void | Promise<void>) | undefined
vi.mock('node:child_process', () => ({
  spawn: (_bin: string, args: string[]) => {
    spawnCalls.push(args)
    spawnAtMs.push(Date.now())
    const handlers: Record<string, (arg?: unknown) => void> = {}
    const child = {
      on(ev: string, cb: (arg?: unknown) => void) {
        handlers[ev] = cb
        return child
      },
    }
    void Promise.resolve(onSpawn?.(args)).then(() => handlers.close?.(0))
    return child
  },
}))

import { Generator } from './generate.ts'

// 1x1 transparent PNG — the download writes bytes verbatim; validity is irrelevant here.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  'base64',
)

const BASE = 'http://fixtures.test'
const STATE_FILE = '_art-state.json'
let assetsDir: string
let notesPath: string
let onGenerated: Mock<() => void>
let fetchMock: Mock

// fetch stub: 200 for exactly the listed pose filenames (e.g. 'turdus-merula' for the
// perched pose, 'turdus-merula-2' for flight), 404 for everything else.
function stubFetch(presentPoses: string[]) {
  fetchMock = vi.fn(async (url: string) => {
    const name = url.match(/\/illustrations\/(.+)\.png$/)?.[1]
    if (name && presentPoses.includes(name)) {
      // Slice by offset+length, not `.buffer`: a Buffer from a small base64 string
      // sits in Node's shared pool, so `.buffer` is the whole pool and the bytes
      // written would not be a valid PNG.
      const body = PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength)
      return { ok: true, arrayBuffer: async () => body } as unknown as Response
    }
    return { ok: false, status: 404 } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
}

/** Names the download path asked the repo for, in call order. */
const fetched = () =>
  fetchMock.mock.calls.map(([url]) => (url as string).match(/\/illustrations\/(.+)\.png$/)?.[1])

/** argv of every `--generate` invocation, in call order. */
const generateCalls = () => spawnCalls.filter((a) => a.includes('--generate'))

function makeGen(opts: {
  enabled: boolean
  downloadBaseUrl: string
  generateGapMs?: number
  notesPaths?: string[]
  isDescribed?: (key: string) => boolean
}) {
  onGenerated = vi.fn<() => void>(() => {})
  return new Generator({
    pythonBin: 'python3',
    workerScript: '/fake/worker.py',
    assetsDir,
    cacheDir: join(assetsDir, '.cache'),
    enabled: opts.enabled,
    downloadBaseUrl: opts.downloadBaseUrl,
    notesPaths: opts.notesPaths ?? [notesPath],
    generateGapMs: opts.generateGapMs ?? 0,
    onGenerated,
    isDescribed: opts.isDescribed,
  })
}

const idle = (g: Generator) =>
  vi.waitFor(() => {
    // biome-ignore lint/suspicious/noExplicitAny: reach into private lane state for the test
    const any = g as any
    expect(any.dlBusy).toBe(false)
    expect(any.genBusy).toBe(false)
    expect(any.dlQueue.size).toBe(0)
    expect(any.genQueue.size).toBe(0)
  })

/** Make the pipeline "succeed" by writing the pose file it was asked for. */
function landRenders() {
  onSpawn = async (args) => {
    const i = args.indexOf('--generate')
    if (i === -1) return
    const sci = args[i + 1]?.split('|')[0] ?? ''
    const slug = sci.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const suffix = args[args.indexOf('--poses') + 1] === '2' ? '-2' : ''
    await writeFile(join(assetsDir, `${slug}${suffix}.png`), PNG)
  }
}

interface PoseStateJson {
  downloadMissAt?: number
  generateMissAt?: number
  source?: string
  noteVer?: string
}

const readState = async () =>
  JSON.parse(await readFile(join(assetsDir, STATE_FILE), 'utf8')) as Record<string, PoseStateJson>

const writeState = (state: Record<string, PoseStateJson>) =>
  writeFile(join(assetsDir, STATE_FILE), JSON.stringify(state))

beforeEach(async () => {
  spawnCalls.length = 0
  spawnAtMs.length = 0
  onSpawn = undefined
  assetsDir = await mkdtemp(join(tmpdir(), 'saezuri-gen-'))
  notesPath = join(assetsDir, '_species-notes.json')
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(assetsDir, { recursive: true, force: true })
})

describe('Generator art acquisition', () => {
  it('downloads a complete pair and rebuilds the manifest (no generation key)', async () => {
    stubFetch(['turdus-merula', 'turdus-merula-2'])
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    const files = await readdir(assetsDir)
    expect(files).toContain('turdus-merula.png')
    expect(files).toContain('turdus-merula-2.png')
    // Downloaded art still needs its silhouette built, but never local generation.
    expect(spawnCalls.some((a) => a.includes('--rebuild'))).toBe(true)
    expect(generateCalls()).toHaveLength(0)
    expect(onGenerated).toHaveBeenCalled()
  })

  it('generates only the pose the repo is missing', async () => {
    stubFetch(['turdus-merula']) // perched only; flight 404s
    landRenders()
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(await readdir(assetsDir)).toContain('turdus-merula.png')
    // Exactly one generation, for the flight pose only.
    expect(generateCalls()).toHaveLength(1)
    const gen = generateCalls()[0]
    expect(gen).toContain('Turdus merula|Eurasian Blackbird')
    expect(gen.slice(gen.indexOf('--poses'))).toContain('2')
  })

  it('asks the pipeline for one pose per invocation, perched first', async () => {
    stubFetch([]) // repo has nothing, so both poses are generated
    landRenders()
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    const poses = generateCalls().map((a) => a[a.indexOf('--poses') + 1])
    expect(poses).toEqual(['1', '2'])
    // One species per call, never a batch of several.
    for (const call of generateCalls()) {
      expect(call.filter((a) => a.includes('|'))).toHaveLength(1)
    }
  })

  it('is a no-op for an absent species with no generation key', async () => {
    stubFetch([])
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(await readdir(assetsDir)).not.toContain('turdus-merula.png')
    expect(generateCalls()).toHaveLength(0)
  })

  it('re-downloads only the pose deleted from an existing pair', async () => {
    // The reported bug's happy path: one image removed by hand, the other left alone.
    stubFetch(['turdus-merula', 'turdus-merula-2'])
    await writeFile(join(assetsDir, 'turdus-merula.png'), PNG)
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueueRepairs([{ slug: 'turdus-merula', sci: 'Turdus merula', com: 'Eurasian Blackbird' }])
    await idle(g)

    expect(fetched()).toEqual(['turdus-merula-2'])
    expect(await readdir(assetsDir)).toContain('turdus-merula-2.png')
    expect(spawnCalls.some((a) => a.includes('--generate'))).toBe(false)
  })

  it('downloads but never generates a repair whose species we cannot name', async () => {
    stubFetch([]) // repo has nothing, and we have no scientific name to prompt with
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueueRepairs([{ slug: 'turdus-merula' }])
    await idle(g)

    expect(fetched()).toEqual(['turdus-merula', 'turdus-merula-2'])
    expect(spawnCalls.some((a) => a.includes('--generate'))).toBe(false)
  })

  it('no-ops enqueue when both sources are disabled', async () => {
    stubFetch(['turdus-merula'])
    const g = makeGen({ enabled: false, downloadBaseUrl: '' })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(spawnCalls).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onGenerated).not.toHaveBeenCalled()
  })
})

describe('Generator miss backoff', () => {
  it('remembers a repo miss and stops re-requesting it, across restarts', async () => {
    stubFetch([]) // repo has nothing
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    expect(fetched()).toEqual(['turdus-merula', 'turdus-merula-2'])

    // Same process, next publish: enqueueMissingAssets re-asks and must cost nothing.
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    expect(fetched()).toEqual(['turdus-merula', 'turdus-merula-2'])

    const state = await readState()
    expect(typeof state['turdus-merula'].downloadMissAt).toBe('number')
    expect(typeof state['turdus-merula-2'].downloadMissAt).toBe('number')

    // A fresh Generator over the same directory is a restart.
    fetchMock.mockClear()
    const restarted = makeGen({ enabled: false, downloadBaseUrl: BASE })
    restarted.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(restarted)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries a repo miss once its backoff has expired', async () => {
    const stale = Date.now() - 8 * 24 * 60 * 60 * 1000 // older than the 7d download TTL
    await writeState({
      'turdus-merula': { downloadMissAt: stale },
      'turdus-merula-2': { downloadMissAt: stale },
    })
    stubFetch(['turdus-merula', 'turdus-merula-2'])
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(fetched()).toEqual(['turdus-merula', 'turdus-merula-2'])
    expect(await readdir(assetsDir)).toContain('turdus-merula-2.png')
    // Both poses landed, so neither source's verdict stands any more.
    const state = await readState()
    expect(state['turdus-merula'].downloadMissAt).toBeUndefined()
    expect(state['turdus-merula-2'].downloadMissAt).toBeUndefined()
  })

  it('backs off a pose the model declines rather than regenerating every sweep', async () => {
    stubFetch([]) // repo has nothing; the mocked worker exits 0 without writing anything
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    expect(generateCalls()).toHaveLength(2) // one per pose

    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    expect(generateCalls()).toHaveLength(2) // backed off, not retried

    const state = await readState()
    expect(typeof state['turdus-merula'].generateMissAt).toBe('number')
    expect(typeof state['turdus-merula-2'].generateMissAt).toBe('number')
  })

  it('carries the legacy _misses.json backoff over on upgrade', async () => {
    // Deployments upgrading from the previous format must not re-probe the repo for
    // every species it is already known to lack.
    const recent = Date.now() - 60_000
    await writeFile(
      join(assetsDir, '_misses.json'),
      JSON.stringify({
        download: { 'turdus-merula': recent, 'turdus-merula-2': recent },
        generate: { 'parus-major': recent },
      }),
    )
    stubFetch([])
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(typeof (await readState())['parus-major'].generateMissAt).toBe('number')
  })

  it('does not record a miss when the probe fails transiently', async () => {
    fetchMock = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    vi.stubGlobal('fetch', fetchMock)
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    // Nothing recorded, so the next cycle tries again rather than writing it off.
    const state = await readState().catch(() => ({}) as Awaited<ReturnType<typeof readState>>)
    expect(state['turdus-merula']?.downloadMissAt).toBeUndefined()
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2)
  })

  it('treats a malformed state file as empty rather than skipping every pose', async () => {
    await writeFile(join(assetsDir, STATE_FILE), 'not json at all')
    stubFetch(['turdus-merula'])
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(fetched()).toContain('turdus-merula')
    expect(await readdir(assetsDir)).toContain('turdus-merula.png')
  })
})

describe('Generator lanes', () => {
  it('acquires repo art while the generate lane is busy', async () => {
    stubFetch(['parus-major', 'parus-major-2'])
    // Block the generate lane until we release it.
    let release: () => void = () => {}
    const blocked = new Promise<void>((r) => {
      release = r
    })
    onSpawn = async (args) => {
      if (args.includes('--generate')) await blocked
    }

    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird') // repo has nothing → generate lane
    g.enqueue('Parus major', 'Great Tit') // repo has both → download lane

    // The repo-supplied species lands without waiting for the render.
    await vi.waitFor(async () => {
      const files = await readdir(assetsDir)
      expect(files).toContain('parus-major.png')
      expect(files).toContain('parus-major-2.png')
    })
    expect(generateCalls().length).toBeGreaterThan(0) // render genuinely still in flight

    release()
    await idle(g)
  })

  // Real timers, not fake ones: the lanes await real fs reads and writes, which fake
  // timers do not drive, so advancing them races the state file instead of the gap.
  it('paces successive generations by the configured gap', async () => {
    const GAP_MS = 120
    stubFetch([])
    landRenders()
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE, generateGapMs: GAP_MS })
    const startedMs = Date.now()
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(generateCalls()).toHaveLength(2)
    // Each call waits out a gap: the first after enqueue, the second after the first.
    expect(spawnAtMs[0] - startedMs).toBeGreaterThanOrEqual(GAP_MS)
    expect(spawnAtMs[1] - spawnAtMs[0]).toBeGreaterThanOrEqual(GAP_MS)
  })

  it('does not pace when the gap is zero', async () => {
    stubFetch([])
    landRenders()
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE, generateGapMs: 0 })
    const startedMs = Date.now()
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(generateCalls()).toHaveLength(2)
    // Generous on purpose: this only has to distinguish "no gap" from the 6s-per-pose
    // production default, so it must not fail merely because the machine is loaded.
    expect(Date.now() - startedMs).toBeLessThan(2_000)
  })
})

describe('Generator species notes', () => {
  const noteFile = (notes: Record<string, string>) => writeFile(notesPath, JSON.stringify(notes))

  it('re-renders generated art when its note changes', async () => {
    stubFetch([]) // nothing in the repo → both poses generated locally
    landRenders()
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    const before = generateCalls().length
    expect((await readState())['turdus-merula'].source).toBe('generated')

    await noteFile({ 'Turdus merula': 'darker bill, rounder head' })
    const g2 = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g2.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g2)

    const forced = generateCalls()
      .slice(before)
      .filter((a) => a.includes('--force'))
    expect(forced.length).toBeGreaterThan(0)
    expect(forced[0]).toContain('Turdus merula|Eurasian Blackbird')
  })

  it('leaves repo art alone when a note is added for it', async () => {
    stubFetch(['turdus-merula', 'turdus-merula-2'])
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    expect((await readState())['turdus-merula'].source).toBe('repo')
    const before = generateCalls().length

    await noteFile({ 'turdus-merula': 'darker bill' })
    const g2 = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g2.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g2)

    // The repo is authoritative: a note must not silently replace its art.
    expect(generateCalls()).toHaveLength(before)
  })

  it('does not re-render when the note is unchanged', async () => {
    await noteFile({ 'Turdus merula': 'darker bill' })
    stubFetch([])
    landRenders()
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    const before = generateCalls().length

    const g2 = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g2.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g2)
    expect(generateCalls()).toHaveLength(before)
  })

  it('retries a forced re-render that produced nothing', async () => {
    stubFetch([])
    landRenders()
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    // A note arrives, and the forced render fails, leaving the old file untouched.
    await writeFile(notesPath, JSON.stringify({ 'Turdus merula': 'darker bill' }))
    onSpawn = async (args) => {
      if (args.includes('--force')) return // the render fails; the old file survives
    }
    const g2 = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g2.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g2)

    // The failure must not be recorded as success under the new note, or it would
    // never be attempted again.
    expect((await readState())['turdus-merula'].noteVer).toBeUndefined()

    // So a later cycle tries again.
    const before = generateCalls().length
    const g3 = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g3.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g3)
    expect(generateCalls().length).toBeGreaterThan(before)
  })

  it('passes every notes layer to the pipeline', async () => {
    stubFetch([])
    landRenders()
    const bundled = join(assetsDir, 'bundled-notes.json')
    await writeFile(bundled, '{}')
    const g = makeGen({
      enabled: true,
      downloadBaseUrl: BASE,
      notesPaths: [bundled, notesPath],
    })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    const gen = generateCalls()[0]
    expect(gen.filter((a) => a === '--notes')).toHaveLength(2)
    expect(gen).toContain(bundled)
    expect(gen).toContain(notesPath)
  })
})

describe('Generator corrupt-art diagnosis', () => {
  const logged: string[] = []
  beforeEach(() => {
    logged.length = 0
    vi.spyOn(console, 'log').mockImplementation((m: unknown) => {
      logged.push(String(m))
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const complaints = () => logged.filter((l) => l.includes('layout manifest keeps rejecting'))

  // Only Date is faked: faking timers wholesale breaks the real fs the lanes await.
  const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))

  it('reports art the manifest keeps rejecting, once the manifest has had time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      stubFetch(['turdus-merula', 'turdus-merula-2'])
      // The manifest never describes it — what a corrupt PNG looks like from here.
      const g = makeGen({ enabled: false, downloadBaseUrl: BASE, isDescribed: () => false })

      // Cycle 1 downloads the art, so it sights nothing yet.
      g.enqueue('Turdus merula', 'Eurasian Blackbird')
      await idle(g)
      expect(complaints()).toHaveLength(0)

      // A burst of cycles right after it lands must stay quiet: the manifest is simply
      // behind, which is indistinguishable from corruption at this point.
      for (let i = 0; i < 3; i++) {
        g.enqueue('Turdus merula', 'Eurasian Blackbird')
        await idle(g)
      }
      expect(complaints()).toHaveLength(0)

      // Still undescribed a couple of minutes later — now it is a real problem.
      advance(150_000)
      g.enqueue('Turdus merula', 'Eurasian Blackbird')
      await idle(g)
      expect(complaints().length).toBeGreaterThan(0)

      // Reported once, not on every cycle from here on.
      const after = complaints().length
      advance(150_000)
      g.enqueue('Turdus merula', 'Eurasian Blackbird')
      await idle(g)
      expect(complaints()).toHaveLength(after)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays quiet for art the manifest does describe', async () => {
    stubFetch(['turdus-merula', 'turdus-merula-2'])
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE, isDescribed: () => true })
    for (let i = 0; i < 3; i++) {
      g.enqueue('Turdus merula', 'Eurasian Blackbird')
      await idle(g)
    }
    expect(complaints()).toHaveLength(0)
  })

  it('stays quiet while the manifest is merely catching up', async () => {
    stubFetch(['turdus-merula', 'turdus-merula-2'])
    // Absent on the first look, described by the time it is asked again — the normal
    // lag between art landing and the next publish.
    let described = false
    const g = makeGen({
      enabled: false,
      downloadBaseUrl: BASE,
      isDescribed: () => described,
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      g.enqueue('Turdus merula', 'Eurasian Blackbird') // downloads
      await idle(g)
      g.enqueue('Turdus merula', 'Eurasian Blackbird') // first sighting, undescribed
      await idle(g)
      described = true
      // Long enough that a time-gated warning would have fired had it stayed absent.
      advance(150_000)
      for (let i = 0; i < 3; i++) {
        g.enqueue('Turdus merula', 'Eurasian Blackbird')
        await idle(g)
      }
      expect(complaints()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
