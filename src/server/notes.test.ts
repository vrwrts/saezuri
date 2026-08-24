import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadNotes, noteFor, noteVersion } from './notes.ts'

let dir: string
const write = async (name: string, body: unknown) => {
  const path = join(dir, name)
  await writeFile(path, typeof body === 'string' ? body : JSON.stringify(body))
  return path
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'saezuri-notes-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadNotes', () => {
  it('is empty with no paths', async () => {
    expect(await loadNotes([])).toEqual({})
  })

  it('ignores a missing file', async () => {
    expect(await loadNotes([join(dir, 'nope.json')])).toEqual({})
  })

  it('drops comment keys and non-string values', async () => {
    const p = await write('n.json', {
      'Turdus merula': 'keep me',
      _comment: 'drop me',
      'Parus major': { not: 'a string' },
      'Erithacus rubecula': 42,
    })
    expect(await loadNotes([p])).toEqual({ 'Turdus merula': 'keep me' })
  })

  it('layers later files over earlier ones per key', async () => {
    const bundled = await write('bundled.json', { a: 'from bundled', b: 'only bundled' })
    const operator = await write('operator.json', { a: 'from operator', c: 'only operator' })
    expect(await loadNotes([bundled, operator])).toEqual({
      a: 'from operator',
      b: 'only bundled',
      c: 'only operator',
    })
  })

  it('is idempotent when a layer is passed twice', async () => {
    // The pipeline prepends the bundled layer itself, so the service passing it too
    // means it appears twice. That has to be a no-op.
    const bundled = await write('bundled.json', { a: 'bundled' })
    const operator = await write('operator.json', { a: 'operator' })
    expect(await loadNotes([bundled, bundled, operator])).toEqual(
      await loadNotes([bundled, operator]),
    )
  })

  it('skips a malformed file instead of failing the load', async () => {
    const bad = await write('bad.json', '{ not json')
    const good = await write('good.json', { a: 'kept' })
    expect(await loadNotes([bad, good])).toEqual({ a: 'kept' })
  })

  it('skips a file that is not a JSON object', async () => {
    const arr = await write('arr.json', ['not', 'an', 'object'])
    const good = await write('good.json', { a: 'kept' })
    expect(await loadNotes([arr, good])).toEqual({ a: 'kept' })
  })
})

describe('noteFor', () => {
  it('resolves a scientific-name key', () => {
    expect(noteFor({ 'Turdus merula': 'n' }, 'Turdus merula')).toBe('n')
  })

  it('resolves a slug key', () => {
    expect(noteFor({ 'turdus-merula': 'n' }, 'Turdus merula')).toBe('n')
  })

  it('prefers the scientific name over the slug', () => {
    expect(noteFor({ 'Turdus merula': 'sci', 'turdus-merula': 'slug' }, 'Turdus merula')).toBe(
      'sci',
    )
  })

  it('is undefined for a species with no note', () => {
    expect(noteFor({ 'Parus major': 'n' }, 'Turdus merula')).toBeUndefined()
  })
})

describe('noteVersion', () => {
  it('distinguishes no note from any note', () => {
    expect(noteVersion(undefined)).toBeUndefined()
    expect(noteVersion('')).toBeDefined()
  })

  it('is stable for the same note and differs for a changed one', () => {
    expect(noteVersion('darker bill')).toBe(noteVersion('darker bill'))
    expect(noteVersion('darker bill')).not.toBe(noteVersion('darker bill.'))
  })
})
