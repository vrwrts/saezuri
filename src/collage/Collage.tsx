import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { imagePath, resolveArt, rollFlight } from '../domain/asset.ts'
import { type CallManifest, callFor, EMPTY_CALL_MANIFEST } from '../domain/calls.ts'
import type { LayoutManifest } from '../domain/manifest.ts'
import type { Species } from '../domain/species.ts'
import { BirdTile } from './BirdTile.tsx'
import { hitTest } from './hitTest.ts'
import {
  computeLayout,
  type LaidTile,
  type LayoutInput,
  layoutSignature,
  type Viewport,
} from './layout.ts'
import { decodeMaskCached } from './pack.ts'
import { SpeciesCard } from './SpeciesCard.tsx'

interface Props {
  species: Species[]
  manifest: LayoutManifest
  /** Absent ⇒ no bird offers playback. */
  calls?: CallManifest
  /** Bloom tiles in on mount (disable for screenshots). */
  animate?: boolean
  /** Namespaces the tile keys so a change remounts every tile and replays the
   *  entrance bloom. Combined here with a signature of the current layout, so the
   *  bloom also replays when an in-place update (poll / focus revalidation) yields
   *  a genuinely different arrangement — not only when the window switches. Pass
   *  the window preset; it keeps windows in separate key namespaces. */
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

export function Collage({
  species,
  manifest,
  calls = EMPTY_CALL_MANIFEST,
  animate = true,
  blossomKey = '',
  emptyState,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState<Viewport>({ width: 0, height: 0 })
  // Scientific name of the bird under the pointer. Kept as a bare id so the chip
  // reads the live count off the current tiles — it stays fresh across polls and
  // clears itself when the bird leaves the window.
  const [hoveredSci, setHoveredSci] = useState<string | null>(null)
  // The bird whose card is open. Same bare-id treatment as `hoveredSci`, for the
  // same reason: a species that leaves the window simply stops resolving.
  // `byKey` records how the selection was made — the card pulls focus only for a
  // keyboard user, who would otherwise have to tab past every remaining bird to
  // reach it. Doing it after a press would paint a focus ring nobody asked for.
  const [selection, setSelection] = useState<{ sci: string; byKey: boolean } | null>(null)
  const selectedSci = selection?.sci ?? null
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

  // A window switch changes what the card describes — its count and times are
  // window-scoped — so close it rather than silently rewriting it in place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the window, not on the setter
  useEffect(() => setSelection(null), [blossomKey])

  useEffect(() => {
    if (!selectedSci) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedSci])

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

  // Fingerprint the arrangement (species / counts / art slots, not pixel coords)
  // so the tile keys below change — and the bloom replays — exactly when a poll or
  // focus revalidation lands a genuinely different layout, and never on a plain
  // resize or an identical poll. Memoized so hover re-renders don't recompute it.
  const sig = useMemo(() => layoutSignature(tiles), [tiles])

  const fallbackUrl = imagePath(manifest.fallbackKey, manifest.ver?.[manifest.fallbackKey])
  const cx = vp.width / 2
  const cy = vp.height / 2

  const visible = tiles.filter((t) => !t.parked)
  // The card needs the species record (first/last heard), which the laid tile
  // doesn't carry — but only for a bird actually on screen, so gate on the tile
  // first and let a parked or departed species close the card on its own.
  const selected =
    selectedSci && visible.some((t) => t.sci === selectedSci)
      ? species.find((s) => s.sci === selectedSci)
      : undefined

  // Silhouette hover, arbitrated at the container: the tiles are pointer-events:
  // none (see index.css), so the boxes never intercept — we hit-test the cursor
  // against each bird's mask and light up only the shape actually under it. The
  // handler closes over the current `visible` each render.
  const onMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const hit = pick(e)
    const next = hit ? hit.sci : null
    setHoveredSci((cur) => (cur === next ? cur : next))
  }

  // Selection is arbitrated the same way hover is, and for the same reason —
  // the overlapping boxes mean only a mask test lands on the bird you pressed.
  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // The card is the only pointer-events:auto descendant (tiles are none), so a
    // press on a bird targets the container itself. Anything else came from
    // inside the card — pressing play must not re-arbitrate the selection.
    if (e.target !== e.currentTarget) return
    const hit = pick(e)
    setSelection(hit ? { sci: hit.sci, byKey: false } : null)
  }

  function pick(e: ReactMouseEvent<HTMLDivElement>): LaidTile | null {
    const el = containerRef.current
    if (!el) return null
    const b = el.getBoundingClientRect()
    return hitTest(e.clientX - b.left, e.clientY - b.top, visible)
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pointer must be arbitrated here rather than per tile (the tiles are pointer-events:none so their boxes never intercept); the keyboard equivalent lives on the child bird buttons, which carry the accessible names.
    // biome-ignore lint/a11y/useKeyWithClickEvents: this container is not focusable, so a key handler here would never fire — Enter/Space on a bird is handled by its own tile button, which is the real tab stop.
    <div
      // A container class rather than `:has(.is-selected)`: hover toggles a
      // descendant class on every pointer move, and :has would put the parent's
      // style recalc on that path.
      className={`gcollage${selected ? ' has-selection' : ''}`}
      ref={containerRef}
      onMouseMove={onMove}
      onMouseLeave={() => setHoveredSci(null)}
      onClick={onClick}
    >
      {species.length === 0
        ? emptyState
        : visible.map((t) => {
            const dist = Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy)
            return (
              <BirdTile
                key={`${blossomKey}:${sig}:${t.sci}`}
                tile={t}
                animate={animate}
                delayMs={Math.min(MAX_BLOOM_DELAY_MS, dist * BLOOM_DELAY_PER_PX)}
                fallbackUrl={fallbackUrl}
                hovered={t.sci === hoveredSci}
                selected={t.sci === selectedSci}
                onSelect={(sci) => setSelection({ sci, byKey: true })}
              />
            )
          })}
      {selected && (
        // Deliberately unkeyed: keying by species would remount the card on every
        // switch, replaying its entrance animation even though the card never
        // left the screen — which reads as the new content flashing. Reusing the
        // element swaps the content in place and animates only on a real entrance.
        <SpeciesCard
          sci={selected.sci}
          com={selected.com}
          n={selected.n}
          firstSeenMs={selected.firstSeenMs}
          lastSeenMs={selected.lastSeenMs}
          call={callFor(calls, selected.sci)}
          autoFocus={selection?.byKey ?? false}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  )
}
