/** First-load indicator: a small, centered caption with a subtle shimmer — a
 *  soft band of stronger ink sweeps across the muted text. Shown only while a
 *  window is fetched for the first time (SWR's isLoading) — cached windows swap
 *  in instantly and never show it, so it never flashes on a return visit. Sits
 *  in the collage box like the empty-nest, so the loading and empty states
 *  share one center. The caption is intentionally lowercase and frames the app
 *  as *gathering*, not listening — BirdNET-Go does the listening; Saezuri only
 *  visualizes. */
export function CollageLoading() {
  return (
    <div className="collage-loading" role="status">
      <p className="loading-caption">gathering what’s been heard</p>
    </div>
  )
}
