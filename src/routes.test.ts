import { describe, expect, it } from 'vitest'
import { pathToPreset, WINDOW_PRESETS } from './domain/window.ts'
import { collagePath } from './routes.ts'

describe('collagePath', () => {
  it('addresses each window at the root', () => {
    expect(collagePath('24H')).toBe('/24h')
    expect(collagePath('ALL')).toBe('/all')
  })

  it('produces a last segment that parses back to the preset', () => {
    for (const p of WINDOW_PRESETS) {
      const segment = collagePath(p).split('/').pop() ?? ''
      expect(pathToPreset(segment)).toBe(p)
    }
  })
})
