// Home Assistant ingress serves the app from a per-session path
// (/api/hassio_ingress/<token>) that cannot be known at build time, so nginx
// injects it into index.html as a global and everything the browser fetches is
// prefixed with it at runtime.
//
// Deliberately NOT `import.meta.env.BASE_URL`: this module is reachable from
// src/domain/asset.ts, which src/server/render.ts imports and esbuild bundles
// for Node, where `import.meta.env` does not exist. The `window` guard keeps the
// prefix empty there, which is what the e-ink renderer wants.

declare global {
  interface Window {
    __SAEZURI_BASE__?: string
  }
}

/** Empty for a root-served app, otherwise a prefix with a leading and no
 *  trailing slash, so `${BASE_PATH}/snapshot.json` composes either way. */
export function normalizeBasePath(raw: string | undefined): string {
  if (!raw) return ''
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`
  const trimmed = withLeadingSlash.replace(/\/+$/, '')
  return trimmed
}

// Read once at module load: the injected value cannot change without a document
// reload, and a stable constant keeps SWR cache keys stable across renders.
export const BASE_PATH = normalizeBasePath(
  typeof window === 'undefined' ? undefined : window.__SAEZURI_BASE__,
)

export function withBase(path: string): string {
  return `${BASE_PATH}${path}`
}
