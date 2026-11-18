import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createCanvas,
  GlobalFonts,
  type Image,
  loadImage,
  type SKRSContext2D,
} from '@napi-rs/canvas'
import { LABEL_FONT_FAMILY, labelFont } from '../collage/labels/font.ts'
import type { MeasureEm } from '../collage/labels/plan.ts'
import { computeLayout, type LayoutInput } from '../collage/layout.ts'
import { decodeMaskCached } from '../collage/pack.ts'
import { resolveArt, rollFlight } from '../domain/asset.ts'
import type { LayoutManifest } from '../domain/manifest.ts'
import type { Species } from '../domain/species.ts'
import { fnv1a } from '../lib/hash.ts'
import { createPrng } from '../lib/prng.ts'
import { placeGlyphs } from './textPath.ts'

// Frame compositor: renders a window's gated species into a fixed-size PNG for
// the e-ink display, reusing the browser's deterministic layout (computeLayout)
// and compositing the cutout PNGs with @napi-rs/canvas. No UI chrome — just the
// birds on the background. drawImage = CSS object-fit:contain; ctx.shadow* = the
// tile's drop-shadow; fillRect = the --paper background.

export interface FrameOptions {
  width: number
  height: number
  background: string
  shadow: boolean
  /** Directory holding the cutout PNGs (htmlDir/assets/illustrations). */
  assetsDir: string
  /** Letter each bird's name beside it, as the collage does (BIRD_NAMES). */
  birdNames: boolean
  /** The bundled label face (htmlDir/fonts/Caveat.ttf). */
  fontPath: string
}

/** Panel lettering is solid ink at the face's regular weight: an e-ink panel
 *  quantises the web's filtered, heavier ink into ragged strokes. */
const FRAME_LABEL_WEIGHT = 400
/** Smallest name a panel still resolves; finer than the browser can go. */
const FRAME_LABEL_MIN_PX = 11
/** The theme's --ink for a light frame and for a dark one, picked by background. */
const FRAME_INK_ON_LIGHT = '#1a1612'
const FRAME_INK_ON_DARK = '#ece8e1'
/** Relative luminance above which a background counts as light. */
const LIGHT_BACKGROUND_LUMINANCE = 0.5
const MEASURE_PX = 100

/** Light-theme --tile-shadow: drop-shadow(0 2px 6px rgba(26,22,18,0.1)). */
const SHADOW = { color: 'rgba(26,22,18,0.1)', blur: 6, offsetY: 2 }
const DEFAULT_AR = 1.4

/** Stable seed per species so its pose holds across renders (no e-ink churn),
 *  while ~FLY_PROB of the roster still fly. */
function seedFor(sci: string): number {
  return fnv1a(sci)
}

/** Species[] → LayoutInput[] (mirrors Collage.tsx), with a deterministic pose so
 *  the frame is byte-stable across renders of the same data. */
export function buildInputs(species: readonly Species[], manifest: LayoutManifest): LayoutInput[] {
  return species.map((s) => {
    const prefersFlight = rollFlight(createPrng(seedFor(s.sci)))
    const art = resolveArt(manifest, s.sci, prefersFlight)
    const mask = decodeMaskCached(art.key, manifest.masks[art.key])
    const dim = manifest.dims[art.key]
    const ar = dim ? dim[0] / dim[1] : DEFAULT_AR
    return {
      sci: s.sci,
      com: s.com,
      n: s.n,
      key: art.key,
      imageUrl: art.imageUrl,
      illustrated: art.illustrated,
      pose: art.pose,
      mask,
      ar,
    }
  })
}

/** object-fit: contain — fit an image of aspect `arSrc` into the tile box,
 *  centered. Near-identity here since the box aspect is the cutout's aspect. */
export function containRect(
  arSrc: number,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const arBox = w / h
  let dw = w
  let dh = h
  if (arSrc > arBox) dh = w / arSrc
  else dw = h * arSrc
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh }
}

/** A fingerprint of everything that affects the rendered pixels (species,
 *  counts, and the manifest's art versions), so the caller can skip rewriting an
 *  unchanged frame — avoiding needless e-ink refreshes. */
export function frameSignature(
  species: readonly Species[],
  manifest: LayoutManifest,
  birdNames: boolean,
): string {
  // The name is only drawn, and so only matters, when names are on.
  const sp = species.map((s) => `${s.sci}:${s.n}${birdNames ? `:${s.com}` : ''}`).join(',')
  const ver = manifest.ver
  const verStr = ver
    ? Object.keys(ver)
        .sort()
        .map((k) => `${k}=${ver[k]}`)
        .join('')
    : ''
  const vh = fnv1a(verStr).toString(36)
  return `${Object.keys(manifest.masks).length}:${vh}${birdNames ? ':names' : ''}|${sp}`
}

