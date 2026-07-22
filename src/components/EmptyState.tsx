import { useState } from 'react'
import { imagePath } from '../domain/asset.ts'

/** Empty-nest illustration, served from public/. A borrowed AvianVisitors
 *  CC-BY-NC-SA asset that is committed and shipped (see LICENSE / README). */
const NEST_SRC = '/assets/nest.webp'

interface Props {
  /** Silhouette shown only if the nest illustration ever fails to load — a
   *  defensive fallback; the nest itself ships with the app. */
  fallbackKey: string
}

/** Shown when no birds were heard in the active window: an empty nest sits
 *  where the collage would be, with the status line beneath it. Ported from
 *  AvianVisitors; the nest blooms in on mount like a collage tile. */
export function EmptyState({ fallbackKey }: Props) {
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
      <p className="empty mono">no birds heard in this window</p>
    </div>
  )
}
