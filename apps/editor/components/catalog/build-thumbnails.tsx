/**
 * Drawn catalogue thumbnails for the 짓기 tab (inZOI's wall blocks, railing
 * and roof-part renders), as inline SVG on a 64×64 box.
 */

const BASE_Y = 54
/** Room kept above the tallest block's top face so it never meets the card edge. */
const TOP_MARGIN = 5

/** Beige 3/4 block that grows with `height`, with an up-arrow on its face. */
export function WallHeightThumb({
  height,
  max,
  partial = false,
}: {
  height: number
  max: number
  partial?: boolean
}) {
  const [x0, x1, dx, dy] = [16, 40, 10, -6]
  const tallest = BASE_Y + dy - TOP_MARGIN
  const h = 12 + ((tallest - 12) * height) / max
  const top = BASE_Y - h
  const arrowX = (x0 + x1) / 2
  const arrowTop = top + 5
  return (
    <svg aria-hidden className="h-full w-full" viewBox="0 0 64 64">
      <path
        d={`M${x1} ${top} L${x1 + dx} ${top + dy} L${x1 + dx} ${BASE_Y + dy} L${x1} ${BASE_Y} Z`}
        fill="#c9c4b4"
      />
      <path
        d={`M${x0} ${top} L${x1} ${top} L${x1 + dx} ${top + dy} L${x0 + dx} ${top + dy} Z`}
        fill="#ece8dc"
      />
      <rect fill="#d8d4c6" height={h} width={x1 - x0} x={x0} y={top} />
      {partial && (
        <path
          d={`M${x0} ${top} L${x1} ${top} L${x1 + dx} ${top + dy}`}
          fill="none"
          stroke="#8f8a7c"
          strokeDasharray="2 2"
          strokeWidth={1}
        />
      )}
      <g
        fill="none"
        stroke="#6e6e66"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      >
        <path d={`M${arrowX} ${BASE_Y - 4} L${arrowX} ${arrowTop}`} />
        <path
          d={`M${arrowX - 3} ${arrowTop + 3} L${arrowX} ${arrowTop} L${arrowX + 3} ${arrowTop + 3}`}
        />
      </g>
    </svg>
  )
}

export type RailingStyle = 'slat' | 'rail' | 'privacy' | 'horizontal'

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function shade(hex: string, amount: number): string {
  const [r, g, b] = channels(hex).map((v) =>
    Math.max(0, Math.min(255, Math.round(v + amount * (amount < 0 ? v : 255 - v)))),
  )
  return `rgb(${r}, ${g}, ${b})`
}

/** Short fence run in a slight 3/4 skew: two posts, a top rail and the infill. */
export function RailingThumb({
  style,
  color,
  height,
}: {
  style: RailingStyle
  color: string
  height: number
}) {
  const stroke = shade(color, -0.45)
  const fill = color
  const [r, g, b] = channels(color)
  // Near-black railings would sink into the dark card; outline them light there.
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 80
  const top = BASE_Y - 12 - Math.min(1, height / 1.8) * 30
  const [left, right] = [14, 50]
  const innerTop = top + 3
  const span = right - left
  const infill: React.ReactNode[] = []
  if (style === 'slat') {
    for (let x = left + 5; x < right - 2; x += 5)
      infill.push(<rect height={BASE_Y - 3 - innerTop} key={x} width={2} x={x} y={innerTop} />)
  } else if (style === 'rail') {
    for (const f of [0.42, 0.74])
      infill.push(
        <rect height={2.5} key={f} width={span} x={left} y={innerTop + (BASE_Y - innerTop) * f} />,
      )
  } else if (style === 'privacy') {
    infill.push(
      <rect height={BASE_Y - 3 - innerTop} key="board" width={span} x={left} y={innerTop} />,
    )
  } else {
    for (let y = innerTop + 1; y < BASE_Y - 4; y += 5)
      infill.push(<rect height={3.8} key={y} width={span} x={left} y={y} />)
  }
  return (
    <svg aria-hidden className="h-full w-full" viewBox="0 0 64 64">
      <ellipse
        className="dark:fill-white/10"
        cx={32}
        cy={BASE_Y + 3}
        fill="rgba(0,0,0,0.08)"
        rx={22}
        ry={2.5}
      />
      <g
        className={dark ? 'dark:stroke-[#a3a3a3]' : undefined}
        fill={fill}
        stroke={stroke}
        strokeWidth={0.8}
        transform="skewY(-8) translate(0 5)"
      >
        {infill}
        <rect height={3} width={span + 4} x={left - 2} y={top} />
        <rect height={BASE_Y - top} width={4} x={left - 2} y={top} />
        <rect height={BASE_Y - top} width={4} x={right - 2} y={top} />
      </g>
    </svg>
  )
}

// ── Roof parts ──────────────────────────────────────────────────────────
// A pitched roof plane over a wall strip, with the part drawn on it.

const ROOF = { eaveL: [6, 46], eaveR: [44, 46], ridgeR: [58, 24], ridgeL: [20, 24] } as const
const PART = {
  fill: '#9d988c',
  stroke: '#6e6a60',
  strokeWidth: 0.8,
  strokeLinejoin: 'round',
} as const

/** Point on the roof plane: `u` along the eave (0–1), `v` up the slope (0–1). */
function onRoof(u: number, v: number): [number, number] {
  const [ax, ay] = ROOF.eaveL
  const [bx, by] = ROOF.eaveR
  const [dx, dy] = ROOF.ridgeL
  return [ax + (bx - ax) * u + (dx - ax) * v, ay + (by - ay) * u + (dy - ay) * v]
}

