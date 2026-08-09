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
- Icons come from `lucide-react`, imported per icon so tree-shaking keeps only what is
  used. Don't hand-roll SVGs and don't use emoji glyphs as icons — emoji render at the
  mercy of the platform's font, which is what they replaced.
## Architecture invariants
 
- The browser only ever talks to Saezuri's own origin, and reads **only static files
  Saezuri publishes** (snapshot, layout manifest, species-name dictionaries, e-ink
  frames, cutouts, cached reference calls). All outbound access is **backend-only**:
  the Node refresh service is the sole BirdNET-Go client (it holds the detection SSE
  stream and publishes the static files) and the only thing that reaches third-party
  archives for call audio — it caches what it fetches and re-serves it from this
  origin. nginx serves those static files and does **not** proxy the BirdNET-Go
  API — exposing the whole API (writes included) to anyone who can reach Saezuri is a
  real risk when Saezuri is on the internet but BirdNET-Go is not. Never reintroduce a
  browser→BirdNET-Go path (no `/api/` proxy, no direct calls). This also avoids CORS
  and mixed-content and lets it work against a plain-HTTP LAN BirdNET-Go.
- Configuration is by environment variable, never hardcoded hosts. `BIRDNETGO_URL` is
  the one required setting.
- Keep modules small and well-typed. Favor code that is easy to read and review over
  code that is short or clever.
## Code style
 
- **Comments explain WHY, not WHAT.** Delete comments that restate what the code already
  says. Keep comments that explain *why* the code is the way it is — a rationale, an
  external-system or wire-contract quirk, a security or attribution/licence constraint,
  cross-file coordination, a non-obvious math invariant, or a deliberate trade-off. When
  unsure whether a comment is a "why", keep it.
- **Prefer self-documenting code.** Before writing a comment to explain a piece of code,
  first try to make the code explain itself: name the constant, extract a helper, rename
  the symbol.
- **No magic numbers.** Give tuning values named constants, not inline comments.
- **State each rationale once.** Don't repeat the same "why" across a type, the hook that
  wraps it, and the call site — put it in the canonical place and let the others be silent.
- Never strip licence, security, or wire-contract "why" notes — those are load-bearing.
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
- Consume only public read endpoints under `/api/v2`: detections and analytics (the
  species set); the per-locale species-name dictionaries (`/species/dictionary/:locale`)
  and the public dashboard locale (`/settings/dashboard`, a read only — for the
  default display language) for browser-language localization. No auth beyond the
  optional bearer token. No writes. All of these are called **server-side** by the
  refresh service; the browser reads the republished static files.
- BirdNET-Go ships as rolling nightlies and its v2 API takes occasional breaking
  changes. Keep the typed client centralized so a shape change is a one-file fix, and
  note in the client which fixture and roughly which BirdNET-Go build it was derived
  from.
## Out of scope for v1
 
- Admin or settings control. Saezuri is read-only for now. The BirdNET-Go settings
  API is a later, separate piece and must not creep into v1. (The one narrow
  exception is a server-side *read* of the public `/settings/dashboard` locale to pick
  a default display language — a read, never a write, and never settings control.)
- Producing the full illustration set. Art is contributed as PRs to the
  `saezuri-illustrations` repo (a flat folder the app auto-downloads per detected
  species); the AvianVisitors cutouts under `public/assets/` remain gitignored dev
  placeholders so the UI is testable locally. Growing that set is ongoing, not a v1 gate.
## Code map
 
Where things live, so a change lands in the right place fast.
 
- **Collage render path:** `src/pages/CollagePage.tsx` fetches the data and renders
  `src/collage/Collage.tsx`, which measures the viewport, resolves each species to art,
  packs the tiles, and maps them to `src/collage/BirdTile.tsx` (one absolutely-positioned
  `<button><img></button>` per bird). Silhouette hover **and** selection are arbitrated at
  the container (`hitTest.ts`), not per tile — the tiles are `pointer-events: none`, so the
  tile buttons only ever fire from the keyboard. Selecting a bird opens
  `src/collage/SpeciesCard.tsx` (which replaced the old hover chip) and lifts that bird
  while the rest of the plate recedes; the three tile states (resting / hover / selected)
  are deliberately distinct so the card's subject stays obvious once the pointer moves on.
