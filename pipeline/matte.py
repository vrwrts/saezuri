#!/usr/bin/env python3
"""Saezuri - ML-free bird cutout from a magenta-ground render (step 2).

Original Saezuri code (not ported from AvianVisitors), except the final
bbox-crop-with-margin, which is ported from AvianVisitors' cutout.py (attribution
preserved below, CC-BY-NC-SA-4.0). Replaces cutout.py's BiRefNet matte: no rembg /
onnxruntime / ~1 GB model - only numpy + scipy + Pillow.

Background removal is a SEGMENTATION problem, not a colour one: we decide which
*region* is background (the magenta area connected to the frame border, plus any
pocket as magenta as the ground itself) instead of deleting a colour everywhere.
That keeps the bird's own colours - red bills, warm rufous plumage - which a
global colour key destroys, and it tolerates the ground's per-image, non-uniform
magenta. See region_matte's docstring for the algorithm.

Usage:
    python3 matte.py --region bird.png --out bird.png     # in place is fine
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path


def region_matte(img, edge_frac: float = 0.03, band: int = 4,
                 min_island_frac: float = 0.0005, t_lo_f: float = 0.30,
                 t_hi_f: float = 0.80, strong_f: float = 0.60, despill: bool = True):
    """Return an RGBA cutout of a bird rendered on a flat magenta ground.

    1. **Magenta-ness** m = clip(min(R,B) - G, 0, 1): a hue measure that stays
       stable across the ground's brightness variation (the darker corners score
       the same as the main ground) and is ~0 on red/warm plumage (red has low
       B). Ground level `t` = median(m) over a border ring - the prompt mandates
       padding, so the frame edge is always ground.
    2. **Region, not colour:** candidate background = m above a tolerant fraction
       of `t`; keep only the part CONNECTED to the border (scipy label). Every-
       thing else is foreground, whatever its colour - so a pink/red patch inside
       the bird survives. Fill foreground holes; drop tiny stray islands (ground
       speckle). Colours are never altered here.
    3. **Edge matte:** a `band`-px unknown ring at the boundary gets a soft alpha
       from m (antialiased edge); elsewhere alpha is a hard 0/1 region decision.
    4. **Despill (optional, gated):** reduce magenta only where a pixel is BOTH
       partially transparent AND actually magenta - never touches opaque plumage.
    """
    import numpy as np
    from scipy import ndimage as ndi
    from PIL import Image

    rgb = np.asarray(img.convert("RGB"), np.float32) / 255.0
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    m = np.clip(np.minimum(R, B) - G, 0.0, 1.0)
    h, w = m.shape

    b = max(6, int(round(min(h, w) * edge_frac)))
    ring = np.concatenate([m[:b].ravel(), m[-b:].ravel(), m[:, :b].ravel(), m[:, -b:].ravel()])
    ground = float(np.median(ring))
    if ground < 1e-3:
        # No magenta ground detected - leave fully opaque (region_cut warns).
        rgba = np.dstack([rgb, np.ones((h, w, 1), np.float32)])
        return Image.fromarray(np.round(rgba * 255).astype(np.uint8), "RGBA")

    t_lo, t_hi = t_lo_f * ground, t_hi_f * ground

    # Background = magenta-ish candidates CONNECTED to the border.
    cand = m > t_lo
    lbl, _ = ndi.label(cand)
    border = np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]])
    keep = np.unique(border)
    bg = np.isin(lbl, keep[keep != 0])

    fg = ndi.binary_fill_holes(~bg)
    # Drop tiny foreground islands (ground pixels that dipped below t_lo).
    flbl, fn = ndi.label(fg)
    if fn > 1:
        sizes = np.bincount(flbl.ravel())
        sizes[0] = 0
        min_area = max(64, int(min_island_frac * h * w))
        fg = np.isin(flbl, np.where(sizes >= min_area)[0])

    # Carve out TRAPPED ground: pixels as magenta as the ground itself are
    # background even when fully enclosed by the bird (the gap between an owl's
    # talons, the sliver beside a gull's leg) - connectivity alone can't reach
    # these. The threshold is high (strong_f*ground) so it only catches
    # near-ground magenta, never a red bill or warm plumage (whose m is far
    # lower) - verified: every trapped cluster's mean RGB matched its ground.
    fg = fg & (m < strong_f * ground)
    bg = ~fg

    # Trimap: soft alpha only in a thin band around the boundary. bg is eroded
    # with border_value=1 so the image frame stays DEFINITE background - other-
    # wise the frame rim becomes "unknown" and the soft formula resurrects any
    # low-m ground pixels there (the darker top-left corner Gemini paints).
    struct = ndi.generate_binary_structure(2, 1)
    fg_sure = ndi.binary_erosion(fg, struct, iterations=band)
    bg_sure = ndi.binary_erosion(bg, struct, iterations=band, border_value=1)
    unknown = ~(fg_sure | bg_sure)

    soft = np.clip((t_hi - m) / max(t_hi - t_lo, 1e-6), 0.0, 1.0)
    alpha = fg.astype(np.float32)
    alpha = np.where(unknown, soft, alpha)
    alpha = np.where(bg_sure, 0.0, alpha)
    alpha = np.where(fg_sure, 1.0, alpha)

    color = rgb.copy()
    if despill:
        spill = m * (1.0 - alpha)  # magenta-ness, only where transparent-leaning
        color[..., 0] = np.clip(R - spill, 0.0, 1.0)
        color[..., 2] = np.clip(B - spill, 0.0, 1.0)

    rgba = np.dstack([color, alpha[..., None]])
    return Image.fromarray(np.round(np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")


def region_cut(src_path: Path, out_path: Path, margin: float = 0.02,
               force: bool = False) -> None:
    """Region-matte a single magenta-ground render to an RGBA cutout, crop, save.

    Idempotent: an image that already has transparency is left alone unless
    `force`, so re-running the worker (which mattes in place) doesn't re-matte an
    already-cut file - the same guard cutout.py had."""
    from PIL import Image
    im = Image.open(src_path)
    im.load()
    if not force and im.mode == "RGBA" and im.getchannel("A").getextrema()[0] == 0:
        print(f"  [matte] {out_path.name}: already transparent - skipped", file=sys.stderr)
        return
    rgba = region_matte(im)
    lo, hi = rgba.getchannel("A").getextrema()
    if hi == 0:
        print(f"[matte] {out_path.name}: WARNING no foreground recovered",
              file=sys.stderr)
    elif lo >= 255:
        print(f"[matte] {out_path.name}: WARNING nothing removed - no magenta "
              f"ground detected (was it rendered on magenta?)", file=sys.stderr)
    rgba = crop_to_alpha(rgba, margin)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(out_path)
    print(f"  [matte] {out_path.name} -> {rgba.width}x{rgba.height} (alpha {lo}..{hi})")


def crop_to_alpha(img, margin: float):
    """Crop to the alpha bounding box plus an even margin (fraction of the long
    side). Ported from AvianVisitors cutout.py so the framing matches the
    BiRefNet path exactly. Returns the image unchanged if it is fully empty."""
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return img
    pad = round(margin * max(bbox[2] - bbox[0], bbox[3] - bbox[1]))
    x0, y0 = max(0, bbox[0] - pad), max(0, bbox[1] - pad)
    x1, y1 = min(img.width, bbox[2] + pad), min(img.height, bbox[3] + pad)
    return img.crop((x0, y0, x1, y1))


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--region", type=Path, required=True,
                    help="Magenta-ground render to matte")
    ap.add_argument("--out", type=Path, required=True, help="Output RGBA cutout")
    ap.add_argument("--margin", type=float, default=0.02,
                    help="Even margin around the bird, fraction of its long side (default 0.02)")
    ap.add_argument("--force", action="store_true",
                    help="Re-matte even if the input already has transparency")
    args = ap.parse_args()

    try:
        import numpy  # noqa: F401
        import scipy  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError:
        print("error: needs Pillow + numpy + scipy (pip install -r requirements.txt)",
              file=sys.stderr)
        return 2

    region_cut(args.region, args.out, args.margin, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
