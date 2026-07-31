import { WINDOW_PRESETS, type WindowPreset } from '../domain/window.ts'
import { SegmentedControl } from './SegmentedControl.tsx'

interface Props {
  value: WindowPreset
  onChange: (preset: WindowPreset) => void
}

/** The collage time-window switcher: a segmented control whose options drive the
 *  URL, so it uses tablist/tab semantics. */
export function WindowPicker({ value, onChange }: Props) {
  return (
    <SegmentedControl
      values={WINDOW_PRESETS}
      value={value}
      onChange={onChange}
      ariaLabel="Time window"
      variant="tabs"
    />
  )
}
