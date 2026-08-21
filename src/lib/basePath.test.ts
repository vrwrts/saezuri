// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeBasePath } from './basePath.ts'

describe('normalizeBasePath', () => {
  it('is empty when the app is served from the root', () => {
    for (const raw of [undefined, '', '/']) {
      expect(normalizeBasePath(raw)).toBe('')
    }
  })

  it('keeps an ingress prefix with a leading and no trailing slash', () => {
    expect(normalizeBasePath('/api/hassio_ingress/abc123')).toBe('/api/hassio_ingress/abc123')
    expect(normalizeBasePath('/api/hassio_ingress/abc123/')).toBe('/api/hassio_ingress/abc123')
    expect(normalizeBasePath('api/hassio_ingress/abc123')).toBe('/api/hassio_ingress/abc123')
  })
})

// BASE_PATH is read once at module load, so each case needs a fresh module graph.
async function loadWithBase(injected: string | undefined) {
  if (injected === undefined) delete window.__SAEZURI_BASE__
  else window.__SAEZURI_BASE__ = injected
  vi.resetModules()
  return (await import('./basePath.ts')).withBase
}

describe('withBase', () => {
  beforeEach(() => {
    delete window.__SAEZURI_BASE__
  })

  it('leaves URLs untouched when nginx injected nothing (every non-ingress deployment)', async () => {
    const withBase = await loadWithBase(undefined)
    expect(withBase('/snapshot.json')).toBe('/snapshot.json')
    expect(withBase('/assets/illustrations/turdus-merula.png')).toBe(
      '/assets/illustrations/turdus-merula.png',
    )
  })

  it('prefixes URLs with the ingress path', async () => {
    const withBase = await loadWithBase('/api/hassio_ingress/abc123')
    expect(withBase('/snapshot.json')).toBe('/api/hassio_ingress/abc123/snapshot.json')
    expect(withBase('/assets/illustrations/turdus-merula.png')).toBe(
      '/api/hassio_ingress/abc123/assets/illustrations/turdus-merula.png',
    )
  })
})
