import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, inflateSync } from 'node:zlib'
import { FLIGHT_SUFFIX } from '../domain/asset.ts'
import { fnv1a } from '../lib/hash.ts'
import { parseArtState, STATE_FILE } from './generate.ts'
import { type GitHubClient, GitHubError } from './github.ts'

// Turns the art this deployment generated into a pull request against the illustrations
// repo, so one operator's paid renders become free downloads for everyone else.
//
// Only poses whose provenance is 'generated' are offered: art downloaded from the repo
// is the repo's already, and a file of unknown origin is never assumed to be ours to
// license. What is offered is then checked against what the repo has and what open pull
// requests already propose, so running this twice — or after someone else contributed
// the same bird — never opens a duplicate.

/** The repo's art folder. Fixed by its layout, and the same path the app downloads from. */
const ILLUSTRATIONS_DIR = 'illustrations'

// Mirrors the illustrations repo's scripts/validate.sh, which its CI runs on every PR:
// anything that would fail there is held back here rather than handed to a maintainer.
const STEM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_PIXELS = 40_000_000

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Chunk framing: 4-byte length + 4-byte type, then data, then a 4-byte CRC. */
const CHUNK_OVERHEAD = 12
const IHDR_LENGTH = 13
const COLOR_TYPE_GRAY_ALPHA = 4
const COLOR_TYPE_RGBA = 6
const COLOR_TYPE_PALETTE = 3
/** Samples per pixel, by colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, [COLOR_TYPE_PALETTE]: 1, 4: 2, 6: 4 }
const BIT_DEPTHS = new Set([1, 2, 4, 8, 16])
const INTERLACE_ADAM7 = 1
/** [x0, y0, dx, dy] of each interlace pass: where its first pixel sits and its stride. */
const ADAM7_PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const
const NO_INTERLACE_PASS = [0, 0, 1, 1] as const
/** None, Sub, Up, Average, Paeth. */
const MAX_FILTER_TYPE = 4

/** Forking is asynchronous: GitHub answers the request before the fork's git data is
 *  readable. A fresh fork of a small repo is usually ready within seconds. */
const FORK_READY_ATTEMPTS = 30
const FORK_POLL_MS = 2_000

/** Species named in a PR title before it falls back to a count. */
const TITLE_MAX_NAMES = 3
/** Preview width in the PR description: big enough to judge the art, small enough
 *  that a dozen species stay scannable. */
const PREVIEW_WIDTH_PX = 200

export interface Pose {
  stem: string
  slug: string
  flight: boolean
}

export interface Skip {
  slug: string
  reason: string
}

export interface SpeciesContribution {
  slug: string
  /** The pose stems this contribution adds, perched first. */
  stems: string[]
}

export interface SpeciesInfo {
  sci: string
  com: string
  /** A prompt note this deployment used that the pipeline's bundled notes lack. */
  localNote?: string
}

export function toPose(stem: string): Pose {
  const flight = stem.endsWith(FLIGHT_SUFFIX)
  return { stem, slug: flight ? stem.slice(0, -FLIGHT_SUFFIX.length) : stem, flight }
}

const poseName = (pose: Pose) => (pose.flight ? 'flight' : 'perched')
const counterpartStem = (pose: Pose) => (pose.flight ? pose.slug : `${pose.slug}${FLIGHT_SUFFIX}`)

interface PngHeader {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlaced: boolean
}

/** Why a file would fail the repo's lint, or undefined when it would pass.
 *
 *  The lint fully decodes every image, so this does too, short of unfiltering pixels:
 *  every chunk's CRC, then the image data inflated and measured against the header.
 *  A truncated download or an interrupted write leaves a valid header, and a flipped
 *  byte can leave a file that still ends in IEND — neither is caught by the header. */
