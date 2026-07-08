import { describe, expect, it } from 'vitest'
import { buildQuery } from './client.ts'

describe('buildQuery', () => {
  it('drops undefined, null, and empty values', () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: '' })).toBe('?a=1')
  })

  it('serializes and encodes values', () => {
    expect(buildQuery({ start_date: '2026-07-08', includeWeather: true })).toBe(
      '?start_date=2026-07-08&includeWeather=true',
    )
  })

  it('returns an empty string when nothing remains', () => {
    expect(buildQuery({ a: undefined })).toBe('')
  })
})
