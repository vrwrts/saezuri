import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

interface Props<T extends string> {
  values: readonly T[]
  value: T
  onChange: (value: T) => void
  /** Renders the label for a value; defaults to the value itself. */
  renderLabel?: (value: T) => ReactNode
  ariaLabel: string
  /** ARIA semantics: 'tabs' for a view switcher (e.g. the time window, which drives
   *  the URL) or 'radiogroup' for a setting (e.g. the theme). */
  variant?: 'tabs' | 'radiogroup'
}

/** Segmented control: a recessed track with a single raised pill that glides under
 *  the active option (matching the AvianVisitors chrome). Generic over the option
 *  set so both the time-window switcher and the theme switcher share one behavior
 *  and one style. The pill's geometry is measured from the active option and driven
 *  inline; the CSS transition does the gliding. */
export function SegmentedControl<T extends string>({
  values,
  value,
  onChange,
  renderLabel,
  ariaLabel,
  variant = 'tabs',
}: Props<T>) {
  const trackRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  const activeIndex = values.indexOf(value)

  // Layout effect (not effect) so the pill is committed before paint — it appears
  // already under the active option instead of animating in from the left.
  // Re-measures via a ResizeObserver so a late reflow (font swap, popover open)
  // keeps it pinned to the option's real geometry.
  useLayoutEffect(() => {
    const measure = () => {
      const el = optionRefs.current[activeIndex]
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return // jsdom: the initial measure is enough
    const observer = new ResizeObserver(measure)
    if (trackRef.current) observer.observe(trackRef.current)
    return () => observer.disconnect()
  }, [activeIndex])

  const isTabs = variant === 'tabs'
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is tablist|radiogroup, both of which support aria-label; the ternary role defeats Biome's static check.
    <div
      ref={trackRef}
      className="segmented"
      role={isTabs ? 'tablist' : 'radiogroup'}
      aria-label={ariaLabel}
    >
      {thumb && (
        <span
          className="segmented-thumb"
          aria-hidden="true"
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
        />
      )}
      {values.map((v, i) => {
        const active = v === value
        return (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is tab|radio; each attr is gated to its role (aria-selected for tab, aria-checked for radio), but the ternary role defeats Biome's static check.
          <button
            key={v}
            ref={(el) => {
              optionRefs.current[i] = el
            }}
            type="button"
            role={isTabs ? 'tab' : 'radio'}
            aria-selected={isTabs ? active : undefined}
            aria-checked={isTabs ? undefined : active}
            className={`segmented-option${active ? ' is-active' : ''}`}
            onClick={() => onChange(v)}
          >
            {renderLabel ? renderLabel(v) : v}
          </button>
        )
      })}
    </div>
  )
}
