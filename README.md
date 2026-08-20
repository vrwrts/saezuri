# Saezuri

A self-hosted web frontend that renders a **live bird collage** in the kachō-e style of
[AvianVisitors](https://github.com/Twarner491/AvianVisitors), driven by a
[BirdNET-Go](https://github.com/tphakala/birdnet-go) instance's HTTP API.

Saezuri is a display surface, not a detector: BirdNET-Go does the listening and
identification; Saezuri visualizes recent detections as a woodblock-print collage that
grows the birds you hear most.

## How it works

- **React + Vite + TypeScript + Tailwind** single-page app, no SSR.
- The browser only ever talks to Saezuri's own origin, and reads **only the static files
  Saezuri publishes** — it never calls BirdNET-Go. In production, **nginx** serves the
  static bundle; it does not proxy the BirdNET-Go API.
- A small **Node refresh service** runs beside nginx: it holds BirdNET-Go's detection
  stream, counts detections per species over each time window, and publishes a static
  snapshot (plus per-species art and localized name dictionaries) that the browser polls
  and lays out with a silhouette-mask packing algorithm. Keeping BirdNET-Go backend-only
  means a Saezuri exposed to the internet never exposes the BirdNET-Go API, and it still
  works against a plain-HTTP LAN BirdNET-Go with no CORS or mixed-content.

## What you see

- **A collage of the species heard recently**, each bird sized by how often it called in the
  chosen window. Only illustrated species are drawn; the rest are counted in the status line
  until their art arrives.
- **Five time windows**, each its own shareable URL: `/1h`, `/12h`, `/24h`, `/7d`, `/all`.
  Anything else redirects to `/24h`.
- **Click or tab to a bird** for a species card: local and scientific name, how many times it
  was heard, the first and last time it called in the window, and — when a recording was found —
  a play button with the recordist and licence credited.
- **Light, dark, or follow-the-OS**, and a display language for species names, both in the
  settings menu. Both are per-browser, remembered in `localStorage` under `saezuri:theme` and
  `saezuri:lang`.
- **An e-ink frame** of every window at `/1h.png`, `/12h.png`, `/24h.png`, `/7d.png`, `/all.png` —
  the same collage with no chrome, rendered server-side at a fixed pixel size for a panel to
  fetch. Sized with the `FRAME_*` settings below.
- **Honest empty states**: a nest when nothing has been heard, a distinct message when species
  were heard but none are illustrated yet, and a loading indicator that only appears if the
  first load is actually slow.

Data stays fresh without a reload: the browser re-reads the snapshot every 12 seconds and the
manifests every 30, revalidates the moment a tab regains focus, and stops polling while hidden.
Nothing is cached staler than that, so two screens on the same deployment always agree.

## Configuration

Everything is configured by environment variable; no hosts are hardcoded. `BIRDNETGO_URL` is
the only required one — the rest have working defaults. [`.env.example`](.env.example) has an
annotated copy of every setting.

### Core

| Variable          | Default | Description                                                                                                                              |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `BIRDNETGO_URL`   | —       | **Required.** Base URL of your BirdNET-Go instance, e.g. `http://192.168.1.10:8080`.                                                     |
| `BIRDNETGO_TOKEN` | unset   | Auth token for an instance running with `Security.PrivateMode`. Used only by the refresh service, for the API and the SSE detection stream; it never reaches the browser. |

### Illustrations

| Variable                 | Default                       | Description                                                                                                                    |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ILLUSTRATIONS_REPO`     | `vrwrts/saezuri-illustrations` | Source repo for the free pre-made cutouts, downloaded per detected species. Set it **empty** to turn downloading off entirely. |
| `ILLUSTRATIONS_REF`      | `main`                        | Branch or release tag to pull art from. Pin a tag for a fixed art set.                                                         |
| `ILLUSTRATIONS_BASE_URL` | derived jsDelivr URL          | Overrides the whole download base URL, and wins over the two above. For testing against a local file server.                   |
| `GEMINI_API_KEY`         | unset                         | Google AI (Gemini) key. Set it to *also* generate art for species the repo lacks (see below); unset relies on downloads only.   |
| `GENERATE_MAX_PER_CYCLE` | `4`                           | Cap on species generated per pipeline run.                                                                                     |
| `GENERATE_SLEEP`         | pipeline default (`6`)        | Seconds between image-API calls, to stay under the Gemini free tier. Read by the vendored pipeline, not by Saezuri — the default lives there. |

### Reference calls

| Variable              | Default   | Description                                                                                                                     |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CALL_PROVIDERS`      | `commons` | Comma-list of archives to look recordings up in, tried in order. Only `commons` exists today. Set it **empty** to disable all outbound archive lookups — unlike the other comma-lists, empty here means *off*, not *all*. |
| `CALLS_MAX_PER_CYCLE` | `4`       | Cap on species looked up per batch.                                                                                             |

### e-ink frames

| Variable       | Default            | Description                                                                                                  |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `FRAME_WIDTH`  | `800`              | Frame width in device pixels. Set it to your panel (a Waveshare 7.3" 7-colour is `800`×`480`). A width of 700 or less switches to portrait packing. |
| `FRAME_HEIGHT` | `480`              | Frame height in device pixels.                                                                               |
| `FRAME_BG`     | `#fcfcfb`          | Background fill. Use something like `#17181c` for a dark panel.                                              |
| `FRAME_SHADOW` | `1`                | Per-tile drop shadow; `0` disables it (some quantized panels muddy it).                                      |
| `FRAME_WINDOWS`| all five           | Comma-list of `1h,12h,24h,7d,all` to render. Narrow it if the panel only ever shows one.                     |

### Display languages

| Variable                | Default   | Description                                                                                                                    |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SPECIES_DICT_LOCALES`  | all 16    | Comma-list of the BirdNET-Go dictionary locales to publish for browser localization (`cs,da,de,en,es,fi,fr,hu,it,lv,nb,nl,pl,pt,sk,sv`). Narrow it to save disk and bandwidth, e.g. `de,nl,en`. |

### Refresh cadence (rarely needs tuning)

| Variable              | Default             | Description                                                              |
| --------------------- | ------------------- | ------------------------------------------------------------------------ |
| `PUBLISH_DEBOUNCE_MS` | `20000`             | Minimum gap between publishes triggered by new detections.               |
| `AGING_INTERVAL_MS`   | `120000`            | Periodic republish, so bounded windows shed detections that aged out.    |
| `SUMMARY_INTERVAL_MS` | `1800000`           | How often the all-time species summary — the one expensive call — is refreshed. |

### Paths (advanced)

| Variable         | Default                            | Description                                                                     |
| ---------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| `FRAME_HTML_DIR` | `/usr/share/nginx/html`            | Root the service publishes into. Set it to `./public` to run the service in dev. |
| `CACHE_DIR`      | `/var/cache/saezuri`               | Scratch directory for the illustration pipeline.                                 |
| `PYTHON_BIN`     | `python3`                          | Interpreter used to run the pipeline.                                            |
| `WORKER_SCRIPT`  | `/opt/saezuri/pipeline/worker.py`  | Pipeline entry script.                                                           |

Two parsing quirks worth knowing, because neither fails loudly: a numeric setting that isn't a
number greater than zero falls back to its default, and a comma-list that names nothing valid
falls back to the full set — so `FRAME_WINDOWS=6h` renders *every* window rather than erroring.
`CALL_PROVIDERS` is the documented exception: empty means off.

`BIRDNETGO_URL` must be reachable **from inside the container**, and its host is forwarded
upstream by the refresh service as the `Host` header (and SNI, for `https`). A LAN IP is simplest;
a hostname works too, including one behind a reverse proxy or Cloudflare Tunnel that routes by
Host. When BirdNET-Go also runs in Docker on the same host, the cleanest option is to put Saezuri
on its Docker network and point `BIRDNETGO_URL` at the service name + internal port (e.g.
`http://birdnet-go:8080`) so traffic stays on the local network — see
[`docker-compose.yml`](docker-compose.yml).

## Run the published image

```bash
docker run -d -p 8090:80 \
  -e BIRDNETGO_URL=http://<birdnet-go-host>:8080 \
  -v saezuri-illustrations:/data/illustrations \
  -v saezuri-calls:/data/calls \
  ghcr.io/vrwrts/saezuri:latest
```

Then open <http://localhost:8090>. The host port is 8090 rather than 8080 on purpose: 8080 is
BirdNET-Go's own default, so the two would collide whenever they share a host, which is the
common case. Images are published multi-arch (amd64 + arm64), so they run on a Raspberry Pi as
well as an x86 host. The two volumes keep the illustrations
and reference recordings it collects, so replacing the container doesn't start it over —
both sections below explain what lands in them.

`/data/illustrations` and `/data/calls` are symlinks to where the files actually live,
`/usr/share/nginx/html/assets/illustrations` and `.../assets/calls`. Docker resolves a symlinked
mount destination, so both spellings mount the same directory: the short one is just less to
type, and an existing deployment mounted on the long path keeps working unchanged.

## On-demand generation (optional)

The free downloads above only cover species someone has contributed art for. To *also* fill in
anything the repo doesn't have — generated fresh in the same kachō-e style — set `GEMINI_API_KEY`:

```bash
docker run -d -p 8090:80 \
  -e BIRDNETGO_URL=http://<birdnet-go-host>:8080 \
  -e GEMINI_API_KEY=<your-google-ai-key> \
  -v saezuri-illustrations:/data/illustrations \
  ghcr.io/vrwrts/saezuri:latest
```

The refresh service holds BirdNET-Go's detection SSE stream; the moment a new species is heard it
first tries the free download, and if the repo doesn't have it, generates a perched + flight cutout
(via the bundled pipeline), then refreshes the layout manifest the frontend polls. Silhouettes turn
into real birds on their own within seconds to hours.

Things to know:

- **It uses the paid Gemini image API with _your_ key** — you pay for what it generates.
  Only detected species not already downloaded are generated (typically a handful). Generation is
  paced by `GENERATE_SLEEP` (default 6s) to stay under the free tier and capped per cycle by
  `GENERATE_MAX_PER_CYCLE`.
- **Persist the art** with the named volume above so container upgrades don't re-spend
  those API calls. The manifest is rebuilt from the volume at startup.
- **The generator is bundled in every image** — vendored at build time from the
  [saezuri-illustrations](https://github.com/vrwrts/saezuri-illustrations) pipeline at a pinned
  version (numpy/scipy cutout, no ML model, so the `nginx:alpine` image stays modest).
  `GEMINI_API_KEY` unset simply means the worker never generates; the container is otherwise identical.
- **Licensing.** Generating art locally for your own display is personal use. The style
  derives from the CC-BY-NC-SA lineage (see below) — confirm the obligations before
  publishing generated images.

## Free illustrations

You don't have to pay for generation to get real art. **On by default**, the moment BirdNET-Go
reports a species the refresh service downloads its ready-made cutout from the
[saezuri-illustrations](https://github.com/vrwrts/saezuri-illustrations) repo (via the jsDelivr
CDN) — no API key needed. Just mount the volume so it persists:

```bash
docker run -d -p 8090:80 \
  -e BIRDNETGO_URL=http://<birdnet-go-host>:8080 \
  -v saezuri-illustrations:/data/illustrations \
  ghcr.io/vrwrts/saezuri:latest
```

How it behaves:

- **Per detected species, once.** Both of a species' cutouts (perched + flight) are fetched when
  it is first heard and kept in the volume, so a restart re-downloads nothing. A species only
  appears once it has both. A fresh display fills in over the first hours
  as birds are heard (not all at t=0).
- **Composes with on-demand generation.** Download is tried first (free); if `GEMINI_API_KEY`
  is set, a species the repo *doesn't* have still falls back to Gemini generation.
- **Requires `BIRDNETGO_URL`** — the refresh service (which fetches art and builds the manifest)
  only runs when it's set.
- **Offline-safe / disable.** A failed fetch is non-fatal (silhouette until art exists). Set
  `ILLUSTRATIONS_REPO=` (empty) to turn downloading off entirely; pin `ILLUSTRATIONS_REF` to a
  release tag instead of `main` for a fixed art set.
- **Self-healing.** Delete a cutout from the volume and the service notices, re-downloads it (or
  regenerates it), and rebuilds the manifest — which is also how you replace art you don't like.
- **Licensing.** The illustrations (and the generation pipeline the image bundles) are
  **CC-BY-NC-SA-4.0** — non-commercial. See the illustrations repo and *Credits and licensing* below.

Want to contribute art for more species? Generate them with your key and open a PR — see the
[saezuri-illustrations](https://github.com/vrwrts/saezuri-illustrations) repo.

## Reference calls

**On by default.** When a species is heard, the refresh service looks up a freely-licensed
recording of its call, caches it in a volume, and publishes it — so selecting a bird on the
collage offers a play button for what it sounds like. Mount the volume so it persists:

```bash
docker run -d -p 8090:80 \
  -e BIRDNETGO_URL=http://<birdnet-go-host>:8080 \
  -v saezuri-calls:/data/calls \
  ghcr.io/vrwrts/saezuri:latest
```

How it behaves:

- **The browser never talks to the archives.** Only the refresh service does; clients play the
  cached copy from Saezuri's own origin, like every other asset.
- **Per species, once.** A lookup happens the first time a species is heard. Species with no
  recording are remembered so they aren't re-queried every cycle, and retried after a week.
- **Source: [Wikimedia Commons](https://commons.wikimedia.org/)** — no account or API key.
  Commons only hosts free licences (CC0 / CC BY / CC BY-SA), so everything it yields is safe to
  cache and re-serve provided the recordist is credited, which the species card does.
- **Matched on the binomial**, not on free text, so a recording of a different bird that merely
  mentions the species is never picked. Playing the wrong call is worse than playing none.
- **Disable** with `CALL_PROVIDERS=` (empty) to stop all outbound archive lookups.

Not every species has a recording, and that's expected — the card simply offers no playback.

## Develop

Uses [pnpm](https://pnpm.io) (via Corepack — `corepack enable`).

```bash
pnpm install
pnpm dev                            # Vite dev server (serves the app + static files from ./public)
pnpm dev:mock                       # no backend needed — species synthesized from the manifest
pnpm test                           # unit tests (Vitest); test:watch to watch
pnpm typecheck                      # tsc --noEmit
pnpm check                          # lint + format check (Biome); check:fix to autofix
pnpm build                          # type-check + production bundle
pnpm preview                        # serve the built bundle
```

To run the backend against a real instance, give it the settings in the environment — nothing in
this repo reads a dotenv file:

```bash
BIRDNETGO_URL=http://<birdnet-go-host>:8080 FRAME_HTML_DIR=./public pnpm refresh:dev
```

That publishes the snapshot, the layout and call manifests, the name dictionaries and the e-ink
frames into `./public`, and downloads (or generates) art as species come in — the same work it
does in the container. `refresh:dev` bundles the service first via `build:server`. Copying
[`.env.example`](.env.example) is still a useful reference for what to set, but it is not loaded
automatically; `node --env-file=.env.local dist-server/refresh.mjs` works if you'd rather keep the
values in a file.

In `dev:mock` there is no backend and so no real recordings; `node src/dev/mockCalls.mjs` writes
short synthetic tones and a matching call manifest into `./public` so playback can be exercised.

## Build and run with Docker

```bash
cp .env.example .env                # set BIRDNETGO_URL (and BIRDNETGO_TOKEN if needed)
docker compose up --build
```

## Landing page

A static one-pager (Astro) lives in [`site/`](site/) and shares the app's design tokens
([`shared/theme.css`](shared/theme.css)). It is a separate project, kept out of the Docker
image, and deploys to Cloudflare Pages — see [`site/README.md`](site/README.md).

## Continuous integration & releases

- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs Biome (lint +
  format), type-check, tests, and a production build on every push to `main` and every
  pull request.
- **Docker build** ([`.github/workflows/docker.yml`](.github/workflows/docker.yml))
  builds the runtime image on **fork** pull requests to prove the Dockerfile still works. It
  never pushes. Same-repo branches are covered by the preview build instead, so the heavy image
  isn't built twice per PR.
- **Preview image** ([`.github/workflows/preview.yml`](.github/workflows/preview.yml)) builds a
  throwaway multi-arch image on every push to a branch other than `main` and pushes it to
  `ghcr.io/vrwrts/saezuri:<branch>`, so a change can be installed on a real device before it
  merges. The package is private, so pulling it needs `docker login ghcr.io`. Both this and the
  Docker build skip pushes that only touch `site/`, `fixtures/`, or Markdown.
- **Release** ([`.github/workflows/release.yml`](.github/workflows/release.yml)) is
  continuous and semver-based: on every push to `main` that touches app code,
  [semantic-release](https://semantic-release.gitbook.io/) reads the
  [Conventional Commits](https://www.conventionalcommits.org/) since the last release and,
  if there is a releasable change (`feat`/`fix`/`perf`/breaking), it tags `vX.Y.Z` and
  publishes a **GitHub Release with auto-generated notes**. The same run then builds the
  multi-arch image (`linux/amd64` + `linux/arm64`) and pushes it to `ghcr.io/vrwrts/saezuri`
  as `:X.Y.Z`, `:X.Y`, and `:latest`. No manual tagging.
- **Site vs app:** changes under `site/` and docs never cut an app release — the landing
  site deploys itself to Cloudflare. The generation **pipeline lives in the
  [saezuri-illustrations](https://github.com/vrwrts/saezuri-illustrations) repo** (versioned
  there); the app adopts a new one by bumping the `PIPELINE_VERSION` build arg in the Dockerfile,
  which cuts a normal app release.
- **One-time setup:** after the first release, set the `saezuri` package to **public** in
  the org's GHCR package settings so anonymous `docker pull` works, and link it to the repo.

## Credits and licensing

Saezuri is an **original, clean-room reimplementation** of a collage frontend. It shares
no source with AvianVisitors; it matches the look and feel and reuses only the
backend-agnostic illustration tooling, which lives in the
[saezuri-illustrations](https://github.com/vrwrts/saezuri-illustrations) repo and is vendored
into the Docker image.

- Design, collage aesthetic, and the illustration pipeline are owed to
  **[AvianVisitors](https://github.com/Twarner491/AvianVisitors)** by Teddy Warner.
- AvianVisitors builds on **BirdNET-Pi** (Patrick McGuire), which in turn uses
  **BirdNET-Lite** from the K. Lisa Yang Center for Conservation Bioacoustics, Cornell Lab
  of Ornithology, Cornell University.
- Detections come from **[BirdNET-Go](https://github.com/tphakala/birdnet-go)** by Tomi Phakala.
- Reference calls come from **[Wikimedia Commons](https://commons.wikimedia.org/)** and the
  recordists who contributed them — much of the bird audio there originates from
  **[xeno-canto](https://xeno-canto.org/)**. Each recording is cached per deployment and is
  individually licensed (CC0 / CC BY / CC BY-SA); the recordist, licence, and a link back are
  shown on the species card whenever a call can be played. These recordings are **not**
  redistributed by this repo or bundled into the image — each deployment fetches its own.

The reused illustrations and pipeline carry the **CC-BY-NC-SA-4.0** license inherited from
BirdNET-Pi — **non-commercial use only**. In this repo that covers the empty-state nest
illustration (`public/assets/nest.webp`), bundled and shipped under that license. The Docker
image additionally bundles the vendored pipeline and any downloaded bird illustrations, all
CC-BY-NC-SA-4.0 — so the published image is non-commercial (see [`LICENSE`](LICENSE)). Purely
local, personal use does not trigger distribution terms, but publishing images or a derived
repository does; confirm the obligations before doing so.
