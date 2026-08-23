import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Mock the pipeline subprocess: record argv, resolve immediately (code 0). Lets us
// assert whether --rebuild (download-only) or --generate (Gemini) was invoked without
// needing Python.
const spawnCalls: string[][] = []
vi.mock('node:child_process', () => ({
  spawn: (_bin: string, args: string[]) => {
    spawnCalls.push(args)
    const handlers: Record<string, (arg?: unknown) => void> = {}
    const child = {
      on(ev: string, cb: (arg?: unknown) => void) {
        handlers[ev] = cb
        return child
      },
    }
    queueMicrotask(() => handlers.close?.(0))
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
let assetsDir: string
let onGenerated: Mock<() => Promise<void>>

// Pose stems requested since the last stubFetch, in order.
const fetched: string[] = []

// fetch stub: 200 for exactly the listed pose filenames (e.g. 'turdus-merula' for the
// perched pose, 'turdus-merula-2' for flight), 404 for everything else.
function stubFetch(presentPoses: string[]) {
  fetched.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const m = url.match(/\/illustrations\/(.+)\.png$/)
      const name = m?.[1]
      if (name) fetched.push(name)
      if (name && presentPoses.includes(name)) {
        return { ok: true, arrayBuffer: async () => PNG.buffer.slice(0) } as unknown as Response
      }
      return { ok: false, status: 404 } as Response
    }),
  )
}

function makeGen(opts: { enabled: boolean; downloadBaseUrl: string }) {
  onGenerated = vi.fn<() => Promise<void>>(async () => {})
  return new Generator({
    pythonBin: 'python3',
    workerScript: '/fake/worker.py',
    assetsDir,
    cacheDir: join(assetsDir, '.cache'),
    maxPerCycle: 4,
    enabled: opts.enabled,
    downloadBaseUrl: opts.downloadBaseUrl,
    onGenerated,
  })
}

const idle = (g: Generator) =>
  vi.waitFor(() => {
    // biome-ignore lint/suspicious/noExplicitAny: reach into private drain state for the test
    const any = g as any
    expect(any.busy).toBe(false)
    expect(any.queued.size).toBe(0)
  })

beforeEach(async () => {
  spawnCalls.length = 0
  assetsDir = await mkdtemp(join(tmpdir(), 'saezuri-gen-'))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(assetsDir, { recursive: true, force: true })
})

describe('Generator art acquisition', () => {
  it('downloads a complete pair and rebuilds the manifest (no Gemini key)', async () => {
    stubFetch(['turdus-merula', 'turdus-merula-2']) // both poses available in the repo
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    const files = await readdir(assetsDir)
    expect(files).toContain('turdus-merula.png')
    expect(files).toContain('turdus-merula-2.png')
    // Complete via download → manifest rebuilt, never Gemini generation.
    expect(spawnCalls.some((a) => a.includes('--rebuild'))).toBe(true)
    expect(spawnCalls.some((a) => a.includes('--generate'))).toBe(false)
    expect(onGenerated).toHaveBeenCalledTimes(1)
  })

  it('generates only the missing pose when the repo has a partial pair (keyed)', async () => {
    stubFetch(['turdus-merula']) // repo has the perched pose only; flight 404s
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    // Perched downloaded for free, but the pair is incomplete → Gemini fills the gap
    // (pregen skips the pose already on disk).
    expect(await readdir(assetsDir)).toContain('turdus-merula.png')
    const gen = spawnCalls.find((a) => a.includes('--generate'))
    expect(gen).toBeDefined()
    expect(gen).toContain('Turdus merula|Eurasian Blackbird')
    expect(onGenerated).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an absent species with no Gemini key', async () => {
    stubFetch([]) // everything 404s
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(await readdir(assetsDir)).not.toContain('turdus-merula.png')
    expect(spawnCalls).toHaveLength(0) // nothing to rebuild, nothing to generate
    expect(onGenerated).not.toHaveBeenCalled()
  })

  it('falls back to Gemini generation for an absent species when keyed', async () => {
    stubFetch([]) // repo has nothing
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    const gen = spawnCalls.find((a) => a.includes('--generate'))
    expect(gen).toBeDefined()
    expect(gen).toContain('Turdus merula|Eurasian Blackbird')
    expect(onGenerated).toHaveBeenCalledTimes(1)
  })

  it('re-downloads only the pose deleted from an existing pair', async () => {
    // The reported bug's happy path: one image removed by hand, the other left alone.
    stubFetch(['turdus-merula', 'turdus-merula-2'])
    await writeFile(join(assetsDir, 'turdus-merula.png'), PNG)
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueueRepairs([{ slug: 'turdus-merula', sci: 'Turdus merula', com: 'Eurasian Blackbird' }])
    await idle(g)

    expect(fetched).toEqual(['turdus-merula-2'])
    expect(await readdir(assetsDir)).toContain('turdus-merula-2.png')
    expect(spawnCalls.some((a) => a.includes('--generate'))).toBe(false)
  })

  it('downloads but never generates a repair whose species we cannot name', async () => {
    stubFetch([]) // repo has nothing, and we have no scientific name to prompt with
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueueRepairs([{ slug: 'turdus-merula' }])
    await idle(g)

    expect(fetched).toEqual(['turdus-merula', 'turdus-merula-2'])
    expect(spawnCalls.some((a) => a.includes('--generate'))).toBe(false)
  })

  it('remembers a repo miss and stops re-requesting it, across restarts', async () => {
    stubFetch([])
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    expect(fetched).toEqual(['turdus-merula', 'turdus-merula-2'])

    const misses = JSON.parse(await readFile(join(assetsDir, '_misses.json'), 'utf8'))
    expect(Object.keys(misses.download).sort()).toEqual(['turdus-merula', 'turdus-merula-2'])

    fetched.length = 0
    const restarted = makeGen({ enabled: false, downloadBaseUrl: BASE })
    restarted.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(restarted)
    expect(fetched).toEqual([])
  })

  it('retries a repo miss once its backoff has expired', async () => {
    const stale = Date.now() - 8 * 24 * 60 * 60 * 1000 // older than the 7d download TTL
    await writeFile(
      join(assetsDir, '_misses.json'),
      JSON.stringify({ download: { 'turdus-merula': stale, 'turdus-merula-2': stale } }),
    )
    stubFetch(['turdus-merula', 'turdus-merula-2'])
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(fetched).toEqual(['turdus-merula', 'turdus-merula-2'])
    expect(await readdir(assetsDir)).toContain('turdus-merula-2.png')
    const misses = JSON.parse(await readFile(join(assetsDir, '_misses.json'), 'utf8'))
    expect(misses.download).toEqual({}) // both poses landed
  })

  it('backs off a species the model declines rather than regenerating every sweep', async () => {
    stubFetch([]) // repo has nothing; the mocked worker exits 0 without writing anything
    const g = makeGen({ enabled: true, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    expect(spawnCalls.filter((a) => a.includes('--generate'))).toHaveLength(1)

    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)
    expect(spawnCalls.filter((a) => a.includes('--generate'))).toHaveLength(1)

    const misses = JSON.parse(await readFile(join(assetsDir, '_misses.json'), 'utf8'))
    expect(Object.keys(misses.generate).sort()).toEqual(['turdus-merula', 'turdus-merula-2'])
  })

  it('no-ops enqueue when both sources are disabled', async () => {
    stubFetch(['turdus-merula'])
    const g = makeGen({ enabled: false, downloadBaseUrl: '' })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(spawnCalls).toHaveLength(0)
    expect(await readdir(assetsDir)).not.toContain('turdus-merula.png')
    expect(onGenerated).not.toHaveBeenCalled()
  })
})
