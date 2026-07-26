import { presetToSegment, type WindowPreset } from './domain/window.ts'

// Centralized route layout. The collage lives under its own base so sibling
// feature areas can hang off their own bases later; keeping every route string
// here means the URL shape is changed in one place.

/** Base path for the collage feature area. */
export const COLLAGE_BASE = '/collage'

/** Route pattern for a collage window, e.g. `/collage/:window`. */
export const COLLAGE_ROUTE = `${COLLAGE_BASE}/:window`

/** Full path for a collage window, e.g. `collagePath('24H') === '/collage/24h'`. */
export function collagePath(preset: WindowPreset): string {
  return `${COLLAGE_BASE}/${presetToSegment(preset)}`
}
