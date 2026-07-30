# Saezuri
 
Saezuri is a self-hosted web frontend that renders a live bird collage in the visual
style of the AvianVisitors project, driven by a BirdNET-Go instance's HTTP API. It is
a display surface, not a detector: BirdNET-Go does the listening and identification,
Saezuri just visualizes recent detections.
 
## What this is and is not
 
- It is an original, clean-room reimplementation of a collage frontend.
- It is not a fork of AvianVisitors and shares none of its source. It matches the look
  and feel and reuses only the backend-agnostic illustration pipeline (see below).
- It talks to BirdNET-Go, not BirdNET-Pi. There is no PHP and no BirdNET-Pi anywhere.
## Stack (decided, do not re-litigate)
 
- React + Vite + TypeScript + Tailwind. Single-page app. No SSR.
- Production: multi-stage Docker build, served by nginx. nginx serves the static
  bundle and reverse-proxies `/api/` to a BirdNET-Go base URL from the `BIRDNETGO_URL`
  env var, resolved at container start.
- Prefer boring, widely-used dependencies over clever ones, and don't reinvent the
  wheel: reach for a small, well-trusted library when it removes real complexity (e.g.
  SWR for data fetching). Every dependency is still something a reviewer must trust, so
  add only what earns its place and keep the tree lean.
## Architecture invariants
 
- The browser only ever talks to Saezuri's own origin. All BirdNET-Go calls go
  through the nginx `/api/` proxy. This is what avoids CORS and mixed-content and lets
  the app work against a plain-HTTP LAN BirdNET-Go. Do not make the browser call
  BirdNET-Go directly.
- Configuration is by environment variable, never hardcoded hosts. `BIRDNETGO_URL` is
  the one required setting.
- Keep modules small and well-typed. Favor code that is easy to read and review over
  code that is short or clever.
## Reference material (critical rules)
 
Two read-only clones live under `reference/`. They are for study only.
 
- `reference/avianvisitors/` shows the design, the kacho-e collage aesthetic, the
  silhouette-mask packing and layout logic, and the illustration pipeline.
- `reference/birdnet-go/` is the backend we target. Use its frontend source and API
  handlers to understand the `/api/v2` endpoints and shapes.
Rules:
 
1. Never copy source from `reference/` into the app. Reimplement in our own code.
2. Never commit anything under `reference/`. It is gitignored. If `git status` ever
   shows files under `reference/`, stop and fix `.gitignore` before committing.
3. The only exception, the one thing we ported rather than reimplemented, is the
   illustration tooling: the image-generation prompt template and the pregen, matte,
   and mask-building scripts, with their original attribution and license headers
   preserved. These now live in their own repo,
   [`saezuri-illustrations`](https://github.com/vrwrts/saezuri-illustrations) (alongside
   the community-contributed art). There is no in-repo `pipeline/` directory: the app
   vendors that pipeline into its Docker image at a pinned `PIPELINE_VERSION` (see the
   `Dockerfile`) for on-demand generation, and at runtime downloads pre-generated
   illustrations from that repo per detected species.
## Attribution and licensing
 
- `README.md` must credit AvianVisitors and, through it, BirdNET-Pi.
- Preserve license headers on the ported illustration tooling (now in the
  `saezuri-illustrations` repo, vendored into the image) and on any illustration assets
  carried over (e.g. the bundled `public/assets/nest.webp`).
- The BirdNET-Pi lineage is likely copyleft. Before publishing any image or repo,
  confirm the license and its obligations. Purely local, personal use does not trigger
  distribution terms, but publishing does.
## Data contract
 
- `fixtures/` holds real `/api/v2` responses captured from a running instance. Treat
  fixtures as the source of truth for shapes, ahead of anything inferred from source.
- Consume only public read endpoints: detections and analytics under `/api/v2`. No
  auth. No writes.
- BirdNET-Go ships as rolling nightlies and its v2 API takes occasional breaking
  changes. Keep the typed client centralized so a shape change is a one-file fix, and
  note in the client which fixture and roughly which BirdNET-Go build it was derived
  from.
## Out of scope for v1
 
- Admin or settings control. Saezuri is read-only for now. The BirdNET-Go settings
  API is a later, separate piece and must not creep into v1.
- Producing the full illustration set. Art is contributed as PRs to the
  `saezuri-illustrations` repo (a flat folder the app auto-downloads per detected
  species); the AvianVisitors cutouts under `public/assets/` remain gitignored dev
  placeholders so the UI is testable locally. Growing that set is ongoing, not a v1 gate.
## Common commands
 
To be filled in once the scaffold lands. Expected shape:
 
- `npm run dev` for the Vite dev server.
- `npm run build` for the production bundle.
- `docker compose up --build` to run the container against a configured `BIRDNETGO_URL`.
## Git hygiene
 
- Confirm `reference/` is ignored before the first commit.
- Small, focused commits with clear messages, so each change is reviewable on its own.