function roofQuad(u0: number, v0: number, u1: number, v1: number): string {
  return [onRoof(u0, v0), onRoof(u1, v0), onRoof(u1, v1), onRoof(u0, v1)]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
}

function roofPart(kind: string): React.ReactNode {
  switch (kind) {
    case 'box-vent': {
      const [x, y] = onRoof(0.5, 0.45)
      return (
        <g {...PART}>
          <path d={`M${x - 5} ${y} L${x + 5} ${y} L${x + 5} ${y - 5} L${x - 5} ${y - 5} Z`} />
          <path d={`M${x - 5} ${y - 5} L${x - 2} ${y - 9} L${x + 8} ${y - 9} L${x + 5} ${y - 5}`} />
          <path d={`M${x + 5} ${y} L${x + 8} ${y - 4} L${x + 8} ${y - 9}`} fill="none" />
        </g>
      )
    }
    case 'ridge-vent':
      return <polygon {...PART} points={roofQuad(0.04, 0.9, 0.96, 1.08)} />
    case 'turbine-vent': {
      const [x, y] = onRoof(0.5, 0.5)
      return (
        <g {...PART}>
          <rect height={6} width={6} x={x - 3} y={y - 6} />
          <path d={`M${x - 6} ${y - 6} Q${x} ${y - 18} ${x + 6} ${y - 6} Z`} />
          <path
            d={`M${x - 3} ${y - 7} L${x - 1} ${y - 13} M${x + 1} ${y - 7} L${x + 2} ${y - 13}`}
          />
        </g>
      )
    }
    case 'cupola': {
      const [x, y] = onRoof(0.5, 1)
      return (
        <g {...PART}>
          <rect fill="#ece8dc" height={10} width={12} x={x - 6} y={y - 10} />
          <rect fill="#a9d4ef" height={5} width={6} x={x - 3} y={y - 8} />
          <path d={`M${x - 8} ${y - 10} L${x} ${y - 18} L${x + 8} ${y - 10} Z`} />
        </g>
      )
    }
    case 'eyebrow-vent': {
      const [x0, y0] = onRoof(0.35, 0.35)
      const [x1, y1] = onRoof(0.65, 0.35)
      return <path {...PART} d={`M${x0} ${y0} Q${(x0 + x1) / 2} ${y0 - 14} ${x1} ${y1} Z`} />
    }
    case 'chimney': {
      const [x, y] = onRoof(0.66, 0.62)
      return (
        <g {...PART} fill="#b57a5c">
          <rect height={20} width={8} x={x - 4} y={y - 20} />
          <rect fill="#8f5c43" height={3} width={11} x={x - 5.5} y={y - 22} />
        </g>
      )
    }
    case 'solar-panel':
      return (
        <g>
          <polygon {...PART} fill="#3d5f8e" points={roofQuad(0.2, 0.2, 0.8, 0.8)} />
          <g fill="none" stroke="#a9c6e8" strokeWidth={0.6}>
            {[0.4, 0.6].map((u) => {
              const [ax, ay] = onRoof(u, 0.2)
              const [bx, by] = onRoof(u, 0.8)
              return <line key={u} x1={ax} x2={bx} y1={ay} y2={by} />
            })}
            {(() => {
              const [ax, ay] = onRoof(0.2, 0.5)
              const [bx, by] = onRoof(0.8, 0.5)
              return <line x1={ax} x2={bx} y1={ay} y2={by} />
            })()}
          </g>
        </g>
      )
    case 'skylight':
      return <polygon {...PART} fill="#a9d4ef" points={roofQuad(0.35, 0.3, 0.65, 0.75)} />
    case 'dormer': {
      const [x, y] = onRoof(0.45, 0.25)
      return (
        <g {...PART}>
          <rect fill="#ece8dc" height={10} width={14} x={x - 7} y={y - 10} />
          <rect fill="#a9d4ef" height={6} width={6} x={x - 3} y={y - 8} />
          <path d={`M${x - 9} ${y - 10} L${x} ${y - 19} L${x + 9} ${y - 10} Z`} />
        </g>
      )
    }
    case 'gutter':
      return <rect {...PART} height={3.5} width={42} x={4} y={45} />
    case 'downspout':
      return (
        <g {...PART}>
          <rect height={3} width={42} x={4} y={45} />
          <rect height={13} width={3.5} x={39} y={47} />
          <path d="M39 60 L45 60 L45 57.5 L42.5 57.5" />
        </g>
      )
    default:
      return null
  }
}

/** A roof plane with one roof part (vent, chimney, gutter …) drawn on it. */
export function RoofFeatureThumb({ kind }: { kind: string }) {
  const points = [ROOF.eaveL, ROOF.eaveR, ROOF.ridgeR, ROOF.ridgeL]
    .map(([x, y]) => `${x},${y}`)
    .join(' ')
  return (
    <svg aria-hidden className="h-full w-full" viewBox="0 0 64 64">
      <rect fill="#ece8dc" height={12} stroke="#b9b4a6" strokeWidth={0.6} width={36} x={7} y={46} />
      <polygon
        fill="#d4cebe"
        points={`${ROOF.eaveR.join(',')} ${ROOF.ridgeR.join(',')} 58,36 44,58`}
        stroke="#b9b4a6"
        strokeWidth={0.6}
      />
      <polygon fill="#c2bba8" points={points} stroke="#8f8a7c" strokeWidth={0.8} />
      {roofPart(kind)}
    </svg>
  )
}
