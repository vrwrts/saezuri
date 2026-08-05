import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { imagePath, resolveArt, rollFlight } from '../domain/asset.ts'
import type { LayoutManifest } from '../domain/manifest.ts'
import type { Species } from '../domain/species.ts'
import { BirdTile } from './BirdTile.tsx'
import { HoverChip } from './HoverChip.tsx'
import { hitTest } from './hitTest.ts'
import { computeLayout, type LayoutInput, type Viewport } from './layout.ts'
import { decodeMaskCached } from './pack.ts'

interface Props {
  species: Species[]
  manifest: LayoutManifest
  /** Bloom tiles in on mount (disable for screenshots). */
  animate?: boolean
  /** Namespaces the tile keys so a change remounts every tile — used to replay
   *  the entrance bloom when the whole set turns over (e.g. switching windows),
   *  while a same-key poll still re-blooms only newly-arrived birds. */
  blossomKey?: string
  /** Rendered when there are no birds in the window. */
  emptyState?: ReactNode
}

const RESIZE_DEBOUNCE_MS = 120

/** Fallback tile aspect ratio when a species has no manifest dims. */
const DEFAULT_ASPECT_RATIO = 1.4

/** Entrance bloom: each tile's delay is its distance from center × this, capped. */
const BLOOM_DELAY_PER_PX = 0.6
const MAX_BLOOM_DELAY_MS = 600

export function Collage({ species, manifest, animate = true, blossomKey = '', emptyState }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState<Viewport>({ width: 0, height: 0 })
  // Scientific name of the bird under the pointer. Kept as a bare id so the chip
  // reads the live count off the current tiles — it stays fresh across polls and
  // clears itself when the bird leaves the window.
  const [hoveredSci, setHoveredSci] = useState<string | null>(null)
  // sci -> prefersFlight, persisted across polls so a bird keeps its pose until
  // it leaves the window (then it re-rolls on return), matching AvianVisitors.
  const poseRef = useRef<Map<string, boolean>>(new Map())

  // Measure the container; debounce so a drag-resize doesn't thrash the packer.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      clearTimeout(timer)
      timer = setTimeout(
        () => setVp({ width: rect.width, height: rect.height }),
        RESIZE_DEBOUNCE_MS,
      )
    })
    ro.observe(el)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [])

  // Recompute the layout when the species set, viewport, or manifest changes.
  // computeLayout is deterministic (seeded PRNG), so an identical-content poll
  // yields an identical layout — recomputing it is cheap and churn-free.
  const tiles = useMemo(() => {
    const pose = poseRef.current
    const present = new Set(species.map((s) => s.sci))
    for (const key of pose.keys()) if (!present.has(key)) pose.delete(key)

    const inputs: LayoutInput[] = species.map((s) => {
      let prefersFlight = pose.get(s.sci)
      if (prefersFlight === undefined) {
        prefersFlight = rollFlight()
        pose.set(s.sci, prefersFlight)
      }
      const art = resolveArt(manifest, s.sci, prefersFlight)
      const mask = decodeMaskCached(art.key, manifest.masks[art.key])
      const dim = manifest.dims[art.key]
      const ar = dim ? dim[0] / dim[1] : DEFAULT_ASPECT_RATIO
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
    return computeLayout(inputs, vp)
  }, [species, manifest, vp])

  const fallbackUrl = imagePath(manifest.fallbackKey, manifest.ver?.[manifest.fallbackKey])
  const cx = vp.width / 2
  const cy = vp.height / 2

  const visible = tiles.filter((t) => !t.parked)
  // Read the hovered bird off the current tiles, so a stale id (bird left the
  // window) simply yields nothing and the chip disappears.
  const hovered = hoveredSci ? visible.find((t) => t.sci === hoveredSci) : undefined

  // Silhouette hover, arbitrated at the container: the tiles are pointer-events:
  // none (see index.css), so the boxes never intercept — we hit-test the cursor
  // against each bird's mask and light up only the shape actually under it. The
  // handler closes over the current `visible` each render.
  const onMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = containerRef.current
    if (!el) return
    const b = el.getBoundingClientRect()
    const hit = hitTest(e.clientX - b.left, e.clientY - b.top, visible)
    const next = hit ? hit.sci : null
    setHoveredSci((cur) => (cur === next ? cur : next))
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: read-only display; these handlers only track the pointer to highlight a silhouette (decorative, no click/keyboard equivalent). Accessible names live on the child bird buttons.
    <div
      className="gcollage"
      ref={containerRef}
      onMouseMove={onMove}
      onMouseLeave={() => setHoveredSci(null)}
    >
      {species.length === 0
        ? emptyState
        : visible.map((t) => {
            const dist = Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy)
            return (
              <BirdTile
                key={`${blossomKey}:${t.sci}`}
                tile={t}
                animate={animate}
                delayMs={Math.min(MAX_BLOOM_DELAY_MS, dist * BLOOM_DELAY_PER_PX)}
                fallbackUrl={fallbackUrl}
                hovered={t.sci === hoveredSci}
              />
            )
          })}
      {hovered && <HoverChip com={hovered.com} n={hovered.n} />}
    </div>
  )
}
