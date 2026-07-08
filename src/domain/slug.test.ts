import { describe, expect, it } from 'vitest'
import { slugify } from './slug.ts'

describe('slugify', () => {
  it('matches the AvianVisitors filename rule', () => {
    expect(slugify('Calypte anna')).toBe('calypte-anna')
    expect(slugify('Accipiter cooperii')).toBe('accipiter-cooperii')
    expect(slugify('Turdus merula')).toBe('turdus-merula')
  })

  it('collapses punctuation and trims hyphens', () => {
    expect(slugify("Anna's Hummingbird")).toBe('anna-s-hummingbird')
    expect(slugify('  Passer   domesticus  ')).toBe('passer-domesticus')
    expect(slugify('Motacilla alba (yarrellii)')).toBe('motacilla-alba-yarrellii')
  })
})
