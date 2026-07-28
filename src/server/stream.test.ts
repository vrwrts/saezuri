import { describe, expect, it } from 'vitest'
import { normalizeDetection, parseSSEChunk } from './stream.ts'

describe('parseSSEChunk', () => {
  it('extracts complete events and returns the partial tail', () => {
    const buffer =
      'event: connected\ndata: {"clientId":"x"}\n\n' +
      'event: detection\ndata: {"id":1}\n\n' +
      'event: detection\ndata: {"id":2}' // no trailing blank line yet
    const { events, rest } = parseSSEChunk(buffer)
    expect(events).toEqual([
      { event: 'connected', data: '{"clientId":"x"}' },
      { event: 'detection', data: '{"id":1}' },
    ])
    expect(rest).toBe('event: detection\ndata: {"id":2}')
  })

  it('handles CRLF and skips comment/heartbeat lines', () => {
    const { events } = parseSSEChunk(':keep-alive\r\n\r\nevent: heartbeat\r\ndata: {"t":1}\r\n\r\n')
    expect(events).toEqual([{ event: 'heartbeat', data: '{"t":1}' }])
  })
})

describe('normalizeDetection', () => {
  it('maps a detection payload onto the DetectionResponse shape', () => {
    const row = normalizeDetection({
      id: 42,
      date: '2026-07-08',
      time: '09:09:54',
      timestamp: '2026-07-08T09:09:54+03:00',
      scientificName: 'Turdus merula',
      commonName: 'Blackbird',
      confidence: 0.87,
      verified: 'unverified',
    })
    expect(row).toMatchObject({
      id: 42,
      scientificName: 'Turdus merula',
      commonName: 'Blackbird',
      confidence: 0.87,
      timestamp: '2026-07-08T09:09:54+03:00',
      verified: 'unverified',
    })
  })

  it('preserves false_positive so aggregation can exclude it', () => {
    expect(
      normalizeDetection({ id: 1, scientificName: 'X', verified: 'false_positive' })?.verified,
    ).toBe('false_positive')
  })

  it('rejects payloads missing an id or scientific name', () => {
    expect(normalizeDetection({ scientificName: 'X' })).toBeNull()
    expect(normalizeDetection({ id: 1 })).toBeNull()
    expect(normalizeDetection(null)).toBeNull()
  })
})
