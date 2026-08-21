/// <reference types="vitest/config" />

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The browser only ever talks to Saezuri's own origin (CLAUDE.md invariant) and
// reads only static files it publishes — it never calls BirdNET-Go. All
// BirdNET-Go access is backend-only, done by the Node refresh service (run it
// with `pnpm refresh:dev` pointed at BIRDNETGO_URL, publishing into ./public so
// Vite serves the snapshot / manifest / species dictionaries). So there is no
// dev API proxy here.
// Relative asset URLs, because Home Assistant ingress serves the app from a
// per-session path prefix that cannot be baked in at build time. Everything the
// app fetches at runtime is prefixed by src/lib/basePath.ts instead, which reads
// a global nginx injects — vitest reads this same config, so BASE_URL is './'
// in tests too, which is one more reason that helper doesn't use it.
export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    test: {
      // Pure logic tests run in node; component tests opt into jsdom with a
      // `// @vitest-environment jsdom` pragma at the top of the file.
      environment: 'node',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }
})
