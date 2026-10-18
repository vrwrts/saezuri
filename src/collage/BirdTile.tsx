import { useRef, useState } from 'react'
import type { LaidTile } from './layout.ts'

interface Props {
  tile: LaidTile
  animate: boolean
  /** Entrance-bloom delay, staggered by distance from center. */
  delayMs: number
  /** Fires once this tile has something to show, i.e. it starts to bloom. */
  onLoaded?: () => void
  /** Generic silhouette to show if the tile's image fails to load. */
  fallbackUrl: string
  /** Cursor is over this bird's silhouette — hit-tested by the collage container,
   *  not by this tile (it's pointer-events:none). Drives the scale. */
  hovered?: boolean
  selected?: boolean
  /** Unreachable by pointer — the tile is pointer-events:none — but it still
   *  fires on Enter/Space, which is what gives keyboard and screen-reader users
   *  a way in without disturbing the container's silhouette arbitration. */
  onSelect?: (sci: string) => void
}

/** One absolutely-positioned bird in the collage. */
export function BirdTile({
  tile,
  animate,
  delayMs,
  onLoaded,
  fallbackUrl,
  hovered,
  selected,
  onSelect,
}: Props) {
  const [errored, setErrored] = useState(false)
  const src = errored ? fallbackUrl : tile.imageUrl
  // The bloom waits for the image, or a slow connection blooms an empty box and
  // the bird pops in afterwards. Whatever part of the stagger the load already
  // used up is subtracted, so a slow image blooms as soon as it arrives.
  const mountedAt = useRef(performance.now())
  const [bloomDelayMs, setBloomDelayMs] = useState<number | null>(null)
  const loaded = bloomDelayMs !== null

  const onLoad = () => {
    if (loaded) return
    setBloomDelayMs(Math.max(0, delayMs - (performance.now() - mountedAt.current)))
    onLoaded?.()
  }

  return (
    <button
      type="button"
      className={`gtile${animate ? (loaded ? ' entering' : ' pending') : ''}${hovered ? ' is-hover' : ''}${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect?.(tile.sci)}
      aria-expanded={selected}
      style={{
        left: `${tile.x}px`,
        top: `${tile.y}px`,
        width: `${tile.w}px`,
        height: `${tile.h}px`,
        animationDelay: animate && loaded ? `${bloomDelayMs}ms` : undefined,
      }}
      aria-label={tile.com}
    >
      <img
        src={src}
        alt={tile.com}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={onLoad}
        // A broken fallback leaves nothing better to wait for, so stop holding
        // the tile (and the loading indicator) back.
        onError={() => (errored ? onLoad() : setErrored(true))}
      />
    </button>
  )
}