- **Layout / packer:** `src/collage/layout.ts` — `computeLayout(inputs, vp)` is the
  deterministic, seeded (`src/lib/prng.ts`) count-driven sizing + silhouette packer
  (`pack.ts`); reimplemented from AvianVisitors, not copied. Same inputs + viewport ⇒ same
  layout, so polls and resizes don't churn. `layoutSignature(tiles)` fingerprints the
  arrangement (`sci`/`n`/`key`, viewport-independent) via `src/lib/hash.ts` (`fnv1a`).
- **Entrance bloom:** the `gtile-in` keyframes in `src/index.css` (`.gtile.entering`),
  disabled under `prefers-reduced-motion`. It is a **one-shot CSS mount animation** — it
  replays only when React remounts a tile, i.e. when the tile `key`
  `` `${blossomKey}:${sig}:${sci}` `` changes: `blossomKey` is the window preset and `sig`
  is `layoutSignature`. So the bloom fires on load, window switch, and any in-place update
  (poll / focus revalidation) that yields a genuinely different layout — not on identical
  polls or plain resizes. There is no positional transition on `.gtile`; tiles that don't
  remount just snap.
- **Data hooks (browser reads static files only):** `src/hooks/useRecentSpecies.ts`
  (`/snapshot.json`, 12s poll) selects the active window; `src/hooks/useLayoutManifest.ts`
  (`/layout-manifest.json`, 30s poll) supplies per-species masks/dims/versions. Both use
  SWR's default `revalidateOnFocus`. The dictionary hooks (`useDictionaryIndex.ts`,
  `useSpeciesDictionary.ts`) deliberately set `revalidateOnFocus: false`. There is no
  `SWRConfig` provider. User preferences (`useThemePreference.ts`, `useLanguagePreference.ts`)
  are per-client `localStorage` under `saezuri:*` keys.
- **Domain (framework-free, shared with the server):** `src/domain/` — `species.ts`
  (aggregation + localization), `asset.ts` (`resolveArt`, `imagePath` with the `?v=` hash
  cache-bust), `snapshot.ts`, `manifest.ts`, `slug.ts`.
- **Refresh service (the sole BirdNET-Go client):** `src/server/` — holds the SSE stream,
  gates/aggregates species, and publishes `/snapshot.json`, `/layout-manifest.json`,
  `/calls-manifest.json`, and the e-ink PNG frames (`render.ts`, reusing `computeLayout`).
  Run it with `npm run refresh:dev`.
- **Reference calls:** `src/server/calls.ts` (`CallLibrary`) queues a lookup per newly-heard
  species, mirroring `generate.ts`; `callProviders/` holds one provider per archive behind a
  common interface — `find()` resolves null for "nothing here" (cacheable) and **throws** for
  anything transient, so a rate limit is retried rather than written off. Audio lands in
  `assets/calls/<slug>.<ext>` beside a `<slug>.json` sidecar holding its `CallRecord`; the
  sidecar sits there, not in `cacheDir`, because the credit is a licence obligation and has to
  travel in the same volume as the file it credits. A recording with no sidecar (or vice versa)
  is never published — no credit, no playback.
 
## Common commands
 
- `npm run dev` (Vite dev server) / `npm run dev:mock` (`VITE_MOCK=1`, synthesizes species
  from the local manifest so the collage runs with no backend).
- `npm test` (vitest), `npm run typecheck` (`tsc --noEmit`), `npm run check` (Biome).
- `npm run build` for the production bundle; `npm run refresh:dev` runs the refresh service.
- `docker compose up --build` to run the container against a configured `BIRDNETGO_URL`.
## Git hygiene
 
- Confirm `reference/` is ignored before the first commit.
- Small, focused commits with clear messages, so each change is reviewable on its own.
