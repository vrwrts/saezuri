import { useState } from 'react'
import type { LaidTile } from './layout.ts'

interface Props {
  tile: LaidTile
  animate: boolean
  /** Entrance-bloom delay, staggered by distance from center. */
  delayMs: number
  /** Generic silhouette to show if the tile's image fails to load. */
  fallbackUrl: string
}

/** One absolutely-positioned bird in the collage. */
export function BirdTile({ tile, animate, delayMs, fallbackUrl }: Props) {
  const [errored, setErrored] = useState(false)
  const src = errored ? fallbackUrl : tile.imageUrl

  return (
    <button
      type="button"
      className={`gtile${animate ? ' entering' : ''}`}
      style={{
        left: `${tile.x}px`,
        top: `${tile.y}px`,
        width: `${tile.w}px`,
        height: `${tile.h}px`,
        animationDelay: animate ? `${delayMs}ms` : undefined,
      }}
      title={tile.com}
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
