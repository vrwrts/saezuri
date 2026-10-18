// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CallRecord, callPath } from '../domain/calls.ts'
import { stopCall } from './callPlayer.ts'
import { formatCalls, formatHeard, SpeciesCard } from './SpeciesCard.tsx'

describe('formatCalls', () => {
  it('pluralizes the unit around the count', () => {
    expect(formatCalls(0)).toBe('0 calls')
    expect(formatCalls(1)).toBe('1 call')
    expect(formatCalls(756)).toBe('756 calls')
  })

  it('groups thousands', () => {
    expect(formatCalls(1234)).toBe('1,234 calls')
  })
})

// Compare against Intl's own output rather than literal strings, so these test
// the branch chosen (instant / same-day / cross-day) and not the test runner's
// locale — the app formats in the viewer's.
describe('formatHeard', () => {
  const at = (iso: string) => new Date(iso).getTime()
  const CLOCK = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const
  const time = (ms: number) => new Intl.DateTimeFormat(undefined, CLOCK).format(ms)
  const dateTime = (ms: number) =>
    new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...CLOCK }).format(ms)

  it('uses a 24-hour clock whatever the locale', () => {
    const heard = formatHeard(at('2026-08-05T21:40'), at('2026-08-05T21:40')) ?? ''
    expect(heard).toContain('21:40')
    expect(heard).not.toMatch(/[AP]M/i)
  })

  it('is null when nothing is known', () => {
    expect(formatHeard(undefined, undefined)).toBeNull()
  })

  it('shows one instant for a single detection', () => {
    const only = at('2026-08-05T14:03')
    expect(formatHeard(only, only)).toBe(`heard ${time(only)}`)
  })

  it('falls back to the last instant when no first is known', () => {
    const last = at('2026-08-05T14:03')
    expect(formatHeard(undefined, last)).toBe(`heard ${time(last)}`)
  })

  it('shows a same-day span as times only', () => {
    const first = at('2026-08-05T06:12')
    const last = at('2026-08-05T21:40')
    expect(formatHeard(first, last)).toBe(`heard ${time(first)} – ${time(last)}`)
  })

  it('adds dates once the span crosses midnight, so it cannot read as same-day', () => {
    const first = at('2026-08-04T21:40')
    const last = at('2026-08-05T06:12')
    expect(formatHeard(first, last)).toBe(`heard ${dateTime(first)} – ${dateTime(last)}`)
  })
})

const REC: CallRecord = {
  ext: 'wav',
  ver: 'v1',
  recordist: 'A. Recordist',
  license: 'CC BY-SA 4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.wav',
  sourceName: 'Wikimedia Commons',
}

function renderCard(call: CallRecord | null, com = 'Eurasian Blackbird') {
  return render(
    <SpeciesCard
      sci="Turdus merula"
      com={com}
      n={12}
      firstSeenMs={new Date('2026-08-05T06:12').getTime()}
      lastSeenMs={new Date('2026-08-05T21:40').getTime()}
      call={call}
      onClose={() => {}}
    />,
  )
}

