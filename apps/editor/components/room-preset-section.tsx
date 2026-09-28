'use client'

import {
  CatalogCard,
  CatalogSection,
  type RoomPresetKind,
  type RoomPresetSpec,
  useEditor,
} from '@pascal-app/editor'
import { useEffect } from 'react'
import { ROOM_PRESET_SHAPES, type RoomPresetShape, roomPresetArea } from '@/lib/room-presets'
import { useWallDrawingDefaults, wallDrawingToolDefaults } from '@/lib/wall-drawing-defaults'

const RECTANGLE_ROOM_LABEL = '사각형 방'

/** The 방 / 플랫폼 cards matching the panel's search text (titles match by prefix). */
function presetMatches(needle: string) {
  const query = needle.trim()
  const matches = (title: string, label: string) =>
    !query || title.startsWith(query) || label.includes(query)
  return {
    rooms: ROOM_PRESET_SHAPES.filter((shape) => matches('방', shape.label)),
    platforms: ROOM_PRESET_SHAPES.filter((shape) => matches('플랫폼', shape.label)),
    showRectangle: matches('방', RECTANGLE_ROOM_LABEL),
  }
}

/** Section headers this component renders for `needle`, for the panel's icon row. */
export function visibleRoomPresetSections(needle: string): string[] {
  const { rooms, platforms, showRectangle } = presetMatches(needle)
  return [
    ...(showRectangle || rooms.length > 0 ? ['방'] : []),
    ...(platforms.length > 0 ? ['플랫폼'] : []),
  ]
}

function activateRoomPreset(kind: RoomPresetKind, shape: RoomPresetShape): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  const roomPreset: RoomPresetSpec = {
    kind,
    label: shape.label,
    outline: shape.outline,
    size: shape.size,
  }
  ed.setToolDefaults('wall', {
    placementMode: 'room-preset',
    roomPreset,
    ...wallDrawingToolDefaults(),
  })
  ed.setMode('build')
  ed.setTool('room-preset')
}

function activateRectangleRoom(): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setToolDefaults('wall', { placementMode: 'rectangle-room', ...wallDrawingToolDefaults() })
  ed.setSnappingMode('wall', 'grid')
  ed.setMode('build')
  ed.setTool('rectangle-room')
}

// ── Thumbnails ──────────────────────────────────────────────────────────
// An open-top white room shell (방) or a low solid pad (플랫폼), drawn from
// the preset outline so every card matches the shape it places. Seen from the
// front and above, turned a little (inZOI's cards), so 정사각 reads as a box
// and 마름모 as a corner.

const VIEW_TURN = (20 * Math.PI) / 180
const DEPTH_SQUASH = 0.5
const ROOM_WALL_HEIGHT = 0.42
const PLATFORM_HEIGHT = 0.12

type Plan = [number, number]

function turnPlan([x, z]: Plan): Plan {
  const c = Math.cos(VIEW_TURN)
  const s = Math.sin(VIEW_TURN)
  return [x * c - z * s, x * s + z * c]
}

function project([x, z]: Plan, y: number): Plan {
  return [x, z * DEPTH_SQUASH - y]
}

function signedArea(points: Plan[]) {
  let twice = 0
  points.forEach(([x, z], index) => {
    const [nx, nz] = points[(index + 1) % points.length]!
    twice += x * nz - nx * z
  })
  return twice / 2
}

function PresetThumb({
  dashed,
  kind,
  shape,
}: {
  dashed?: boolean
  kind: RoomPresetKind
  shape: RoomPresetShape
}) {
  const [w, d] = shape.size
  const scale = 1 / Math.max(w, d)
  const plan: Plan[] = shape.outline.map(([x, z]) => turnPlan([x * w * scale, z * d * scale]))
  const height = kind === 'room' ? ROOM_WALL_HEIGHT : PLATFORM_HEIGHT
  const winding = Math.sign(signedArea(plan)) || 1

  const projected = plan.flatMap((point) => [project(point, 0), project(point, height)])
  const xs = projected.map(([x]) => x)
  const ys = projected.map(([, y]) => y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY)
  const fit = 70 / span
  const offsetX = (100 - (Math.max(...xs) - minX) * fit) / 2
  const offsetY = (92 - (Math.max(...ys) - minY) * fit) / 2
  const toSvg = (point: Plan, y: number) => {
    const [px, py] = project(point, y)
    return `${((px - minX) * fit + offsetX).toFixed(2)},${((py - minY) * fit + offsetY).toFixed(2)}`
  }
  const ring = (y: number) => plan.map((point) => toSvg(point, y)).join(' ')

  const faces = plan
    .map((a, index) => {
      const b = plan[(index + 1) % plan.length]!
      const normal: Plan = [winding * (b[1] - a[1]), winding * -(b[0] - a[0])]
      return {
        key: index,
        depth: a[1] + b[1],
        outer: normal[1] > 1e-6,
        rightFacing: normal[0] > 0,
        points: [toSvg(a, 0), toSvg(b, 0), toSvg(b, height), toSvg(a, height)].join(' '),
      }
    })
    .sort((a, b) => a.depth - b.depth)

  const stroke = '#b8b8b8'
  if (kind === 'platform') {
    return (
      <svg aria-hidden className="h-full w-full" viewBox="0 0 100 100">
        {faces
          .filter((face) => face.outer)
          .map((face) => (
            <polygon
              fill={face.rightFacing ? '#dedede' : '#ebebeb'}
              key={face.key}
              points={face.points}
              stroke={stroke}
              strokeLinejoin="round"
              strokeWidth={0.8}
            />
          ))}
        <polygon
          fill="#fbfbfb"
          points={ring(height)}
          stroke={stroke}
          strokeLinejoin="round"
          strokeWidth={0.9}
        />
      </svg>
    )
  }
  return (
    <svg aria-hidden className="h-full w-full" viewBox="0 0 100 100">
      <polygon fill="#e2e2e2" points={ring(0)} stroke={stroke} strokeWidth={0.6} />
      {faces.map((face) => (
        <polygon
          fill={
            face.outer
              ? face.rightFacing
                ? '#f1f1f1'
                : '#fcfcfc'
              : face.rightFacing
                ? '#ececec'
                : '#e5e5e5'
          }
          key={face.key}
          points={face.points}
          stroke={stroke}
          strokeLinejoin="round"
          strokeWidth={0.8}
        />
      ))}
      <polygon
        fill="none"
        points={ring(height)}
        stroke="#a3a3a3"
        strokeDasharray={dashed ? '3 2.5' : undefined}
        strokeLinejoin="round"
        strokeWidth={1.1}
      />
    </svg>
  )
}

