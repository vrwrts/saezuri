import { birdnetFetch } from '../birdnet.ts'
import type { CallCandidate, CallProvider } from './types.ts'

const MAX_BYTES = 16 * 1024 * 1024
const MAX_DETECTION_ATTEMPTS = 10
const PLAYABLE_EXT = new Set(['mp3', 'ogg', 'opus', 'wav', 'flac', 'm4a'])

function playableExtension(clipName: string): string | null {
  const dot = clipName.lastIndexOf('.')
  if (dot < 0) return null
  const ext = clipName.slice(dot + 1).toLowerCase()
  return PLAYABLE_EXT.has(ext) ? ext : null
}

function isAudio(res: Response): boolean {
  const mime = res.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  return !mime || mime.startsWith('audio/') || mime === 'application/ogg'
}

export function birdnetProvider(baseUrl: string, token?: string): CallProvider {
  return {
    name: 'birdnet',
    sourceKey: ({ detections }) => (detections[0] ? String(detections[0].id) : undefined),
    async find({ detections, current }, signal) {
      let attempts = 0
      for (const detection of detections) {
        if (current?.provider === 'birdnet' && current.sourceKey === String(detection.id)) {
          return null
        }
        const ext = playableExtension(detection.clipName)
        if (!ext) continue
        if (attempts >= MAX_DETECTION_ATTEMPTS) break
        attempts++

        const res = await birdnetFetch(baseUrl, token, '/media/audio', {
          accept: 'audio/*',
          params: { id: detection.id },
          signal,
        })
        if (res.status === 404) {
          await res.body?.cancel()
          continue
        }
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = res.headers.get('retry-after')
          await res.body?.cancel()
          throw new Error(
            `birdnet ${res.status}${retryAfter ? ` (retry-after ${retryAfter})` : ''}`,
          )
        }
        // Only 404 means this particular saved clip is absent. Authentication
        // or API errors must remain retryable after the operator fixes them.
        if (!res.ok) {
          await res.body?.cancel()
          throw new Error(`birdnet ${res.status}`)
        }
        if (!isAudio(res)) {
          await res.body?.cancel()
          throw new Error(`birdnet ${res.status} non-audio response`)
        }

        const declared = Number(res.headers.get('content-length') ?? '0')
        if (declared > MAX_BYTES) {
          await res.body?.cancel()
          continue
        }
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) continue

        return {
          bytes,
          ext,
          sourceKey: String(detection.id),
          recordist: '',
          sourceName: 'BirdNET-Go',
        } satisfies CallCandidate
      }
      return null
    },
  }
}
