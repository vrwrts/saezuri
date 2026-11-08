import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DictionaryIndex } from '../domain/dictionary.ts'
import { type DictLocale, SUPPORTED_DICT_LOCALES } from '../domain/locale.ts'
import { slugify } from '../domain/slug.ts'
import { birdnetFetch } from './birdnet.ts'

// The refresh service downloads BirdNET-Go's species-name dictionaries and
// republishes them as static files under <htmlDir>/species-dict/, so the browser
// localizes display names from its own origin rather than calling BirdNET-Go.

const TAG = 'saezuri-dictionaries'
const log = (msg: string) => console.log(`${TAG}: ${msg}`)

export interface PublishDictionariesConfig {
  baseUrl: string
  token?: string
  htmlDir: string
  /** Which dictionary locales to attempt (default: all supported). */
  locales?: readonly DictLocale[]
}

async function writeJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(data))
  await rename(tmp, path)
}

export interface PublishedDictionaries {
  index: DictionaryIndex
  /** slug -> species name, over every species BirdNET-Go knows — not just the ones
   *  this station has heard. Lets the refresh service name a cutout it finds on disk
   *  whose bird predates the detection window, so a deleted pose can be regenerated
   *  under the right name instead of a guess reversed out of the slug. */
  sciBySlug: ReadonlyMap<string, { sci: string; com: string }>
}

/** English if it was published, else whatever was — the keys (scientific names) are
 *  the same in every locale, only the display name differs. */
function buildSciBySlug(
  published: readonly DictLocale[],
  maps: ReadonlyMap<DictLocale, Record<string, string>>,
): ReadonlyMap<string, { sci: string; com: string }> {
  const locale = published.includes('en') ? 'en' : published[0]
  const map = locale ? maps.get(locale) : undefined
  const out = new Map<string, { sci: string; com: string }>()
  if (!map) return out
  for (const [sci, com] of Object.entries(map)) {
    const slug = slugify(sci)
    if (slug) out.set(slug, { sci, com: com || sci })
  }
  return out
}

/** Download each requested species dictionary from BirdNET-Go and publish it as a
 *  static file under <htmlDir>/species-dict/, plus an index.json listing what was
 *  published. Locales the backend lacks (404) or
 *  that fail are skipped, so an older build simply yields an empty index and the
 *  browser falls back to the station's own names. Returns the published index plus
 *  a slug index (see buildSciBySlug). */
export async function publishDictionaries(
  cfg: PublishDictionariesConfig,
): Promise<PublishedDictionaries> {
  const dir = join(cfg.htmlDir, 'species-dict')
  await mkdir(dir, { recursive: true })
  const wanted = cfg.locales ?? SUPPORTED_DICT_LOCALES
  const published: DictLocale[] = []
  const maps = new Map<DictLocale, Record<string, string>>()

  for (const locale of wanted) {
    try {
      const res = await birdnetFetch(cfg.baseUrl, cfg.token, `/species/dictionary/${locale}`)
      if (!res.ok) continue // 404 on older builds / unsupported locale — skip quietly
      const map = (await res.json()) as Record<string, string>
      await writeJson(join(dir, `${locale}.json`), map)
      published.push(locale)
      maps.set(locale, map)
    } catch (e) {
      log(`skip ${locale}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const index: DictionaryIndex = { locales: published }
  await writeJson(join(dir, 'index.json'), index)
  log(`published ${published.length}/${wanted.length} dictionaries`)
  return { index, sciBySlug: buildSciBySlug(published, maps) }
}
