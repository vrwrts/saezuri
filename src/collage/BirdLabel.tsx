import { useId } from 'react'
import { WEB_LABEL_WEIGHT } from '../hooks/useLabelFont.ts'
import { labelFont } from './labels/font.ts'
import type { TileLabel } from './labels/plan.ts'

// The lettering is filtered so it reads as ink laid into the print rather than type
// set on top of it: a fine noise moves the glyph edge about as far as paper tooth,
// and a coarser one, stretched along the line, lets the ink density drift along each
// stroke. The displacement is in px, so one filter would be paper tooth on large
// type and blur on small type; each size band gets its own, with the alpha floor
// raised as the type shrinks to hold contrast where there's less ink to carry it.
interface InkBand {
  id: string
  /** Largest type (px) this band serves. */
  maxPx: number
  displacement: number
  alphaSlope: number
  alphaFloor: number
}

const INK_BANDS: readonly InkBand[] = [
  { id: 'saezuri-ink-s', maxPx: 12, displacement: 0.45, alphaSlope: 0.24, alphaFloor: 0.68 },
  { id: 'saezuri-ink-m', maxPx: 17, displacement: 0.75, alphaSlope: 0.34, alphaFloor: 0.55 },
  { id: 'saezuri-ink-l', maxPx: Infinity, displacement: 1.1, alphaSlope: 0.42, alphaFloor: 0.42 },
]

/** Fine noise period ≈ 2px: above Caveat's widest stroke, or it cuts strokes
 *  instead of roughening their edges. */
const TOOTH_FREQUENCY = '0.5'
const POOL_FREQUENCY = '0.25 0.55'

function inkFor(px: number): InkBand {
  return INK_BANDS.find((b) => px <= b.maxPx) ?? INK_BANDS[INK_BANDS.length - 1]
}

/** The ink filters, rendered once per collage. feTurbulence is generated in user
 *  space and each label carries its own viewBox origin, so every name comes out
 *  with different grain without a seed apiece. */
export function LabelInkDefs() {
  return (
    <svg className="gtile-label-defs" width="0" height="0" aria-hidden="true">
      <defs>
        {INK_BANDS.map((b) => (
          <filter
            key={b.id}
            id={b.id}
            x="-6%"
            y="-16%"
            width="112%"
            height="132%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency={TOOTH_FREQUENCY}
              numOctaves={2}
              seed={17}
              result="tooth"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="tooth"
              scale={b.displacement}
              xChannelSelector="R"
              yChannelSelector="G"
              result="edge"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency={POOL_FREQUENCY}
              numOctaves={3}
              seed={5}
              result="pool"
            />
            <feComponentTransfer in="pool" result="density">
              <feFuncA type="linear" slope={b.alphaSlope} intercept={b.alphaFloor} />
            </feComponentTransfer>
            <feComposite in="edge" in2="density" operator="in" />
          </filter>
        ))}
      </defs>
    </svg>
  )
}

interface Props {
  label: TileLabel
  /** The tile's size, so the label scales about the bird's centre on hover. */
  tileW: number
  tileH: number
}

/** A bird's name, one textPath per line along the baselines the planner chose.
 *  Sized to the lettering, not the tile: a tile-sized overlay per bird makes the
 *  compositor repaint the illustration under it. */
export function BirdLabel({ label, tileW, tileH }: Props) {
  const id = useId()
  const { box, px } = label
  const w = Math.max(1, Math.ceil(box.x1 - box.x0))
  const h = Math.max(1, Math.ceil(box.y1 - box.y0))
  return (
    <svg
      className="gtile-label"
      aria-hidden="true"
      viewBox={`${box.x0} ${box.y0} ${w} ${h}`}
      style={{
        left: `${box.x0}px`,
        top: `${box.y0}px`,
        width: `${w}px`,
        height: `${h}px`,
        transformOrigin: `${tileW / 2 - box.x0}px ${tileH / 2 - box.y0}px`,
      }}
    >
      {label.rows.map((row, i) => {
        const pathId = `${id}-${i}`
        return (
          <g key={pathId}>
            <path
              id={pathId}
              fill="none"
              d={row.pts
                .map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
                .join(' ')}
            />
            <text
              style={{ font: labelFont(WEB_LABEL_WEIGHT, px), filter: `url(#${inkFor(px).id})` }}
            >
              <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
                {row.text}
              </textPath>
            </text>
          </g>
        )
      })}
    </svg>
  )
}
