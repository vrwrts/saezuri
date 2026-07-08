# Saezuri landing page

A static one-pager (Astro) in the app's kachō-e aesthetic — sent to people who want to
try Saezuri. It reuses the app's design tokens from [`../shared/theme.css`](../shared/theme.css)
(via a Vite alias) so the site and app stay in visual lockstep, including light/dark.

It is a self-contained project: its own `package.json` / `pnpm-lock.yaml`, kept **out of
the app's Docker image** (`site` is in the repo `.dockerignore`).

## Develop

```sh
cd site
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # static output → site/dist
pnpm preview    # serve the built output
pnpm check      # astro type-check
```

## Hero images

`public/hero-light.webp` / `public/hero-dark.webp` are product screenshots of the running
app (captured from `pnpm dev:mock` at the repo root). To refresh them, re-capture the app
in each theme, export ~1400px-wide webp, and drop them in `public/`. They are the only
place the borrowed AvianVisitors art appears; the footer carries the required
CC-BY-NC-SA attribution.

## Deploy — Cloudflare Pages (Git integration)

Configured once in the Cloudflare dashboard; no in-repo workflow or secrets.

1. **Workers & Pages → Create → Pages → Connect to Git**, pick this repo.
2. Build settings:
   - **Root directory:** `site`
   - **Build command:** `pnpm build`
   - **Build output directory:** `dist`
   - Node version comes from `site/.node-version` (22); pnpm is detected from
     `pnpm-lock.yaml` + the `packageManager` field.
3. Save & deploy. Pushes to `main` deploy to production; pull requests get preview URLs.
4. (Optional) add a custom domain under the project's **Custom domains** tab.
