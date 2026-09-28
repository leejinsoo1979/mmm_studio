/**
 * Drawn catalogue thumbnails for the 짓기 tab (inZOI's wall blocks and
 * railing renders), as inline SVG on a 64×64 box.
 */

const BASE_Y = 54

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
  const h = 14 + (34 * height) / max
  const top = BASE_Y - h
  const [x0, x1, dx, dy] = [16, 40, 10, -6]
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

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  const channel = (shift: number) => {
    const v = (n >> shift) & 0xff
    return Math.max(0, Math.min(255, Math.round(v + amount * (amount < 0 ? v : 255 - v))))
  }
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
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
      <ellipse cx={32} cy={BASE_Y + 3} fill="rgba(0,0,0,0.08)" rx={22} ry={2.5} />
      <g fill={fill} stroke={stroke} strokeWidth={0.8} transform="skewY(-8) translate(0 5)">
        {infill}
        <rect height={3} width={span + 4} x={left - 2} y={top} />
        <rect height={BASE_Y - top} width={4} x={left - 2} y={top} />
        <rect height={BASE_Y - top} width={4} x={right - 2} y={top} />
      </g>
    </svg>
  )
}
