import { describe, expect, it } from 'vitest'
import { computeLayout } from '../collage/layout.ts'
import { decodeMask } from '../collage/pack.ts'
import { resolveArt } from '../domain/asset.ts'
import { DEFAULT_MANIFEST } from './useLayoutManifest.ts'

// Guards the committed built-in manifest: its base64 mask must be valid (a
// corrupted literal previously blanked the whole app on first render) and the
// fallback must pack. This runs without the gitignored generated manifest.
describe('DEFAULT_MANIFEST', () => {
  it('has a fallback key present in both dims and masks', () => {
    const { fallbackKey, dims, masks } = DEFAULT_MANIFEST
    expect(fallbackKey in dims).toBe(true)
    expect(fallbackKey in masks).toBe(true)
  })

  it('decodes to a non-empty silhouette (valid base64)', () => {
    const rec = DEFAULT_MANIFEST.masks[DEFAULT_MANIFEST.fallbackKey]
    const decoded = decodeMask(rec)
    expect(decoded.cells.length).toBeGreaterThan(0)
    // A truncated/invalid base64 would degrade to a solid rectangle — assert we
    // did NOT hit that path (the real silhouette is smaller than full coverage).
    expect(decoded.cells.length).toBeLessThan(rec.w * rec.h)
  })

  it('lays out unmatched species via the fallback without throwing', () => {
    const art = resolveArt(DEFAULT_MANIFEST, 'Turdus merula', false)
    expect(art.illustrated).toBe(false)
    const mask = decodeMask(DEFAULT_MANIFEST.masks[art.key])
    const tiles = computeLayout(
      [
        {
          sci: 'Turdus merula',
          com: 'Blackbird',
          n: 3,
          key: art.key,
          imageUrl: art.imageUrl,
          illustrated: false,
          pose: 1,
          mask,
          ar: 560 / 460,
        },
      ],
      { width: 1000, height: 700 },
    )
    expect(tiles).toHaveLength(1)
    expect(tiles[0].parked).toBe(false)
  })
})
