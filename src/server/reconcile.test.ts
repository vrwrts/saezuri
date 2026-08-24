import { describe, expect, it } from 'vitest'
import type { LayoutManifest } from '../domain/manifest.ts'
import type { Species } from '../domain/species.ts'
import { planArtRepairs, unpairedSlugs } from './reconcile.ts'

const MASK = { w: 1, h: 1, bits: '' }

/** A manifest describing exactly the given keys, as build_masks would from disk. */
function manifestOf(...keys: string[]): LayoutManifest {
  const masks: LayoutManifest['masks'] = { _fallback: MASK }
  const dims: LayoutManifest['dims'] = { _fallback: [1, 1] }
  for (const k of keys) {
    masks[k] = MASK
    dims[k] = [1, 1]
  }
  return { dims, masks, fallbackKey: '_fallback' }
}

const species = (sci: string, com: string): Species => ({ sci, com, n: 1 })

const EMPTY_NAMES = new Map<string, { sci: string; com: string }>()

const plan = (input: Partial<Parameters<typeof planArtRepairs>[0]>) =>
  planArtRepairs({
    recent: [],
    allSpecies: [],
    manifest: manifestOf(),
    sciBySlug: EMPTY_NAMES,
    ...input,
  })

describe('unpairedSlugs', () => {
  it('finds a slug missing either pose and ignores complete pairs and the fallback', () => {
    const manifest = manifestOf('turdus-merula', 'pica-pica', 'pica-pica-2', 'grus-grus-2')
    expect(unpairedSlugs(manifest).sort()).toEqual(['grus-grus', 'turdus-merula'])
  })
})

describe('planArtRepairs', () => {
  it('repairs a half-illustrated species heard too long ago to be in either list', () => {
    // The reported bug: a pose deleted by hand for a bird outside the 7d store.
    expect(plan({ manifest: manifestOf('turdus-merula') })).toEqual([{ slug: 'turdus-merula' }])
  })

  it('names a disk-only slug from the species dictionary so it can be generated', () => {
    const repairs = plan({
      manifest: manifestOf('turdus-merula'),
      sciBySlug: new Map([['turdus-merula', { sci: 'Turdus merula', com: 'Eurasian Blackbird' }]]),
    })
    expect(repairs).toEqual([
      { slug: 'turdus-merula', sci: 'Turdus merula', com: 'Eurasian Blackbird' },
    ])
  })

  it('enqueues a species known only from the all-time summary', () => {
    expect(plan({ allSpecies: [species('Grus grus', 'Common Crane')] })).toEqual([
      { slug: 'grus-grus', sci: 'Grus grus', com: 'Common Crane' },
    ])
  })

  it('skips species that already have both poses', () => {
    expect(
      plan({
        recent: [species('Pica pica', 'Eurasian Magpie')],
        manifest: manifestOf('pica-pica', 'pica-pica-2'),
      }),
    ).toEqual([])
  })

  it('prefers the named source over the disk scan for the same slug', () => {
    const repairs = plan({
      recent: [species('Turdus merula', 'Merel')],
      manifest: manifestOf('turdus-merula'),
    })
    expect(repairs).toEqual([{ slug: 'turdus-merula', sci: 'Turdus merula', com: 'Merel' }])
  })
})
