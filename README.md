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

One required setting, one optional (see [`.env.example`](.env.example)):

| Variable          | Required | Description                                                             |
| ----------------- | -------- | ----------------------------------------------------------------------- |
| `BIRDNETGO_URL`   | yes      | Base URL of your BirdNET-Go instance, e.g. `http://192.168.1.10:8080`.  |
| `BIRDNETGO_TOKEN` | no       | Auth token for a `PrivateMode` instance; nginx injects it, never the browser. |

## Run the published image

```bash
docker run -d -p 8080:80 -e BIRDNETGO_URL=http://<birdnet-go-host>:8080 \
  ghcr.io/vrwrts/saezuri:latest
```

Then open <http://localhost:8080>. Images are published multi-arch (amd64 + arm64), so
they run on a Raspberry Pi as well as an x86 host.

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

## Continuous integration & publishing

- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs Biome (lint +
  format), type-check, tests, and a production build on every push to `main` and every
  pull request.
- **Publish** ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)) builds a
  multi-arch image (`linux/amd64` + `linux/arm64`) and pushes to
  `ghcr.io/vrwrts/saezuri`: `latest` + `sha-<short>` from `main`, and semver tags from
  git tags (`vX.Y.Z`). Pull requests build only, no push.
- **One-time setup:** after the first publish, set the `saezuri` package to **public** in
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
from BirdNET-Pi — **non-commercial use only**. Purely local, personal use does not trigger
distribution terms, but publishing images or a derived repository does; confirm the
obligations before doing so. Attribution headers on ported files are preserved.
