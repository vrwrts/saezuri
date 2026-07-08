import { WINDOW_LABELS, WINDOW_PRESETS, type WindowPreset } from '../domain/window.ts'

interface Props {
  value: WindowPreset
  onChange: (preset: WindowPreset) => void
}

/** Segmented control for the collage time window, styled as a recessed track
 *  with a raised active pill (matching the AvianVisitors chrome). */
export function WindowPicker({ value, onChange }: Props) {
  return (
    <div className="window-picker" role="tablist" aria-label="Time window">
      {WINDOW_PRESETS.map((preset) => {
        const active = preset === value
        return (
          <button
            key={preset}
            type="button"
            role="tab"
            aria-selected={active}
            className={`window-option${active ? ' is-active' : ''}`}
            onClick={() => onChange(preset)}
          >
            {WINDOW_LABELS[preset]}
          </button>
        )
      })}
    </div>
  )
}
