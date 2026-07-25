# Saezuri

A self-hosted web frontend that renders a **live bird collage** in the kachō-e style of
[AvianVisitors](https://github.com/Twarner491/AvianVisitors), driven by a
[BirdNET-Go](https://github.com/tphakala/birdnet-go) instance's HTTP API.

Saezuri is a display surface, not a detector: BirdNET-Go does the listening and
identification; Saezuri visualizes recent detections as a woodblock-print collage that
grows the birds you hear most.

## How it works

- **React + Vite + TypeScript + Tailwind** single-page app, no SSR.
- The browser only ever talks to Saezuri's own origin. In production, **nginx** serves
  the static bundle and reverse-proxies `/api/` to a BirdNET-Go base URL. This avoids CORS
  and mixed-content, and lets the app work against a plain-HTTP LAN BirdNET-Go.
- The collage polls BirdNET-Go's public read endpoints (`/api/v2`), counts detections per
  species over a time window, and lays them out with a silhouette-mask packing algorithm.

## Configuration

One required setting; the rest are optional (see [`.env.example`](.env.example)):

| Variable            | Required | Description                                                             |
| ------------------- | -------- | ----------------------------------------------------------------------- |
| `BIRDNETGO_URL`     | yes      | Base URL of your BirdNET-Go instance, e.g. `http://192.168.1.10:8080`.  |
| `BIRDNETGO_TOKEN`   | no       | Auth token for a `PrivateMode` instance; nginx injects it, never the browser. |
| `GEMINI_API_KEY`    | no       | Google AI (Gemini) key. Set it to generate illustrations on demand (see below); unset stays display-only. |
| `GENERATE_INTERVAL` | no       | How often the generator checks for newly detected species. `30m`/`1h`/`600s`; default `30m`. |
| `GENERATE_SLEEP`    | no       | Seconds between image-API calls, to stay under the Gemini free tier. Default `6` (matches the pipeline). |

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

## On-demand illustrations

Out of the box Saezuri renders every bird as the same generic silhouette — it ships no
species art. To fill the collage with real kachō-e cutouts **without running the
[`pipeline/`](pipeline/) by hand**, set `GEMINI_API_KEY`:

```bash
docker run -d -p 8080:80 \
  -e BIRDNETGO_URL=http://<birdnet-go-host>:8080 \
  -e GEMINI_API_KEY=<your-google-ai-key> \
  -v saezuri-illustrations:/usr/share/nginx/html/assets/illustrations \
  ghcr.io/vrwrts/saezuri:latest
```

A worker then runs beside nginx: every `GENERATE_INTERVAL` it asks your instance which
species have actually been detected, generates a perched + flight cutout for any that are
missing (reusing the same pipeline scripts, so the result is identical to a manual run),
and refreshes the layout manifest the frontend polls. Silhouettes turn into real birds on
their own over the first hours/days.

Things to know:

- **It uses the paid Gemini image API with _your_ key** — you pay for what it generates.
  Only detected species are generated (typically dozens), not a whole region. There is no
  count cap; generation is paced by `GENERATE_SLEEP` (default 6s) to stay under the free
  tier, and it drains over successive cycles.
- **Persist the art** with the named volume above so container upgrades don't re-spend
  those API calls. The manifest is rebuilt from the volume at startup.
- **The image is large.** Bundling the generator (Python + the BiRefNet matting model)
  makes every image heavy, even when you don't enable generation. A leaner generator-less
  variant may come later; for now `GEMINI_API_KEY` unset simply means the worker never
  runs.
- **Licensing.** Generating art locally for your own display is personal use. The style
  derives from the CC-BY-NC-SA lineage (see below) — confirm the obligations before
  publishing generated images.

## Develop

Uses [pnpm](https://pnpm.io) (via Corepack — `corepack enable`).

```bash
cp .env.example .env.local          # set BIRDNETGO_URL to your instance
pnpm install
pnpm dev                            # Vite dev server; /api is proxied to BIRDNETGO_URL
pnpm dev:mock                       # no backend needed — species synthesized from the manifest
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
  site deploys itself to Cloudflare. `pipeline/` now ships in the image (the on-demand
  illustration worker), so a `feat:`/`fix:` there releases like any other app code; use
  non-releasing types (`chore:`, `docs:`) for tooling-only tweaks.
- **One-time setup:** after the first release, set the `saezuri` package to **public** in
  the org's GHCR package settings so anonymous `docker pull` works, and link it to the repo.

## Credits and licensing

Saezuri is an **original, clean-room reimplementation** of a collage frontend. It shares
no source with AvianVisitors; it matches the look and feel and reuses only the
backend-agnostic illustration tooling (see [`pipeline/`](pipeline/)).

- Design, collage aesthetic, and the illustration pipeline are owed to
  **[AvianVisitors](https://github.com/Twarner491/AvianVisitors)** by Teddy Warner.
- AvianVisitors builds on **BirdNET-Pi** (Patrick McGuire), which in turn uses
  **BirdNET-Lite** from the K. Lisa Yang Center for Conservation Bioacoustics, Cornell Lab
  of Ornithology, Cornell University.
- Detections come from **[BirdNET-Go](https://github.com/tphakala/birdnet-go)** by Tomi Phakala.

The reused illustration assets and pipeline carry the **CC-BY-NC-SA-4.0** license inherited
from BirdNET-Pi — **non-commercial use only**. This includes the empty-state nest
illustration (`public/assets/nest.webp`), which is bundled and shipped under that license,
attributed to AvianVisitors / BirdNET-Pi. Purely local, personal use does not trigger
distribution terms, but publishing images or a derived repository does; confirm the
obligations before doing so. Attribution headers on ported files are preserved.
