#!/usr/bin/env python3
"""Saezuri - on-demand illustration worker.

Original Saezuri code (not ported from AvianVisitors). Runs beside nginx inside
the container. When GEMINI_API_KEY is set it periodically asks the configured
BirdNET-Go instance which species have actually been detected, generates kachO-e
cutouts for any that have no art yet (by driving the pipeline/ scripts), and
rebuilds the layout manifest the frontend polls. New art therefore appears on
the collage on its own, without anyone running the pipeline by hand.

When GEMINI_API_KEY is unset the worker exits immediately, so the container
behaves exactly as a display-only build (generic silhouettes, zero overhead).

Only public read endpoints of BirdNET-Go are touched; the worker never writes to
it. Generation reuses the existing scripts verbatim (pregen -> matte ->
build_masks), so a change to the art style or the mask format stays a one-file
fix in those scripts.

Env:
    GEMINI_API_KEY    required to enable generation; unset => no-op exit.
    BIRDNETGO_URL     required; base URL of the BirdNET-Go instance.
    BIRDNETGO_TOKEN   optional; bearer token for a PrivateMode instance.
    GENERATE_INTERVAL poll cadence between cycles ("30m", "1h", "600s", or plain
                      seconds). Default 30m; floored at 60s.
    GENERATE_SLEEP    seconds between image-API calls (passed to pregen --sleep).
                      Unset => pregen's default 6s, to stay under the free tier.

Usage (dev, against a real instance):
    GEMINI_API_KEY=... BIRDNETGO_URL=http://host:8080 \\
        python3 pipeline/worker.py --assets-dir public/assets/illustrations \\
        --cache-dir .cache --once --max-per-cycle 2
"""
from __future__ import annotations
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
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
DEFAULT_INTERVAL = "30m"
MIN_INTERVAL = 60.0

# Perched (no suffix) and flight (-2) pose file suffixes.
POSE_SUFFIXES = ("", "-2")


def parse_interval(raw: str) -> float:
    """Parse "30m" / "1h" / "600s" / "600" into seconds, floored at MIN_INTERVAL.
    Falls back to 30 minutes on anything unparseable."""
    raw = (raw or "").strip().lower()
    mult = 1.0
    if raw.endswith("s"):
        raw = raw[:-1]
    elif raw.endswith("m"):
        raw, mult = raw[:-1], 60.0
    elif raw.endswith("h"):
        raw, mult = raw[:-1], 3600.0
    try:
        return max(MIN_INTERVAL, float(raw) * mult)
    except ValueError:
        return 1800.0


def parse_summary(payload: object) -> list[tuple[str, str]]:
    """Extract (scientific_name, common_name) pairs from an
    /analytics/species/summary response. Tolerates either a bare array or a
    {"data": [...]} envelope (the wire shape isn't fixture-validated yet, so we
    accept both). Rows missing either name are skipped."""
    rows = payload
    if isinstance(payload, dict):
        rows = payload.get("data", [])
    if not isinstance(rows, list):
        return []
    out: list[tuple[str, str]] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        sci = str(item.get("scientific_name") or "").strip()
        com = str(item.get("common_name") or "").strip()
        if sci and com:
            out.append((sci, com))
    return out


