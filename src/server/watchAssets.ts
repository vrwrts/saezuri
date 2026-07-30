import { existsSync, type FSWatcher, watch } from 'node:fs'
import { join } from 'node:path'

// Watch the served illustrations directory and react when a cutout is *removed*
// at runtime (a manual delete, a cache eviction). Without this, a deleted PNG is
// only noticed at the next restart: the layout manifest is a disk-derived cache,
// so until it is rebuilt both `isComplete` (the regeneration gate) and `hasArt`
// (the display gate) keep trusting the vanished slug — the collage points at a
// 404 and the species is never re-enqueued. The refresh service turns a removal
// into a manifest rebuild + republish, which re-enqueues and refills the gap.

export interface AssetWatchOptions {
  /** Coalesce a burst of removals (e.g. `rm *.png`) into a single callback. */
  debounceMs: number
  /** Delay before re-arming after a watcher error / the dir not yet existing. */
  rearmMs: number
  onError?: (where: string, e: unknown) => void
}

/**
 * Fire `onRemoval` (debounced) whenever a `.png` disappears from `dir`. Reacts to
 * removals only: our own art writes are atomic (tmp + rename), so the target file
 * is present afterwards and an `existsSync` check filters them out — there is no
 * write→heal feedback loop. `.png.tmp` churn is ignored by the suffix filter.
 * Self-heals across watcher errors (and a not-yet-created dir) by closing and
 * re-arming. Returns a stop() that tears down the watcher and any pending timer.
 */
export function watchAssetRemovals(
  dir: string,
  onRemoval: () => void,
  opts: AssetWatchOptions,
): () => void {
  let watcher: FSWatcher | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let rearm: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const fire = () => {
    if (debounce) return
    debounce = setTimeout(() => {
      debounce = undefined
      if (!stopped) onRemoval()
    }, opts.debounceMs)
  }

  const reArm = () => {
    watcher?.close()
    watcher = undefined
    if (stopped) return
    rearm = setTimeout(arm, opts.rearmMs)
  }

  function arm(): void {
    if (stopped) return
    try {
      watcher = watch(dir, (_event, filename) => {
        if (!filename) return
        const name = filename.toString()
        if (!name.endsWith('.png')) return // skip .png.tmp and non-art files
        if (existsSync(join(dir, name))) return // created/replaced, not removed
        fire()
      })
      watcher.on('error', (e) => {
        opts.onError?.('watch', e)
        reArm()
      })
    } catch (e) {
      opts.onError?.('watch', e)
      reArm()
    }
  }

  arm()

  return () => {
    stopped = true
    if (debounce) clearTimeout(debounce)
    if (rearm) clearTimeout(rearm)
    watcher?.close()
  }
}
