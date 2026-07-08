// Park–Miller minimal-standard PRNG. Deterministic given a seed: the collage
// packer creates one per run from a constant seed, so the same tiles + viewport
// always produce the same layout (stable across polls and resizes) while still
// looking organically scattered. Matches the generator AvianVisitors used.
export function createPrng(seed = 0x9e3779b9): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}
