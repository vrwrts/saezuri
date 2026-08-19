// Dev-only: synthesize placeholder call recordings for `npm run dev:mock`, so
// the species card's play / stop / loading states can be exercised with no
// backend and no third-party archive. These are SYNTHETIC TONES, not bird calls
// — the real thing arrives via the refresh service.
//
// Named after the same slugs mockCallManifest picks (the first few base keys of
// the local layout manifest, sorted), because callPath derives the filename from
// the species slug. Re-run this whenever the local art set changes.
//
//   node src/dev/mockCalls.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MANIFEST = 'public/layout-manifest.json'
const OUT_DIR = 'public/assets/calls'
const FLIGHT_SUFFIX = '-2'

// Keep in sync with MOCK_CALL_COUNT in mock.ts.
const COUNT = 3

const RATE = 22050
const SECONDS = 1.6
const AMPLITUDE = 12000
/** Notes per second — a few short bursts rather than one continuous tone. */
const PULSE_HZ = 2.2

function chirp(baseHz, warbleHz) {
  const n = Math.floor(RATE * SECONDS)
  const pcm = Buffer.alloc(n * 2)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const freq =
      baseHz + warbleHz * Math.sin(2 * Math.PI * 5.5 * t) + 300 * Math.sin(2 * Math.PI * 0.7 * t)
    phase += (2 * Math.PI * freq) / RATE
    // Sharp attack, exponential decay: reads as a call rather than a beep.
    const beat = (t * PULSE_HZ) % 1
    const env = Math.exp(-6 * beat) * Math.min(1, beat * 40) * (t < SECONDS - 0.1 ? 1 : 0)
    pcm.writeInt16LE(Math.round(Math.sin(phase) * AMPLITUDE * env), i * 2)
  }

  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + pcm.length, 4)
  head.write('WAVE', 8)
  head.write('fmt ', 12)
  head.writeUInt32LE(16, 16) // PCM chunk size
  head.writeUInt16LE(1, 20) // format: PCM
  head.writeUInt16LE(1, 22) // mono
  head.writeUInt32LE(RATE, 24)
  head.writeUInt32LE(RATE * 2, 28) // byte rate
  head.writeUInt16LE(2, 32) // block align
  head.writeUInt16LE(16, 34) // bit depth
  head.write('data', 36)
  head.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([head, pcm])
}

const VOICES = [
  [2600, 700],
  [1900, 400],
  [3400, 1100],
]

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
const slugs = Object.keys(manifest.masks)
  .filter((k) => k !== manifest.fallbackKey && !k.endsWith(FLIGHT_SUFFIX))
  .sort()
  .slice(0, COUNT)

if (slugs.length === 0) {
  console.error(`no species in ${MANIFEST} — generate some art first`)
  process.exit(1)
}

await mkdir(OUT_DIR, { recursive: true })
for (const [i, slug] of slugs.entries()) {
  const [base, warble] = VOICES[i % VOICES.length]
  await writeFile(join(OUT_DIR, `${slug}.wav`), chirp(base, warble))
}
console.log(`wrote ${slugs.length} placeholder calls to ${OUT_DIR}: ${slugs.join(', ')}`)
