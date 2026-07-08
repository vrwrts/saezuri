/// <reference types="vitest/config" />

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The browser only ever talks to Saezuri's own origin (CLAUDE.md invariant).
// In production nginx proxies /api/ to BIRDNETGO_URL; in dev the Vite proxy
// stands in for nginx so the app behaves identically. Point it at your
// instance with BIRDNETGO_URL in a .env.local file (never committed).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.BIRDNETGO_URL || 'http://localhost:8080'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': { target, changeOrigin: true },
      },
    },
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
