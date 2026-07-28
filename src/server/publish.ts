import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hasArt } from '../domain/asset.ts'
import { DEFAULT_MANIFEST } from '../domain/defaultManifest.ts'
import type { LayoutManifest } from '../domain/manifest.ts'
import type { Snapshot, WindowSnapshot } from '../domain/snapshot.ts'
import type { Species } from '../domain/species.ts'
import {
  presetToSegment,
  resolveWindow,
  WINDOW_PRESETS,
  type WindowSegment,
} from '../domain/window.ts'
import type { DetectionStore } from './store.ts'

export interface SnapshotInputs {
  store: DetectionStore
  /** All-time species from the summary endpoint (for the ALL window). */
  allSpecies: Species[]
  manifest: LayoutManifest
  now: number
}

/** Build the per-window snapshot, gating each window to illustrated species and
 *  recording the withheld tail (`heard`/`notIllustrated`). Pure. */
export function buildSnapshot({ store, allSpecies, manifest, now }: SnapshotInputs): Snapshot {
  const windows = {} as Record<WindowSegment, WindowSnapshot>
  for (const preset of WINDOW_PRESETS) {
    const seg = presetToSegment(preset)
    const w = resolveWindow(preset, now)
    let species: Species[]
    let truncated: boolean
    if (w.kind === 'all') {
      species = allSpecies
      truncated = false
    } else {
      species = store.aggregate(w.sinceMs)
      truncated = store.truncated(w.sinceMs)
    }
    const gated = species.filter((s) => hasArt(manifest, s.sci))
    windows[seg] = {
      species: gated,
      truncated,
      heard: species.length,
      notIllustrated: species.length - gated.length,
    }
  }
  return { generatedAt: now, windows }
}

/** Atomically write snapshot.json into the served html dir (tmp + rename, so
 *  nginx never serves a half-written file). Callers rebuild the manifest first,
 *  so a snapshot never references art the manifest doesn't yet describe. */
export async function writeSnapshot(htmlDir: string, snapshot: Snapshot): Promise<void> {
  const path = join(htmlDir, 'snapshot.json')
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(snapshot))
  await rename(tmp, path)
}

/** Read the manifest the pipeline writes to the html dir; fall back to the
 *  built-in single-silhouette manifest when it is absent or malformed (a
 *  display-only container before any build_masks run). */
export async function loadManifest(htmlDir: string): Promise<LayoutManifest> {
  try {
    const raw = await readFile(join(htmlDir, 'layout-manifest.json'), 'utf8')
    const data = JSON.parse(raw) as LayoutManifest
    if (data.masks && data.fallbackKey && data.fallbackKey in data.masks) return data
  } catch {
    // missing / unreadable / invalid JSON — use the fallback
  }
  return DEFAULT_MANIFEST
}
