import { describe, expect, it } from 'vitest'
import { hasArt, resolveArt } from './asset.ts'
import type { LayoutManifest } from './manifest.ts'

const mask = { w: 2, h: 2, bits: 'AA==' }
const manifest: LayoutManifest = {
  dims: {
    'turdus-merula': [560, 400],
    'turdus-merula-2': [560, 500],
    'parus-major': [400, 560],
    _fallback: [500, 500],
  },
  masks: {
    'turdus-merula': mask,
    'turdus-merula-2': mask,
    'parus-major': mask,
    _fallback: mask,
  },
  fallbackKey: '_fallback',
}

describe('resolveArt', () => {
  it('uses the perched key by default', () => {
    expect(resolveArt(manifest, 'Turdus merula', false)).toEqual({
      key: 'turdus-merula',
      imageUrl: '/assets/illustrations/turdus-merula.png',
      illustrated: true,
      pose: 1,
    })
  })

  it('uses the -2 flight key when a flight render exists and flight is preferred', () => {
    const art = resolveArt(manifest, 'Turdus merula', true)
    expect(art.key).toBe('turdus-merula-2')
    expect(art.pose).toBe(2)
  })

  it('stays perched when no flight render exists even if flight preferred', () => {
    const art = resolveArt(manifest, 'Parus major', true)
    expect(art.key).toBe('parus-major')
    expect(art.pose).toBe(1)
  })

  it('falls back to the generic silhouette for unmatched species', () => {
    const art = resolveArt(manifest, 'Sylvia atricapilla', true)
    expect(art).toEqual({
      key: '_fallback',
      imageUrl: '/assets/illustrations/_fallback.png',
      illustrated: false,
      pose: 1,
    })
  })

  it('appends the content-hash version to the URL when the manifest carries one', () => {
    const versioned: LayoutManifest = { ...manifest, ver: { 'turdus-merula': 'abc12345' } }
    // The keyed image gets `?v=`; a species without a `ver` entry stays unversioned.
    expect(resolveArt(versioned, 'Turdus merula', false).imageUrl).toBe(
      '/assets/illustrations/turdus-merula.png?v=abc12345',
    )
    expect(resolveArt(versioned, 'Parus major', false).imageUrl).toBe(
      '/assets/illustrations/parus-major.png',
    )
  })
})

describe('hasArt', () => {
  it('reflects manifest membership by slug', () => {
    expect(hasArt(manifest, 'Turdus merula')).toBe(true)
    expect(hasArt(manifest, 'Sylvia atricapilla')).toBe(false)
  })
})
