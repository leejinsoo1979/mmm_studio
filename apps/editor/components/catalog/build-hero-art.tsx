/**
 * Line-art hero illustrations for the catalogue panel (inZOI style: 1.5px
 * dark strokes, white fills, pale grey silhouettes), drawn on a 320×150 box.
 * Colours come from the hero band's `--hero-*` variables so dark mode swaps
 * them instead of inverting the drawing.
 */

import type { ReactNode } from 'react'

const FILL = 'var(--hero-fill, #fff)'
const INK = 'var(--hero-line, #333)'
const SHADE = 'var(--hero-shade, #dcdad8)'

/** White shapes with a dark outline. */
const LINE = {
  strokeWidth: 1.5,
  strokeLinejoin: 'round',
  style: { fill: FILL, stroke: INK },
} as const
/** Outline only. */
const INK_LINE = {
  strokeWidth: 1.5,
  strokeLinejoin: 'round',
  fill: 'none',
  style: { stroke: INK },
} as const

function Ground() {
  return <line strokeWidth={1.5} style={{ stroke: INK }} x1={4} x2={316} y1={138} y2={138} />
}

function Tree({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g style={{ fill: SHADE }}>
      <rect height={r * 1.2} width={4} x={x - 2} y={y} />
      <circle cx={x} cy={y - r * 0.3} r={r} />
    </g>
  )
}

function Plant({ x, s = 1 }: { x: number; s?: number }) {
  return (
    <g>
      <g style={{ fill: SHADE }}>
        <ellipse
          cx={x - 6 * s}
          cy={138 - 38 * s}
          rx={8 * s}
          ry={14 * s}
          transform={`rotate(-20 ${x - 6 * s} ${138 - 38 * s})`}
        />
        <ellipse
          cx={x + 6 * s}
          cy={138 - 40 * s}
          rx={7 * s}
          ry={13 * s}
          transform={`rotate(25 ${x + 6 * s} ${138 - 40 * s})`}
        />
        <ellipse cx={x} cy={138 - 46 * s} rx={6 * s} ry={14 * s} />
      </g>
      <path
        {...LINE}
        d={`M${x - 8 * s} 138 L${x + 8 * s} 138 L${x + 7 * s} ${138 - 26 * s} L${x - 7 * s} ${138 - 26 * s} Z`}
      />
    </g>
  )
}

function Window({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g {...LINE}>
      <rect height={h} width={w} x={x} y={y} />
      <line x1={x + w / 2} x2={x + w / 2} y1={y} y2={y + h} />
      <line x1={x} x2={x + w} y1={y + h / 2} y2={y + h / 2} />
    </g>
  )
}

function Picture({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g {...LINE}>
      <rect height={h} width={w} x={x} y={y} />
      <path
        d={`M${x + 4} ${y + h - 4} L${x + w * 0.35} ${y + h * 0.4} L${x + w * 0.55} ${y + h * 0.65} L${x + w * 0.7} ${y + h * 0.5} L${x + w - 4} ${y + h - 4} Z`}
      />
    </g>
  )
}

function FloorLamp({ x }: { x: number }) {
  return (
    <g {...LINE}>
      <path d={`M${x - 9} 44 L${x + 9} 44 L${x + 15} 62 L${x - 15} 62 Z`} />
      <line x1={x} x2={x} y1={62} y2={136} />
      <path d={`M${x - 9} 138 L${x + 9} 138 L${x} 132 Z`} />
    </g>
  )
}

