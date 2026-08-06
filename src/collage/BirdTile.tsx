import { useState } from 'react'
import type { LaidTile } from './layout.ts'

interface Props {
  tile: LaidTile
  animate: boolean
  /** Entrance-bloom delay, staggered by distance from center. */
  delayMs: number
  /** Generic silhouette to show if the tile's image fails to load. */
  fallbackUrl: string
  /** Cursor is over this bird's silhouette — hit-tested by the collage container,
   *  not by this tile (it's pointer-events:none). Drives the scale. */
  hovered?: boolean
  /** This bird's card is open. Highlighted like hover, so it stays obvious which
   *  bird the card describes once the pointer moves away. */
  selected?: boolean
  /** Open this bird's card. Unreachable by pointer — the tile is
   *  pointer-events:none and the container arbitrates presses against the
   *  silhouette — but it still fires on Enter/Space, which is what gives keyboard
   *  and screen-reader users the same path without disturbing that arbitration. */
  onSelect?: (sci: string) => void
}

/** One absolutely-positioned bird in the collage. */
export function BirdTile({
  tile,
  animate,
  delayMs,
  fallbackUrl,
  hovered,
  selected,
  onSelect,
}: Props) {
  const [errored, setErrored] = useState(false)
  const src = errored ? fallbackUrl : tile.imageUrl

  return (
    <button
      type="button"
      className={`gtile${animate ? ' entering' : ''}${hovered ? ' is-hover' : ''}${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect?.(tile.sci)}
      aria-expanded={selected}
      style={{
        left: `${tile.x}px`,
        top: `${tile.y}px`,
        width: `${tile.w}px`,
        height: `${tile.h}px`,
        animationDelay: animate ? `${delayMs}ms` : undefined,
      }}
      aria-label={tile.com}
    >
      <img
        src={src}
        alt={tile.com}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setErrored(true)}
      />
    </button>
  )
}
