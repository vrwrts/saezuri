// FNV-1a, the 32-bit variant. A fast, dependency-free string hash used to fold a
// long fingerprint down to a short, stable token — the e-ink frame signature and
// the collage's re-bloom key both fold their per-species strings through this so
// two identical inputs always collapse to the same value.
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

export function fnv1a(str: string): number {
  let h = FNV_OFFSET
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, FNV_PRIME)
  }
  return h >>> 0
}
