import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanvas, type Image, loadImage } from '@napi-rs/canvas'
import { computeLayout, type LayoutInput } from '../collage/layout.ts'
import { decodeMaskCached } from '../collage/pack.ts'
import { resolveArt, rollFlight } from '../domain/asset.ts'
import type { LayoutManifest } from '../domain/manifest.ts'
import type { Species } from '../domain/species.ts'
import { createPrng } from '../lib/prng.ts'

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
}

/** Light-theme --tile-shadow: drop-shadow(0 2px 6px rgba(26,22,18,0.1)). */
const SHADOW = { color: 'rgba(26,22,18,0.1)', blur: 6, offsetY: 2 }
const DEFAULT_AR = 1.4

/** Stable string hash → positive int seed (FNV-1a), so a species keeps its pose
 *  across renders (no e-ink churn) while ~FLY_PROB of the roster still fly. */
function seedFor(sci: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < sci.length; i++) {
    h ^= sci.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
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
export function frameSignature(species: readonly Species[], manifest: LayoutManifest): string {
  const sp = species.map((s) => `${s.sci}:${s.n}`).join(',')
  let vh = 0x811c9dc5
  if (manifest.ver) {
    for (const k of Object.keys(manifest.ver).sort()) {
      const entry = `${k}=${manifest.ver[k]}`
      for (let i = 0; i < entry.length; i++) {
        vh ^= entry.charCodeAt(i)
        vh = Math.imul(vh, 0x01000193)
      }
    }
  }
  return `${Object.keys(manifest.masks).length}:${(vh >>> 0).toString(36)}|${sp}`
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

  const inputs = buildInputs(species, manifest)
  const tiles = computeLayout(inputs, { width: opts.width, height: opts.height }).filter(
    (t) => !t.parked,
  )

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

  for (const t of tiles) {
    const img = (await load(t.key)) ?? fallback
    if (!img) continue
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
