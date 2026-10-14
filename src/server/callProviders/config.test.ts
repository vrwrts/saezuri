import { describe, expect, it } from 'vitest'
import { parseCallProviders } from './config.ts'

describe('parseCallProviders', () => {
  it('keeps Commons as the default and an empty value as off', () => {
    expect(parseCallProviders(undefined)).toEqual(['commons'])
    expect(parseCallProviders('')).toEqual([])
  })

  it('preserves configured order and drops unknown or duplicate names', () => {
    expect(parseCallProviders('commons,birdnet')).toEqual(['commons', 'birdnet'])
    expect(parseCallProviders('birdnet,unknown,commons,birdnet')).toEqual(['birdnet', 'commons'])
    expect(parseCallProviders(' unknown ')).toEqual(['commons'])
  })
})
