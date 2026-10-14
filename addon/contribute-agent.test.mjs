import { describe, expect, it, vi } from 'vitest'
import {
  commandReader,
  DEFAULT_MIN_SPECIES,
  describeSpecies,
  messages,
  shouldNotify,
} from './contribute-agent.mjs'

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY

describe('shouldNotify', () => {
  const min = DEFAULT_MIN_SPECIES

  it('waits for a batch', () => {
    expect(shouldNotify(min - 1, {}, NOW, min)).toBe(false)
    expect(shouldNotify(min, {}, NOW, min)).toBe(true)
  })

  it('does not repeat an offer for the same set', () => {
    const state = { notifiedAt: NOW - 30 * DAY, notifiedCount: 12 }
    expect(shouldNotify(12, state, NOW, min)).toBe(false)
  })

  it('reminds about a grown set, at most weekly', () => {
    expect(shouldNotify(15, { notifiedAt: NOW - 2 * DAY, notifiedCount: 12 }, NOW, min)).toBe(false)
    expect(shouldNotify(15, { notifiedAt: NOW - 7 * DAY, notifiedCount: 12 }, NOW, min)).toBe(true)
  })
})

describe('commandReader', () => {
  const read = (...chunks) => {
    const seen = vi.fn()
    const feed = commandReader(seen)
    for (const c of chunks) feed(c)
    return seen.mock.calls.map(([c]) => c)
  }

  it('takes hassio.addon_stdin input, which is JSON-encoded and may lack a newline', () => {
    expect(read('"contribute"')).toEqual(['contribute'])
    expect(read('{"action": "check"}\n')).toEqual(['check'])
  })

  it('takes plain lines, split across chunks', () => {
    expect(read('contri', 'bute\nche', 'ck\n')).toEqual(['contribute', 'check'])
  })

  it('ignores anything else', () => {
    expect(read('"delete everything"\n', '42\n')).toEqual([])
  })
})

describe('messages', () => {
  const species = (...names) => names.map((com) => ({ slug: com.toLowerCase(), com }))

  it('names a few species and counts the rest', () => {
    expect(describeSpecies(species('Rook', 'Jay'))).toBe('Rook and Jay')
    expect(describeSpecies(species('Rook', 'Jay', 'Wren', 'Coot', 'Teal'))).toBe(
      'Rook, Jay, Wren and 2 more',
    )
  })

  it('falls back to the slug for a species it cannot name', () => {
    expect(describeSpecies([{ slug: 'pica-pica' }])).toBe('pica-pica')
  })

  it('words an offer by count', () => {
    expect(messages.offer({ species: species('Rook') })).toMatch(/^1 species .* is missing/)
    expect(messages.offer({ species: species('Rook', 'Jay') })).toMatch(/^2 species .* are missing/)
  })
})
