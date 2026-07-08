#!/usr/bin/env python3
"""AvianVisitors - rebuild the collage silhouette masks from the cutouts.

Step 3 of the illustration pipeline (after pregen.py and cutout.py).

  --- Ported into Saezuri (pipeline/) with attribution preserved. The only
  change from the AvianVisitors original is the OUTPUT: instead of rewriting
  the DIMS/MASKS tables inline in apt.js, this writes a standalone JSON layout
  manifest that the Saezuri frontend fetches at runtime, and it adds a
  generic `fallback` silhouette entry for species with no matching art. The
  mask-building logic (aspect scaling, 1-bit silhouette packing) is unchanged
  so the packer behaves identically. ---

The collage packs birds by their actual silhouette, not bounding boxes, so the
frontend needs a tiny 1-bit mask per illustration:

    dims[slug]  = [w, h]  aspect, scaled so the long side is 560
    masks[slug] = {w, h, bits}  silhouette downscaled to <=93px, 1-bit
                  packed MSB-first row-major, base64. A bit is 1 where the
                  cutout is opaque (alpha > 127). This is exactly what the
                  frontend's mask decoder expects.

Usage:
    python3 pipeline/build_masks.py \
        --illustrations public/assets/illustrations \
        --fallback public/assets/illustrations/_fallback.png \
        --out public/layout-manifest.json
"""
from __future__ import annotations
import argparse
import base64
import json
import re
import sys
from pathlib import Path

DIM_MAX = 560   # long side of the stored aspect
MASK_MAX = 93   # long side of the stored silhouette
ALPHA_ON = 127  # opaque above this -> silhouette bit set
FALLBACK_KEY = "_fallback"


def build_entry(path: "Path"):
    """Return (dims_entry, mask_entry) for a single cutout PNG."""
    from PIL import Image
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    scale = DIM_MAX / max(w, h)
    dims_entry = [round(w * scale), round(h * scale)]

    ms = MASK_MAX / max(w, h)
    mw, mh = max(1, round(w * ms)), max(1, round(h * ms))
    alpha = im.getchannel("A").resize((mw, mh), Image.LANCZOS)
    px = alpha.load()
    bits = bytearray((mw * mh + 7) // 8)
    for y in range(mh):
        for x in range(mw):
            if px[x, y] > ALPHA_ON:
                i = y * mw + x
                bits[i >> 3] |= 1 << (7 - (i & 7))
    mask_entry = {"w": mw, "h": mh, "bits": base64.b64encode(bytes(bits)).decode()}
    return dims_entry, mask_entry


def build_tables(illus_dir: Path):
    """Return (dims, masks) dicts keyed by slug, in sorted order."""
    dims, masks = {}, {}
    pngs = sorted(p for p in illus_dir.glob("*.png")
                  if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", p.stem))
    for p in pngs:
        dims[p.stem], masks[p.stem] = build_entry(p)
    return dims, masks


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--illustrations", type=Path,
                    default=root / "public" / "assets" / "illustrations",
                    help="Cutout directory (default: public/assets/illustrations/)")
    ap.add_argument("--fallback", type=Path,
                    default=root / "public" / "assets" / "illustrations" / "_fallback.png",
                    help="Generic silhouette PNG for unmatched species")
    ap.add_argument("--out", type=Path, default=root / "public" / "layout-manifest.json",
                    help="Manifest output path (default: public/layout-manifest.json)")
    args = ap.parse_args()

    dims, masks = build_tables(args.illustrations)
    perched = sum(1 for k in dims if not k.endswith("-2"))
    flight = sum(1 for k in dims if k.endswith("-2"))
    print(f"built {len(dims)} masks ({perched} perched + {flight} flight) "
          f"from {args.illustrations}")

    # The fallback silhouette is added under a reserved key (underscore stems
    # are skipped by build_tables, so it never collides with a real slug).
    if args.fallback.exists():
        dims[FALLBACK_KEY], masks[FALLBACK_KEY] = build_entry(args.fallback)
        print(f"added fallback silhouette from {args.fallback}")
    else:
        print(f"warning: no fallback at {args.fallback}; "
              f"unmatched species will have no silhouette", file=sys.stderr)

    if not dims:
        print("error: no cutouts found", file=sys.stderr)
        return 1

    manifest = {"dims": dims, "masks": masks, "fallbackKey": FALLBACK_KEY}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, separators=(",", ":")))
    print(f"wrote {args.out} ({len(dims)} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
