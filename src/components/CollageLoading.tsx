/** First-load indicator, shown while the snapshot is first fetched and then until
 *  the window's first bird image has loaded. Cached windows and art swap in
 *  instantly, so it never flashes on a return visit. */
export function CollageLoading() {
  return (
    <div className="collage-loading" role="status">
      <p className="loading-caption">gathering what’s been heard</p>
    </div>
  )
}