describe('SpeciesCard', () => {
  let audio: HTMLAudioElement
  beforeEach(() => {
    // The player owns one element across card mounts, just as in the browser.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (
      this: HTMLMediaElement,
    ) {
      audio = this
      this.dispatchEvent(new Event('playing'))
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })
  afterEach(() => {
    act(() => stopCall())
    vi.restoreAllMocks()
  })

  it.each([
    'station',
    'newer',
    'removed',
  ])('stops the previous recording when a manifest update changes it to %s', async (change) => {
    const initial: CallRecord =
      change === 'newer'
        ? { ...REC, recordist: '', license: undefined, sourceName: 'BirdNET-Go' }
        : REC
    const { rerender } = renderCard(initial)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play Eurasian Blackbird call' }))
    })
    expect(screen.getByRole('button', { name: 'Stop Eurasian Blackbird call' })).toBeInTheDocument()
    const previousAudio = audio
    const next =
      change === 'removed'
        ? null
        : {
            ...initial,
            ver: 'v2',
            recordist: '',
            license: undefined,
            sourceUrl: undefined,
            sourceName: 'BirdNET-Go',
          }
    rerender(
      <SpeciesCard
        sci="Turdus merula"
        com="Eurasian Blackbird"
        n={12}
        call={next}
        onClose={() => {}}
      />,
    )
    expect(previousAudio.pause).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Stop/ })).not.toBeInTheDocument()
    if (next) {
      fireEvent.click(screen.getByRole('button', { name: 'Play Eurasian Blackbird call' }))
      expect(previousAudio.src).toContain(callPath('Turdus merula', next))
    }
  })

  it('keeps playing when a manifest refresh only changes metadata', async () => {
    const { rerender, unmount } = renderCard(REC)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play Eurasian Blackbird call' }))
    })
    const previousAudio = audio
    vi.mocked(previousAudio.pause).mockClear()
    rerender(
      <SpeciesCard
        sci="Turdus merula"
        com="Eurasian Blackbird"
        n={13}
        call={{ ...REC }}
        onClose={() => {}}
      />,
    )
    expect(previousAudio.pause).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop Eurasian Blackbird call' })).toBeInTheDocument()
    expect(screen.getByText(/A\. Recordist/)).toBeInTheDocument()
    unmount()
    expect(previousAudio.pause).toHaveBeenCalled()
  })

  it('names the bird and reports its window activity', () => {
    renderCard(null)
    expect(screen.getByText('Eurasian Blackbird')).toBeInTheDocument()
    expect(screen.getByText(/12 calls/)).toBeInTheDocument()
  })

  it('shows the binomial behind a localized common name', () => {
    renderCard(null)
    expect(screen.getByText('Turdus merula')).toBeInTheDocument()
  })

  it('drops the binomial when the common name already is one', () => {
    // No localized name available, so the primary label is the binomial itself —
    // printing it twice is noise, not information.
    renderCard(null, 'Turdus merula')
    expect(screen.getAllByText('Turdus merula')).toHaveLength(1)
  })

  it('drops the binomial regardless of casing differences', () => {
    renderCard(null, 'turdus merula')
    expect(screen.queryByText('Turdus merula')).not.toBeInTheDocument()
  })

  it('offers no playback for a species with no recording', () => {
    renderCard(null)
    expect(screen.queryByRole('button', { name: /play/i })).not.toBeInTheDocument()
  })

  it('offers playback and credits the recordist when a recording exists', () => {
    renderCard(REC)
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
    // The CC licences require the recordist be named wherever the call plays.
    expect(screen.getByText(/A\. Recordist · CC BY-SA 4\.0/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Wikimedia Commons' })).toHaveAttribute(
      'href',
      REC.sourceUrl,
    )
  })

  it('still credits licence and source when the archive names no recordist', () => {
    renderCard({ ...REC, recordist: '' })
    expect(screen.getByText(/CC BY-SA 4\.0/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Wikimedia Commons' })).toBeInTheDocument()
  })

  it('links a BirdNET-Go station recording without showing archive credit', () => {
    renderCard({
      ...REC,
      recordist: '',
      license: undefined,
      sourceUrl: 'https://github.com/tphakala/birdnet-go',
      sourceName: 'BirdNET-Go',
    })

    expect(screen.getByRole('link', { name: 'BirdNET-Go' })).toBeInTheDocument()
    expect(screen.queryByText(/CC BY-SA/)).not.toBeInTheDocument()
  })

  it('hides a BirdNET-Go source that has no detection-page link', () => {
    renderCard({
      ...REC,
      recordist: '',
      license: undefined,
      sourceUrl: undefined,
      sourceName: 'BirdNET-Go',
    })

    expect(screen.queryByText('BirdNET-Go')).not.toBeInTheDocument()
  })
})