export function pngProblem(buf: Buffer): string | undefined {
  if (buf.length < PNG_SIGNATURE.length || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'not a PNG'
  }
  let offset = PNG_SIGNATURE.length
  let header: PngHeader | undefined
  let hasTransparencyChunk = false
  const imageData: Buffer[] = []
  while (offset + CHUNK_OVERHEAD <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const end = offset + CHUNK_OVERHEAD + length
    if (end > buf.length) break
    const type = buf.toString('latin1', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, end - 4)
    if (crc32(buf.subarray(offset + 4, end - 4)) !== buf.readUInt32BE(end - 4)) {
      return `corrupt ${type} chunk (CRC mismatch)`
    }
    if (!header && type !== 'IHDR') return 'malformed PNG (IHDR is not first)'
    if (type === 'IHDR') {
      header = parseHeader(data)
      if (!header) return 'malformed PNG header'
      const { width, height } = header
      if (width * height > MAX_PIXELS) return `${width}x${height} exceeds the ${MAX_PIXELS}px cap`
    } else if (type === 'tRNS') {
      hasTransparencyChunk = true
    } else if (type === 'IDAT') {
      imageData.push(data)
    } else if (type === 'IEND' && header) {
      const dataProblem = imageDataProblem(header, Buffer.concat(imageData))
      if (dataProblem) return dataProblem
      const { colorType } = header
      const hasAlpha =
        colorType === COLOR_TYPE_RGBA ||
        colorType === COLOR_TYPE_GRAY_ALPHA ||
        (colorType === COLOR_TYPE_PALETTE && hasTransparencyChunk)
      // An opaque render means the matte step never ran on it — a bird on a magenta
      // rectangle, which nobody wants in the shared set.
      return hasAlpha ? undefined : 'no transparency (the cutout step did not run on it)'
    }
    offset = end
  }
  return 'truncated PNG'
}

function parseHeader(data: Buffer): PngHeader | undefined {
  if (data.length !== IHDR_LENGTH) return undefined
  const header = {
    width: data.readUInt32BE(0),
    height: data.readUInt32BE(4),
    bitDepth: data[8],
    colorType: data[9],
    interlaced: data[12] === INTERLACE_ADAM7,
  }
  const valid =
    header.width > 0 &&
    header.height > 0 &&
    CHANNELS[header.colorType] !== undefined &&
    BIT_DEPTHS.has(header.bitDepth) &&
    data[12] <= INTERLACE_ADAM7
  return valid ? header : undefined
}

/** Byte length of each scanline, filter byte included, in the order they are stored. */
function scanlineLengths({ width, height, bitDepth, colorType, interlaced }: PngHeader): number[] {
  const bitsPerPixel = bitDepth * CHANNELS[colorType]
  const lengths: number[] = []
  for (const [x0, y0, dx, dy] of interlaced ? ADAM7_PASSES : [NO_INTERLACE_PASS]) {
    const passWidth = Math.ceil((width - x0) / dx)
    const passHeight = Math.ceil((height - y0) / dy)
    // A pass with no pixels (a narrow or short image) stores no scanlines at all.
    if (passWidth <= 0 || passHeight <= 0) continue
    const rowLength = 1 + Math.ceil((passWidth * bitsPerPixel) / 8)
    for (let row = 0; row < passHeight; row++) lengths.push(rowLength)
  }
  return lengths
}

function imageDataProblem(header: PngHeader, compressed: Buffer): string | undefined {
  const rows = scanlineLengths(header)
  const expected = rows.reduce((sum, n) => sum + n, 0)
  let raw: Buffer
  try {
    // Capped at what the header promises, so a crafted stream can't balloon in memory.
    raw = inflateSync(compressed, { maxOutputLength: expected })
  } catch (e) {
    return `corrupt image data (${e instanceof Error ? e.message : String(e)})`
  }
  if (raw.length !== expected) return 'truncated image data'
  let offset = 0
  for (const length of rows) {
    if (raw[offset] > MAX_FILTER_TYPE) return 'corrupt image data (unknown scanline filter)'
    offset += length
  }
  return undefined
}

/** Every pose this deployment generated that is still on disk and would pass the
 *  repo's lint. Missing state means nothing was generated, which is not an error. */
export async function findGeneratedArt(
  assetsDir: string,
): Promise<{ poses: Pose[]; skipped: Skip[] }> {
  let raw: string
  try {
    raw = await readFile(join(assetsDir, STATE_FILE), 'utf8')
  } catch {
    return { poses: [], skipped: [] }
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    // Provenance is the only thing licensing a file as ours to contribute, so a state
    // file we can't read means we can't say, not that there is nothing.
    throw new Error(
      `${join(assetsDir, STATE_FILE)} is not valid JSON; cannot tell which art is ours`,
    )
  }
  const poses: Pose[] = []
  const skipped: Skip[] = []
  for (const [stem, state] of parseArtState(data)) {
    if (state.source !== 'generated') continue
    const pose = toPose(stem)
    if (!STEM.test(stem)) {
      skipped.push({ slug: pose.slug, reason: `${stem}.png is not a valid illustration name` })
      continue
    }
    let buf: Buffer
    try {
      buf = await readFile(join(assetsDir, `${stem}.png`))
    } catch {
      continue // deleted since it was generated: nothing to offer
    }
    const problem = pngProblem(buf)
    if (problem) skipped.push({ slug: pose.slug, reason: `${poseName(pose)} pose: ${problem}` })
    else poses.push(pose)
  }
  return { poses, skipped }
}

