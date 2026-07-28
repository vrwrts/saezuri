#!/usr/bin/env python3
"""Saezuri - illustration generator (one-shot).

Original Saezuri code (not ported from AvianVisitors). Invoked by the Node
refresh service (src/server/) as a subprocess: given the species that have been
heard but have no cutout yet, it generates kachO-e cutouts for them (by driving
the pipeline/ scripts) and rebuilds the layout manifest. The refresh service owns
the BirdNET-Go relationship and decides *what* is missing; this script only does
the generation, so a change to the art style or mask format stays a one-file fix
in pregen.py / matte.py / build_masks.py.

Generation reuses the existing scripts verbatim (pregen -> matte -> build_masks).
Only public read endpoints of BirdNET-Go are ever touched (by the service, not
here); nothing is written back to it.

Usage:
    # generate art for two species, then rebuild the manifest:
    python3 worker.py --generate "Turdus merula|Blackbird" "Parus major|Great tit"

    # just (ensure fallback +) rebuild the manifest, no generation:
    python3 worker.py --rebuild

Env:
    GEMINI_API_KEY   required for --generate; unset => error (the service only
                     calls --generate when a key is set).
    GENERATE_SLEEP   seconds between image-API calls (passed to pregen --sleep).
                     Unset => pregen's default 6s, to stay under the free tier.
"""
from __future__ import annotations
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# slugify is the canonical scientific-name -> filename join key, kept in parity
# with the frontend (src/domain/slug.ts) and the rest of the pipeline.
from pregen import slugify

HERE = Path(__file__).resolve().parent
PREGEN = HERE / "pregen.py"
MATTE = HERE / "matte.py"
BUILD_MASKS = HERE / "build_masks.py"
MAKE_FALLBACK = HERE / "make_fallback.py"

# Reference art bundled into the image (see pipeline/assets/). Missing dirs are
# fine - pregen degrades gracefully without them (lower style fidelity).
BUNDLED = HERE / "assets"
STYLES_DIR = BUNDLED / "styles"
ANTI_DIR = BUNDLED / "anti"

# In the container the served illustration dir; overridden for local dev.
DEFAULT_ASSETS_DIR = Path("/usr/share/nginx/html/assets/illustrations")
DEFAULT_CACHE_DIR = Path("/var/cache/saezuri")

# Perched (no suffix) and flight (-2) pose file suffixes.
POSE_SUFFIXES = ("", "-2")


def parse_species_args(items: list[str]) -> list[tuple[str, str]]:
    """Parse `"scientificName|commonName"` args into (sci, com) pairs. A missing
    common name defaults to the scientific name. Blank scientific names are
    dropped."""
    out: list[tuple[str, str]] = []
    for item in items:
        sci, _, com = item.partition("|")
        sci = sci.strip()
        com = (com or sci).strip()
        if sci:
            out.append((sci, com))
    return out


def _run(cmd: list[str], **kwargs) -> int:
    """Run a pipeline script, letting its stdout/stderr flow to the container
    log. Non-zero is returned, not raised: a partial run should not abort the
    whole batch (pregen/matte skip already-done work, so the next run retries)."""
    proc = subprocess.run([sys.executable, *cmd], check=False, **kwargs)
    return proc.returncode


def ensure_fallback(assets_dir: Path) -> None:
    fallback = assets_dir / "_fallback.png"
    if not fallback.exists():
        _run([str(MAKE_FALLBACK), "--out", str(fallback)])


def seed_anti_refs(refs_dir: Path) -> None:
    """Copy the bundled contrastive anti-reference photos into the writable refs
    cache so pregen finds them alongside the Wikipedia photos it fetches. No-op
    if none are bundled."""
    if not ANTI_DIR.is_dir():
        return
    for src in ANTI_DIR.glob("_anti_*.jpg"):
        dest = refs_dir / src.name
        if not dest.exists():
            shutil.copy2(src, dest)


def rebuild_manifest(assets_dir: Path) -> None:
    _run([
        str(BUILD_MASKS),
        "--illustrations", str(assets_dir),
        "--fallback", str(assets_dir / "_fallback.png"),
        "--out", str(assets_dir.parent.parent / "layout-manifest.json"),
    ])


