import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { slugify } from '../domain/slug.ts'
import type { Snapshot } from '../domain/snapshot.ts'
import { type ArtConfig, readArtConfig } from './artConfig.ts'
import {
  contribute,
  findGeneratedArt,
  planContribution,
  readProposed,
  readUpstream,
  type Skip,
  type SpeciesInfo,
} from './contribution.ts'
import { gitHubClient } from './github.ts'
import { loadNotes, noteFor } from './notes.ts'

// `saezuri-contribute`: offers the illustrations this deployment generated to the shared
// illustrations repo as a pull request. Run by hand inside the container, never by the
// service: it acts on GitHub as the operator and publishes their art under a licence, so
// it takes a token only for the duration of the command and asks before it does anything.

const USAGE = `Usage: saezuri-contribute [options]

Opens a pull request adding the illustrations this Saezuri generated, and that the
illustrations repo doesn't have yet, to that repo.

  --dry-run          list what would be contributed, and stop (no token needed)
  --no-pr            push the branch to your fork, but leave opening the PR to you
  --only <list>      contribute only these species (comma-separated slugs or scientific names)
  --exclude <list>   leave these species out
  --repo <owner/name>  target repo (default: ILLUSTRATIONS_REPO, else vrwrts/saezuri-illustrations)
  -y, --yes          don't ask for confirmation
  -h, --help         show this help

Needs a GitHub token in GITHUB_TOKEN (or GH_TOKEN) that can fork public repos and open
pull requests: a classic token with the public_repo scope, or \`gh auth token\`.
  docker exec -it -e GITHUB_TOKEN="$(gh auth token)" saezuri saezuri-contribute`

const slugSet = (list: string | undefined) =>
  new Set(
    (list ?? '')
      .split(',')
      .map((s) => slugify(s.trim()))
      .filter(Boolean),
  )

/** English names, then whatever the snapshot has, for the species being contributed —
 *  the PR is read by maintainers, not by this station's audience. */
async function loadSpeciesInfo(
  cfg: ArtConfig,
  slugs: readonly string[],
): Promise<Map<string, SpeciesInfo>> {
  const names = new Map<string, { sci: string; com: string }>()
  const add = (sci: string, com: string) => {
    const slug = slugify(sci)
    if (slug && !names.has(slug)) names.set(slug, { sci, com: com || sci })
  }
  try {
    const dict = JSON.parse(
      await readFile(join(cfg.htmlDir, 'species-dict', 'en.json'), 'utf8'),
    ) as Record<string, string>
    for (const [sci, com] of Object.entries(dict)) add(sci, com)
  } catch {
    // Not published (yet): the snapshot below still names every species heard.
  }
  try {
    const snapshot = JSON.parse(
      await readFile(join(cfg.htmlDir, 'snapshot.json'), 'utf8'),
    ) as Snapshot
    for (const w of Object.values(snapshot.windows)) for (const s of w.species) add(s.sci, s.com)
  } catch {
    // Without names the PR lists slugs, which is all the repo itself records anyway.
  }

  const bundled = await loadNotes(cfg.notesPaths.slice(0, 1))
  const layered = await loadNotes(cfg.notesPaths)
  const info = new Map<string, SpeciesInfo>()
  for (const slug of slugs) {
    const name = names.get(slug)
    if (!name) continue
    const note = noteFor(layered, name.sci)
    info.set(slug, { ...name, localNote: note !== noteFor(bundled, name.sci) ? note : undefined })
  }
  return info
}

function printSkipped(skipped: readonly Skip[]): void {
  if (skipped.length === 0) return
  console.log('\nHeld back:')
  for (const s of skipped) console.log(`  ${s.slug}: ${s.reason}`)
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim())
  } finally {
    rl.close()
  }
}

async function main(): Promise<number> {
  const { values: args } = parseArgs({
    options: {
      'dry-run': { type: 'boolean' },
      'no-pr': { type: 'boolean' },
      only: { type: 'string' },
      exclude: { type: 'string' },
      repo: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (args.help) {
    console.log(USAGE)
    return 0
  }

  const cfg = readArtConfig()
  const repo = (args.repo ?? cfg.illustrationsRepo).trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error('No illustrations repo to contribute to: pass --repo <owner/name>.')
    return 2
  }
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim() || undefined
  const dryRun = args['dry-run'] === true
  if (!token && !dryRun) {
    console.error(`GITHUB_TOKEN is not set.\n\n${USAGE}`)
    return 2
  }

  const only = slugSet(args.only)
  const exclude = slugSet(args.exclude)
  const selected = (slug: string) => (only.size === 0 || only.has(slug)) && !exclude.has(slug)
  const found = await findGeneratedArt(cfg.assetsDir)
  const wanted = found.poses.filter((p) => selected(p.slug))
  const rejected = found.skipped.filter((s) => selected(s.slug))
  if (wanted.length === 0) {
    console.log(`No generated illustrations to contribute in ${cfg.assetsDir}.`)
    printSkipped(rejected)
    return 0
  }

  const gh = gitHubClient(token)
  const upstream = await readUpstream(gh, repo)
  const proposed = await readProposed(gh, repo)
  const plan = planContribution(wanted, upstream.stems, proposed)
  const info = await loadSpeciesInfo(
    cfg,
    plan.species.map((s) => s.slug),
  )
  const skipped = [...rejected, ...plan.skipped]

  if (plan.species.length === 0) {
    console.log(`Nothing new to contribute to ${repo}.`)
    printSkipped(skipped)
    return 0
  }

  const images = plan.species.reduce((n, s) => n + s.stems.length, 0)
  console.log(
    `Ready to contribute to ${repo}: ${plan.species.length} species, ${images} image(s)\n`,
  )
  for (const s of plan.species) {
    const i = info.get(s.slug)
    const label = i ? `${i.com} (${i.sci})` : s.slug
    const poses = s.stems.map((stem) => (stem === s.slug ? 'perched' : 'flight')).join(' + ')
    console.log(`  ${label}: ${poses}${i?.localNote ? '  [local prompt note]' : ''}`)
  }
  printSkipped(skipped)
  console.log('')

  if (dryRun) {
    console.log('Dry run: nothing was pushed.')
    return 0
  }
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      console.error('Not asking for confirmation without a terminal: run with -it, or pass --yes.')
      return 2
    }
    const action = args['no-pr'] ? 'Push a branch for' : 'Open a pull request with'
    const ok = await confirm(
      `${action} these to ${repo}? You agree to publish them under CC-BY-NC-SA-4.0. [y/N] `,
    )
    if (!ok) {
      console.log('Cancelled.')
      return 1
    }
  }

  const result = await contribute(gh, {
    upstream,
    species: plan.species,
    info,
    assetsDir: cfg.assetsDir,
    openPr: args['no-pr'] !== true,
    log: (msg) => console.log(`  ${msg}`),
  })
  if (result.prUrl) {
    console.log(`\nOpened ${result.prUrl}`)
  } else {
    console.log(
      `\nPushed ${result.headRepo}:${result.branch}. Open the PR at:\n${result.compareUrl}`,
    )
  }
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (e) => {
    console.error(`saezuri-contribute: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  },
)
