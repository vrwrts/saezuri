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

export function imagePath(key: string): string {
  return `${ILLUSTRATIONS_BASE}/${key}.png`
}

/** True when the species has its own illustration in the manifest. */
export function hasArt(manifest: LayoutManifest, scientificName: string): boolean {
  return slugify(scientificName) in manifest.masks
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
    return { key, imageUrl: imagePath(key), illustrated: false, pose: 1 }
  }

  const flightKey = `${base}-2`
  if (prefersFlight && flightKey in manifest.masks) {
    return { key: flightKey, imageUrl: imagePath(flightKey), illustrated: true, pose: 2 }
  }
  return { key: base, imageUrl: imagePath(base), illustrated: true, pose: 1 }
}
