import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DictionaryIndex } from '../domain/dictionary.ts'
import { type DictLocale, reduceToDictLocale, SUPPORTED_DICT_LOCALES } from '../domain/locale.ts'
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

/** Best-effort read of the station's configured language from the PUBLIC dashboard
 *  settings (the `locale` field), reduced to a dictionary code. Used only as the
 *  fallback preselect when the viewer's browser language isn't published; a failure
 *  or a non-dictionary locale just yields null. (The precise name-resolution locale,
 *  BirdNET.Locale, lives behind an auth-gated endpoint; the public dashboard locale
 *  is the same in typical single-language setups and is all we need here.) */
async function fetchStationDefault(baseUrl: string, token?: string): Promise<DictLocale | null> {
  try {
    const res = await birdnetFetch(baseUrl, token, '/settings/dashboard')
    if (!res.ok) return null
    const data = (await res.json()) as { locale?: string }
    return data.locale ? reduceToDictLocale(data.locale, SUPPORTED_DICT_LOCALES) : null
  } catch {
    return null
  }
}

/** Download each requested species dictionary from BirdNET-Go and publish it as a
 *  static file under <htmlDir>/species-dict/, plus an index.json listing what was
 *  published and the station's default language. Locales the backend lacks (404) or
 *  that fail are skipped, so an older build simply yields an empty index and the
 *  browser falls back to the station's own names. Returns the published index. */
export async function publishDictionaries(
  cfg: PublishDictionariesConfig,
): Promise<DictionaryIndex> {
  const dir = join(cfg.htmlDir, 'species-dict')
  await mkdir(dir, { recursive: true })
  const wanted = cfg.locales ?? SUPPORTED_DICT_LOCALES
  const published: DictLocale[] = []

  for (const locale of wanted) {
    try {
      const res = await birdnetFetch(cfg.baseUrl, cfg.token, `/species/dictionary/${locale}`)
      if (!res.ok) continue // 404 on older builds / unsupported locale — skip quietly
      const map = (await res.json()) as Record<string, string>
      await writeJson(join(dir, `${locale}.json`), map)
      published.push(locale)
    } catch (e) {
      log(`skip ${locale}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const index: DictionaryIndex = {
    locales: published,
    default: await fetchStationDefault(cfg.baseUrl, cfg.token),
  }
  await writeJson(join(dir, 'index.json'), index)
  log(
    `published ${published.length}/${wanted.length} dictionaries (default: ${index.default ?? 'none'})`,
  )
  return index
}