let registeredFont: string | null = null

/** Register the label face with the canvas once per path. A missing file isn't
 *  fatal: the canvas measures and draws its default face instead, consistently. */
function ensureLabelFont(path: string): void {
  if (registeredFont === path) return
  registeredFont = path
  if (!GlobalFonts.registerFromPath(path, LABEL_FONT_FAMILY)) {
    console.error(`saezuri-refresh: label font not found at ${path}; names use a default face`)
  }
}

function frameMeasureEm(ctx: SKRSContext2D): MeasureEm {
  const cache = new Map<string, number>()
  return (text) => {
    let em = cache.get(text)
    if (em === undefined) {
      ctx.font = labelFont(FRAME_LABEL_WEIGHT, MEASURE_PX)
      em = ctx.measureText(text).width / MEASURE_PX
      cache.set(text, em)
    }
    return em
  }
}

/** Ink that reads on the configured background, which may be a dark panel's. */
export function inkFor(background: string): string {
  const hex = /^#?([0-9a-f]{6})$/i.exec(background.trim())?.[1]
  if (!hex) return FRAME_INK_ON_LIGHT
  // WCAG relative luminance: linearise each sRGB channel, then weight it.
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > LIGHT_BACKGROUND_LUMINANCE ? FRAME_INK_ON_LIGHT : FRAME_INK_ON_DARK
}

/** Composite a window's species into a PNG buffer. */
export async function renderFrame(
  species: readonly Species[],
  manifest: LayoutManifest,
  opts: FrameOptions,
): Promise<Buffer> {
  const canvas = createCanvas(opts.width, opts.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = opts.background
  ctx.fillRect(0, 0, opts.width, opts.height)

  if (opts.birdNames) ensureLabelFont(opts.fontPath)
  const inputs = buildInputs(species, manifest)
  const tiles = computeLayout(
    inputs,
    { width: opts.width, height: opts.height },
    opts.birdNames ? { labels: { measureEm: frameMeasureEm(ctx), minPx: FRAME_LABEL_MIN_PX } } : {},
  ).filter((t) => !t.parked)

  const imgCache = new Map<string, Image | null>()
  const load = async (key: string): Promise<Image | null> => {
    const cached = imgCache.get(key)
    if (cached !== undefined) return cached
    let img: Image | null = null
    try {
      img = await loadImage(join(opts.assetsDir, `${key}.png`))
    } catch {
      img = null // missing cutout on disk — fall back below
    }
    imgCache.set(key, img)
    return img
  }
  const fallback = await load(manifest.fallbackKey)

  const ink = inkFor(opts.background)
  for (const t of tiles) {
    const img = (await load(t.key)) ?? fallback
    if (!img) continue
    if (t.label) {
      ctx.save()
      ctx.font = labelFont(FRAME_LABEL_WEIGHT, t.label.px)
      ctx.fillStyle = ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      for (const row of t.label.rows) {
        const pts = row.pts.map(([x, y]): [number, number] => [t.x + x, t.y + y])
        for (const g of placeGlyphs(pts, row.text, (s) => ctx.measureText(s).width)) {
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.translate(g.x, g.y)
          ctx.rotate(g.angle)
          ctx.fillText(g.text, 0, 0)
        }
      }
      ctx.restore()
    }
    const r = containRect(img.width / img.height, t.x, t.y, t.w, t.h)
    if (opts.shadow) {
      ctx.save()
      ctx.shadowColor = SHADOW.color
      ctx.shadowBlur = SHADOW.blur
      ctx.shadowOffsetY = SHADOW.offsetY
      ctx.drawImage(img, r.x, r.y, r.w, r.h)
      ctx.restore()
    } else {
      ctx.drawImage(img, r.x, r.y, r.w, r.h)
    }
  }
  return await canvas.encode('png')
}

/** Atomically write a rendered frame to htmlDir/<segment>.png. */
export async function writeFrame(htmlDir: string, segment: string, png: Buffer): Promise<void> {
  await mkdir(htmlDir, { recursive: true })
  const path = join(htmlDir, `${segment}.png`)
  const tmp = `${path}.tmp`
  await writeFile(tmp, png)
  await rename(tmp, path)
}