/** Decide, per species, which generated poses to contribute.
 *
 *  The repo's lint requires both poses of a species to exist side by side, so a pose
 *  only goes in when its counterpart is in the same contribution or already upstream.
 *  A counterpart that is merely proposed in another open PR doesn't count: the lint
 *  runs on this branch alone. */
export function planContribution(
  generated: readonly Pose[],
  upstream: ReadonlySet<string>,
  proposed: ReadonlyMap<string, number>,
): { species: SpeciesContribution[]; skipped: Skip[] } {
  const bySlug = new Map<string, Pose[]>()
  for (const pose of generated) bySlug.set(pose.slug, [...(bySlug.get(pose.slug) ?? []), pose])

  const species: SpeciesContribution[] = []
  const skipped: Skip[] = []
  for (const slug of [...bySlug.keys()].sort()) {
    const offered = (bySlug.get(slug) ?? []).sort((a, b) => Number(a.flight) - Number(b.flight))
    const fresh = offered.filter((p) => !upstream.has(p.stem) && !proposed.has(p.stem))
    if (fresh.length === 0) {
      // A stale PR can re-add art that has since merged, so the repo is the better answer.
      const pending = offered.find((p) => !upstream.has(p.stem))
      skipped.push({
        slug,
        reason: pending
          ? `already proposed in #${proposed.get(pending.stem)}`
          : 'already in the repo',
      })
      continue
    }
    const freshStems = new Set(fresh.map((p) => p.stem))
    const orphan = fresh.find(
      (p) => !freshStems.has(counterpartStem(p)) && !upstream.has(counterpartStem(p)),
    )
    if (orphan) {
      const missing = toPose(counterpartStem(orphan))
      const pr = proposed.get(missing.stem)
      skipped.push({
        slug,
        reason: pr
          ? `its ${poseName(missing)} pose is proposed separately in #${pr}; the repo needs both together`
          : `no ${poseName(missing)} pose yet; the repo needs both together`,
      })
      continue
    }
    species.push({ slug, stems: fresh.map((p) => p.stem) })
  }
  return { species, skipped }
}

// ---- the upstream repo ----------------------------------------------------

export interface Upstream {
  repo: string
  defaultBranch: string
  headSha: string
  treeSha: string
  /** Pose stems already in the repo's illustrations folder. */
  stems: Set<string>
  /** The token can push here, so the branch goes straight to it instead of a fork. */
  canPush: boolean
}

interface TreeEntry {
  path: string
  type: string
  sha: string
}

export async function readUpstream(gh: GitHubClient, repo: string): Promise<Upstream> {
  const meta = await gh.request<{ default_branch: string; permissions?: { push?: boolean } }>(
    'GET',
    `/repos/${repo}`,
  )
  const branch = await gh.request<{ commit: { sha: string; commit: { tree: { sha: string } } } }>(
    'GET',
    `/repos/${repo}/branches/${encodeURIComponent(meta.default_branch)}`,
  )
  const treeSha = branch.commit.commit.tree.sha
  const root = await gh.request<{ tree: TreeEntry[] }>('GET', `/repos/${repo}/git/trees/${treeSha}`)
  const dir = root.tree.find((e) => e.path === ILLUSTRATIONS_DIR && e.type === 'tree')
  const stems = new Set<string>()
  if (dir) {
    // Listed via the git tree rather than the contents API, which stops at 1,000 files.
    const listing = await gh.request<{ tree: TreeEntry[]; truncated: boolean }>(
      'GET',
      `/repos/${repo}/git/trees/${dir.sha}`,
    )
    // A partial listing would make art the repo has look missing, and get it proposed
    // again; better to stop than to open that PR.
    if (listing.truncated) throw new Error(`the ${repo} illustrations listing was truncated`)
    for (const e of listing.tree) {
      if (e.type === 'blob' && e.path.endsWith('.png')) stems.add(e.path.slice(0, -'.png'.length))
    }
  }
  return {
    repo,
    defaultBranch: meta.default_branch,
    headSha: branch.commit.sha,
    treeSha,
    stems,
    canPush: meta.permissions?.push === true,
  }
}

