import {
  DEFAULT_WALL_THICKNESS,
  emitter,
  type FloorplanGeometry,
  type GridEvent,
} from '@pascal-app/core'
import {
  createRoomPresetOnCurrentLevel,
  EDITOR_LAYER,
  formatLinearMeasurement,
  getRoomPresetPolygon,
  isFloorplanInputEvent,
  MeasurementChip,
  markToolCancelConsumed,
  NO_RAYCAST,
  normalizeQuarterTurns,
  ROOM_PRESET_PLATFORM_ELEVATION,
  type RoomPresetKind,
  type RoomPresetPlacement,
  type RoomPresetSpec,
  roomPresetLocalToPlan,
  triggerSFX,
  useDraftReadout,
  useEditor,
  usePlacementFeedback,
  usePlacementPreview,
  useRoomPresetStatus,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Check } from 'lucide-react'
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  type Group,
  Matrix4,
  Plane,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { color, float, floor, fract, mix, sin, step, uv } from 'three/tsl'
import { Line2NodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'

/**
 * inZOI's click-to-place 방 / 플랫폼 preset (q129 / q130). The preset follows
 * the cursor as a cyan wireframe prism with glow streaks along its base; the
 * first click drops it into an editable state — side push-pull tabs, a centre
 * move handle, a 90° rotate arrow and a '✓ 확인' bubble. 확인 (or Enter)
 * commits the walls + floor (방) or the raised slab (플랫폼) as one undo step;
 * Esc returns to placing. Everything snaps to the grid step. The floor plan
 * has no gizmo: it shows the preset as a cyan ghost (the wall band for a 방)
 * and a plan click places it as previewed (R still turns it).
 *
 * Reached through the wall tool router (`tool: 'room-preset'`, alias of the
 * wall kind) with the shape seeded in `toolDefaults.wall.roomPreset`.
 */

const FALLBACK_WALL_HEIGHT = 2.5
const MIN_SPAN = 1
const CURTAIN_MIN_HEIGHT = 0.6
const CURTAIN_MAX_HEIGHT = 1.2
const STREAK_SPACING = 0.08
const FLOOR_LIFT = 0.015

const HANDLE_BLUE = '#27a2e8'
const TAB_FILL = '#bfe6f8'
const PLAN_GHOST_FILL = '#38bdf8'
const PLAN_GHOST_EDGE = '#0284c7'

// Screen-space gizmo layout (px). The parts keep these gaps at any zoom or
// footprint size, pushing outward along their side of the box as needed.
const TAB_SIZE = { hw: 14, hh: 14 }
const MOVE_SIZE = { hw: 15, hh: 15 }
const ROTATE_SIZE = { hw: 24, hh: 15 }
const CONFIRM_HALF_HEIGHT = 14
const CONFIRM_TAIL = 6
const TAB_MIN_RADIUS = 50
const TAB_MIN_GAP = 38
const CHIP_GAP = 8
const PART_PAD = 4
// Bisector the rotate arrow prefers (screen angle, y down): left of the
// centre and a little below, as in inZOI.
const ROTATE_PREFERRED_ANGLE = (160 * Math.PI) / 180

// A bright double edge (wide cyan under a thin near-white core), sized in
// pixels so the box keeps reading when zoomed out.
const lineMaterial = (lineColor: string, linewidth: number) =>
  new Line2NodeMaterial({
    color: lineColor,
    linewidth,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
const edgeGlowMaterial = lineMaterial('#3fbdf4', 5)
const edgeCoreMaterial = lineMaterial('#effbff', 1.6)

// The glow curtain along the base: uv.x runs along the perimeter in metres,
// uv.y up the curtain. Thin columns of random height, bright at the floor and
// fading upward, over a cyan wash.
const streakCell = uv().x.div(STREAK_SPACING)
const streakRandom = fract(sin(floor(streakCell).mul(12.9898).add(78.233)).mul(43758.5453))
const streakTop = streakRandom.mul(streakRandom).mul(0.85).add(0.15)
const streak = step(fract(streakCell), float(0.45))
  .mul(step(uv().y, streakTop))
  .mul(float(1).sub(uv().y.div(streakTop)))
const wash = float(1).sub(uv().y).pow(1.6).mul(0.42)
const curtainMaterial = new MeshBasicNodeMaterial({
  colorNode: mix(color('#6fd2fb'), color('#0ea5e9'), streak),
  opacityNode: streak.mul(0.95).add(wash).min(1),
  transparent: true,
  depthTest: false,
  depthWrite: false,
  side: DoubleSide,
  toneMapped: false,
})
const floorMaterial = new MeshBasicNodeMaterial({
  color: '#4cc6f7',
  opacity: 0.3,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  side: DoubleSide,
  toneMapped: false,
})

type DragHandle = { kind: 'move' } | { kind: 'side'; axis: 0 | 1; sign: 1 | -1 }

const SIDE_HANDLES: { axis: 0 | 1; sign: 1 | -1 }[] = [
  { axis: 0, sign: 1 },
  { axis: 0, sign: -1 },
  { axis: 1, sign: 1 },
  { axis: 1, sign: -1 },
]

function readSpec(value: unknown): RoomPresetSpec | null {
  const spec = value as RoomPresetSpec | undefined
  if (!(spec && Array.isArray(spec.outline) && spec.outline.length >= 3)) return null
  return spec
}

function snapTo(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : value
}

function gridStep() {
  return useEditor.getState().gridSnapStep
}

function footprintOf(placement: Pick<RoomPresetPlacement, 'size' | 'turns'>): [number, number] {
  const [w, d] = placement.size
  return normalizeQuarterTurns(placement.turns) % 2 === 1 ? [d, w] : [w, d]
}

/** Centre the footprint on `point` with its corner on the grid. */
function snapCenter(point: WallPlanPoint, placement: Pick<RoomPresetPlacement, 'size' | 'turns'>) {
  const [fw, fd] = footprintOf(placement)
  const step = gridStep()
  return [snapTo(point[0] - fw / 2, step) + fw / 2, snapTo(point[1] - fd / 2, step) + fd / 2] as [
    number,
    number,
  ]
}

/** Plan direction of the shape's own +x (axis 0) or +z (axis 1). */
function axisOf(axis: 0 | 1, turns: number): WallPlanPoint {
  return roomPresetLocalToPlan(axis === 0 ? [1, 0] : [0, 1], {
    center: [0, 0],
    size: [1, 1],
    turns,
  })
}

/**
 * Where a side's push-pull tab sits, in the unit box: the middle of the
 * outline's longest edge on that side, else of the corners touching it — so
 * an ㄱ자's tabs sit on its arms, not out in the notch.
 */
function sideAnchor(outline: WallPlanPoint[], axis: 0 | 1, sign: 1 | -1): WallPlanPoint {
  const onSide = (point: WallPlanPoint) => Math.abs(point[axis] - sign * 0.5) < 1e-6
  let best: readonly [WallPlanPoint, WallPlanPoint] | null = null
  let bestLength = -1
  for (const edge of edgesOf(outline)) {
    if (!(onSide(edge[0]) && onSide(edge[1]))) continue
    const length = Math.hypot(edge[1][0] - edge[0][0], edge[1][1] - edge[0][1])
    if (length > bestLength) {
      best = edge
      bestLength = length
    }
  }
  const points = best ? [...best] : outline.filter(onSide)
  if (points.length === 0) return axis === 0 ? [sign * 0.5, 0] : [0, sign * 0.5]
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ]
}

/**
 * The placement after dragging `handle` from `grab` to `hit` (both on the
 * handle's own plane): the centre moves by the snapped delta, a side moves by
 * it while the opposite side stays put.
 */
function dragPlacement(
  handle: DragHandle,
  start: RoomPresetPlacement,
  grab: WallPlanPoint,
  hit: WallPlanPoint,
): RoomPresetPlacement {
  const step = gridStep()
  if (handle.kind === 'move') {
    return {
      ...start,
      center: [
        start.center[0] + snapTo(hit[0] - grab[0], step),
        start.center[1] + snapTo(hit[1] - grab[1], step),
      ],
    }
  }
  const [ax, az] = axisOf(handle.axis, start.turns)
  const span = start.size[handle.axis]
  const fixed: WallPlanPoint = [
    start.center[0] - (handle.sign * ax * span) / 2,
    start.center[1] - (handle.sign * az * span) / 2,
  ]
  const pulled = handle.sign * ((hit[0] - grab[0]) * ax + (hit[1] - grab[1]) * az)
  const nextSpan = Math.max(Math.max(MIN_SPAN, step), snapTo(span + pulled, step))
  const size: [number, number] = [...start.size]
  size[handle.axis] = nextSpan
  return {
    ...start,
    size,
    center: [
      fixed[0] + (handle.sign * ax * nextSpan) / 2,
      fixed[1] + (handle.sign * az * nextSpan) / 2,
    ],
  }
}

function samePlacement(a: RoomPresetPlacement | null, b: RoomPresetPlacement | null) {
  return (
    !!a &&
    !!b &&
    a.turns === b.turns &&
    a.center[0] === b.center[0] &&
    a.center[1] === b.center[1] &&
    a.size[0] === b.size[0] &&
    a.size[1] === b.size[1]
  )
}

function edgesOf(polygon: WallPlanPoint[]) {
  return polygon.map((a, index) => [a, polygon[(index + 1) % polygon.length]!] as const)
}

function prismEdgePositions(polygon: WallPlanPoint[], y: number, height: number) {
  const positions: number[] = []
  for (const [a, b] of edgesOf(polygon)) {
    positions.push(a[0], y, a[1], b[0], y, b[1])
    positions.push(a[0], y + height, a[1], b[0], y + height, b[1])
    positions.push(a[0], y, a[1], a[0], y + height, a[1])
  }
  return positions
}

function curtainGeometry(polygon: WallPlanPoint[], y: number, height: number) {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let along = 0
  for (const [a, b] of edgesOf(polygon)) {
    const base = positions.length / 3
    const next = along + Math.hypot(b[0] - a[0], b[1] - a[1])
    positions.push(a[0], y, a[1], b[0], y, b[1], b[0], y + height, b[1], a[0], y + height, a[1])
    uvs.push(along, 0, next, 0, next, 1, along, 1)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    along = next
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  return geometry
}

function floorGeometry(polygon: WallPlanPoint[]) {
  // The mesh lies flat by −π/2 about X, which maps shape (x, y) → plan (x, −y).
  return new ShapeGeometry(new Shape(polygon.map(([x, z]) => new Vector2(x, -z))))
}

/**
 * The floor plan's ghost: a 방 shows the band its walls will fill, a 플랫폼
 * a tinted pad — both cyan, so neither reads as something already built.
 */
function planGhost(
  kind: RoomPresetKind,
  polygon: WallPlanPoint[],
  thickness: number,
): FloorplanGeometry {
  const outline = { kind: 'polygon' as const, points: polygon }
  const edge: FloorplanGeometry = {
    ...outline,
    stroke: PLAN_GHOST_EDGE,
    strokeWidth: 1.5,
    strokeLinejoin: 'round',
    vectorEffect: 'non-scaling-stroke',
  }
  if (kind === 'platform') {
    return {
      kind: 'group',
      children: [
        {
          ...outline,
          fill: PLAN_GHOST_FILL,
          fillOpacity: 0.32,
          stroke: PLAN_GHOST_FILL,
          strokeOpacity: 0.35,
          strokeWidth: 7,
          strokeLinejoin: 'round',
          vectorEffect: 'non-scaling-stroke',
        },
        edge,
      ],
    }
  }
  return {
    kind: 'group',
    children: [
      { ...outline, fill: PLAN_GHOST_FILL, fillOpacity: 0.12 },
      {
        ...outline,
        stroke: PLAN_GHOST_FILL,
        strokeOpacity: 0.6,
        strokeWidth: thickness,
        strokeLinejoin: 'miter',
      },
      { ...edge, strokeDasharray: '6 4' },
    ],
  }
}

function PresetGhost({
  baseY,
  fillAtTop,
  height,
  polygon,
}: {
  baseY: number
  /** A platform's fill marks its top face; a room's marks its floor. */
  fillAtTop: boolean
  height: number
  polygon: WallPlanPoint[]
}) {
  const parts = useMemo(() => {
    const edges = new LineSegmentsGeometry().setPositions(
      prismEdgePositions(polygon, baseY, height),
    )
    const lines = [
      new LineSegments2(edges, edgeGlowMaterial),
      new LineSegments2(edges, edgeCoreMaterial),
    ]
    lines.forEach((line, index) => {
      line.layers.set(EDITOR_LAYER)
      line.renderOrder = 4 + index
      line.frustumCulled = false
      line.raycast = NO_RAYCAST
    })
    return {
      edges,
      lines,
      curtain: curtainGeometry(
        polygon,
        baseY,
        Math.min(Math.max(height, CURTAIN_MIN_HEIGHT), CURTAIN_MAX_HEIGHT),
      ),
      floor: floorGeometry(polygon),
    }
  }, [polygon, baseY, height])
  useEffect(
    () => () => {
      parts.edges.dispose()
      parts.curtain.dispose()
      parts.floor.dispose()
    },
    [parts],
  )
  return (
    <group>
      <mesh
        frustumCulled={false}
        geometry={parts.floor}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        material={floorMaterial}
        position={[0, baseY + FLOOR_LIFT + (fillAtTop ? height : 0), 0]}
        renderOrder={1}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      <mesh
        frustumCulled={false}
        geometry={parts.curtain}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        material={curtainMaterial}
        renderOrder={2}
      />
      {parts.lines.map((line) => (
        <primitive key={line.id} object={line} />
      ))}
    </group>
  )
}

function SideTab({
  onPointerDown,
  vertical,
}: {
  onPointerDown: (event: ReactPointerEvent) => void
  vertical: boolean
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        pointerEvents: 'auto',
        touchAction: 'none',
        cursor: vertical ? 'ns-resize' : 'ew-resize',
        width: vertical ? 22 : 28,
        height: vertical ? 28 : 22,
        borderRadius: 7,
        background: TAB_FILL,
        border: '2px solid #ffffff',
        boxShadow: '0 1px 6px rgba(20, 90, 140, 0.35)',
      }}
      title="밀고 당겨서 크기 조절"
    />
  )
}

function RotateArrow({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="90° 회전 (R)"
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        display: 'block',
        pointerEvents: 'auto',
        cursor: 'pointer',
        background: 'none',
        border: 'none',
        padding: 0,
        filter: 'drop-shadow(0 1px 3px rgba(20, 90, 140, 0.45))',
      }}
      title="90° 회전 (R)"
      type="button"
    >
      <svg aria-hidden fill="none" height="30" viewBox="0 0 64 40" width="48">
        <path
          d="M52 10 C 40 4, 22 4, 12 12"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeWidth="7"
        />
        <path
          d="M52 10 C 40 4, 22 4, 12 12"
          stroke={TAB_FILL}
          strokeLinecap="round"
          strokeWidth="4"
        />
        <path d="M6 16 L 12 5 L 18 15 Z" fill={TAB_FILL} stroke="#ffffff" strokeWidth="1.5" />
        <path
          d="M12 30 C 24 38, 42 38, 52 30"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeWidth="7"
        />
        <path
          d="M12 30 C 24 38, 42 38, 52 30"
          stroke={TAB_FILL}
          strokeLinecap="round"
          strokeWidth="4"
        />
        <path d="M58 26 L 52 37 L 46 27 Z" fill={TAB_FILL} stroke="#ffffff" strokeWidth="1.5" />
      </svg>
    </button>
  )
}

