import { FLIGHT_SUFFIX } from '../domain/asset.ts'
import type { CallManifest } from '../domain/calls.ts'
import type { LayoutManifest } from '../domain/manifest.ts'
import { slugify } from '../domain/slug.ts'
import type { Species } from '../domain/species.ts'

// Dev-only: synthesize a plausible Species[] from whatever illustrations the
// local manifest contains, so the collage can be exercised without a live
// BirdNET-Go. Enabled via the VITE_MOCK env flag (see App). Counts follow a
// Zipf-ish curve so the size hierarchy is visible.

/** Slug back to the binomial it was made from: genus capitalized, epithet(s)
 *  lower — "accipiter-gentilis" -> "Accipiter gentilis". The manifest keys are
 *  slugified scientific names, so this recovers real-shaped `sci` values instead
 *  of leaking the slug into the UI. */
function binomial(slug: string): string {
  const [genus, ...epithets] = slug.split('-')
  return [genus.charAt(0).toUpperCase() + genus.slice(1), ...epithets].join(' ')
}

// Common names for the species that sort first, so a mock run shows both title
// states: a localized name with the binomial behind it, and — for everything
// else — the binomial standing alone. Real common names come from BirdNET-Go
// and the species dictionaries; there is no source for them offline.
const MOCK_COMMON_NAMES: Record<string, string> = {
  'Acanthis flammea': 'Common Redpoll',
  'Accipiter cooperii': "Cooper's Hawk",
  'Accipiter gentilis': 'Northern Goshawk',
  'Accipiter striatus': 'Sharp-shinned Hawk',
  'Aix sponsa': 'Wood Duck',
  'Anas platyrhynchos': 'Mallard',
  'Anser albifrons': 'Greater White-fronted Goose',
  'Archilochus colubris': 'Ruby-throated Hummingbird',
  'Ardea herodias': 'Great Blue Heron',
  'Athene noctua': 'Little Owl',
}

/** Spread the synthetic first/last-heard times over roughly a day, so the card's
 *  same-day and multi-day range formats both show up in a mock run. */
const MOCK_SPAN_MS = 26 * 60 * 60 * 1000

function mockHeard(i: number, now: number): Pick<Species, 'firstSeenMs' | 'lastSeenMs'> {
  const lastSeenMs = now - i * 7 * 60 * 1000
  return { firstSeenMs: lastSeenMs - (MOCK_SPAN_MS / (i + 2)) * 0.9, lastSeenMs }
}

export function mockSpecies(manifest: LayoutManifest, count = 20): Species[] {
  const now = Date.now()
  const bases = Object.keys(manifest.masks)
    .filter((k) => k !== manifest.fallbackKey && !k.endsWith(FLIGHT_SUFFIX))
    .sort()
  const chosen = bases.slice(0, count)
  // If the local manifest has no real art (fallback-only), still show something.
  if (chosen.length === 0) {
    return Array.from({ length: 6 }, (_, i) => ({
      sci: `Mystery bird ${i + 1}`,
      com: `Mystery bird ${i + 1}`,
      n: Math.max(1, Math.round(60 / (i + 1))),
      ...mockHeard(i, now),
    }))
  }
  return chosen.map((slug, i) => {
    const sci = binomial(slug)
    return {
      sci,
      com: MOCK_COMMON_NAMES[sci] ?? sci,
      n: Math.max(1, Math.round(240 / (i + 1))),
      ...mockHeard(i, now),
    }
  })
}

// Only the first few species get a recording — most real species have none, and
// the card must be judged in both states. Keep in sync with COUNT in
// mockCalls.mjs, which writes the placeholder audio for exactly these slugs.
const MOCK_CALL_COUNT = 3

const MOCK_CREDITS: readonly Pick<
  CallManifest['calls'][string],
  'by' | 'lic' | 'licUrl' | 'src' | 'srcName'
>[] = [
  {
    by: 'A. Recordist',
    lic: 'CC BY-SA 4.0',
    licUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    src: 'https://commons.wikimedia.org/wiki/Main_Page',
    srcName: 'Wikimedia Commons',
  },
  {
    by: 'B. Fieldworker',
    lic: 'CC BY 4.0',
    licUrl: 'https://creativecommons.org/licenses/by/4.0/',
    src: 'https://commons.wikimedia.org/wiki/Main_Page',
    srcName: 'Wikimedia Commons',
  },
  // No recordist: Commons' extmetadata sometimes carries no Artist, and the
  // credit line has to stay sensible without one.
  {
    by: '',
    lic: 'CC0 1.0',
    licUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    src: 'https://commons.wikimedia.org/wiki/Main_Page',
    srcName: 'Wikimedia Commons',
  },
]

/** Synthesize a call manifest covering the first few mock species. Pairs with
 *  the placeholder audio written by `node src/dev/mockCalls.mjs`. */
export function mockCallManifest(species: readonly Species[]): CallManifest {
  const calls: CallManifest['calls'] = {}
  species.slice(0, MOCK_CALL_COUNT).forEach((s, i) => {
    calls[slugify(s.sci)] = { ext: 'wav', ver: 'mock', ...MOCK_CREDITS[i % MOCK_CREDITS.length] }
  })
  return { calls }
}
