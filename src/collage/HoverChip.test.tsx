import { describe, expect, it } from 'vitest'
import { formatCalls } from './HoverChip.tsx'

describe('formatCalls', () => {
  it('pluralizes the unit around the count', () => {
    expect(formatCalls(0)).toBe('0 calls')
    expect(formatCalls(1)).toBe('1 call')
    expect(formatCalls(756)).toBe('756 calls')
  })

  it('groups thousands', () => {
    expect(formatCalls(1234)).toBe('1,234 calls')
  })
})
