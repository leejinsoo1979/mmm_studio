import { emitter, type GridEvent, SlabNode as SlabSchema } from '@pascal-app/core'
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
  type RoomPresetPlacement,
  type RoomPresetSpec,
  roomPresetLocalToPlan,
  triggerSFX,
  useDraftReadout,
  useEditor,
  usePlacementPreview,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Check } from 'lucide-react'
import {
  type PointerEvent as ReactPointerEvent,
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
import { color, float, floor, fract, mix, sin, step, uv } from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'

/**
 * inZOI's click-to-place 방 / 플랫폼 preset (q129 / q130). The preset follows
 * the cursor as a cyan wireframe prism with glow streaks along its base; the
 * first click drops it into an editable state — side push-pull tabs, a centre
 * move handle, a 90° rotate arrow and a '✓ 확인' bubble. 확인 (or Enter)
 * commits the walls + floor (방) or the raised slab (플랫폼) as one undo step;
 * Esc returns to placing. Everything snaps to the grid step. The floor plan
 * has no gizmo: it shows the preset as a ghost footprint and a plan click
 * places it as previewed (R still turns it).
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
// Dimension chips sit this far outside the footprint, clear of the side tabs.
const LABEL_GAP = 0.8

const EDGE_COLOR = '#74d3f5'
const HANDLE_BLUE = '#27a2e8'
const TAB_FILL = '#bfe6f8'

const edgeMaterial = new LineBasicNodeMaterial({
  color: EDGE_COLOR,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 0.95,
  toneMapped: false,
})

// The glow curtain along the base: uv.x runs along the perimeter in metres,
// uv.y up the curtain. Thin columns of random height, bright at the floor and
// fading upward, over a soft cyan wash.
const streakCell = uv().x.div(STREAK_SPACING)
const streakRandom = fract(sin(floor(streakCell).mul(12.9898).add(78.233)).mul(43758.5453))
const streakTop = streakRandom.mul(streakRandom).mul(0.85).add(0.12)
const streak = step(fract(streakCell), float(0.4))
  .mul(step(uv().y, streakTop))
  .mul(float(1).sub(uv().y.div(streakTop)))
const wash = float(1).sub(uv().y).pow(2).mul(0.28)
const curtainMaterial = new MeshBasicNodeMaterial({
  colorNode: mix(color('#8fdcfb'), color('#16ade9'), streak),
  opacityNode: streak.mul(0.95).add(wash),
  transparent: true,
  depthTest: false,
  depthWrite: false,
  side: DoubleSide,
  toneMapped: false,
})
const floorMaterial = new MeshBasicNodeMaterial({
  color: '#7fd8ff',
  opacity: 0.2,
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
  const reach = handle.sign * ((hit[0] - fixed[0]) * ax + (hit[1] - fixed[1]) * az)
  const nextSpan = Math.max(Math.max(MIN_SPAN, step), snapTo(reach, step))
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

function prismEdgeGeometry(polygon: WallPlanPoint[], y: number, height: number) {
  const points: Vector3[] = []
  for (const [a, b] of edgesOf(polygon)) {
    points.push(new Vector3(a[0], y, a[1]), new Vector3(b[0], y, b[1]))
    points.push(new Vector3(a[0], y + height, a[1]), new Vector3(b[0], y + height, b[1]))
    points.push(new Vector3(a[0], y, a[1]), new Vector3(a[0], y + height, a[1]))
  }
  return new BufferGeometry().setFromPoints(points)
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
  const geometries = useMemo(
    () => ({
      edges: prismEdgeGeometry(polygon, baseY, height),
      curtain: curtainGeometry(
        polygon,
        baseY,
        Math.min(Math.max(height, CURTAIN_MIN_HEIGHT), CURTAIN_MAX_HEIGHT),
      ),
      floor: floorGeometry(polygon),
    }),
    [polygon, baseY, height],
  )
  useEffect(
    () => () => {
      for (const geometry of Object.values(geometries)) geometry.dispose()
    },
    [geometries],
  )
  return (
    <group>
      <mesh
        frustumCulled={false}
        geometry={geometries.floor}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        material={floorMaterial}
        position={[0, baseY + FLOOR_LIFT + (fillAtTop ? height : 0), 0]}
        renderOrder={1}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      <mesh
        frustumCulled={false}
        geometry={geometries.curtain}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        material={curtainMaterial}
        renderOrder={2}
      />
      <lineSegments
        frustumCulled={false}
        geometry={geometries.edges}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        material={edgeMaterial}
        renderOrder={4}
      />
    </group>
  )
}

const htmlStyle = { pointerEvents: 'none', userSelect: 'none' } as const

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
      <svg aria-hidden fill="none" height="40" viewBox="0 0 64 40" width="64">
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

  useEffect(() => {
    const publishReadout = () => {
      const current = placementRef.current
      if (!current) return useDraftReadout.getState().set(null)
      const [w, d] = footprintOf(current)
      useDraftReadout
        .getState()
        .set(`${formatLinearMeasurement(w, unit)} × ${formatLinearMeasurement(d, unit)}`)
    }
    const place = (next: RoomPresetPlacement) => {
      if (!samePlacement(next, placementRef.current)) {
        if (placementRef.current) triggerSFX('sfx:grid-snap')
        setPlacement(next)
      }
      publishReadout()
    }
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
      place({ ...next, center: snapCenter([event.localPosition[0], event.localPosition[2]], next) })
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
      useDraftReadout.getState().set(null)
    }
  }, [unit, commit, confirm, rotate, setEditing, setPlacement])

  useEffect(() => () => dragCleanupRef.current?.(), [])

  const polygon = useMemo(
    () => (spec && placement ? getRoomPresetPolygon(spec.outline, placement) : null),
    [spec, placement],
  )
  const presetKind = spec?.kind

  // The floor plan's ghost: the footprint as a transient slab.
  useEffect(() => {
    if (!polygon) return usePlacementPreview.getState().clear()
    usePlacementPreview.getState().set(
      SlabSchema.parse({
        polygon,
        elevation: presetKind === 'platform' ? ROOM_PRESET_PLATFORM_ELEVATION : undefined,
      }),
    )
  }, [polygon, presetKind])
  useEffect(() => () => usePlacementPreview.getState().clear(), [])

  const hitOnFloor = (clientX: number, clientY: number): WallPlanPoint | null => {
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
    const hit = ray.intersectPlane(
      new Plane(new Vector3(0, 1, 0), -baseYRef.current),
      new Vector3(),
    )
    return hit ? [hit.x, hit.z] : null
  }

  const startDrag = (handle: DragHandle) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = placementRef.current
    const grab = hitOnFloor(event.clientX, event.clientY)
    if (!(start && grab)) return
    dragCleanupRef.current?.()
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = handle.kind === 'move' ? 'grabbing' : document.body.style.cursor
    triggerSFX('sfx:item-pick')

    const onMove = (moveEvent: PointerEvent) => {
      const hit = hitOnFloor(moveEvent.clientX, moveEvent.clientY)
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

  const [cx, cz] = placement.center
  const handleY = baseY + (spec.kind === 'platform' ? height : height / 2)
  const [footW, footD] = footprintOf(placement)
  const sidePoint = (axis: 0 | 1, sign: 1 | -1): [number, number, number] => {
    const [px, pz] = roomPresetLocalToPlan(
      axis === 0 ? [sign * 0.5, 0] : [0, sign * 0.5],
      placement,
    )
    return [px, handleY, pz]
  }
  const labelY = baseY + 0.05

  return (
    <group ref={rootRef}>
      <PresetGhost
        baseY={baseY}
        fillAtTop={spec.kind === 'platform'}
        height={height}
        polygon={polygon}
      />
      <Html
        center
        position={[cx, labelY, cz + footD / 2 + LABEL_GAP]}
        style={htmlStyle}
        zIndexRange={[100, 0]}
      >
        <MeasurementChip label={formatLinearMeasurement(footW, unit)} />
      </Html>
      <Html
        center
        position={[cx + footW / 2 + LABEL_GAP, labelY, cz]}
        style={htmlStyle}
        zIndexRange={[100, 0]}
      >
        <MeasurementChip label={formatLinearMeasurement(footD, unit)} />
      </Html>
      {editing && (
        <>
          {SIDE_HANDLES.map(({ axis, sign }) => {
            // Whether this side's push-pull runs along the plan's z (drawn upright).
            const vertical = Math.abs(axisOf(axis, placement.turns)[1]) > 0.5
            return (
              <Html
                center
                key={`${axis}${sign}`}
                position={sidePoint(axis, sign)}
                style={{ userSelect: 'none' }}
                zIndexRange={[110, 0]}
              >
                <SideTab
                  onPointerDown={startDrag({ kind: 'side', axis, sign })}
                  vertical={vertical}
                />
              </Html>
            )
          })}
          <Html
            center
            position={[cx, handleY, cz]}
            style={{ userSelect: 'none' }}
            zIndexRange={[110, 0]}
          >
            <div style={{ position: 'relative', width: 30, height: 30 }}>
              <div
                onPointerDown={startDrag({ kind: 'move' })}
                style={{
                  pointerEvents: 'auto',
                  touchAction: 'none',
                  cursor: 'grab',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: HANDLE_BLUE,
                  border: '2px solid #ffffff',
                  boxShadow: '0 1px 8px rgba(20, 90, 140, 0.45)',
                  boxSizing: 'border-box',
                }}
                title="끌어서 이동"
              />
              <div style={{ position: 'absolute', right: 46, top: -5 }}>
                <RotateArrow onClick={rotate} />
              </div>
            </div>
          </Html>
          <Html
            center
            position={[cx, baseY + height, cz - footD / 2]}
            style={{ userSelect: 'none' }}
            zIndexRange={[120, 0]}
          >
            <button
              onClick={confirm}
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                pointerEvents: 'auto',
                position: 'relative',
                // Float the bubble above the box's back top edge.
                transform: 'translateY(-26px)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                height: 28,
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
          </Html>
        </>
      )}
    </group>
  )
}
