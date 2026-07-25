# Bundled reference art for the on-demand worker

These are the **reference inputs** the in-container worker (`pipeline/worker.py`)
feeds to `pregen.py` when it generates illustrations for detected species. They
are bundled into the runtime image so generation works out of the box. They are
**not** output art and are never served to the browser.

`pregen.py` degrades gracefully when any of these are missing — it just produces
lower-fidelity output (less consistent kachō-e style, more lookalike drift for a
few genera). So the worker runs fine without them; they are a quality boost.

Provenance and licensing for every file here are in [`ATTRIBUTION.md`](ATTRIBUTION.md).

## Layout (paths the worker points at)

- `styles/` → passed as `--styles`. One Edo-period kachō-e woodblock print per
  file. The bird in each print is irrelevant; only its painting technique is
  borrowed. Filenames must match `STYLE_REFS` in `pregen.py` exactly:

  | File                               | Subject / artist                    |
  | ---------------------------------- | ----------------------------------- |
  | `01-sparrows-on-bamboo-Koson.jpg`  | Sparrows on bamboo — Ohara Koson    |
  | `02-cawing-crow-Koson.jpg`         | Crow on a branch — Ohara Koson      |
  | `03-jays-on-berry-tree-Koson.jpg`  | Jays on a berry tree — Ohara Koson  |
  | `04-kingfisher-Koson.jpg`          | Kingfisher — Ohara Koson            |
  | `05-owl-on-ginkgo-Koson.jpg`       | Owl on a ginkgo branch — Ohara Koson|
  | `06-goose-flying-in-moonlight-Koson.jpg` | Goose in moonlight — Ohara Koson |
  | `07-swallows-in-flight-Koson.jpg`  | Swallows in flight — Ohara Koson    |
  | `08-crane-in-small-water-Koson.jpg`| Crane in shallow water — Ohara Koson|
  | `09-cockatoo-Koson.jpg`            | Two cockatoos — Ohara Koson         |
  | `10-mandarin-ducks-Koson.jpg`      | Mandarin ducks — Ohara Koson        |

- `anti/` → the worker copies these into the reference cache so `pregen.py` finds
  them alongside the Wikipedia photos it fetches. Contrastive "do NOT copy this
  lookalike" photos for a few drift-prone genera:

  | File                    | Subject                                   |
  | ----------------------- | ----------------------------------------- |
  | `_anti_bluejay.jpg`     | A Blue Jay (Cyanocitta cristata) photo    |
  | `_anti_barnswallow.jpg` | A Barn Swallow (Hirundo rustica) photo    |

## Sourcing & licensing

All files are from Wikimedia Commons, vetted and recorded in
[`ATTRIBUTION.md`](ATTRIBUTION.md):

- **Prints (`styles/`):** ten Ohara Koson (1877–1945) woodblock prints, all
  **public domain**. (The cockatoo and mandarin-duck slots use Koson prints
  rather than Yoshida — same PD status, single-artist attribution.)
- **Anti-ref photos (`anti/`):** one Blue Jay and one Barn Swallow photo, each
  **CC BY-SA**, bundled unmodified with attribution per the license.

To swap any file, keep the same filename (it's the key `pregen.py`/`STYLE_REFS`
looks up) and update `ATTRIBUTION.md`.
