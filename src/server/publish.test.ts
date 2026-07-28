import { describe, expect, it } from 'vitest'
import type { DetectionResponse } from '../api/types.ts'
import type { LayoutManifest, MaskRecord } from '../domain/manifest.ts'
import type { Species } from '../domain/species.ts'
import { buildSnapshot } from './publish.ts'
import { DetectionStore } from './store.ts'

const now = Date.parse('2026-07-08T12:00:00Z')
const H = 3_600_000

const mask: MaskRecord = { w: 1, h: 1, bits: 'AA==' }

// Manifest with art only for Turdus merula (slug turdus-merula) + the fallback.
const manifest: LayoutManifest = {
  dims: {},
  masks: { 'turdus-merula': mask, _fallback: mask },
  fallbackKey: '_fallback',
}

function det(id: number, sci: string, tsMs: number): DetectionResponse {
  return {
    id,
    date: '2026-07-08',
    time: '12:00:00',
    timestamp: new Date(tsMs).toISOString(),
    beginTime: '',
    endTime: '',
    scientificName: sci,
    commonName: sci,
    confidence: 0.9,
    verified: 'unverified',
    locked: false,
  }
}

describe('buildSnapshot', () => {
  it('gates each window to illustrated species and counts the withheld tail', () => {
    const store = new DetectionStore()
    store.seed(
      [
        det(1, 'Turdus merula', now - 0.5 * H), // has art
        det(2, 'Parus major', now - 0.5 * H), // no art → withheld
      ],
      true,
      now - 7 * 24 * H,
    )
    const allSpecies: Species[] = [
      { sci: 'Turdus merula', com: 'Blackbird', n: 10 },
      { sci: 'Parus major', com: 'Great tit', n: 4 },
    ]

    const snap = buildSnapshot({ store, allSpecies, manifest, now })

    const h1 = snap.windows['1h']
    expect(h1.species.map((s) => s.sci)).toEqual(['Turdus merula'])
    expect(h1.heard).toBe(2)
    expect(h1.notIllustrated).toBe(1)

    // ALL window is gated the same way, off the summary species.
    const all = snap.windows.all
    expect(all.species.map((s) => s.sci)).toEqual(['Turdus merula'])
    expect(all.heard).toBe(2)
    expect(all.notIllustrated).toBe(1)

    expect(snap.generatedAt).toBe(now)
  })

  it('emits every window key', () => {
    const snap = buildSnapshot({ store: new DetectionStore(), allSpecies: [], manifest, now })
    expect(Object.keys(snap.windows).sort()).toEqual(['12h', '1h', '24h', '7d', 'all'])
  })
})