function ConfirmBubble({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        pointerEvents: 'auto',
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: CONFIRM_HALF_HEIGHT * 2,
        padding: '0 12px',
        borderRadius: 9999,
        background: '#2B8CE8',
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        border: '2px solid #ffffff',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
        cursor: 'pointer',
      }}
      title="확인 (Enter) · 취소 (Esc) · 회전 (R)"
      type="button"
    >
      <Check size={14} strokeWidth={2.5} />
      확인
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '100%',
          width: 8,
          height: 8,
          background: '#2B8CE8',
          borderRight: '2px solid #ffffff',
          borderBottom: '2px solid #ffffff',
          transform: 'translate(-50%, -4px) rotate(45deg)',
        }}
      />
    </button>
  )
}

type Pt = { x: number; y: number }
type Box = Pt & { hw: number; hh: number }

const overlaps = (a: Box, b: Box, pad = PART_PAD) =>
  Math.abs(a.x - b.x) < a.hw + b.hw + pad && Math.abs(a.y - b.y) < a.hh + b.hh + pad

function unit(v: Pt, fallback: Pt): Pt {
  const length = Math.hypot(v.x, v.y)
  return length > 1e-3 ? { x: v.x / length, y: v.y / length } : fallback
}

/** Slide `box` along `dir` until it clears every one of `others`. */
function pushClear(box: Box, dir: Pt, others: Box[]) {
  for (let step = 0; step < 80 && others.some((other) => overlaps(box, other)); step++) {
    box.x += dir.x * 3
    box.y += dir.y * 3
  }
}

