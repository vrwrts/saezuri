# Static assets

## `illustrations/`

Pre-generated bird cutout PNGs, keyed by slugified scientific name
(`slugify("Calypte anna")` → `calypte-anna.png`; flight variant `calypte-anna-2.png`).

**Only `_fallback.png` is committed.** It is Saezuri's own generic silhouette
(`pipeline/make_fallback.py`), shown for any species without matching art.

Every other PNG here is a **dev placeholder** borrowed from AvianVisitors
(CC-BY-NC-SA, non-commercial). They are **gitignored and never shipped**. To populate
them locally for a richer collage:

```sh
cp /path/to/avianvisitors/avian/assets/illustrations/*.png public/assets/illustrations/
./.venv/bin/python pipeline/build_masks.py    # regenerate public/layout-manifest.json
```

Regenerating a proper European species set via `pipeline/` is a later task. Because the
placeholders are western-U.S. species, a European BirdNET-Go instance will match few of
them — unmatched species render the fallback silhouette (by design for v1).

## `nest.webp`

Empty-state illustration, shown where the collage would be when no birds were heard in
the window. Like the cutouts above it is a **borrowed AvianVisitors placeholder**
(CC-BY-NC-SA), so it is **gitignored and never shipped**. When absent, the empty state
falls back to the committed `_fallback.png` silhouette. To populate it locally:

```sh
cp /path/to/avianvisitors/avian/frontend/nest.webp public/assets/nest.webp
```

A Saezuri-original nest illustration is a later task, alongside the cutout regeneration.