const formatArea = (area: number) => `${Number.isInteger(area) ? area : area.toFixed(1)}㎡`

/**
 * inZOI's 방 and 플랫폼 build-panel groups: click a shape, move it over the
 * lot, click to drop it, then push / pull / rotate it in place and 확인.
 * `needle` is the panel's search text; a group hides when nothing matches.
 */
export function RoomPresetSection({ needle = '' }: { needle?: string }) {
  const mode = useEditor((s) => s.mode)
  const tool = useEditor((s) => s.tool)
  const activePreset = useEditor((s) =>
    s.tool === 'room-preset'
      ? (s.toolDefaults.wall?.roomPreset as RoomPresetSpec | undefined)
      : undefined,
  )

  // Keep an armed preset on the build panel's current wall height / build-up.
  useEffect(
    () =>
      useWallDrawingDefaults.subscribe(() => {
        const ed = useEditor.getState()
        if (ed.tool !== 'room-preset') return
        const { height: _height, ...rest } = (ed.toolDefaults.wall ?? {}) as Record<string, unknown>
        ed.setToolDefaults('wall', { ...rest, ...wallDrawingToolDefaults() })
      }),
    [],
  )

  const isActive = (kind: RoomPresetKind, shape: RoomPresetShape) =>
    mode === 'build' && activePreset?.kind === kind && activePreset.label === shape.label

  const { rooms, platforms, showRectangle } = presetMatches(needle)
  const square = ROOM_PRESET_SHAPES[0]!

  const card = (kind: RoomPresetKind, shape: RoomPresetShape, description: string) => {
    const area = formatArea(roomPresetArea(shape))
    return (
      <CatalogCard
        active={isActive(kind, shape)}
        hover={{ description, meta: area }}
        key={shape.id}
        // Names the kind too, so 정사각 방 and 정사각 플랫폼 read apart.
        label={`${shape.label} ${kind === 'room' ? '방' : '플랫폼'}`}
        meta={`${shape.label} ${area}`}
        onClick={() => activateRoomPreset(kind, shape)}
        thumb={<PresetThumb kind={kind} shape={shape} />}
      />
    )
  }

  return (
    <>
      {(showRectangle || rooms.length > 0) && (
        <CatalogSection data-build-section="방" title="방">
          {showRectangle && (
            <CatalogCard
              active={mode === 'build' && tool === 'rectangle-room'}
              hover={{
                description:
                  '두 번 클릭해 원하는 크기의 사각형 방을 그립니다. 벽과 바닥이 함께 생깁니다.',
                meta: '직접 그리기',
              }}
              label={RECTANGLE_ROOM_LABEL}
              meta={RECTANGLE_ROOM_LABEL}
              onClick={activateRectangleRoom}
              thumb={<PresetThumb dashed kind="room" shape={square} />}
            />
          )}
          {rooms.map((shape) =>
            card(
              'room',
              shape,
              `${shape.size[0]} × ${shape.size[1]} m ${shape.label} 방. 클릭해 놓은 뒤 옆면 손잡이로 크기를, 화살표로 방향을 바꾸고 확인(Enter)을 누르세요.`,
            ),
          )}
        </CatalogSection>
      )}
      {platforms.length > 0 && (
        <CatalogSection data-build-section="플랫폼" title="플랫폼">
          {platforms.map((shape) =>
            card(
              'platform',
              shape,
              `${shape.size[0]} × ${shape.size[1]} m ${shape.label} 플랫폼 (높이 30 cm, 벽 없음). 클릭해 놓은 뒤 크기·방향을 맞추고 확인(Enter)을 누르세요.`,
            ),
          )}
        </CatalogSection>
      )}
    </>
  )
}
