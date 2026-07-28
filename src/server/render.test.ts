import { describe, expect, it } from 'vitest'
import type { LayoutManifest, MaskRecord } from '../domain/manifest.ts'
import type { Species } from '../domain/species.ts'
import { buildInputs, containRect, frameSignature } from './render.ts'

const mask: MaskRecord = { w: 2, h: 2, bits: '8A==' }
const manifest: LayoutManifest = {
  dims: { 'turdus-merula': [280, 200] },
  masks: { 'turdus-merula': mask, _fallback: mask },
  ver: { 'turdus-merula': 'abc123' },
  fallbackKey: '_fallback',
}

describe('containRect', () => {
  it('is the identity when the image aspect matches the box', () => {
    expect(containRect(2, 0, 0, 200, 100)).toEqual({ x: 0, y: 0, w: 200, h: 100 })
  })

  it('letterboxes a taller image inside the box, centered', () => {
    // arSrc 1 (square) into a 200x100 box → 100x100 centered horizontally.
    expect(containRect(1, 0, 0, 200, 100)).toEqual({ x: 50, y: 0, w: 100, h: 100 })
  })
})

describe('frameSignature', () => {
  const species: Species[] = [{ sci: 'Turdus merula', com: 'Blackbird', n: 3 }]

  it('changes when a count changes', () => {
    const a = frameSignature(species, manifest)
    const b = frameSignature([{ ...species[0], n: 4 }], manifest)
    expect(a).not.toBe(b)
  })

  it('changes when the manifest art version changes', () => {
    const bumped: LayoutManifest = { ...manifest, ver: { 'turdus-merula': 'zzz999' } }
    expect(frameSignature(species, manifest)).not.toBe(frameSignature(species, bumped))
  })
})

describe('buildInputs', () => {
  const species: Species[] = [{ sci: 'Turdus merula', com: 'Blackbird', n: 3 }]

  it('resolves art + aspect and picks a deterministic pose', () => {
    const a = buildInputs(species, manifest)
    const b = buildInputs(species, manifest)
    expect(a[0].ar).toBeCloseTo(280 / 200)
    expect(a[0].key).toBe('turdus-merula')
    // Same species → same pose every render (byte-stable frames).
    expect(a[0].pose).toBe(b[0].pose)
  })
})
