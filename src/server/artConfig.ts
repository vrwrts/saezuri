import { join } from 'node:path'

// Where the art lives and where it comes from. Shared by the refresh service and the
// contribute command, which must agree on both: the command reads the art the service
// wrote, and contributes back to the repo the service downloads from.

export const DEFAULT_ILLUSTRATIONS_REPO = 'vrwrts/saezuri-illustrations'

export interface ArtConfig {
  htmlDir: string
  assetsDir: string
  workerScript: string
  /** Notes files, layered in order (bundled pipeline file first, operator's over it). */
  notesPaths: string[]
  /** owner/name, or '' when the operator turned downloading off. */
  illustrationsRepo: string
  illustrationsRef: string
}

export function readArtConfig(env: NodeJS.ProcessEnv = process.env): ArtConfig {
  const htmlDir = (env.FRAME_HTML_DIR ?? '/usr/share/nginx/html').trim()
  const workerScript = (env.WORKER_SCRIPT ?? '/opt/saezuri/pipeline/worker.py').trim()
  const assetsDir = join(htmlDir, 'assets', 'illustrations')
  // Prompt addenda, layered: the pipeline's own species-notes.json carries what the
  // community has learned, and an operator's file refines it per key. The operator's
  // has to sit on the writable volume — beside the art is where they will look for it.
  // Both layers are passed to the pipeline verbatim; it prepends the bundled one
  // itself, and merging a layer twice is a no-op, so the duplicate is harmless and
  // keeps this list identical to the one the service hashes for note changes.
  const notesPaths = [
    join(workerScript, '..', 'species-notes.json'),
    (env.SPECIES_NOTES ?? '').trim() || join(assetsDir, '_species-notes.json'),
  ]
  return {
    htmlDir,
    assetsDir,
    workerScript,
    notesPaths,
    illustrationsRepo: (env.ILLUSTRATIONS_REPO ?? DEFAULT_ILLUSTRATIONS_REPO).trim(),
    illustrationsRef: (env.ILLUSTRATIONS_REF ?? 'main').trim(),
  }
}
