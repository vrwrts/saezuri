import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchAssetRemovals } from './watchAssets.ts'

let dir: string
let stop: (() => void) | undefined
const OPTS = { debounceMs: 10, rearmMs: 50 }
const settle = () => new Promise((r) => setTimeout(r, 80))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'saezuri-watch-'))
})
afterEach(async () => {
  stop?.()
  stop = undefined
  await rm(dir, { recursive: true, force: true })
})

describe('watchAssetRemovals', () => {
  it('fires on a .png removal', async () => {
    const png = join(dir, 'turdus-merula.png')
    await writeFile(png, 'x')
    const onRemoval = vi.fn()
    stop = watchAssetRemovals(dir, onRemoval, OPTS)

    await rm(png)
    await vi.waitFor(() => expect(onRemoval).toHaveBeenCalled())
  })

  it('ignores a .png being created/replaced (no write→heal loop)', async () => {
    const onRemoval = vi.fn()
    stop = watchAssetRemovals(dir, onRemoval, OPTS)

    // Mimic the generator's atomic write: the target exists afterwards.
    await writeFile(join(dir, 'parus-major.png'), 'x')
    await settle()
    expect(onRemoval).not.toHaveBeenCalled()
  })

  it('ignores .png.tmp churn', async () => {
    const onRemoval = vi.fn()
    stop = watchAssetRemovals(dir, onRemoval, OPTS)

    const tmp = join(dir, 'parus-major.png.tmp')
    await writeFile(tmp, 'x')
    await rm(tmp) // a .tmp came and went; not a real cutout
    await settle()
    expect(onRemoval).not.toHaveBeenCalled()
  })

  it('stops firing after stop()', async () => {
    const a = join(dir, 'a.png')
    await writeFile(a, 'x')
    const onRemoval = vi.fn()
    stop = watchAssetRemovals(dir, onRemoval, OPTS)
    stop()
    stop = undefined

    await rm(a)
    await settle()
    expect(onRemoval).not.toHaveBeenCalled()
  })
})