/** 짓기: a gable house cut open to show its stairs, with a stepladder. */
export function StructureHero() {
  const steps = Array.from({ length: 6 }, (_, i) => i)
  return (
    <svg aria-hidden preserveAspectRatio="xMidYMax meet" viewBox="0 0 320 150">
      <Tree r={20} x={34} y={104} />
      <Tree r={16} x={292} y={110} />
      <g style={{ fill: SHADE }}>
        {[8, 20, 32, 44].map((x) => (
          <rect height={16} key={x} width={3} x={x} y={122} />
        ))}
        <rect height={2} width={42} x={6} y={126} />
      </g>
      <Ground />
      <g {...LINE}>
        <rect height={76} width={164} x={70} y={62} />
        <path d="M58 64 L152 16 L246 64 Z" />
        <path d="M70 62 L152 21 L234 62" fill="none" />
        <line x1={152} x2={152} y1={62} y2={138} />
        <line x1={70} x2={152} y1={100} y2={100} />
        <path
          d={`M78 138 ${steps.map((i) => `L${78 + i * 11} ${138 - i * 6.3} L${89 + i * 11} ${138 - i * 6.3}`).join(' ')} L144 100`}
          fill="none"
        />
        <rect height={42} width={22} x={180} y={96} />
        <circle cx={197} cy={118} r={1.2} stroke="none" style={{ fill: INK }} />
        <rect height={20} width={20} x={206} y={72} />
        <line x1={216} x2={216} y1={72} y2={92} />
        <rect height={16} width={30} x={100} y={72} />
      </g>
      <g {...INK_LINE}>
        <line x1={258} x2={272} y1={138} y2={58} />
        <line x1={286} x2={272} y1={138} y2={58} />
        {[74, 90, 106, 122].map((y) => {
          const t = (y - 58) / 80
          return <line key={y} x1={272 - 14 * t} x2={272 + 14 * t} y1={y} y2={y} />
        })}
      </g>
    </svg>
  )
}

function Living() {
  return (
    <>
      <Window h={44} w={52} x={34} y={34} />
      <Picture h={26} w={34} x={142} y={40} />
      <g {...LINE}>
        <rect height={30} width={118} x={100} y={98} />
        <rect height={22} width={110} x={104} y={80} />
        <rect height={34} width={14} x={94} y={94} />
        <rect height={34} width={14} x={210} y={94} />
        <line x1={159} x2={159} y1={80} y2={98} />
        <line x1={112} x2={112} y1={128} y2={138} />
        <line x1={206} x2={206} y1={128} y2={138} />
      </g>
      <FloorLamp x={253} />
      <Plant x={292} />
      <rect height={10} rx={2} style={{ fill: SHADE }} width={90} x={114} y={128} />
    </>
  )
}

function Bedroom() {
  return (
    <>
      <Window h={40} w={44} x={40} y={36} />
      <g {...LINE}>
        <rect height={56} width={16} x={108} y={78} />
        <rect height={22} width={120} x={120} y={104} />
        <rect height={12} width={116} x={122} y={94} />
        <rect height={10} rx={3} width={30} x={128} y={84} />
        <path d="M170 94 L236 94 L236 126 L170 126 Z" />
        <line x1={124} x2={124} y1={126} y2={138} />
        <line x1={236} x2={236} y1={126} y2={138} />
        <rect height={28} width={30} x={250} y={110} />
        <line x1={250} x2={280} y1={124} y2={124} />
        <path d="M258 90 L272 90 L276 102 L254 102 Z" />
        <line x1={265} x2={265} y1={102} y2={110} />
      </g>
      <Plant s={0.8} x={24} />
      <rect height={8} rx={2} style={{ fill: SHADE }} width={70} x={150} y={130} />
    </>
  )
}

function Kitchen() {
  return (
    <>
      <g {...LINE}>
        <rect height={30} width={120} x={40} y={34} />
        {[70, 100, 130].map((x) => (
          <line key={x} x1={x} x2={x} y1={34} y2={64} />
        ))}
        <path d="M172 50 L204 50 L210 64 L166 64 Z" />
        <rect height={44} width={170} x={40} y={94} />
        <line x1={40} x2={210} y1={100} y2={100} />
        {[82, 124, 166].map((x) => (
          <line key={x} x1={x} x2={x} y1={100} y2={138} />
        ))}
        <rect height={4} width={30} x={172} y={90} />
        <rect height={104} width={46} x={226} y={34} />
        <line x1={226} x2={272} y1={70} y2={70} />
        <line x1={232} x2={232} y1={46} y2={60} />
        <line x1={232} x2={232} y1={82} y2={100} />
      </g>
      <Plant s={0.7} x={294} />
    </>
  )
}

