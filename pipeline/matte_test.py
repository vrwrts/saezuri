#!/usr/bin/env python3
"""Saezuri - offline correctness tests for matte.py (no network / Gemini key).

Covers the region matte (the pipeline cutout path).
Needs numpy + scipy + Pillow; skips cleanly if they're absent.

    python3 -m unittest pipeline.matte_test      # from repo root
    python3 matte_test.py                         # from pipeline/
"""
from __future__ import annotations
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import numpy as np
    from PIL import Image
    import scipy  # noqa: F401  (region_matte needs it)
    import matte
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

_M = None if not HAVE_DEPS else np.array([1.0, 0.0, 1.0], np.float32)  # magenta ground


@unittest.skipUnless(HAVE_DEPS, "needs numpy + scipy + Pillow")
class RegionMatteTest(unittest.TestCase):
    """The region matte segments the background by connectivity, keeps the
    bird's colours, and only mattes the edge - the fixes for the defects the
    global colour key produced."""

    def _img(self, arr):
        return Image.fromarray(np.round(np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGB")

    def test_keeps_interior_magenta_spot_and_its_colour(self):
        """A pink/magenta patch INSIDE the bird (not connected to the border)
        must survive with its colour intact - the gull-bill-spot / owl-rufous
        failure of the colour key. Connectivity, not colour, decides."""
        size = 80
        img = np.tile(_M, (size, size, 1))              # magenta ground
        img[20:60, 20:60] = np.array([74, 63, 49], np.float32) / 255.0   # ink body
        pink = np.array([230, 51, 179], np.float32) / 255.0             # magenta-ish spot
        img[36:44, 36:44] = pink
        out = np.asarray(matte.region_matte(self._img(img)), np.float32) / 255.0

        self.assertEqual(out[2, 2, 3], 0.0, "border ground must be transparent")
        self.assertGreater(out[30, 30, 3], 0.98, "bird body must be opaque")
        self.assertGreater(out[40, 40, 3], 0.98, "interior magenta spot must survive")
        self.assertLess(np.abs(out[40, 40, :3] - pink).max(), 6.0 / 255.0,
                        "interior spot colour must be preserved (no unmix)")

    def test_removes_enclosed_ground_pocket(self):
        """A pocket of the SAME magenta as the ground, fully enclosed by the bird
        (owl-between-talons), must be removed - connectivity can't reach it, so
        the strong-hue carve handles it. A pink spot BELOW ground strength (prev
        test) is still kept, so this doesn't reduce to a colour key."""
        size = 80
        img = np.tile(_M, (size, size, 1))
        img[20:60, 20:60] = np.array([74, 63, 49], np.float32) / 255.0   # ink body
        img[36:44, 36:44] = _M                                           # trapped ground
        out = np.asarray(matte.region_matte(self._img(img)), np.float32) / 255.0
        self.assertGreater(out[24, 24, 3], 0.98, "bird body opaque")
        self.assertEqual(out[40, 40, 3], 0.0, "enclosed ground pocket must be removed")

    def test_removes_darker_connected_ground(self):
        """A DARKER magenta patch connected to the border must still be removed -
        the Mallard/Sand-Martin corner defect. Hue test is brightness-tolerant."""
        size = 80
        img = np.tile(_M, (size, size, 1))
        img[0:24, 0:24] = np.array([0.6, 0.0, 0.6], np.float32)  # darker connected ground
        img[30:50, 30:50] = np.array([74, 63, 49], np.float32) / 255.0  # a bird body
        out = np.asarray(matte.region_matte(self._img(img)), np.float32) / 255.0
        self.assertEqual(out[6, 6, 3], 0.0, "darker connected ground must be removed")
        self.assertGreater(out[40, 40, 3], 0.98, "bird body must stay opaque")

    def test_antialiases_soft_edge(self):
        """A soft-edged blob over magenta must yield partial-alpha edge pixels,
        not a hard binary cut."""
        size = 96
        yy, xx = np.mgrid[0:size, 0:size]
        dist = np.sqrt((xx - size / 2) ** 2 + (yy - size / 2) ** 2)
        cov = np.clip((size * 0.3 - dist) / 2.0 + 0.5, 0.0, 1.0)[..., None]
        ink = np.array([74, 63, 49], np.float32) / 255.0
        img = cov * ink + (1 - cov) * _M
        a = np.asarray(matte.region_matte(self._img(img)), np.float32)[..., 3] / 255.0
        self.assertEqual(a[2, 2], 0.0, "corner transparent")
        self.assertGreater(a[48, 48], 0.98, "centre opaque")
        self.assertGreater(int(((a > 0.1) & (a < 0.9)).sum()), 0,
                           "edge must have antialiased (partial-alpha) pixels")


if __name__ == "__main__":
    unittest.main(verbosity=2)
