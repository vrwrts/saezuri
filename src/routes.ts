import { presetToSegment, type WindowPreset } from './domain/window.ts'

// Centralized route layout. The collage is the app's only view, so each time
// window is addressed directly at the root (`/1h`, `/24h`, …) with no base
// segment. Keeping every route string here means the URL shape is changed in
// one place.

/** Route pattern for a collage window, e.g. `/:window`. */
export const COLLAGE_ROUTE = '/:window'

/** Full path for a collage window, e.g. `collagePath('24H') === '/24h'`. */
export function collagePath(preset: WindowPreset): string {
  return `/${presetToSegment(preset)}`
}
