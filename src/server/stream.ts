import type { DetectionResponse } from '../api/types.ts'
import { birdnetFetch } from './birdnet.ts'

// SSE consumer for BirdNET-Go's GET /api/v2/detections/stream — the same stream
// its own dashboard uses. One persistent connection pushes every detection the
// instant it's processed, so we react without polling the (expensive, uncached)
// summary endpoint. We use fetch rather than the platform EventSource because we
// need to send the optional bearer token as a header.
//
// The server closes the stream every ~30 min and heartbeats every 15s; the loop
// reconnects with a floor of 6s (the server rate-limits to 10 conns/min/IP).
// Each (re)connect fires onConnect so the caller can re-backfill and heal any
// gap — the stream is best-effort on top of an authoritative periodic backfill.

const RECONNECT_FLOOR_MS = 6000

export interface SSEEvent {
  event: string
  data: string
}

/** Parse whatever complete SSE events are buffered, returning them plus the
 *  unconsumed tail. Pure, so it's unit-testable by feeding chunks. */
export function parseSSEChunk(buffer: string): { events: SSEEvent[]; rest: string } {
  let rest = buffer.replace(/\r\n?/g, '\n')
  const events: SSEEvent[] = []
  for (;;) {
    const sep = rest.indexOf('\n\n')
    if (sep === -1) break
    const block = rest.slice(0, sep)
    rest = rest.slice(sep + 2)
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue // blank / comment (heartbeat keep-alive)
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') event = value
      else if (field === 'data') dataLines.push(value)
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join('\n') })
  }
  return { events, rest }
}

/** Map a `detection` SSE payload (SSEDetectionData, camelCase) onto the REST
 *  DetectionResponse shape so it feeds the store alongside the backfill and
 *  reuses aggregateDetections. Returns null for anything unusable. */
export function normalizeDetection(data: unknown): DetectionResponse | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (typeof d.id !== 'number' || typeof d.scientificName !== 'string') return null
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
  return {
    id: d.id,
    date: str(d.date),
    time: str(d.time),
    timestamp: typeof d.timestamp === 'string' ? d.timestamp : undefined,
    beginTime: str(d.beginTime),
    endTime: str(d.endTime),
    scientificName: d.scientificName,
    commonName: str(d.commonName, d.scientificName),
    confidence: typeof d.confidence === 'number' ? d.confidence : 0,
    verified: (d.verified === 'correct' || d.verified === 'false_positive'
      ? d.verified
      : 'unverified') as DetectionResponse['verified'],
    locked: Boolean(d.locked),
    speciesCode: typeof d.speciesCode === 'string' ? d.speciesCode : undefined,
  }
}

export interface StreamOptions {
  baseUrl: string
  token?: string
  /** Abort to stop the loop (e.g. shutdown). */
  signal?: AbortSignal
  /** Reconnect floor; clamped to ≥6000ms to respect the server rate limit. */
  reconnectMinMs?: number
}

export interface StreamHandlers {
  onDetection: (row: DetectionResponse) => void
  /** Fired after each successful (re)connect — re-backfill here. */
  onConnect?: () => void | Promise<void>
  onError?: (e: unknown) => void
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })
}

async function connectOnce(opts: StreamOptions, handlers: StreamHandlers): Promise<void> {
  const res = await birdnetFetch(opts.baseUrl, opts.token, '/detections/stream', {
    accept: 'text/event-stream',
    signal: opts.signal,
  })
  if (!res.ok || !res.body) throw new Error(`stream ${res.status} ${res.statusText}`)
  await handlers.onConnect?.()

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { events, rest } = parseSSEChunk(buffer)
    buffer = rest
    for (const ev of events) {
      if (ev.event !== 'detection') continue
      let parsed: unknown
      try {
        parsed = JSON.parse(ev.data)
      } catch {
        continue
      }
      const row = normalizeDetection(parsed)
      if (row) handlers.onDetection(row)
    }
  }
}

/** Hold the detection stream open, reconnecting until the signal aborts. */
export async function runDetectionStream(
  opts: StreamOptions,
  handlers: StreamHandlers,
): Promise<void> {
  const backoff = Math.max(RECONNECT_FLOOR_MS, opts.reconnectMinMs ?? RECONNECT_FLOOR_MS)
  while (!opts.signal?.aborted) {
    try {
      await connectOnce(opts, handlers)
    } catch (e) {
      if (opts.signal?.aborted) break
      handlers.onError?.(e)
    }
    if (opts.signal?.aborted) break
    await delay(backoff, opts.signal)
  }
}