const PART_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  visibility: 'hidden',
} as const

/**
 * The chips and (once dropped) the handles, laid out in screen space every
 * frame around the centre handle so no part ever sits on another: tabs keep a
 * minimum radius and gap, chips sit outside their side, the rotate arrow takes
 * the widest free gap and the 확인 bubble floats above everything. The parts
 * share one zero-size overlay, so nothing invisible covers a handle.
 */
function PresetGizmo({
  baseY,
  editing,
  frameRef,
  handleY,
  height,
  onConfirm,
  onRotate,
  outline,
  placement,
  polygon,
  startDrag,
  unitSystem,
}: {
  baseY: number
  editing: boolean
  frameRef: RefObject<Group | null>
  handleY: number
  height: number
  onConfirm: () => void
  onRotate: () => void
  outline: WallPlanPoint[]
  placement: RoomPresetPlacement
  polygon: WallPlanPoint[]
  startDrag: (handle: DragHandle) => (event: ReactPointerEvent) => void
  unitSystem: Parameters<typeof formatLinearMeasurement>[1]
}) {
  const tabRefs = useRef<(HTMLDivElement | null)[]>([])
  const moveRef = useRef<HTMLDivElement>(null)
  const rotateRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLDivElement>(null)
  const widthChipRef = useRef<HTMLDivElement>(null)
  const depthChipRef = useRef<HTMLDivElement>(null)
  const scratch = useMemo(() => new Vector3(), [])

  const [cx, cz] = placement.center
  const [footW, footD] = footprintOf(placement)
  const tabAnchors = useMemo(
    () =>
      SIDE_HANDLES.map(({ axis, sign }) => {
        const [px, pz] = roomPresetLocalToPlan(sideAnchor(outline, axis, sign), placement)
        const [ox, oz] = axisOf(axis, placement.turns)
        return {
          point: [px, pz] as WallPlanPoint,
          outward: [sign * ox, sign * oz] as WallPlanPoint,
        }
      }),
    [outline, placement],
  )

  useEffect(() => () => usePlacementFeedback.getState().setAnchor(null), [])

  useFrame(({ camera, size }) => {
    const frame = frameRef.current
    const feedback = usePlacementFeedback.getState()
    if (!frame || size.width < 10 || size.height < 10) {
      feedback.setAnchor(null)
      return
    }
    let behind = false
    const project = (x: number, y: number, z: number): Pt => {
      scratch.set(x, y, z).applyMatrix4(frame.matrixWorld).project(camera)
      if (scratch.z > 1) behind = true
      return { x: ((scratch.x + 1) / 2) * size.width, y: ((1 - scratch.y) / 2) * size.height }
    }
    const origin = project(cx, handleY, cz)
    const rel = (x: number, y: number, z: number): Pt => {
      const p = project(x, y, z)
      return { x: p.x - origin.x, y: p.y - origin.y }
    }
    /** Screen direction of a plan step `outward` taken from `from` at height `y`. */
    const screenDir = (from: WallPlanPoint, outward: WallPlanPoint, y: number, fallback: Pt) => {
      const a = rel(from[0], y, from[1])
      const b = rel(from[0] + outward[0], y, from[1] + outward[1])
      return unit({ x: b.x - a.x, y: b.y - a.y }, fallback)
    }

    const move: Box = { x: 0, y: 0, ...MOVE_SIZE }
    const tabs: Box[] = []
    const tabDirs: Pt[] = []
    if (editing) {
      for (const { point, outward } of tabAnchors) {
        const t = rel(point[0], handleY, point[1])
        const dir = screenDir(point, outward, handleY, unit(t, { x: 1, y: 0 }))
        const radius = Math.hypot(t.x, t.y)
        if (radius < TAB_MIN_RADIUS) {
          // Slide out along the side's own direction to the minimum radius.
          const along = t.x * dir.x + t.y * dir.y
          const s = -along + Math.sqrt(along * along - radius * radius + TAB_MIN_RADIUS ** 2)
          t.x += dir.x * s
          t.y += dir.y * s
        }
        tabs.push({ ...t, ...TAB_SIZE })
        tabDirs.push(dir)
      }
      for (let pass = 0; pass < 24; pass++) {
        let moved = false
        for (let i = 0; i < tabs.length; i++) {
          for (let j = i + 1; j < tabs.length; j++) {
            const a = tabs[i]!
            const b = tabs[j]!
            if (Math.hypot(a.x - b.x, a.y - b.y) >= TAB_MIN_GAP) continue
            a.x += tabDirs[i]!.x * 2
            a.y += tabDirs[i]!.y * 2
            b.x += tabDirs[j]!.x * 2
            b.y += tabDirs[j]!.y * 2
            moved = true
          }
        }
        if (!moved) break
      }
    }

    // The width chip on the plan-z side nearer the viewer, the depth chip on
    // the plan-x side further right; both just outside the footprint.
    const labelY = baseY + 0.05
    const chipBox = (el: HTMLDivElement | null, side: WallPlanPoint, outward: WallPlanPoint) => {
      const at = rel(side[0], labelY, side[1])
      const dir = screenDir(side, outward, labelY, { x: 0, y: 1 })
      const hw = (el?.offsetWidth ?? 60) / 2
      const hh = (el?.offsetHeight ?? 18) / 2
      const offset = CHIP_GAP + hw * Math.abs(dir.x) + hh * Math.abs(dir.y)
      const box: Box = { x: at.x + dir.x * offset, y: at.y + dir.y * offset, hw, hh }
      return { box, dir }
    }
    const zSides = ([1, -1] as const).map((s) => [cx, cz + (s * footD) / 2] as WallPlanPoint)
    const zSide =
      rel(zSides[0]![0], labelY, zSides[0]![1]).y >= rel(zSides[1]![0], labelY, zSides[1]![1]).y
        ? 0
        : 1
    const xSides = ([1, -1] as const).map((s) => [cx + (s * footW) / 2, cz] as WallPlanPoint)
    const xSide =
      rel(xSides[0]![0], labelY, xSides[0]![1]).x >= rel(xSides[1]![0], labelY, xSides[1]![1]).x
        ? 0
        : 1
    const widthChip = chipBox(widthChipRef.current, zSides[zSide]!, [0, zSide === 0 ? 1 : -1])
    pushClear(widthChip.box, widthChip.dir, [move, ...tabs])
    const depthChip = chipBox(depthChipRef.current, xSides[xSide]!, [xSide === 0 ? 1 : -1, 0])
    pushClear(depthChip.box, depthChip.dir, [move, ...tabs, widthChip.box])

    let rotate: Box | null = null
    let confirm: Pt | null = null
    if (editing) {
      // The rotate arrow takes the widest free gap between the tabs (the
      // preferred one when several are wide), as close in as it fits.
      const angles = tabs.map((tab) => Math.atan2(tab.y, tab.x)).sort((a, b) => a - b)
      let bestAngle = ROTATE_PREFERRED_ANGLE
      let bestScore = Number.NEGATIVE_INFINITY
      angles.forEach((angle, index) => {
        const next = index + 1 < angles.length ? angles[index + 1]! : angles[0]! + Math.PI * 2
        const gap = next - angle
        const bisector = angle + gap / 2
        const off = Math.abs(
          Math.atan2(
            Math.sin(bisector - ROTATE_PREFERRED_ANGLE),
            Math.cos(bisector - ROTATE_PREFERRED_ANGLE),
          ),
        )
        const score = (gap >= (70 * Math.PI) / 180 ? 10 : 0) + gap - off * 0.5
        if (score > bestScore) {
          bestScore = score
          bestAngle = bisector
        }
      })
      const dir = { x: Math.cos(bestAngle), y: Math.sin(bestAngle) }
      rotate = { x: dir.x * 36, y: dir.y * 36, ...ROTATE_SIZE }
      pushClear(rotate, dir, [move, ...tabs, widthChip.box, depthChip.box])

      // 확인 floats above the box and every other part.
      const top = rel(cx, baseY + height, cz)
      let highest = Math.min(
        ...polygon.flatMap(([x, z]) => [rel(x, baseY, z).y, rel(x, baseY + height, z).y]),
        ...[move, rotate, ...tabs, widthChip.box, depthChip.box].map((box) => box.y - box.hh),
      )
      highest -= PART_PAD + CONFIRM_TAIL + CONFIRM_HALF_HEIGHT
      confirm = { x: top.x, y: Math.max(highest, CONFIRM_HALF_HEIGHT + 2 - origin.y) }
    }

    const place = (el: HTMLElement | null | undefined, at: Pt | null) => {
      if (!el) return
      if (!at) {
        el.style.visibility = 'hidden'
        return
      }
      el.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`
      el.style.visibility = 'visible'
    }
    tabs.forEach((tab, index) => {
      place(tabRefs.current[index], tab)
    })
    place(moveRef.current, editing ? move : null)
    place(rotateRef.current, rotate)
    place(confirmRef.current, confirm)
    place(widthChipRef.current, widthChip.box)
    place(depthChipRef.current, depthChip.box)

    // The cursor key list rides beside the whole gizmo, never over it.
    if (behind) {
      feedback.setAnchor(null)
      return
    }
    const boxes: Box[] = [
      widthChip.box,
      depthChip.box,
      ...polygon.flatMap(([x, z]) => [
        { ...rel(x, baseY, z), hw: 0, hh: 0 },
        { ...rel(x, baseY + height, z), hw: 0, hh: 0 },
      ]),
    ]
    if (editing && rotate && confirm) {
      boxes.push(move, rotate, ...tabs, { ...confirm, hw: 36, hh: CONFIRM_HALF_HEIGHT })
    }
    const left = size.left + origin.x + Math.min(...boxes.map((box) => box.x - box.hw))
    const right = size.left + origin.x + Math.max(...boxes.map((box) => box.x + box.hw))
    const top = size.top + origin.y + Math.min(...boxes.map((box) => box.y - box.hh))
    feedback.setAnchor({ left, right, top })
  })

  return (
    <Html
      position={[cx, handleY, cz]}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      zIndexRange={[110, 0]}
    >
      <div style={{ position: 'relative', width: 0, height: 0 }}>
        <div ref={widthChipRef} style={PART_STYLE}>
          <MeasurementChip label={formatLinearMeasurement(footW, unitSystem)} />
        </div>
        <div ref={depthChipRef} style={PART_STYLE}>
          <MeasurementChip label={formatLinearMeasurement(footD, unitSystem)} />
        </div>
        {editing && (
          <>
            {SIDE_HANDLES.map(({ axis, sign }, index) => (
              <div
                key={`${axis}${sign}`}
                ref={(el) => {
                  tabRefs.current[index] = el
                }}
                style={PART_STYLE}
              >
                <SideTab
                  onPointerDown={startDrag({ kind: 'side', axis, sign })}
                  // Whether this side's push-pull runs along the plan's z (drawn upright).
                  vertical={Math.abs(axisOf(axis, placement.turns)[1]) > 0.5}
                />
              </div>
            ))}
            <div ref={moveRef} style={PART_STYLE}>
              <div
                onPointerDown={startDrag({ kind: 'move' })}
                style={{
                  pointerEvents: 'auto',
                  touchAction: 'none',
                  cursor: 'grab',
                  width: MOVE_SIZE.hw * 2,
                  height: MOVE_SIZE.hh * 2,
                  borderRadius: '50%',
                  background: HANDLE_BLUE,
                  border: '2px solid #ffffff',
                  boxShadow: '0 1px 8px rgba(20, 90, 140, 0.45)',
                  boxSizing: 'border-box',
                }}
                title="끌어서 이동"
              />
            </div>
            <div ref={rotateRef} style={PART_STYLE}>
              <RotateArrow onClick={onRotate} />
            </div>
            <div ref={confirmRef} style={PART_STYLE}>
              <ConfirmBubble onClick={onConfirm} />
            </div>
          </>
        )}
      </div>
    </Html>
  )
}

export const RoomPresetTool: React.FC = () => {
  const unit = useViewer((state) => state.unit)
  const defaults = useEditor((state) => state.toolDefaults.wall)
  const spec = readSpec(defaults?.roomPreset)
  const height =
    spec?.kind === 'platform'
      ? ROOM_PRESET_PLATFORM_ELEVATION
      : typeof defaults?.height === 'number'
        ? defaults.height
        : FALLBACK_WALL_HEIGHT
  const thickness =
    typeof defaults?.thickness === 'number' ? defaults.thickness : DEFAULT_WALL_THICKNESS
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const raycaster = useThree((state) => state.raycaster)
  const rootRef = useRef<Group>(null)
  const [placement, setPlacementState] = useState<RoomPresetPlacement | null>(null)
  const [editing, setEditingState] = useState(false)
  const [baseY, setBaseY] = useState(0)
  const placementRef = useRef<RoomPresetPlacement | null>(null)
  const editingRef = useRef(false)
  const specRef = useRef(spec)
  specRef.current = spec
  const baseYRef = useRef(0)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const setPlacement = useCallback((next: RoomPresetPlacement | null) => {
    placementRef.current = next
    setPlacementState(next)
  }, [])
  const setEditing = useCallback((next: boolean) => {
    editingRef.current = next
    setEditingState(next)
    useRoomPresetStatus.getState().setEditing(next)
  }, [])

  const rotate = useCallback(() => {
    const current = placementRef.current
    if (!current) return
    const turns = normalizeQuarterTurns(current.turns + 1)
    setPlacement({ ...current, turns, center: snapCenter(current.center, { ...current, turns }) })
    triggerSFX('sfx:item-rotate')
  }, [setPlacement])

  const commit = useCallback(() => {
    const current = placementRef.current
    const currentSpec = specRef.current
    if (!(current && currentSpec)) return
    createRoomPresetOnCurrentLevel(
      currentSpec.kind,
      getRoomPresetPolygon(currentSpec.outline, current),
    )
  }, [])

  const confirm = useCallback(() => {
    if (!editingRef.current) return
    dragCleanupRef.current?.()
    commit()
    setEditing(false)
  }, [commit, setEditing])

  // Put the preset mode away only when the tool is: a switch to another wall
  // mode has already replaced the defaults and must keep them.
  useEffect(
    () => () => {
      useRoomPresetStatus.getState().setEditing(false)
      const ed = useEditor.getState()
      if (ed.tool !== 'room-preset' && ed.toolDefaults.wall?.placementMode === 'room-preset') {
        ed.setToolDefaults('wall', null)
      }
    },
    [],
  )

  // A reload restores the persisted tool but not the preset seeded into its
  // (unpersisted) defaults; with nothing to place, fall back to walls.
  const hasSpec = spec !== null
  useEffect(() => {
    if (!hasSpec) useEditor.getState().setTool('wall')
  }, [hasSpec])

  // A newly picked preset starts over at its default size, under the cursor.
  const specKey = spec ? `${spec.kind}:${spec.label}:${spec.size.join('x')}` : null
  useEffect(() => {
    dragCleanupRef.current?.()
    const last = placementRef.current
    const size = specKey ? specRef.current?.size : undefined
    setEditing(false)
    setPlacement(
      last && size
        ? { center: snapCenter(last.center, { size, turns: 0 }), size: [...size], turns: 0 }
        : null,
    )
  }, [specKey, setEditing, setPlacement])

  // The size next to the cursor follows every change: moving, a push-pull, a turn.
  useEffect(() => {
    if (!placement) return useDraftReadout.getState().set(null)
    const [w, d] = footprintOf(placement)
    useDraftReadout
      .getState()
      .set(`${formatLinearMeasurement(w, unit)} × ${formatLinearMeasurement(d, unit)}`)
  }, [placement, unit])
  useEffect(() => () => useDraftReadout.getState().set(null), [])

  useEffect(() => {
    const onMove = (event: GridEvent) => {
      if (editingRef.current) return
      const size = specRef.current?.size
      if (!size) return
      baseYRef.current = event.localPosition[1]
      setBaseY(event.localPosition[1])
      // A resized-then-cancelled preset keeps its size and turn.
      const current = placementRef.current
      const next = {
        size: current?.size ?? ([...size] as [number, number]),
        turns: current?.turns ?? 0,
      }
      const placed = {
        ...next,
        center: snapCenter([event.localPosition[0], event.localPosition[2]], next),
      }
      if (samePlacement(placed, current)) return
      if (current) triggerSFX('sfx:grid-snap')
      setPlacement(placed)
    }
    const onClick = (event: GridEvent) => {
      if (editingRef.current) return
      const fromPlan = isFloorplanInputEvent(event.nativeEvent)
      if (fromPlan || !placementRef.current) onMove(event)
      if (!placementRef.current) return
      if (fromPlan) {
        commit()
        return
      }
      setEditing(true)
      triggerSFX('sfx:structure-build-start')
    }
    const onCancel = () => {
      if (!editingRef.current) return
      markToolCancelConsumed()
      dragCleanupRef.current?.()
      setEditing(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (
        (event.key === 'r' || event.key === 'R' || event.code === 'KeyR') &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        rotate()
      } else if (event.key === 'Enter' && editingRef.current) {
        confirm()
      } else {
        return
      }
      event.preventDefault()
      event.stopPropagation()
    }
    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [commit, confirm, rotate, setEditing, setPlacement])

  useEffect(() => () => dragCleanupRef.current?.(), [])

  const polygon = useMemo(
    () => (spec && placement ? getRoomPresetPolygon(spec.outline, placement) : null),
    [spec, placement],
  )
  const presetKind = spec?.kind

  useEffect(() => {
    if (!(polygon && presetKind)) return usePlacementPreview.getState().clear()
    usePlacementPreview.getState().setGeometry(planGhost(presetKind, polygon, thickness))
  }, [polygon, presetKind, thickness])
  useEffect(() => () => usePlacementPreview.getState().clear(), [])

  const handleY = baseY + (spec?.kind === 'platform' ? height : height / 2)

  /** Plan point under the pointer on the horizontal plane at the handles' height. */
  const hitOnHandlePlane = (clientX: number, clientY: number): WallPlanPoint | null => {
    const root = rootRef.current
    if (!root) return null
    const rect = gl.domElement.getBoundingClientRect()
    raycaster.setFromCamera(
      new Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    )
    const ray = raycaster.ray.clone().applyMatrix4(new Matrix4().copy(root.matrixWorld).invert())
    const hit = ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -handleY), new Vector3())
    return hit ? [hit.x, hit.z] : null
  }

  const startDrag = (handle: DragHandle) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = placementRef.current
    const grab = hitOnHandlePlane(event.clientX, event.clientY)
    if (!(start && grab)) return
    dragCleanupRef.current?.()
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = handle.kind === 'move' ? 'grabbing' : document.body.style.cursor
    triggerSFX('sfx:item-pick')

    const onMove = (moveEvent: PointerEvent) => {
      const hit = hitOnHandlePlane(moveEvent.clientX, moveEvent.clientY)
      if (!hit) return
      const next = dragPlacement(handle, start, grab, hit)
      if (samePlacement(next, placementRef.current)) return
      triggerSFX(handle.kind === 'move' ? 'sfx:grid-snap' : 'sfx:resize')
      setPlacement(next)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
      useViewer.getState().setInputDragging(false)
      dragCleanupRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    dragCleanupRef.current = cleanup
  }

  if (!(spec && placement && polygon)) return <group ref={rootRef} />

  return (
    <group ref={rootRef}>
      <PresetGhost
        baseY={baseY}
        fillAtTop={spec.kind === 'platform'}
        height={height}
        polygon={polygon}
      />
      <PresetGizmo
        baseY={baseY}
        editing={editing}
        frameRef={rootRef}
        handleY={handleY}
        height={height}
        onConfirm={confirm}
        onRotate={rotate}
        outline={spec.outline}
        placement={placement}
        polygon={polygon}
        startDrag={startDrag}
        unitSystem={unit}
      />
    </group>
  )
}
