// The layout manifest ships the per-species geometry the collage packer needs:
// an aspect ratio (`dims`) and a 1-bit silhouette (`masks`), keyed by slug. It
// is generated offline by pipeline/build_masks.py from the cutout PNGs — see
// pipeline/. A `fallbackKey` names a generic silhouette that unmatched species
// borrow so they can still be packed and shown.

export interface MaskRecord {
  w: number
  h: number
  /** 1-bit silhouette, MSB-first, row-major, base64. Bit set where alpha>127. */
  bits: string
}

export interface LayoutManifest {
  /** slug -> [w, h] aspect (long side normalized). */
  dims: Record<string, [number, number]>
  /** slug -> silhouette mask. */
  masks: Record<string, MaskRecord>
  /** slug -> short content hash, appended to the image URL as `?v=` so a
   *  regenerated image (same filename) is fetched fresh past the immutable
   *  cache. Optional: older manifests / the built-in fallback omit it. */
  ver?: Record<string, string>
  /** A key present in both `dims` and `masks`, used for unmatched species. */
  fallbackKey: string
}
