import { describe, expect, it } from 'vitest'
import { pathToPreset, WINDOW_PRESETS } from './domain/window.ts'
import { collagePath } from './routes.ts'

describe('collagePath', () => {
  it('nests each window under the collage base', () => {
    expect(collagePath('24H')).toBe('/collage/24h')
    expect(collagePath('ALL')).toBe('/collage/all')
  })

  it('produces a last segment that parses back to the preset', () => {
    for (const p of WINDOW_PRESETS) {
      const segment = collagePath(p).split('/').pop() ?? ''
      expect(pathToPreset(segment)).toBe(p)
    }
  })
})
