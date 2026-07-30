import type { LayoutManifest } from './manifest.ts'
import { slugify } from './slug.ts'

// Maps a detected species to a cutout asset + the manifest key used to pack it.
// Pure: the flight-pose coin flip is decided by the caller (so randomness and
// per-session persistence stay out of this module) and passed in as
// `prefersFlight`. A species with no matching art borrows the generic fallback
// silhouette so it is still shown, labelled, and sized by its real count.

/** Where the cutout PNGs are served from (public/assets/illustrations). */
export const ILLUSTRATIONS_BASE = '/assets/illustrations'

/** Chance a bird is shown in its flight pose, when a flight render exists.
 *  Matches AvianVisitors' FLY_PROB. */
export const FLY_PROB = 0.15

export interface SpeciesArt {
  /** Manifest key for dims/mask lookup (may be a `-2` flight key or fallback). */
  key: string
  /** Same-origin PNG URL. */
  imageUrl: string
  /** False when the generic fallback is used (no matching art). */
  illustrated: boolean
  pose: 1 | 2
}

export function imagePath(key: string, ver?: string): string {
  const url = `${ILLUSTRATIONS_BASE}/${key}.png`
  // `?v=<hash>` busts the immutable cache when a same-named image is regenerated;
  // an unchanged image keeps its URL and stays cached.
  return ver ? `${url}?v=${ver}` : url
}

/** True when the species has its own illustration in the manifest (its perched key,
 *  the one `resolveArt` anchors on). Used to gate what's *shown*. */
export function hasArt(manifest: LayoutManifest, scientificName: string): boolean {
  return slugify(scientificName) in manifest.masks
}

/** True when the species is fully illustrated — BOTH the perched and flight poses are
 *  present. This is the gate for *generation*: a species needs art until it's complete,
 *  so a half-deleted pair regenerates its missing pose. */
export function isComplete(manifest: LayoutManifest, scientificName: string): boolean {
  const base = slugify(scientificName)
  return base in manifest.masks && `${base}-2` in manifest.masks
}

/** Roll for the flight pose. Injectable RNG keeps callers testable. */
export function rollFlight(random: () => number = Math.random): boolean {
  return random() < FLY_PROB
}

export function resolveArt(
  manifest: LayoutManifest,
  scientificName: string,
  prefersFlight: boolean,
): SpeciesArt {
  const base = slugify(scientificName)

  if (!(base in manifest.masks)) {
    const key = manifest.fallbackKey
    return { key, imageUrl: imagePath(key, manifest.ver?.[key]), illustrated: false, pose: 1 }
  }

  const flightKey = `${base}-2`
  if (prefersFlight && flightKey in manifest.masks) {
    return {
      key: flightKey,
      imageUrl: imagePath(flightKey, manifest.ver?.[flightKey]),
      illustrated: true,
      pose: 2,
    }
  }
  return { key: base, imageUrl: imagePath(base, manifest.ver?.[base]), illustrated: true, pose: 1 }
}
