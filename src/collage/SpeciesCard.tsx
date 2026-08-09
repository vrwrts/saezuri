import { Play, Square, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { type CallRecord, callPath } from '../domain/calls.ts'
import { toggleCall, useCallPlayback } from './callPlayer.ts'

// Both transport glyphs are filled — a hairline outline reads as a smudge at this
// size. The stop square is drawn smaller than the play triangle because a filled
// square carries roughly twice the ink of a triangle inscribed in the same box,
// so matching their nominal sizes would make stop look heavier than play.
const PLAY_ICON_PX = 15
const STOP_ICON_PX = 12
const CLOSE_ICON_PX = 15

/** The count already reflects the active window, so no timeframe is spelled out. */
export function formatCalls(n: number): string {
  return `${n.toLocaleString()} call${n === 1 ? '' : 's'}`
}

// 24-hour clock regardless of locale: these are field timestamps read at a glance
// on a wall display, where "04:33 – 10:24" is quicker to scan than an AM/PM pair
// and stays narrow enough for the card. `hourCycle` rather than `hour12: false`,
// which some locales resolve to h24 ("24:00" for midnight).
const CLOCK = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const

const TIME = new Intl.DateTimeFormat(undefined, CLOCK)
const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  ...CLOCK,
})

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Times alone while the span sits inside one day; anything longer gets dates, so
 *  "21:40 – 06:12" can't be misread as a same-day range. */
export function formatHeard(firstMs?: number, lastMs?: number): string | null {
  if (lastMs === undefined) return null
  const last = new Date(lastMs)
  if (firstMs === undefined || firstMs === lastMs) return `heard ${TIME.format(last)}`
  const first = new Date(firstMs)
  const fmt = sameDay(first, last) ? TIME : DATE_TIME
  return `heard ${fmt.format(first)} – ${fmt.format(last)}`
}

interface Props {
  sci: string
  /** Already localized; see localizeCommonNames. */
  com: string
  n: number
  firstSeenMs?: number
  lastSeenMs?: number
  call: CallRecord | null
  /** Only ever set for a keyboard selection; see Collage for why. */
  autoFocus?: boolean
  onClose: () => void
}

export function SpeciesCard({
  sci,
  com,
  n,
  firstSeenMs,
  lastSeenMs,
  call,
  autoFocus,
  onClose,
}: Props) {
  const playback = useCallPlayback()
  const primaryRef = useRef<HTMLButtonElement>(null)

  // Selecting a bird with the keyboard leaves focus on its tile, several tab
  // stops away from these controls; pulling focus in makes the card reachable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the card switches birds, not when its data updates
  useEffect(() => {
    if (autoFocus) primaryRef.current?.focus()
  }, [sci, autoFocus])

  const url = call ? callPath(sci, call) : null
  const state = url && playback.url === url ? playback.state : 'idle'
  const heard = formatHeard(firstSeenMs, lastSeenMs)
  const credit = call ? [call.recordist, call.license].filter(Boolean).join(' · ') : null
  // The binomial rides behind the common name as a secondary label. With no
  // localized name to show, the primary already *is* the binomial — repeating it
  // would just be the same words twice.
  const showBinomial = sci.trim().toLowerCase() !== com.trim().toLowerCase()

  return (
    <aside className="species-card" aria-label={com}>
      {/* Keyed by species so moving between birds remounts this subtree and
          replays its one-shot entrance — the same pattern as the tile bloom. The
          panel around it deliberately stays mounted: keying the whole card would
          take the background and shadow with it, blinking the card out and back
          rather than swapping what's inside it. */}
      <div className="card-body" key={sci}>
        {url && (
          <button
            ref={primaryRef}
            type="button"
            className={`card-play${state === 'loading' ? ' is-loading' : ''}`}
            onClick={() => toggleCall(url)}
            disabled={state === 'error'}
            aria-label={
              state === 'error'
                ? `${com} recording unavailable`
                : state === 'playing'
                  ? `Stop ${com} call`
                  : `Play ${com} call`
            }
          >
            {state === 'playing' ? (
              <Square size={STOP_ICON_PX} fill="currentColor" />
            ) : (
              <Play className="icon-play" size={PLAY_ICON_PX} fill="currentColor" />
            )}
          </button>
        )}

        <div className="card-text">
          <span className="card-title">
            <strong>{com}</strong>
            {showBinomial && <em>{sci}</em>}
          </span>
          <span className="card-meta mono">
            {formatCalls(n)}
            {heard && ` · ${heard}`}
          </span>
          {call && (
            <span className="card-credit mono">
              {credit && `${credit} · `}
              <a href={call.sourceUrl} target="_blank" rel="noreferrer">
                {call.sourceName}
              </a>
            </span>
          )}
        </div>
      </div>

      <button
        ref={url ? undefined : primaryRef}
        type="button"
        className="card-close"
        onClick={onClose}
        aria-label="Close"
      >
        <X size={CLOSE_ICON_PX} />
      </button>
    </aside>
  )
}
