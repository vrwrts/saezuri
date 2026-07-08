import { imagePath } from '../domain/asset.ts'

interface Props {
  /** Manifest fallback key, for the faded silhouette. */
  fallbackKey: string
}

/** Shown when no birds were heard in the active window. */
export function EmptyState({ fallbackKey }: Props) {
  return (
    <div className="empty-state">
      <img
        className="empty-bird"
        src={imagePath(fallbackKey)}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
      <p className="empty mono">no birds heard in this window</p>
    </div>
  )
}
