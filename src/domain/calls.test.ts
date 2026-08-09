import { describe, expect, it } from 'vitest'
import { type CallManifest, type CallRecord, callFor, callPath } from './calls.ts'

const REC: CallRecord = {
  ext: 'mp3',
  ver: 'a1b2c3',
  recordist: 'A. Recordist',
  license: 'CC BY-SA 4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.mp3',
  sourceName: 'Wikimedia Commons',
}

describe('callPath', () => {
  it('slugifies the scientific name and keeps the published extension', () => {
    expect(callPath('Turdus merula', REC)).toBe('/assets/calls/turdus-merula.mp3?v=a1b2c3')
    expect(callPath('Turdus merula', { ...REC, ext: 'ogg' })).toBe(
      '/assets/calls/turdus-merula.ogg?v=a1b2c3',
    )
  })

  it('omits the cache-bust when the record carries no version', () => {
    expect(callPath('Turdus merula', { ...REC, ver: '' })).toBe('/assets/calls/turdus-merula.mp3')
  })
})

describe('callFor', () => {
  const manifest: CallManifest = { calls: { 'turdus-merula': REC } }

  it('resolves a species to its recording by slug', () => {
    expect(callFor(manifest, 'Turdus merula')).toEqual(REC)
  })

  it('returns null for a species with no recording', () => {
    expect(callFor(manifest, 'Sitta europaea')).toBeNull()
  })

  it('returns null against an empty manifest', () => {
    expect(callFor({ calls: {} }, 'Turdus merula')).toBeNull()
  })
})