function Bathroom() {
  return (
    <>
      <g {...LINE}>
        <path d="M30 96 L150 96 L146 122 Q144 132 132 132 L48 132 Q36 132 34 122 Z" />
        <line x1={44} x2={44} y1={132} y2={138} />
        <line x1={136} x2={136} y1={132} y2={138} />
        <path d="M40 96 L40 50 Q40 42 48 42 L56 42" fill="none" />
        <path d="M52 42 L62 42 L60 48 L54 48 Z" />
        <rect height={34} rx={4} width={28} x={176} y={46} />
        <path d="M170 90 L210 90 L206 104 L174 104 Z" />
        <line x1={190} x2={190} y1={104} y2={138} />
        <rect height={26} width={20} x={236} y={86} />
        <path d="M230 112 L268 112 Q268 128 252 130 L246 138 L238 138 L240 128 Q230 124 230 112 Z" />
      </g>
      <Plant s={0.7} x={294} />
    </>
  )
}

function Study() {
  return (
    <>
      <Window h={40} w={44} x={30} y={36} />
      <g {...LINE}>
        <rect height={94} width={56} x={96} y={44} />
        {[68, 92, 116].map((y) => (
          <line key={y} x1={96} x2={152} y1={y} y2={y} />
        ))}
        {[102, 108, 116, 124].map((x, i) => (
          <rect height={16 - (i % 2) * 3} key={x} width={5} x={x} y={52 + (i % 2) * 3} />
        ))}
        <rect height={5} width={96} x={170} y={96} />
        <line x1={176} x2={176} y1={101} y2={138} />
        <line x1={260} x2={260} y1={101} y2={138} />
        <rect height={30} width={42} x={196} y={58} />
        <path d="M212 88 L222 88 L226 96 L208 96 Z" />
        <path d="M272 80 L292 80 L292 112 L272 112 Z" />
        <line x1={276} x2={276} y1={112} y2={138} />
        <line x1={288} x2={288} y1={112} y2={138} />
      </g>
    </>
  )
}

function Hobby() {
  return (
    <>
      <g {...LINE}>
        <line x1={60} x2={48} y1={48} y2={138} />
        <line x1={60} x2={72} y1={48} y2={138} />
        <line x1={60} x2={60} y1={48} y2={138} />
        <rect height={40} width={44} x={38} y={62} />
        <path d="M44 96 L56 76 L64 88 L70 80 L76 96 Z" />
        <ellipse cx={150} cy={118} rx={20} ry={18} />
        <ellipse cx={150} cy={92} rx={14} ry={12} />
        <rect height={50} width={6} x={147} y={34} />
        <circle cx={150} cy={112} r={5} />
        <rect height={6} width={52} x={206} y={128} />
        <rect height={24} width={8} x={202} y={120} />
        <rect height={24} width={8} x={254} y={120} />
        <circle cx={290} cy={126} r={12} />
        <path d="M280 120 Q290 128 300 120" fill="none" />
      </g>
      <Tree r={14} x={112} y={112} />
    </>
  )
}

function Outdoor() {
  return (
    <>
      <Tree r={24} x={40} y={98} />
      <Tree r={18} x={286} y={106} />
      <g style={{ fill: SHADE }}>
        {[228, 240, 252, 264].map((x) => (
          <rect height={18} key={x} width={3} x={x} y={120} />
        ))}
        <rect height={2} width={42} x={226} y={124} />
      </g>
      <g {...LINE}>
        <rect height={6} width={70} x={84} y={110} />
        <rect height={16} width={70} x={84} y={90} />
        <line x1={90} x2={90} y1={116} y2={138} />
        <line x1={148} x2={148} y1={116} y2={138} />
        <path d="M168 122 L176 104 L210 104 L220 122 L220 132 L168 132 Z" />
        <circle cx={180} cy={132} r={6} />
        <circle cx={208} cy={132} r={6} />
        <line x1={186} x2={192} y1={104} y2={122} />
      </g>
    </>
  )
}

function Utility() {
  return (
    <>
      <g {...LINE}>
        <rect height={24} rx={3} width={80} x={34} y={40} />
        <line x1={42} x2={106} y1={56} y2={56} />
        <line x1={42} x2={106} y1={60} y2={60} />
        <rect height={70} width={40} x={140} y={60} />
        <rect height={10} width={24} x={148} y={70} />
        <circle cx={160} cy={100} r={6} />
        <path d="M150 130 L150 138 M170 130 L170 138" fill="none" />
        <path d="M180 76 L214 76 L214 138" fill="none" />
        <path d="M180 90 L200 90 L200 138" fill="none" />
        <rect height={40} width={28} x={234} y={52} />
        {[60, 68, 76, 84].map((y) => (
          <line key={y} x1={240} x2={256} y1={y} y2={y} />
        ))}
        <rect height={28} rx={5} width={12} x={280} y={110} />
        <path d="M284 110 L284 104 L292 102" fill="none" />
      </g>
    </>
  )
}

