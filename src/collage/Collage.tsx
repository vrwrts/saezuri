import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { imagePath, resolveArt, rollFlight } from '../domain/asset.ts'
import type { LayoutManifest } from '../domain/manifest.ts'
import type { Species } from '../domain/species.ts'
import { BirdTile } from './BirdTile.tsx'
import { computeLayout, type LayoutInput, type Viewport } from './layout.ts'
import { decodeMaskCached } from './pack.ts'

interface Props {
  species: Species[]
  manifest: LayoutManifest
  /** Bloom tiles in on mount (disable for screenshots). */
  animate?: boolean
  /** Rendered when there are no birds in the window. */
  emptyState?: ReactNode
}

const RESIZE_DEBOUNCE_MS = 120

export function Collage({ species, manifest, animate = true, emptyState }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState<Viewport>({ width: 0, height: 0 })
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
      const ar = dim ? dim[0] / dim[1] : 1.4
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

  const fallbackUrl = imagePath(manifest.fallbackKey)
  const cx = vp.width / 2
  const cy = vp.height / 2

  return (
    <div className="gcollage" ref={containerRef}>
      {species.length === 0
        ? emptyState
        : tiles
            .filter((t) => !t.parked)
            .map((t) => {
              const dist = Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy)
              return (
                <BirdTile
                  key={t.sci}
                  tile={t}
                  animate={animate}
                  delayMs={Math.min(600, dist * 0.6)}
                  fallbackUrl={fallbackUrl}
                />
              )
            })}
    </div>
  )
}
