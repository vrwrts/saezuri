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

## Configuration

One required setting; the rest are optional (see [`.env.example`](.env.example)):

| Variable            | Required | Description                                                             |
| ------------------- | -------- | ----------------------------------------------------------------------- |
| `BIRDNETGO_URL`     | yes      | Base URL of your BirdNET-Go instance, e.g. `http://192.168.1.10:8080`.  |
| `BIRDNETGO_TOKEN`   | no       | Auth token for a `PrivateMode` instance; nginx injects it, never the browser. |
| `GEMINI_API_KEY`    | no       | Google AI (Gemini) key. Set it to *also* generate art for species the repo lacks (see below); unset relies on downloads only. |
| `GENERATE_SLEEP`    | no       | Seconds between image-API calls, to stay under the Gemini free tier. Default `6` (matches the pipeline). |
| `ILLUSTRATIONS_REPO`| no       | Source repo for free pre-made cutouts, auto-downloaded per detected species (default `vrwrts/saezuri-illustrations`; empty disables — see below). |
| `SPECIES_DICT_LOCALES`| no     | Comma-list of display languages to publish for browser localization (default: all 16 BirdNET-Go dictionary locales). Narrow it to save disk/bandwidth, e.g. `de,nl,en`. |

`BIRDNETGO_URL` must be reachable **from inside the container**, and its host is forwarded
upstream as the `Host` header (and SNI, for `https`). A LAN IP is simplest; a hostname works
too, including one behind a reverse proxy or Cloudflare Tunnel that routes by Host. When
BirdNET-Go also runs in Docker on the same host, the cleanest option is to put Saezuri on its
Docker network and point `BIRDNETGO_URL` at the service name + internal port (e.g.
`http://birdnet-go:8080`) so traffic stays on the local network — see
[`docker-compose.yml`](docker-compose.yml).

## Run the published image

```bash
docker run -d -p 8080:80 -e BIRDNETGO_URL=http://<birdnet-go-host>:8080 \
  ghcr.io/vrwrts/saezuri:latest
```

Then open <http://localhost:8080>. Images are published multi-arch (amd64 + arm64), so
they run on a Raspberry Pi as well as an x86 host.

## On-demand generation (optional)

The free downloads above only cover species someone has contributed art for. To *also* fill in
anything the repo doesn't have — generated fresh in the same kachō-e style — set `GEMINI_API_KEY`:

```bash
docker run -d -p 8080:80 \
  -e BIRDNETGO_URL=http://<birdnet-go-host>:8080 \
  -e GEMINI_API_KEY=<your-google-ai-key> \
  -v saezuri-illustrations:/usr/share/nginx/html/assets/illustrations \
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
docker run -d -p 8080:80 \
  -e BIRDNETGO_URL=http://<birdnet-go-host>:8080 \
  -v saezuri-illustrations:/usr/share/nginx/html/assets/illustrations \
  ghcr.io/vrwrts/saezuri:latest
```

How it behaves:

- **Per detected species, once.** Each species' cutout is fetched when first heard and kept in
  the volume, so a restart re-downloads nothing. A fresh display fills in over the first hours
  as birds are heard (not all at t=0).
- **Composes with on-demand generation.** Download is tried first (free); if `GEMINI_API_KEY`
  is set, a species the repo *doesn't* have still falls back to Gemini generation.
- **Requires `BIRDNETGO_URL`** — the refresh service (which fetches art and builds the manifest)
  only runs when it's set.
- **Offline-safe / disable.** A failed fetch is non-fatal (silhouette until art exists). Set
  `ILLUSTRATIONS_REPO=` (empty) to turn downloading off entirely; pin `ILLUSTRATIONS_REF` to a
  release tag instead of `main` for a fixed art set.
- **Licensing.** The illustrations (and the generation pipeline the image bundles) are
  **CC-BY-NC-SA-4.0** — non-commercial. See the illustrations repo and *Credits and licensing* below.

Want to contribute art for more species? Generate them with your key and open a PR — see the
[saezuri-illustrations](https://github.com/vrwrts/saezuri-illustrations) repo.

## Reference calls

**On by default.** When a species is heard, the refresh service looks up a freely-licensed
recording of its call, caches it in a volume, and publishes it — so clicking a bird on the
collage plays what it sounds like. Mount the volume so it persists:

```bash
docker run -d -p 8080:80 \
  -e BIRDNETGO_URL=http://<birdnet-go-host>:8080 \
  -v saezuri-calls:/usr/share/nginx/html/assets/calls \
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
cp .env.example .env.local          # set BIRDNETGO_URL to your instance
pnpm install
pnpm dev                            # Vite dev server (serves the app + static files from ./public)
pnpm dev:mock                       # no backend needed — species synthesized from the manifest
FRAME_HTML_DIR=./public pnpm refresh:dev   # backend: publish snapshot + dictionaries into ./public
pnpm test                           # unit tests (Vitest)
pnpm check                          # lint + format check (Biome); check:fix to autofix
pnpm build                          # type-check + production bundle
```

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
  builds the runtime image on pull requests to prove the Dockerfile still works. It never
  pushes.
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