def generate(
    missing: list[tuple[str, str, str]],
    assets_dir: Path,
    refs_dir: Path,
    gemini_key: str,
) -> None:
    """Render + matte the missing species. pregen renders both poses on the flat
    magenta ground; matte.py removes it (region matte in numpy/scipy - no heavy
    model) and crops, writing the RGBA cutout back in place. Any failure is
    logged with its exit code."""
    args = [str(PREGEN), "--out", str(assets_dir), "--refs", str(refs_dir)]
    if STYLES_DIR.is_dir():
        args += ["--styles", str(STYLES_DIR)]
    # Throttle image-API calls to stay within the Gemini free-tier rate limit.
    # Unset => pregen's own default (6s between calls), i.e. identical to a manual
    # pipeline run; raise it if your tier is tighter.
    sleep = os.environ.get("GENERATE_SLEEP", "").strip()
    if sleep:
        args += ["--sleep", sleep]
    for sci, com, _ in missing:
        args += ["--species", f"{sci}|{com}"]
    args += ["--poses", "1", "2"]
    env = {**os.environ, "GEMINI_API_KEY": gemini_key}
    _run(args, env=env)

    # Matte each rendered pose IN PLACE. matte.py is lightweight (numpy/scipy),
    # so unlike the old BiRefNet cutout there's no per-process OOM concern; it
    # skips files that are already transparent, so re-runs stay cheap. The exit
    # code is logged so a bad render is distinguishable from a matte error.
    pose_files = [
        f"{slug}{suf}"
        for _, _, slug in missing
        for suf in POSE_SUFFIXES
        if (assets_dir / f"{slug}{suf}.png").exists()
    ]
    failed: list[str] = []
    for pose in pose_files:
        p = str(assets_dir / f"{pose}.png")
        rc = _run([str(MATTE), "--region", p, "--out", p])
        if rc != 0:
            failed.append(pose)
            print(f"saezuri-worker: matte FAILED for {pose}.png (exit {rc}); "
                  f"magenta ground left uncut", file=sys.stderr)
    if failed:
        print(f"saezuri-worker: matte failed for {len(failed)}/{len(pose_files)} "
              f"pose(s): {', '.join(failed)}", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--generate", nargs="*", default=None, metavar="SCI|COM",
                    help='Generate art for these "scientificName|commonName" species, '
                         "then rebuild the manifest.")
    ap.add_argument("--rebuild", action="store_true",
                    help="Ensure the fallback + rebuild the manifest and exit (no generation).")
    ap.add_argument("--assets-dir", type=Path, default=DEFAULT_ASSETS_DIR,
                    help="Served illustration directory (default: the container path)")
    ap.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR,
                    help="Writable cache for fetched Wikipedia reference photos")
    ap.add_argument("--max-per-cycle", type=int, default=0,
                    help="Cap species generated this run (0 = no cap).")
    args = ap.parse_args()

    assets_dir: Path = args.assets_dir
    refs_dir: Path = args.cache_dir / "references"
    assets_dir.mkdir(parents=True, exist_ok=True)
    refs_dir.mkdir(parents=True, exist_ok=True)

    # A valid manifest must always exist so the frontend fetches a real file
    # (built from whatever art is present - initially just the fallback).
    ensure_fallback(assets_dir)

    species = parse_species_args(args.generate or [])
    if not species:
        # --rebuild, or --generate with no species: just refresh the manifest.
        rebuild_manifest(assets_dir)
        print("saezuri-worker: manifest rebuilt")
        return 0

    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        print("saezuri-worker: GEMINI_API_KEY unset; cannot generate", file=sys.stderr)
        return 2

    if args.max_per_cycle > 0 and len(species) > args.max_per_cycle:
        species = species[:args.max_per_cycle]

    seed_anti_refs(refs_dir)
    missing = [(sci, com, slugify(sci)) for sci, com in species]
    generate(missing, assets_dir, refs_dir, gemini_key)
    # Count how many now have a perched cutout (what the frontend keys art on).
    generated = sum(1 for _, _, slug in missing if (assets_dir / f"{slug}.png").exists())
    rebuild_manifest(assets_dir)
    print(f"saezuri-worker: generated {generated}/{len(missing)} species; manifest rebuilt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
