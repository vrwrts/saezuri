import { useEffect, useMemo, useState } from 'react'
import {
  LABEL_FONT_FAMILY,
  LABEL_FONT_FILE,
  LABEL_FONT_WEIGHTS,
  labelFont,
} from '../collage/labels/font.ts'
import type { MeasureEm } from '../collage/labels/plan.ts'
import { withBase } from '../lib/basePath.ts'

/** Collage lettering weight. Heavier than the e-ink frames' because the web names
 *  go through the ink filter, which eats into thin strokes. */
export const WEB_LABEL_WEIGHT = 600
/** Below this the handwriting stops reading on screen. */
export const WEB_LABEL_MIN_PX = 9

/** Never hold the collage back longer than this for the face; it lays out on the
 *  fallback's metrics and re-lays out once the face does arrive. */
const FONT_LOAD_TIMEOUT_MS = 3000

/** Em widths are linear in size, so one measurement at this size serves them all. */
const MEASURE_PX = 100
/** Stand-in em width per character where there is no canvas to measure with
 *  (jsdom); keeps layouts sane in tests without pretending to be accurate. */
const FALLBACK_EM_PER_CHAR = 0.5

let fontLoad: Promise<void> | null = null

/** Loaded through the FontFace API rather than a CSS @font-face so the URL goes
 *  through withBase (ingress serves the app under a per-session prefix) and the
 *  file is only fetched when names are on. Never rejects: a failed load just means
 *  the fallback face, which the measurer then measures. */
function loadLabelFont(): Promise<void> {
  if (fontLoad) return fontLoad
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    fontLoad = Promise.resolve()
    return fontLoad
  }
  const face = new FontFace(LABEL_FONT_FAMILY, `url(${withBase(`/${LABEL_FONT_FILE}`)})`, {
    weight: LABEL_FONT_WEIGHTS,
    display: 'swap',
  })
  document.fonts.add(face)
  fontLoad = face.load().then(
    () => undefined,
    () => undefined,
  )
  return fontLoad
}

function createMeasureEm(): MeasureEm {
  const ctx =
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  const cache = new Map<string, number>()
  return (text) => {
    let em = cache.get(text)
    if (em === undefined) {
      if (ctx) {
        ctx.font = labelFont(WEB_LABEL_WEIGHT, MEASURE_PX)
        em = ctx.measureText(text).width / MEASURE_PX
      } else {
        em = text.length * FALLBACK_EM_PER_CHAR
      }
      cache.set(text, em)
    }
    return em
  }
}

export interface LabelFont {
  /** False while the face is loading: lay out now and the plate re-flows when the
   *  real metrics land, which is exactly the jump the gate exists to avoid. */
  ready: boolean
  /** Measures in the label face. A new function (with a fresh cache) whenever the
   *  face's availability changes, so anything memoised on it re-measures. */
  measureEm: MeasureEm
}

export function useLabelFont(enabled: boolean): LabelFont {
  // 0: waiting. 1: timed out on the fallback. 2: the face has loaded.
  const [stage, setStage] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const timer = setTimeout(() => live && setStage((s) => Math.max(s, 1)), FONT_LOAD_TIMEOUT_MS)
    void loadLabelFont().then(() => {
      if (live) setStage(2)
    })
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [enabled])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new measurer per stage is the point
  const measureEm = useMemo(createMeasureEm, [stage])
  return { ready: stage > 0, measureEm }
}
