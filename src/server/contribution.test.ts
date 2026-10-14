import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  contribute,
  contributionBody,
  contributionBranch,
  contributionTitle,
  findGeneratedArt,
  planContribution,
  pngProblem,
  readProposed,
  readUpstream,
  type SpeciesInfo,
  toPose,
  type Upstream,
} from './contribution.ts'
import { type GitHubClient, GitHubError } from './github.ts'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b: Buffer) => {
  let c = ~0
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** A real 1x1 PNG of the given colour type, optionally carrying a tRNS chunk. */
function png(colorType: number, opts: { trns?: boolean; width?: number } = {}): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(opts.width ?? 1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(colorType === 3 ? [chunk('PLTE', Buffer.from([0, 0, 0]))] : []),
    ...(opts.trns ? [chunk('tRNS', Buffer.from([0]))] : []),
    chunk('IDAT', deflateSync(Buffer.alloc(5))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const RGBA = png(6)

describe('pngProblem', () => {
  it('passes a cutout with an alpha channel', () => {
    expect(pngProblem(RGBA)).toBeUndefined()
    expect(pngProblem(png(4))).toBeUndefined()
    expect(pngProblem(png(3, { trns: true }))).toBeUndefined()
  })

  it('rejects an opaque render', () => {
    expect(pngProblem(png(2))).toMatch(/no transparency/)
    expect(pngProblem(png(3))).toMatch(/no transparency/)
  })

  it('rejects a truncated file whose header is intact', () => {
    expect(pngProblem(RGBA.subarray(0, RGBA.length - 12))).toBe('truncated PNG')
  })

  it('rejects something that is not a PNG', () => {
    expect(pngProblem(Buffer.from('<html>not found</html>'))).toBe('not a PNG')
  })

  it('rejects an image past the lint pixel cap', () => {
    expect(pngProblem(png(6, { width: 50_000_000 }))).toMatch(/exceeds/)
  })
})

describe('findGeneratedArt', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'saezuri-contribute-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const state = (data: unknown) => writeFile(join(dir, '_art-state.json'), JSON.stringify(data))

  it('offers only generated poses that are on disk and lint-clean', async () => {
    await state({
      'turdus-merula': { source: 'generated' },
      'turdus-merula-2': { source: 'generated' },
      'erithacus-rubecula': { source: 'repo' },
      'parus-major': { source: 'generated' }, // deleted since
      'pica-pica': { source: 'generated' },
      'pica-pica-2': { downloadMissAt: 1 },
    })
    await writeFile(join(dir, 'turdus-merula.png'), RGBA)
    await writeFile(join(dir, 'turdus-merula-2.png'), RGBA)
    await writeFile(join(dir, 'erithacus-rubecula.png'), RGBA)
    await writeFile(join(dir, 'pica-pica.png'), png(2))

    const { poses, skipped } = await findGeneratedArt(dir)
    expect(poses.map((p) => p.stem).sort()).toEqual(['turdus-merula', 'turdus-merula-2'])
    expect(skipped).toEqual([{ slug: 'pica-pica', reason: expect.stringMatching(/^perched pose/) }])
  })

  it('treats a deployment that never generated anything as having nothing to offer', async () => {
    expect(await findGeneratedArt(dir)).toEqual({ poses: [], skipped: [] })
  })
})

describe('planContribution', () => {
  const poses = (...stems: string[]) => stems.map(toPose)
  const none = new Set<string>()
  const noPrs = new Map<string, number>()

  it('contributes a species with both poses, perched first', () => {
    const plan = planContribution(poses('pica-pica-2', 'pica-pica'), none, noPrs)
    expect(plan.species).toEqual([{ slug: 'pica-pica', stems: ['pica-pica', 'pica-pica-2'] }])
    expect(plan.skipped).toEqual([])
  })

  it('holds back a pose whose counterpart exists nowhere', () => {
    const plan = planContribution(poses('pica-pica'), none, noPrs)
    expect(plan.species).toEqual([])
    expect(plan.skipped[0].reason).toMatch(/no flight pose yet/)
  })

  it('contributes a lone pose when the repo already has its counterpart', () => {
    const plan = planContribution(poses('pica-pica-2'), new Set(['pica-pica']), noPrs)
    expect(plan.species).toEqual([{ slug: 'pica-pica', stems: ['pica-pica-2'] }])
  })

  it('does not count a counterpart that only another open PR proposes', () => {
    const plan = planContribution(poses('pica-pica'), none, new Map([['pica-pica-2', 9]]))
    expect(plan.species).toEqual([])
    expect(plan.skipped[0].reason).toMatch(/proposed separately in #9/)
  })

  it('skips what the repo has, preferring that over a stale PR re-adding it', () => {
    const upstream = new Set(['pica-pica', 'pica-pica-2'])
    const plan = planContribution(
      poses('pica-pica', 'pica-pica-2'),
      upstream,
      new Map([['pica-pica', 7]]),
    )
    expect(plan.skipped).toEqual([{ slug: 'pica-pica', reason: 'already in the repo' }])
  })

  it('skips what an open PR already proposes', () => {
    const proposed = new Map([
      ['pica-pica', 7],
      ['pica-pica-2', 7],
    ])
    const plan = planContribution(poses('pica-pica', 'pica-pica-2'), none, proposed)
    expect(plan.skipped).toEqual([{ slug: 'pica-pica', reason: 'already proposed in #7' }])
  })
})

describe('titles, bodies and branches', () => {
  const info = new Map<string, SpeciesInfo>([
    ['pica-pica', { sci: 'Pica pica', com: 'Eurasian Magpie' }],
    ['corvus-corax', { sci: 'Corvus corax', com: 'Common Raven', localNote: 'Wedge tail.' }],
  ])
  const two = [
    { slug: 'pica-pica', stems: ['pica-pica', 'pica-pica-2'] },
    { slug: 'corvus-corax', stems: ['corvus-corax', 'corvus-corax-2'] },
  ]

  it('names a few species, and counts many', () => {
    expect(contributionTitle(two, info)).toBe(
      'chore: add Eurasian Magpie and Common Raven illustrations',
    )
    const many = ['a', 'b', 'c', 'd'].map((slug) => ({ slug, stems: [slug] }))
    expect(contributionTitle(many, info)).toBe('chore: add illustrations for 4 species')
  })

  it('previews every pose and surfaces local prompt notes', () => {
    const body = contributionBody(two, info, (stem) => `https://img/${stem}.png`)
    expect(body).toContain('https://img/pica-pica-2.png')
    expect(body).toContain('*Corvus corax*: Wedge tail.')
    expect(body).toContain('CC-BY-NC-SA-4.0')
  })

  it('derives the branch from the art set, so a repeat push collides', () => {
    expect(contributionBranch(two)).toBe(contributionBranch(two.map((s) => ({ ...s }))))
    expect(contributionBranch(two)).not.toBe(contributionBranch(two.slice(0, 1)))
  })
})

// ---- GitHub ----------------------------------------------------------------

type Handler = (body: unknown) => unknown

/** A GitHubClient answering from a `METHOD path` table, recording every call. */
function fakeGitHub(routes: Record<string, Handler | Handler[]>) {
  const calls: Array<{ key: string; body: unknown }> = []
  const answer = (key: string, body: unknown) => {
    calls.push({ key, body })
    const route = routes[key]
    const handler = Array.isArray(route) ? route.shift() : route
    if (!handler) throw new GitHubError(404, key, 'Not Found')
    return handler(body)
  }
  const gh: GitHubClient = {
    request: async <T>(method: string, path: string, body?: unknown) =>
      answer(`${method} ${path}`, body) as T,
    paginate: async <T>(path: string) => answer(`GET ${path}`, undefined) as T[],
  }
  return { gh, calls }
}

describe('readUpstream / readProposed', () => {
  const repoRoutes = (listing: unknown) => ({
    'GET /repos/o/r': () => ({ default_branch: 'main', permissions: { push: false } }),
    'GET /repos/o/r/branches/main': () => ({
      commit: { sha: 'head', commit: { tree: { sha: 'root' } } },
    }),
    'GET /repos/o/r/git/trees/root': () => ({
      tree: [{ path: 'illustrations', type: 'tree', sha: 'ill' }],
    }),
    'GET /repos/o/r/git/trees/ill': () => listing,
  })

  it('lists the stems in the illustrations folder', async () => {
    const { gh } = fakeGitHub(
      repoRoutes({
        truncated: false,
        tree: [
          { path: 'pica-pica.png', type: 'blob', sha: '1' },
          { path: 'README.md', type: 'blob', sha: '2' },
        ],
      }),
    )
    const up = await readUpstream(gh, 'o/r')
    expect(up).toMatchObject({ headSha: 'head', treeSha: 'root', canPush: false })
    expect([...up.stems]).toEqual(['pica-pica'])
  })

  it('refuses to plan against a partial listing', async () => {
    const { gh } = fakeGitHub(repoRoutes({ truncated: true, tree: [] }))
    await expect(readUpstream(gh, 'o/r')).rejects.toThrow(/truncated/)
  })

  it('maps art added by open PRs to the PR, ignoring removals and other files', async () => {
    const { gh } = fakeGitHub({
      'GET /repos/o/r/pulls?state=open': () => [{ number: 4 }],
      'GET /repos/o/r/pulls/4/files': () => [
        { filename: 'illustrations/pica-pica.png', status: 'added' },
        { filename: 'illustrations/apus-apus.png', status: 'removed' },
        { filename: 'pipeline/pregen.py', status: 'modified' },
      ],
    })
    expect(await readProposed(gh, 'o/r')).toEqual(new Map([['pica-pica', 4]]))
  })
})

describe('contribute', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'saezuri-contribute-'))
    await writeFile(join(dir, 'pica-pica.png'), RGBA)
    await writeFile(join(dir, 'pica-pica-2.png'), RGBA)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const upstream = (canPush: boolean): Upstream => ({
    repo: 'up/art',
    defaultBranch: 'main',
    headSha: 'upstream-head',
    treeSha: 'upstream-tree',
    stems: new Set(),
    canPush,
  })
  const species = [{ slug: 'pica-pica', stems: ['pica-pica', 'pica-pica-2'] }]
  const writeRoutes = (head: string) => ({
    [`POST /repos/${head}/git/blobs`]: () => ({ sha: 'blob' }),
    [`POST /repos/${head}/git/trees`]: () => ({ sha: 'tree' }),
    [`POST /repos/${head}/git/commits`]: () => ({ sha: 'commit' }),
    [`POST /repos/${head}/git/refs`]: () => ({}),
  })
  const opts = (canPush: boolean, openPr = true) => ({
    upstream: upstream(canPush),
    species,
    info: new Map(),
    assetsDir: dir,
    openPr,
    sleep: async () => {},
  })

  it('forks, builds on the upstream head, and opens a PR from the fork', async () => {
    const { gh, calls } = fakeGitHub({
      'POST /repos/up/art/forks': () => ({ full_name: 'me/art' }),
      // Not ready on the first look: forking is asynchronous.
      'GET /repos/me/art/git/ref/heads/main': [
        () => {
          throw new GitHubError(404, 'ref', 'Not Found')
        },
        () => ({}),
      ],
      ...writeRoutes('me/art'),
      'POST /repos/up/art/pulls': () => ({ html_url: 'https://pr' }),
    })
    const result = await contribute(gh, opts(false))

    expect(result.prUrl).toBe('https://pr')
    const body = (key: string) => calls.find((c) => c.key === key)?.body
    expect(body('POST /repos/me/art/git/trees')).toMatchObject({
      base_tree: 'upstream-tree',
      tree: [{ path: 'illustrations/pica-pica.png' }, { path: 'illustrations/pica-pica-2.png' }],
    })
    expect(body('POST /repos/me/art/git/commits')).toMatchObject({ parents: ['upstream-head'] })
    expect(body('POST /repos/up/art/pulls')).toMatchObject({
      head: `me:${result.branch}`,
      base: 'main',
      maintainer_can_modify: true,
    })
  })

  it('pushes straight to a repo the token can write to', async () => {
    const { gh, calls } = fakeGitHub({
      ...writeRoutes('up/art'),
      'POST /repos/up/art/pulls': () => ({ html_url: 'https://pr' }),
    })
    await contribute(gh, opts(true))
    expect(calls.some((c) => c.key.endsWith('/forks'))).toBe(false)
    expect(calls.at(-1)?.body).not.toHaveProperty('maintainer_can_modify')
  })

  it('stops at the branch when asked not to open the PR', async () => {
    const { gh, calls } = fakeGitHub(writeRoutes('up/art'))
    const result = await contribute(gh, opts(true, false))
    expect(result.prUrl).toBeUndefined()
    expect(result.compareUrl).toContain(`/up/art/compare/main...up:${result.branch}`)
    expect(calls.some((c) => c.key.endsWith('/pulls'))).toBe(false)
  })

  it('explains a branch that was already pushed', async () => {
    const { gh } = fakeGitHub({
      ...writeRoutes('up/art'),
      'POST /repos/up/art/git/refs': () => {
        throw new GitHubError(422, 'refs', 'Reference already exists')
      },
    })
    await expect(contribute(gh, opts(true))).rejects.toThrow(/already exists/)
  })
})