def fetch_detected_species(base_url: str, token: str | None) -> list[tuple[str, str]]:
    """GET the all-time species summary from BirdNET-Go (read-only). limit is
    generous so the full detected roster is returned, not just a top slice."""
    url = base_url.rstrip("/") + "/api/v2/analytics/species/summary?limit=2000"
    headers = {"User-Agent": "Saezuri-worker"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        payload = json.loads(r.read())
    return parse_summary(payload)


def missing_species(
    species: list[tuple[str, str]], assets_dir: Path
) -> list[tuple[str, str, str]]:
    """Return (sci, com, slug) for detected species with no perched cutout yet.
    Presence of `<slug>.png` is exactly what the frontend keys illustration on
    (src/domain/asset.ts), so it is the right existence check. De-duplicates on
    slug in case two rows map to the same file."""
    seen: set[str] = set()
    out: list[tuple[str, str, str]] = []
    for sci, com in species:
        slug = slugify(sci)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        if not (assets_dir / f"{slug}.png").exists():
            out.append((sci, com, slug))
    return out


def manifest_path(assets_dir: Path) -> Path:
    """`<root>/assets/illustrations` -> `<root>/layout-manifest.json`, matching
    where the frontend fetches it and where nginx serves it."""
    return assets_dir.parent.parent / "layout-manifest.json"


def _run(cmd: list[str], **kwargs) -> int:
    """Run a pipeline script, letting its stdout/stderr flow to the container
    log. Non-zero is returned, not raised: a partial cycle should not kill the
    worker (pregen/matte skip already-done work, so the next cycle retries)."""
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
        "--out", str(manifest_path(assets_dir)),
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
              f"pose(s) this cycle: {', '.join(failed)}", file=sys.stderr)


def cycle(
    base_url: str,
    token: str | None,
    assets_dir: Path,
    refs_dir: Path,
    gemini_key: str,
    max_per_cycle: int,
) -> None:
    species = fetch_detected_species(base_url, token)
    missing = missing_species(species, assets_dir)
    print(f"saezuri-worker: {len(species)} species detected, {len(missing)} missing art")
    if not missing:
        return
    if max_per_cycle > 0 and len(missing) > max_per_cycle:
        print(f"saezuri-worker: capping to {max_per_cycle} this cycle (--max-per-cycle)")
        missing = missing[:max_per_cycle]
    generate(missing, assets_dir, refs_dir, gemini_key)
    # Count how many now have a perched cutout (what the frontend keys art on),
    # so each cycle ends with a clear success tally next to pregen's [ok] lines.
    generated = sum(1 for _, _, slug in missing if (assets_dir / f"{slug}.png").exists())
    rebuild_manifest(assets_dir)
    print(f"saezuri-worker: generated {generated}/{len(missing)} species this cycle; manifest rebuilt")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--assets-dir", type=Path, default=DEFAULT_ASSETS_DIR,
                    help="Served illustration directory (default: the container path)")
    ap.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR,
                    help="Writable cache for fetched Wikipedia reference photos")
    ap.add_argument("--once", action="store_true",
                    help="Run a single cycle and exit (default: loop forever)")
    ap.add_argument("--max-per-cycle", type=int, default=0,
                    help="Cap species generated per cycle (0 = no cap). Useful for testing.")
    args = ap.parse_args()

    # Off switch: no key => the feature is disabled and the container is display-only.
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        print("saezuri-worker: GEMINI_API_KEY unset; generation disabled")
        return 0

    base_url = os.environ.get("BIRDNETGO_URL", "").strip()
    if not base_url:
        print("saezuri-worker: BIRDNETGO_URL unset; cannot fetch detections", file=sys.stderr)
        return 2
    token = os.environ.get("BIRDNETGO_TOKEN", "").strip() or None
    interval = parse_interval(os.environ.get("GENERATE_INTERVAL", DEFAULT_INTERVAL))

    assets_dir: Path = args.assets_dir
    refs_dir: Path = args.cache_dir / "references"
    assets_dir.mkdir(parents=True, exist_ok=True)
    refs_dir.mkdir(parents=True, exist_ok=True)

    # Make sure a valid manifest exists before the first generation, so the
    # frontend always fetches a real file (built from whatever art is present -
    # initially just the fallback silhouette).
    ensure_fallback(assets_dir)
    seed_anti_refs(refs_dir)
    rebuild_manifest(assets_dir)

    print(
        f"saezuri-worker: polling {base_url} every {interval:.0f}s; "
        f"assets -> {assets_dir}"
    )
    while True:
        try:
            cycle(base_url, token, assets_dir, refs_dir, gemini_key, args.max_per_cycle)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError) as e:
            # Keep the worker alive across transient failures; next cycle retries.
            print(f"saezuri-worker: cycle failed: {e}", file=sys.stderr)
        if args.once:
            break
        time.sleep(interval)
    return 0


if __name__ == "__main__":
    sys.exit(main())
