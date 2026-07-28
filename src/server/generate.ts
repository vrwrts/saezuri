import { spawn } from 'node:child_process'
import { slugify } from '../domain/slug.ts'

// Generation queue: turns "this species was heard but has no cutout" into calls
// to the Python pipeline (worker.py --generate). Deduped by slug, serialized
// (one pipeline run at a time, so Gemini calls stay throttled), and capped per
// batch. After a batch, onGenerated lets the service reload the manifest and
// republish so the new art appears. Disabled (no-op) without GEMINI_API_KEY.

export interface Species {
  sci: string
  com: string
}

export interface GeneratorOptions {
  pythonBin: string
  workerScript: string
  assetsDir: string
  cacheDir: string
  /** Max species per pipeline invocation (0 = no cap). */
  maxPerCycle: number
  /** GEMINI_API_KEY present — otherwise generation is skipped entirely. */
  enabled: boolean
  /** Called after each batch completes (reload manifest + republish). */
  onGenerated: () => void | Promise<void>
}

const TAG = 'saezuri-generate'
const logErr = (e: unknown) =>
  console.error(`${TAG}: ${e instanceof Error ? e.message : String(e)}`)

export class Generator {
  private queued = new Map<string, Species>() // slug -> species awaiting generation
  private inFlight = new Set<string>() // slugs currently being generated
  private busy = false

  constructor(private opts: GeneratorOptions) {}

  /** Enqueue a species for art generation. No-ops when disabled, already
   *  queued, or already in flight. */
  enqueue(sci: string, com: string): void {
    if (!this.opts.enabled) return
    const slug = slugify(sci)
    if (!slug || this.inFlight.has(slug) || this.queued.has(slug)) return
    this.queued.set(slug, { sci, com })
    void this.drain()
  }

  private take(n: number): Species[] {
    const out: Species[] = []
    for (const [slug, sp] of this.queued) {
      this.queued.delete(slug)
      out.push(sp)
      if (out.length >= n) break
    }
    return out
  }

  private async drain(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (this.queued.size > 0) {
        const cap = this.opts.maxPerCycle > 0 ? this.opts.maxPerCycle : this.queued.size
        const batch = this.take(cap)
        for (const s of batch) this.inFlight.add(slugify(s.sci))
        try {
          await this.spawnGenerate(batch)
          // Reload the manifest + republish BEFORE clearing inFlight, so a fresh
          // detection for the just-generated species sees its art and isn't
          // re-enqueued.
          await this.opts.onGenerated()
        } catch (e) {
          logErr(e)
        } finally {
          for (const s of batch) this.inFlight.delete(slugify(s.sci))
        }
      }
    } finally {
      this.busy = false
    }
  }

  private spawnGenerate(batch: Species[]): Promise<void> {
    const args = [
      this.opts.workerScript,
      '--generate',
      ...batch.map((s) => `${s.sci}|${s.com}`),
      '--assets-dir',
      this.opts.assetsDir,
      '--cache-dir',
      this.opts.cacheDir,
    ]
    return this.spawn(args)
  }

  /** Ensure a manifest (and the fallback silhouette) exist without generating —
   *  run once at startup so the browser always fetches a real manifest file. */
  rebuildManifest(): Promise<void> {
    return this.spawn([
      this.opts.workerScript,
      '--rebuild',
      '--assets-dir',
      this.opts.assetsDir,
      '--cache-dir',
      this.opts.cacheDir,
    ])
  }

  private spawn(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.pythonBin, args, { stdio: 'inherit', env: process.env })
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`${this.opts.pythonBin} exited ${code}`)),
      )
    })
  }
}