/** Pose stems that open pull requests already add, mapped to the PR adding them. */
export async function readProposed(gh: GitHubClient, repo: string): Promise<Map<string, number>> {
  const proposed = new Map<string, number>()
  const pulls = await gh.paginate<{ number: number }>(`/repos/${repo}/pulls?state=open`)
  const prefix = `${ILLUSTRATIONS_DIR}/`
  for (const { number } of pulls) {
    const files = await gh.paginate<{ filename: string; status: string }>(
      `/repos/${repo}/pulls/${number}/files`,
    )
    for (const f of files) {
      if (f.status === 'removed' || !f.filename.startsWith(prefix)) continue
      if (!f.filename.endsWith('.png')) continue
      proposed.set(f.filename.slice(prefix.length, -'.png'.length), number)
    }
  }
  return proposed
}

// ---- the pull request -----------------------------------------------------

const displayName = (slug: string, info: ReadonlyMap<string, SpeciesInfo>) =>
  info.get(slug)?.com ?? slug

export function contributionTitle(
  species: readonly SpeciesContribution[],
  info: ReadonlyMap<string, SpeciesInfo>,
): string {
  if (species.length > TITLE_MAX_NAMES) {
    return `chore: add illustrations for ${species.length} species`
  }
  const names = species.map((s) => displayName(s.slug, info))
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return `chore: add ${list} illustrations`
}

export function contributionBody(
  species: readonly SpeciesContribution[],
  info: ReadonlyMap<string, SpeciesInfo>,
  imageUrl: (stem: string) => string,
): string {
  const rows = species.map((s) => {
    const i = info.get(s.slug)
    const name = i ? `${i.com}<br>*${i.sci}*` : `\`${s.slug}\``
    const previews = s.stems
      .map((stem) => `<img src="${imageUrl(stem)}" width="${PREVIEW_WIDTH_PX}" alt="${stem}">`)
      .join(' ')
    return `| ${name} | ${previews} |`
  })
  const notes = species
    .map((s) => ({ s, i: info.get(s.slug) }))
    .filter(({ i }) => i?.localNote)
    .map(({ s, i }) => `- *${i?.sci ?? s.slug}*: ${i?.localNote}`)
  const imageCount = species.reduce((n, s) => n + s.stems.length, 0)
  return [
    `Adds ${imageCount} generated illustration(s) for ${species.length} species, ` +
      'contributed from a Saezuri deployment with `saezuri-contribute`.',
    '',
    '| Species | Art |',
    '| --- | --- |',
    ...rows,
    ...(notes.length > 0
      ? [
          '',
          'These were generated with prompt notes that `pipeline/species-notes.json` does not have yet:',
          '',
          ...notes,
        ]
      : []),
    '',
    'By opening this pull request I agree that these illustrations are published under ' +
      '**CC-BY-NC-SA-4.0**, as described in `ATTRIBUTION.md`.',
  ].join('\n')
}

/** Deterministic, so pushing the same set twice collides instead of opening a twin. */
export function contributionBranch(species: readonly SpeciesContribution[]): string {
  const stems = species.flatMap((s) => s.stems).join(',')
  return `saezuri-contribute/${fnv1a(stems).toString(36)}`
}

export interface ContributeOptions {
  upstream: Upstream
  species: readonly SpeciesContribution[]
  info: ReadonlyMap<string, SpeciesInfo>
  assetsDir: string
  /** false: push the branch and stop, leaving the PR to be opened by hand. */
  openPr: boolean
  log?: (msg: string) => void
  sleep?: (ms: number) => Promise<void>
}

export interface ContributeResult {
  headRepo: string
  branch: string
  compareUrl: string
  prUrl?: string
}

