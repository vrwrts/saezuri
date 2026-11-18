// The face the bird names are lettered in, shared by the browser and the e-ink
// renderer so both measure and draw the same glyphs.

export const LABEL_FONT_FAMILY = 'Caveat'
/** Relative to the served html root (`public/` in the repo). */
export const LABEL_FONT_FILE = 'fonts/Caveat.ttf'
/** The variable font's weight axis, declared so either renderer can pick a weight. */
export const LABEL_FONT_WEIGHTS = '400 700'

/** CSS font shorthand for the label face. The generic fallback catches scripts
 *  Caveat lacks, e.g. a station whose own species names aren't in Latin script. */
export function labelFont(weight: number, px: number): string {
  return `${weight} ${px}px ${LABEL_FONT_FAMILY}, cursive`
}