function Decor() {
  return (
    <>
      <Picture h={36} w={48} x={40} y={40} />
      <Picture h={24} w={30} x={100} y={48} />
      <g {...LINE}>
        <rect height={34} width={110} x={40} y={104} />
        <line x1={95} x2={95} y1={104} y2={138} />
        <path d="M112 104 L128 104 L126 86 L114 86 Z" />
        <path
          d="M120 86 Q114 72 108 66 M120 86 Q122 70 126 62 M120 86 Q128 76 134 72"
          fill="none"
        />
        <circle cx={108} cy={64} r={4} />
        <circle cx={126} cy={60} r={4} />
        <circle cx={135} cy={71} r={4} />
        <ellipse cx={220} cy={134} rx={46} ry={4} />
      </g>
      <FloorLamp x={186} />
      <Plant x={276} />
    </>
  )
}

function MyModels() {
  const cube = (x: number, y: number, s: number) =>
    `M${x} ${y} L${x + s} ${y - s / 2} L${x + 2 * s} ${y} L${x + s} ${y + s / 2} Z M${x} ${y} L${x} ${y + s} L${x + s} ${y + 1.5 * s} L${x + s} ${y + s / 2} M${x + s} ${y + 1.5 * s} L${x + 2 * s} ${y + s} L${x + 2 * s} ${y}`
  return (
    <>
      <g {...LINE}>
        <path d={cube(110, 70, 34)} />
        <path d={cube(188, 102, 16)} />
        <path d={cube(64, 108, 14)} />
      </g>
      <g {...INK_LINE}>
        <path d="M252 104 L252 76 M242 86 L252 76 L262 86" />
        <path d="M236 104 L236 116 L268 116 L268 104" />
      </g>
      <rect height={4} rx={2} style={{ fill: SHADE }} width={110} x={90} y={134} />
    </>
  )
}

function Nature() {
  const flower = (x: number, h: number) => (
    <g key={x}>
      <line strokeWidth={1.5} style={{ stroke: INK }} x1={x} x2={x} y1={138 - h} y2={138} />
      <g {...LINE}>
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse
            cx={x}
            cy={138 - h - 5}
            key={a}
            rx={2.6}
            ry={5}
            transform={`rotate(${a} ${x} ${138 - h})`}
          />
        ))}
        <circle cx={x} cy={138 - h} r={2.4} />
      </g>
    </g>
  )
  return (
    <>
      <Tree r={26} x={60} y={96} />
      <Tree r={20} x={250} y={104} />
      <g style={{ fill: SHADE }}>
        {[190, 196, 202, 290, 296, 302].map((x, i) => (
          <path
            d={`M${x} 138 Q${x + 2} ${126 - (i % 3) * 4} ${x + 5} ${118 - (i % 3) * 5} Q${x + 4} 128 ${x + 6} 138 Z`}
            key={x}
          />
        ))}
      </g>
      {[112, 132, 150, 168].map((x, i) => flower(x, 22 + (i % 2) * 12))}
    </>
  )
}

const ROOM_ART: Record<string, () => ReactNode> = {
  living: Living,
  bedroom: Bedroom,
  kitchen: Kitchen,
  bathroom: Bathroom,
  study: Study,
  hobby: Hobby,
  outdoor: Outdoor,
  utility: Utility,
  decor: Decor,
  mine: MyModels,
  nature: Nature,
}

/** 사물: a line-art scene of the room (`slug`), the living room by default. */
export function RoomHero({ room = 'living' }: { room?: string }) {
  const Art = ROOM_ART[room] ?? Living
  return (
    <svg aria-hidden preserveAspectRatio="xMidYMax meet" viewBox="0 0 320 150">
      <Ground />
      <Art />
    </svg>
  )
}
