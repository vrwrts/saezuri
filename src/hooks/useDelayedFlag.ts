import { useEffect, useState } from 'react'

/** Returns `true` only after `active` has stayed `true` continuously for
 *  `delayMs`; resets to `false` the moment `active` goes false. Used to hold
 *  back a loading indicator during brief fetches — on a fast machine a window
 *  switch resolves in well under a second, so showing the indicator eagerly
 *  makes it flash jarringly. Delaying it means quick loads show nothing and
 *  only a genuinely slow load ever surfaces the indicator. */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    if (!active) {
      setElapsed(false)
      return
    }
    const id = setTimeout(() => setElapsed(true), delayMs)
    return () => clearTimeout(id)
  }, [active, delayMs])

  // Guard on `active` too: the frame where `active` flips false still holds a
  // stale `elapsed` until the effect runs, and the flag must never outlive it.
  return active && elapsed
}
