# Bundled reference art for the on-demand worker

These are the **reference inputs** the in-container worker (`pipeline/worker.py`)
feeds to `pregen.py` when it generates illustrations for detected species. They
are bundled into the runtime image so generation works out of the box. They are
**not** output art and are never served to the browser.

`pregen.py` degrades gracefully when any of these are missing — it just produces
lower-fidelity output (less consistent kachō-e style, more lookalike drift for a
few genera). So the worker runs fine before this directory is populated; filling
it in is a quality improvement.

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
  | `09-cockatoo-Yoshida.jpg`          | Cockatoo — Hiroshi Yoshida          |
  | `10-mandarin-ducks-Yoshida.jpg`    | Mandarin ducks — Hiroshi Yoshida    |

- `anti/` → the worker copies these into the reference cache so `pregen.py` finds
  them alongside the Wikipedia photos it fetches. Contrastive "do NOT copy this
  lookalike" photos for a few drift-prone genera:

  | File                    | Subject                                   |
  | ----------------------- | ----------------------------------------- |
  | `_anti_bluejay.jpg`     | A Blue Jay (Cyanocitta cristata) photo    |
  | `_anti_barnswallow.jpg` | A Barn Swallow (Hirundo rustica) photo    |

## Sourcing & licensing checkpoint (before committing these files)

This is deliberately left as a checkpoint, per CLAUDE.md's attribution/licensing
rules — bundling these into a published image is distribution, so their license
must be confirmed first.

- **Prints (styles/):** source from Wikimedia Commons. Ohara Koson (d. 1945) and
  Hiroshi Yoshida (d. 1950) works are public domain in the US and in life+70
  jurisdictions; confirm each specific file's Commons license page says so before
  bundling.
- **Anti-ref photos (anti/):** source a clearly CC-BY/CC0/PD-licensed photo of
  each species (Wikimedia Commons or Wikipedia). Record attribution.
- Keep a note of each file's source URL + license here or alongside the commit,
  so the provenance is auditable.
