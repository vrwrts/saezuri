import type { LayoutManifest } from '../domain/manifest.ts'
import type { Species } from '../domain/species.ts'

// Dev-only: synthesize a plausible Species[] from whatever illustrations the
// local manifest contains, so the collage can be exercised without a live
// BirdNET-Go. Enabled via the VITE_MOCK env flag (see App). Counts follow a
// Zipf-ish curve so the size hierarchy is visible.

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function mockSpecies(manifest: LayoutManifest, count = 20): Species[] {
  const bases = Object.keys(manifest.masks)
    .filter((k) => k !== manifest.fallbackKey && !k.endsWith('-2'))
    .sort()
  const chosen = bases.slice(0, count)
  // If the local manifest has no real art (fallback-only), still show something.
  if (chosen.length === 0) {
    return Array.from({ length: 6 }, (_, i) => ({
      sci: `Mystery bird ${i + 1}`,
      com: `Mystery bird ${i + 1}`,
      n: Math.max(1, Math.round(60 / (i + 1))),
    }))
  }
  return chosen.map((slug, i) => ({
    sci: slug,
    com: titleCase(slug),
    n: Math.max(1, Math.round(240 / (i + 1))),
  }))
}
