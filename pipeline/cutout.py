#!/usr/bin/env python3
"""AvianVisitors - cut the cream ground off the generated illustrations.

Step 2 of the illustration pipeline (after pregen.py, before build_masks.py).

pregen.py renders each bird on a flat cream ground because the image model
can't cut a clean transparent background on its own (it leaves holes and
fringes). A flat known ground, by contrast, removes cleanly. This runs each
illustration through the BiRefNet matting model (via rembg), then crops to
the bird's bounding box with a small even margin, and saves an RGBA cutout
back in place.

Idempotent: an illustration that already has a transparent background is
skipped unless you pass --force.

Requires rembg + onnxruntime (see requirements.txt). The first run downloads
the BiRefNet model (~1 GB) to ~/.u2net/.

Usage:
    python3 cutout.py                      # process every illustration
    python3 cutout.py calypte-anna         # one slug (both poses)
    python3 cutout.py calypte-anna-2 --force
"""
from __future__ import annotations
import argparse
import os
import sys
import traceback
from pathlib import Path


def main() -> int:
    here = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slugs", nargs="*",
                    help="Slugs to process (e.g. calypte-anna). Default: all.")
    ap.add_argument("--dir", type=Path, default=here / "assets" / "illustrations",
                    help="Illustration directory (default: avian/assets/illustrations/)")
    ap.add_argument("--model", default="birefnet-general",
                    help="rembg model name (default: birefnet-general)")
    ap.add_argument("--margin", type=float, default=0.02,
                    help="Even margin around the bird, as a fraction of its "
                         "long side (default: 0.02)")
    ap.add_argument("--force", action="store_true",
                    help="Re-cut illustrations that already have transparency")
    args = ap.parse_args()

    try:
        from PIL import Image
        from rembg import new_session, remove
    except ImportError:
        print("error: needs Pillow + rembg (pip install -r requirements.txt)",
              file=sys.stderr)
        return 2

    if args.slugs:
        paths = [args.dir / f"{s}.png" for s in args.slugs]
        missing = [p for p in paths if not p.exists()]
        if missing:
            print("error: not found: " + ", ".join(p.name for p in missing), file=sys.stderr)
            return 2
    else:
        paths = sorted(args.dir.glob("*.png"))
    if not paths:
        print("error: no illustrations found", file=sys.stderr)
        return 1

    # --- Diagnostics. A cutout that runs but leaves the cream ground in place
    # points at the matting model itself (wrong/missing model, or an onnxruntime
    # build that returns a useless mask on this host) rather than the pipeline
    # wiring, so log enough to tell those apart. Verbose on purpose while we chase
    # the "cutout ran but didn't cut" failure. ---
    print(f"[cutout] model={args.model} U2NET_HOME={os.environ.get('U2NET_HOME', '(unset)')} "
          f"force={args.force} images={len(paths)}", file=sys.stderr, flush=True)
    try:
        import onnxruntime as ort
        import rembg
        print(f"[cutout] rembg {getattr(rembg, '__version__', '?')} "
              f"onnxruntime {ort.__version__} "
              f"providers={ort.get_available_providers()}", file=sys.stderr, flush=True)
    except Exception as e:  # noqa: BLE001 - diagnostics only
        print(f"[cutout] runtime introspection failed: {e!r}", file=sys.stderr, flush=True)

    try:
        session = new_session(args.model)
    except Exception:
        print(f"[cutout] FAILED to create session for model {args.model!r}:\n"
              f"{traceback.format_exc()}", file=sys.stderr, flush=True)
        return 2
    print(f"[cutout] session ready ({type(session).__name__})", file=sys.stderr, flush=True)

    done = skipped = failed = 0
    for p in paths:
        # Per-image try/except so one bad image logs a full traceback and the rest
        # still run (an aborting batch was hiding the real error).
        try:
            im = Image.open(p)
            im.load()  # force-decode here so a truncated/corrupt file raises now
            print(f"[cutout] {p.name}: input mode={im.mode} size={im.width}x{im.height}",
                  file=sys.stderr, flush=True)
            if not args.force and im.mode == "RGBA" and im.getchannel("A").getextrema()[0] == 0:
                skipped += 1
                print(f"[cutout] {p.name}: already transparent - skipped",
                      file=sys.stderr, flush=True)
                continue
            cut = remove(im.convert("RGB"), session=session)  # RGBA, ground -> transparent
            alpha = cut.getchannel("A")
            lo, hi = alpha.getextrema()
            bbox = alpha.getbbox()
            print(f"[cutout] {p.name}: remove() -> {cut.mode} {cut.width}x{cut.height} "
                  f"alpha_min={lo} alpha_max={hi} bbox={bbox}", file=sys.stderr, flush=True)
            # alpha_min == 255 means the matting kept EVERYTHING opaque -> it removed
            # nothing and the cream ground survives. That is exactly the reported
            # symptom, and it means the model/runtime is the culprit, not the crop.
            if lo >= 255:
                print(f"[cutout] {p.name}: WARNING matting removed nothing "
                      f"(alpha fully opaque) - cream ground will remain",
                      file=sys.stderr, flush=True)
            if bbox:
                pad = round(args.margin * max(bbox[2] - bbox[0], bbox[3] - bbox[1]))
                x0, y0 = max(0, bbox[0] - pad), max(0, bbox[1] - pad)
                x1, y1 = min(cut.width, bbox[2] + pad), min(cut.height, bbox[3] + pad)
                cut = cut.crop((x0, y0, x1, y1))
            cut.save(p)
            done += 1
            print(f"  [cut]  {p.name}  -> {cut.width}x{cut.height} (alpha {lo}..{hi})")
        except Exception:
            failed += 1
            print(f"[cutout] {p.name}: FAILED\n{traceback.format_exc()}",
                  file=sys.stderr, flush=True)

    print(f"\ncut {done} · skipped {skipped} · failed {failed}", file=sys.stderr, flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
