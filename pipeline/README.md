# Illustration pipeline

Backend-agnostic tooling for generating the kachō-e bird cutouts and the collage
silhouette masks. **Ported from [AvianVisitors](https://github.com/Twarner491/AvianVisitors)**
with attribution preserved — this is the one thing Saezuri ports rather than
reimplements (see CLAUDE.md). The art and this tooling are **CC-BY-NC-SA-4.0**
(non-commercial); confirm the obligations before publishing generated images.

## Files

| File                 | Origin                | What it does                                                        |
| -------------------- | --------------------- | ------------------------------------------------------------------- |
| `prompt.template.md` | AvianVisitors (verbatim) | Image-model prompt template (kachō-e on a cream ground).         |
| `pregen.py`          | AvianVisitors (verbatim) | Generate perched + flight illustrations for a species list.      |
| `cutout.py`          | AvianVisitors (verbatim) | Remove the cream ground (BiRefNet/rembg) and crop to the bird.   |
| `build_masks.py`     | AvianVisitors (**adapted**) | Build the silhouette masks. Adapted to emit a JSON manifest (below) instead of rewriting `apt.js`, and to add a fallback entry. |
| `verify.py`          | AvianVisitors (verbatim) | Optional blind QA of each render via a vision model.             |
| `make_fallback.py`   | Saezuri (original)   | Draw the generic fallback silhouette (`_fallback.png`).             |

## Pipeline order

`pregen.py` → `cutout.py` → `build_masks.py` (`verify.py` optional). Steps 1–2 need
`GEMINI_API_KEY` and the heavier deps in `requirements.txt` (rembg + onnxruntime).

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
`pregen`/`cutout`/`build_masks` is a later task.