export async function contribute(
  gh: GitHubClient,
  opts: ContributeOptions,
): Promise<ContributeResult> {
  const { upstream, species, info } = opts
  const log = opts.log ?? (() => {})
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  const headRepo = upstream.canPush ? upstream.repo : await ensureFork(gh, upstream, log, sleep)
  const headOwner = headRepo.split('/')[0]

  const tree: Array<{ path: string; mode: string; type: string; sha: string }> = []
  for (const stem of species.flatMap((s) => s.stems)) {
    log(`uploading ${stem}.png`)
    const content = (await readFile(join(opts.assetsDir, `${stem}.png`))).toString('base64')
    const blob = await gh.request<{ sha: string }>('POST', `/repos/${headRepo}/git/blobs`, {
      content,
      encoding: 'base64',
    })
    tree.push({
      path: `${ILLUSTRATIONS_DIR}/${stem}.png`,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    })
  }

  // Built on the upstream head, not the fork's default branch: a fork that is behind
  // or has commits of its own would otherwise drag those into the PR. A fork shares
  // its network's objects, so the upstream commit is addressable from it.
  const newTree = await gh.request<{ sha: string }>('POST', `/repos/${headRepo}/git/trees`, {
    base_tree: upstream.treeSha,
    tree,
  })
  const title = contributionTitle(species, info)
  const commit = await gh.request<{ sha: string }>('POST', `/repos/${headRepo}/git/commits`, {
    message: title,
    tree: newTree.sha,
    parents: [upstream.headSha],
  })

  const branch = contributionBranch(species)
  await pushBranch(gh, upstream.repo, headRepo, branch, commit.sha)

  const compareUrl =
    `https://github.com/${upstream.repo}/compare/${upstream.defaultBranch}...` +
    `${headOwner}:${branch}?expand=1`
  if (!opts.openPr) return { headRepo, branch, compareUrl }

  // Pinned to the commit rather than the branch, so the previews survive the branch
  // being deleted after merge.
  const imageUrl = (stem: string) =>
    `https://raw.githubusercontent.com/${headRepo}/${commit.sha}/${ILLUSTRATIONS_DIR}/${stem}.png`
  const fromFork = headRepo !== upstream.repo
  const pr = await gh.request<{ html_url: string }>('POST', `/repos/${upstream.repo}/pulls`, {
    title,
    head: `${headOwner}:${branch}`,
    base: upstream.defaultBranch,
    body: contributionBody(species, info, imageUrl),
    // Lets a maintainer fix up the art on the branch instead of asking for a round-trip.
    // GitHub only accepts it for a PR from a fork.
    ...(fromFork ? { maintainer_can_modify: true } : {}),
  })
  return { headRepo, branch, compareUrl, prUrl: pr.html_url }
}

/** Points the branch at the commit. The name is derived from the art set, so it can
 *  already exist: left by a run that pushed but never opened its pull request (it
 *  failed, or ran with --no-pr), it is reused so that run can simply be retried. A
 *  branch any pull request was opened from is left alone — that exact set was proposed
 *  before, and an open one would have been filtered out already, so it was closed. */
async function pushBranch(
  gh: GitHubClient,
  upstreamRepo: string,
  headRepo: string,
  branch: string,
  sha: string,
): Promise<void> {
  try {
    await gh.request('POST', `/repos/${headRepo}/git/refs`, { ref: `refs/heads/${branch}`, sha })
    return
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 422)) throw e
  }
  const head = encodeURIComponent(`${headRepo.split('/')[0]}:${branch}`)
  const [pr] = await gh.request<Array<{ number: number }>>(
    'GET',
    `/repos/${upstreamRepo}/pulls?state=all&head=${head}`,
  )
  if (pr) {
    throw new Error(
      `branch ${branch} in ${headRepo} was already proposed in #${pr.number}. ` +
        'Delete the branch to propose this exact set again.',
    )
  }
  await gh.request('PATCH', `/repos/${headRepo}/git/refs/heads/${branch}`, { sha, force: true })
}

/** The token owner's fork of the upstream repo, created if need be. Asking GitHub to
 *  fork a repo you already forked returns the existing fork, whatever it was renamed to. */
async function ensureFork(
  gh: GitHubClient,
  upstream: Upstream,
  log: (msg: string) => void,
  sleep: (ms: number) => Promise<void>,
): Promise<string> {
  const fork = await gh.request<{ full_name: string }>('POST', `/repos/${upstream.repo}/forks`, {
    default_branch_only: true,
  })
  for (let attempt = 0; attempt < FORK_READY_ATTEMPTS; attempt++) {
    try {
      await gh.request('GET', `/repos/${fork.full_name}/git/ref/heads/${upstream.defaultBranch}`)
      return fork.full_name
    } catch (e) {
      if (!(e instanceof GitHubError) || (e.status !== 404 && e.status !== 409)) throw e
    }
    if (attempt === 0) log(`waiting for GitHub to finish forking into ${fork.full_name}`)
    await sleep(FORK_POLL_MS)
  }
  throw new Error(`${fork.full_name} was not ready after ${FORK_READY_ATTEMPTS} attempts`)
}
