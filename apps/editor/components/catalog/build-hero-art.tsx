/**
 * Line-art hero illustrations for the catalogue panel (inZOI style: 1.5px
 * dark strokes, white fills, pale grey silhouettes), drawn on a 320×150 box.
 */

const LINE = { fill: '#fff', stroke: '#333', strokeWidth: 1.5, strokeLinejoin: 'round' } as const
const SILHOUETTE = '#dcdad8'

function Tree({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g fill={SILHOUETTE}>
      <rect height={r * 1.2} width={4} x={x - 2} y={y} />
      <circle cx={x} cy={y - r * 0.3} r={r} />
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
      <g fill={SILHOUETTE}>
        {[8, 20, 32, 44].map((x) => (
          <rect height={16} key={x} width={3} x={x} y={122} />
        ))}
        <rect height={2} width={42} x={6} y={126} />
      </g>
      <line stroke="#333" strokeWidth={1.5} x1={4} x2={316} y1={138} y2={138} />
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
        <circle cx={197} cy={118} fill="#333" r={1.2} stroke="none" />
        <rect height={20} width={20} x={206} y={72} />
        <line x1={216} x2={216} y1={72} y2={92} />
        <rect height={16} width={30} x={100} y={72} />
      </g>
      <g {...LINE} fill="none">
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

/** 사물: a furnished room (window, sofa, lamp, plant, picture). */
export function RoomHero() {
  return (
    <svg aria-hidden preserveAspectRatio="xMidYMax meet" viewBox="0 0 320 150">
      <line stroke="#333" strokeWidth={1.5} x1={4} x2={316} y1={138} y2={138} />
      <g {...LINE}>
        <rect height={44} width={52} x={34} y={34} />
        <line x1={60} x2={60} y1={34} y2={78} />
        <line x1={34} x2={86} y1={56} y2={56} />
        <rect height={26} width={34} x={142} y={40} />
        <path d="M146 62 L156 50 L163 57 L168 52 L173 62 Z" />
        <rect height={30} width={118} x={100} y={98} />
        <rect height={22} width={110} x={104} y={80} />
        <rect height={34} width={14} x={94} y={94} />
        <rect height={34} width={14} x={210} y={94} />
        <line x1={159} x2={159} y1={80} y2={98} />
        <line x1={112} x2={112} y1={128} y2={138} />
        <line x1={206} x2={206} y1={128} y2={138} />
        <path d="M244 44 L262 44 L268 62 L238 62 Z" />
        <line x1={253} x2={253} y1={62} y2={136} />
        <path d="M244 138 L262 138 L253 132 Z" />
        <path d="M284 138 L300 138 L298 112 L286 112 Z" />
      </g>
      <g fill={SILHOUETTE}>
        <ellipse cx={286} cy={100} rx={8} ry={14} transform="rotate(-20 286 100)" />
        <ellipse cx={298} cy={98} rx={7} ry={13} transform="rotate(25 298 98)" />
        <ellipse cx={292} cy={92} rx={6} ry={14} />
        <rect height={10} rx={2} width={90} x={114} y={128} />
      </g>
    </svg>
  )
}
