import { useLayoutEffect, useRef, useState } from 'react'
import { WINDOW_PRESETS, type WindowPreset } from '../domain/window.ts'

interface Props {
  value: WindowPreset
  onChange: (preset: WindowPreset) => void
}

/** Segmented control for the collage time window, styled as a recessed track
 *  with a raised active pill (matching the AvianVisitors chrome). The pill is a
 *  single element that slides between options rather than snapping. */
export function WindowPicker({ value, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  const activeIndex = WINDOW_PRESETS.indexOf(value)

  // Measure the active option and drive the sliding pill to cover it. Layout
  // effect (not effect) so the initial position is committed before paint — the
  // pill appears already under the active tab instead of animating in from the
  // left. Re-runs on window change, animating from the previous geometry, and
  // re-measures on resize: the selector shrinks at the tablet/mobile breakpoints,
  // so a viewport change alters the geometry the pill is pinned to.
  useLayoutEffect(() => {
    const measure = () => {
      const el = optionRefs.current[activeIndex]
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    // Absent in jsdom (tests); the initial measure above is enough there.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (trackRef.current) observer.observe(trackRef.current)
    return () => observer.disconnect()
  }, [activeIndex])

  return (
    <div ref={trackRef} className="window-picker" role="tablist" aria-label="Time window">
      {thumb && (
        <span
          className="window-thumb"
          aria-hidden="true"
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
        />
      )}
      {WINDOW_PRESETS.map((preset, i) => {
        const active = preset === value
        return (
          <button
            key={preset}
            ref={(el) => {
              optionRefs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={active}
            className={`window-option${active ? ' is-active' : ''}`}
            onClick={() => onChange(preset)}
          >
            {preset}
          </button>
        )
      })}
    </div>
  )
}
