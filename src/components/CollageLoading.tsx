/** First-load indicator, shown only while a window is fetched for the first time
 *  (SWR's isLoading) — cached windows swap in instantly, so it never flashes on a
 *  return visit. */
export function CollageLoading() {
  return (
    <div className="collage-loading" role="status">
      <p className="loading-caption">gathering what’s been heard</p>
    </div>
  )
}
