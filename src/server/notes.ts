import { readFile } from 'node:fs/promises'
import { slugify } from '../domain/slug.ts'
import { fnv1a } from '../lib/hash.ts'

// Per-species prompt addenda. The pipeline is what actually injects these into the
// image prompt (pregen.py: load_species_notes / note_for); the service reads them
// only to notice that a note CHANGED, which is what lets it re-render art it
// generated under an older note. Both sides must resolve a species to the same
// note, so the layering order and the scientific-name-then-slug lookup here are
// kept in parity with pregen.py deliberately — change one and change the other.

const TAG = 'saezuri-notes'
const logErr = (msg: string) => console.error(`${TAG}: ${msg}`)

export type SpeciesNotes = Readonly<Record<string, string>>

/** Load and layer notes files, later paths winning per key — the bundled pipeline
 *  file first, an operator's own file over it. A missing file contributes nothing;
 *  a malformed one is reported and skipped rather than taking generation down with
 *  it, since these are hand-edited. */
export async function loadNotes(paths: readonly string[]): Promise<SpeciesNotes> {
  const merged: Record<string, string> = {}
  for (const path of paths) {
    if (!path) continue
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      continue // absent is the normal case for the operator layer
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        logErr(`ignoring ${path}: not a JSON object`)
        continue
      }
      for (const [key, value] of Object.entries(parsed)) {
        // `_`-prefixed keys are comments, matching the convention used for
        // `_fallback.png` and the call library's `_misses.json`.
        if (!key.startsWith('_') && typeof value === 'string') merged[key] = value
      }
    } catch (e) {
      logErr(`ignoring ${path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return merged
}

/** Resolve a species' note by scientific name, falling back to its slug. */
export function noteFor(notes: SpeciesNotes, scientificName: string): string | undefined {
  return notes[scientificName] ?? notes[slugify(scientificName)]
}

/** Short token identifying the note a pose was generated under. `undefined` for no
 *  note, so "never had one" and "had one that was removed" compare as different. */
export function noteVersion(note: string | undefined): string | undefined {
  return note === undefined ? undefined : fnv1a(note).toString(36)
}
