# Illustration pipeline

Backend-agnostic tooling for generating the kachō-e bird cutouts and the collage
silhouette masks. **Ported from [AvianVisitors](https://github.com/Twarner491/AvianVisitors)**
with attribution preserved — this is the one thing Saezuri ports rather than
reimplements (see CLAUDE.md). The art and this tooling are **CC-BY-NC-SA-4.0**
(non-commercial); confirm the obligations before publishing generated images.

## Files

| File                 | Origin                | What it does                                                        |
| -------------------- | --------------------- | ------------------------------------------------------------------- |
| `prompt.template.md` | AvianVisitors (**adapted**) | Image-model prompt template. Adapted: the ground is now flat **magenta** (a chroma backing `matte.py` removes), not cream. |
| `pregen.py`          | AvianVisitors (verbatim) | Generate perched + flight illustrations for a species list.      |
| `matte.py`           | Saezuri (original*)  | Remove the magenta ground by **region matte** (numpy + scipy, no ML model) and crop to the bird. (*bbox-crop ported from AvianVisitors `cutout.py`.) |
| `matte_test.py`      | Saezuri (original)   | Offline correctness tests for `matte.py` (no key/network needed).   |
| `build_masks.py`     | AvianVisitors (**adapted**) | Build the silhouette masks. Adapted to emit a JSON manifest (below) instead of rewriting `apt.js`, and to add a fallback entry. |
| `verify.py`          | AvianVisitors (verbatim) | Optional blind QA of each render via a vision model.             |
| `make_fallback.py`   | Saezuri (original)   | Draw the generic fallback silhouette (`_fallback.png`).             |

## Pipeline order

`pregen.py` → `matte.py` → `build_masks.py` (`verify.py` optional). Steps 1–2 need
`GEMINI_API_KEY`; the `requirements.txt` deps are just Pillow + numpy + scipy (no ML
model), so the runtime image is `nginx:alpine`.

## Cutout: region matte on a magenta ground

The image model can't emit a clean alpha channel, so `pregen.py` renders each bird on a
flat, saturated **magenta** ground and `matte.py` removes it. Magenta is chosen because
it sits far from every natural plumage colour, so pale birds aren't eaten.

Removal is treated as **segmentation, not colour**: `matte.region_matte` scores each
pixel's magenta-ness `m = min(R,B) − G` (a hue measure that is ~0 on red/warm plumage),
then takes the background to be the magenta region **connected to the frame border**,
plus any pocket as magenta as the ground itself (to catch gaps enclosed by the bird,
e.g. between an owl's talons). The bird's own colours are never altered — only a thin
edge band is feathered. This is what a global colour key can't do: tell ground-pink
from a red bill, or keep warm tones (Gemini also paints a per-image, slightly
non-uniform rose, which `matte.py` auto-detects from a border ring).

`matte.py` needs no rembg / onnxruntime / ~1 GB model — the reason the runtime image
dropped from a Debian + baked-model build to `nginx:alpine`. Correctness is covered
offline by `python3 -m unittest pipeline.matte_test`.

## Generating the layout manifest (step 3)

`build_masks.py` reads the cutout PNGs in `public/assets/illustrations/` and writes
`public/layout-manifest.json`:

```jsonc
{
  "dims":  { "<slug>": [w, h] },                    // aspect, long side 560
  "masks": { "<slug>": { "w":.., "h":.., "bits": "<base64>" } }, // 1-bit silhouette, long side <=93
  "fallbackKey": "_fallback"
}
```

Only Pillow is required for step 3 and the fallback:

```sh
python3 -m venv .venv && ./.venv/bin/pip install 'Pillow>=10.0'
./.venv/bin/python pipeline/make_fallback.py      # once: writes _fallback.png
./.venv/bin/python pipeline/build_masks.py        # writes public/layout-manifest.json
```

The app fetches the manifest at boot and, when it is absent, falls back to a built-in
manifest holding only the generic silhouette (`src/hooks/useLayoutManifest.ts`).

## v1 note

The bundled AvianVisitors cutouts are a western-U.S. set used as **dev placeholders**;
they are gitignored and never shipped. Regenerating a European species set via
`pregen`/`matte`/`build_masks` is a later task.
