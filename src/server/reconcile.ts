import { FLIGHT_SUFFIX, isComplete } from '../domain/asset.ts'
import type { LayoutManifest } from '../domain/manifest.ts'
import { slugify } from '../domain/slug.ts'
import type { Species } from '../domain/species.ts'

// Works out which species still owe us art. Pure so the policy is testable
// without a store, a network, or a filesystem.
//
// Three sources, because no single one covers every gap:
//   - recently heard: the rolling 7d store, the only source with live counts;
//   - all-time known: the summary list, which reaches back past the store's
//     7-day horizon (a bird heard a month ago is invisible to the store);
//   - art already on disk: the manifest is rebuilt from the cutout directory, so
//     a slug with only one of its two poses is a gap we can see without having
//     heard the bird at all. This is what repairs an image deleted by hand.

export interface ArtRepair {
  slug: string
  /** Absent when we know the slug but not the species it belongs to; such a
   *  repair may be downloaded but must never be generated (see planArtRepairs). */
  sci?: string
  com?: string
}

export interface PlanArtRepairsInput {
  /** Species heard in the store's window, with live counts. */
  recent: readonly Species[]
  /** All-time species summary — reaches past the store's 7-day horizon. */
  allSpecies: readonly Species[]
  /** Rebuilt from the cutout directory, so its keys are what's on disk. */
  manifest: LayoutManifest
  /** slug -> species, from the published species dictionary. Names a slug found
   *  on disk whose bird is in neither species list. */
  sciBySlug: ReadonlyMap<string, { sci: string; com: string }>
}

/** Every slug in the manifest that has one pose but not the other. */
export function unpairedSlugs(manifest: LayoutManifest): string[] {
  const out = new Set<string>()
  for (const key of Object.keys(manifest.masks)) {
    if (key === manifest.fallbackKey) continue
    const base = key.endsWith(FLIGHT_SUFFIX) ? key.slice(0, -FLIGHT_SUFFIX.length) : key
    if (!base) continue
    if (!(base in manifest.masks) || !(`${base}${FLIGHT_SUFFIX}` in manifest.masks)) out.add(base)
  }
  return [...out]
}

/** The species to hand to the art queue, deduped by slug. Named repairs come
 *  first so a slug we can name never degrades to a download-only one. */
export function planArtRepairs(input: PlanArtRepairsInput): ArtRepair[] {
  const { recent, allSpecies, manifest, sciBySlug } = input
  const out = new Map<string, ArtRepair>()

  for (const s of [...recent, ...allSpecies]) {
    const slug = slugify(s.sci)
    if (!slug || out.has(slug)) continue
    if (isComplete(manifest, s.sci)) continue
    out.set(slug, { slug, sci: s.sci, com: s.com })
  }

  for (const slug of unpairedSlugs(manifest)) {
    if (out.has(slug)) continue
    const named = sciBySlug.get(slug)
    out.set(slug, named ? { slug, sci: named.sci, com: named.com } : { slug })
  }

  return [...out.values()]
}
