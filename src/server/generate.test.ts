import { mkdtemp, readdir, rm } from 'node:fs/promises'
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

// fetch stub: 200 for the perched pose of "present" slugs, 404 for everything else.
function stubFetch(presentSlugs: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const m = url.match(/\/illustrations\/(.+)\.png$/)
      const name = m?.[1]
      if (name && presentSlugs.includes(name)) {
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
  it('downloads a present species and rebuilds the manifest (no Gemini key)', async () => {
    stubFetch(['turdus-merula'])
    const g = makeGen({ enabled: false, downloadBaseUrl: BASE })
    g.enqueue('Turdus merula', 'Eurasian Blackbird')
    await idle(g)

    expect(await readdir(assetsDir)).toContain('turdus-merula.png')
    // Manifest rebuilt (download-only path), never Gemini generation.
    expect(spawnCalls.some((a) => a.includes('--rebuild'))).toBe(true)
    expect(spawnCalls.some((a) => a.includes('--generate'))).toBe(false)
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
