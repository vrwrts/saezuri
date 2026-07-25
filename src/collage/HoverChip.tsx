/** Human label for a species' call count: "1 call" / "756 calls" / "1,234 calls".
 *  The count already reflects the active window, so no timeframe is spelled out. */
export function formatCalls(n: number): string {
  return `${n.toLocaleString()} call${n === 1 ? '' : 's'}`
}

interface Props {
  /** Common name of the hovered species. */
  com: string
  /** Detection count in the active window. */
  n: number
}

/** Floating pill that names the hovered bird, shown bottom-center of the collage
 *  above the footer count. Purely decorative (aria-hidden): each tile already
 *  exposes its name via aria-label, so screen readers don't need this too. */
export function HoverChip({ com, n }: Props) {
  return (
    <div className="hover-chip" aria-hidden="true">
      <strong>{com}</strong>
      <span className="hover-chip-calls"> — {formatCalls(n)}</span>
    </div>
  )
}
