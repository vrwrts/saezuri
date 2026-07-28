import { useState } from 'react'
import { imagePath } from '../domain/asset.ts'

/** Empty-nest illustration, served from public/. A borrowed AvianVisitors
 *  CC-BY-NC-SA asset that is committed and shipped (see LICENSE / README). */
const NEST_SRC = '/assets/nest.webp'

interface Props {
  /** Silhouette shown only if the nest illustration ever fails to load — a
   *  defensive fallback; the nest itself ships with the app. */
  fallbackKey: string
  /** Overrides the default caption. Used for the "heard, none illustrated yet"
   *  state, distinct from a genuinely empty window. */
  message?: string
}

/** Shown when the collage has nothing to render: an empty nest sits where the
 *  collage would be, with a caption beneath it. Ported from AvianVisitors; the
 *  nest blooms in on mount like a collage tile. */
export function EmptyState({ fallbackKey, message = 'no birds heard in this window' }: Props) {
  const [errored, setErrored] = useState(false)
  return (
    <div className="empty-nest entering">
      <img
        className="nest-img"
        src={errored ? imagePath(fallbackKey) : NEST_SRC}
        alt="an empty nest"
        decoding="async"
        onError={() => setErrored(true)}
      />
      <p className="empty mono">{message}</p>
    </div>
  )
}
