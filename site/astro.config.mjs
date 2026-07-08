import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'

import cloudflare from "@astrojs/cloudflare";

// Static one-pager (output: 'static' is Astro's default — no adapter needed for
// Cloudflare Pages). It shares the app's design tokens from the repo-root
// shared/ folder via a Vite alias; fs.allow lets the dev server read across the
// repo root, and the alias resolves the same way at build time.
export default defineConfig({
  site: 'https://saezuri.pages.dev',

  vite: {
    resolve: {
      alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
    },
    server: { fs: { allow: ['..'] } },
  },

  adapter: cloudflare()
})