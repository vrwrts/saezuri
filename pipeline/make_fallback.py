#!/usr/bin/env python3
"""Saezuri - generate the generic fallback bird silhouette.

Original Saezuri tooling (not ported from AvianVisitors). Draws a simple
perched-bird silhouette in ink on a transparent ground, used for detected
species that have no matching illustration yet. It is our own asset, so unlike
the borrowed placeholder cutouts it is safe to commit and ship.

Usage:
    python3 pipeline/make_fallback.py            # -> public/assets/illustrations/_fallback.png
"""
from __future__ import annotations
import argparse
from pathlib import Path


def draw_fallback(out: Path, ink=(74, 63, 49, 255)) -> None:
    from PIL import Image, ImageDraw

    # Supersample then downscale for smooth edges.
    S = 4
    W, H = 560, 460
    im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def e(cx, cy, rx, ry):
        d.ellipse([(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S], fill=ink)

    def poly(pts):
        d.polygon([(x * S, y * S) for x, y in pts], fill=ink)

    # Body (plump, leaning forward), head, and a swept tail — a generic
    # songbird posture rather than any real species.
    e(250, 250, 150, 120)              # body
    poly([(360, 250), (545, 205), (515, 300)])  # tail sweeping up-right
    e(175, 150, 78, 74)                # head
    poly([(105, 150), (30, 132), (105, 178)])   # beak
    # Two simple legs down to a perch line.
    for lx in (225, 275):
        d.line([(lx * S, 355 * S), (lx * S, 425 * S)], fill=ink, width=9 * S)
    d.line([(150 * S, 425 * S), (360 * S, 425 * S)], fill=ink, width=10 * S)  # perch
    # Eye punched out of the head for a touch of life.
    d.ellipse([(150 * S, 132 * S), (168 * S, 150 * S)], fill=(0, 0, 0, 0))

    im = im.resize((W, H), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    print(f"wrote {out} ({W}x{H})")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path,
                    default=root / "public" / "assets" / "illustrations" / "_fallback.png")
    args = ap.parse_args()
    draw_fallback(args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
