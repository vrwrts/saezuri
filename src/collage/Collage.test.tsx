// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CallManifest } from '../domain/calls.ts'
import type { LayoutManifest } from '../domain/manifest.ts'
import type { Species } from '../domain/species.ts'
import { Collage } from './Collage.tsx'

// jsdom has no ResizeObserver, and the collage will not lay anything out until it
// has measured a viewport — so report a fixed one immediately on observe.
const VIEWPORT = { width: 900, height: 650 }

beforeAll(() => {
  class StubResizeObserver {
    constructor(private cb: ResizeObserverCallback) {}
    observe() {
      this.cb([{ contentRect: VIEWPORT } as ResizeObserverEntry], this as never)
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', StubResizeObserver)
})

// A fully-opaque 1x1 mask: one byte, MSB set (see MaskRecord — bits are MSB-first
// and set where the cutout is opaque), so any point inside a tile box is a hit.
const OPAQUE = { w: 1, h: 1, bits: 'gA==' }

const MANIFEST: LayoutManifest = {
  dims: { _fallback: [10, 10], 'turdus-merula': [10, 10], 'parus-major': [10, 10] },
  masks: { _fallback: OPAQUE, 'turdus-merula': OPAQUE, 'parus-major': OPAQUE },
  fallbackKey: '_fallback',
}

const SPECIES: Species[] = [
  { sci: 'Turdus merula', com: 'Blackbird', n: 12, firstSeenMs: 1, lastSeenMs: 2 },
  { sci: 'Parus major', com: 'Great Tit', n: 5, firstSeenMs: 1, lastSeenMs: 2 },
]

const CALLS: CallManifest = {
  calls: {
    'turdus-merula': {
      ext: 'wav',
      ver: 'v1',
      recordist: 'A. Recordist',
      license: 'CC0 1.0',
      sourceUrl: 'https://example.invalid/rec',
      sourceName: 'Wikimedia Commons',
    },
  },
}

/** The collage debounces its resize measurement, so nothing is laid out on the
 *  first paint — wait for the tiles before touching them. */
async function renderCollage(calls?: CallManifest) {
  const view = render(
    <Collage species={SPECIES} manifest={MANIFEST} calls={calls} animate={false} />,
  )
  const container = view.container.querySelector('.gcollage') as HTMLDivElement
  await waitFor(() => expect(container.querySelector('.gtile')).not.toBeNull())
  return { ...view, container }
}

/** Center of a rendered tile, in container coordinates. jsdom reports a zero
 *  rect for the container, so these double as client coordinates. */
function tileCenter(container: HTMLElement, index: number) {
  const tile = container.querySelectorAll<HTMLElement>('.gtile')[index]
  const px = (v: string) => Number.parseFloat(v)
  return {
    clientX: px(tile.style.left) + px(tile.style.width) / 2,
    clientY: px(tile.style.top) + px(tile.style.height) / 2,
  }
}

describe('Collage selection', () => {
  it('shows no card until a bird is selected', async () => {
    await renderCollage()
    expect(screen.queryByText('12 calls')).not.toBeInTheDocument()
  })

  it('opens the card for the bird under the press', async () => {
    const { container } = await renderCollage()
    fireEvent.click(container, tileCenter(container, 0))
    expect(screen.getByRole('complementary')).toHaveAccessibleName('Blackbird')
  })

  it('closes the card when the press lands on a gap', async () => {
    const { container } = await renderCollage()
    fireEvent.click(container, tileCenter(container, 0))
    // Far outside every tile box — the packer never places anything out here.
    fireEvent.click(container, { clientX: -50, clientY: -50 })
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('closes the card on Escape', async () => {
    const { container } = await renderCollage()
    fireEvent.click(container, tileCenter(container, 0))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('keeps the card open when a press lands on its own controls', async () => {
    const { container } = await renderCollage(CALLS)
    fireEvent.click(container, tileCenter(container, 0))
    // The click bubbles to the container, which must ignore it — otherwise
    // pressing play would re-arbitrate the selection and close the card.
    fireEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(screen.getByRole('complementary')).toBeInTheDocument()
  })

  it('closes the card when its bird leaves the window', async () => {
    const { container, rerender } = await renderCollage()
    fireEvent.click(container, tileCenter(container, 0))
    expect(screen.getByRole('complementary')).toBeInTheDocument()

    rerender(<Collage species={[SPECIES[1]]} manifest={MANIFEST} animate={false} />)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('opens the card from the keyboard, via the tile button', async () => {
    await renderCollage()
    // The tiles are pointer-events:none, so this button is unreachable by mouse;
    // it exists so Enter/Space still selects.
    fireEvent.click(screen.getByRole('button', { name: 'Blackbird' }))
    expect(screen.getByRole('complementary')).toHaveAccessibleName('Blackbird')
  })

  it('keeps the panel mounted but replays its content when moving between birds', async () => {
    const { container } = await renderCollage()
    fireEvent.click(container, tileCenter(container, 0))
    const panel = container.querySelector('.species-card')
    const body = container.querySelector('.card-body')
    expect(panel).toHaveAccessibleName('Blackbird')

    fireEvent.click(container, tileCenter(container, 1))

    // The panel is the same node — remounting it would take the background and
    // shadow with it, blinking the card out and back.
    expect(container.querySelector('.species-card')).toBe(panel)
    expect(panel).toHaveAccessibleName('Great Tit')
    // The content is a new node, so its one-shot entrance animation replays and
    // the swap reads as a change rather than text mutating in place.
    expect(container.querySelector('.card-body')).not.toBe(body)
  })

  it('pulls focus into the card only for a keyboard selection', async () => {
    const { container } = await renderCollage(CALLS)

    // A press leaves focus alone — otherwise the card paints a focus ring the
    // user never asked for.
    fireEvent.click(container, tileCenter(container, 0))
    expect(screen.getByRole('button', { name: /play/i })).not.toHaveFocus()

    // From the keyboard the card would otherwise sit several tab stops away.
    fireEvent.click(screen.getByRole('button', { name: 'Great Tit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Blackbird' }))
    expect(screen.getByRole('button', { name: /play/i })).toHaveFocus()
  })

  it('offers playback only for a bird that has a cached recording', async () => {
    const { container } = await renderCollage(CALLS)
    fireEvent.click(container, tileCenter(container, 1))
    expect(screen.getByRole('complementary')).toHaveAccessibleName('Great Tit')
    expect(screen.queryByRole('button', { name: /play/i })).not.toBeInTheDocument()
  })
})
