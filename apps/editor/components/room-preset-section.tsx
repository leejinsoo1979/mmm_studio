'use client'

import { type RoomPresetKind, type RoomPresetSpec, triggerSFX, useEditor } from '@pascal-app/editor'
import { Check } from 'lucide-react'
import { useEffect } from 'react'
import { ROOM_PRESET_SHAPES, type RoomPresetShape, roomPresetArea } from '@/lib/room-presets'
import { cn } from '@/lib/utils'
import { useWallDrawingDefaults, wallDrawingToolDefaults } from '@/lib/wall-drawing-defaults'
import { CatalogHover } from './catalog-hover-card'

/** Section headers this component renders, for the panel's jump chips. */
export const ROOM_PRESET_SECTION_TITLES = ['방', '플랫폼'] as const

const RECTANGLE_ROOM_LABEL = '사각형 방'

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
      <svg aria-hidden className="h-[78%] w-[78%]" viewBox="0 0 100 100">
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
    <svg aria-hidden className="h-[78%] w-[78%]" viewBox="0 0 100 100">
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

function PresetCard({
  active,
  area,
  description,
  label,
  onClick,
  thumb,
}: {
  active: boolean
  area?: string
  description: string
  label: string
  onClick: () => void
  thumb: React.ReactNode
}) {
  return (
    <CatalogHover info={{ title: label, description, meta: area }}>
      <button
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'group relative flex aspect-square min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] ring-1 transition-all duration-150 dark:bg-neutral-900',
          active ? 'ring-2 ring-sky-400' : 'ring-black/5 hover:ring-neutral-400 dark:ring-white/10',
        )}
        onClick={() => {
          triggerSFX('sfx:menu-click')
          onClick()
        }}
        onMouseEnter={() => triggerSFX('sfx:menu-hover')}
        type="button"
      >
        <span className="mb-2 flex h-full w-full items-center justify-center transition-transform duration-150 group-hover:scale-105">
          {thumb}
        </span>
        <span className="absolute inset-x-1.5 bottom-1 flex items-baseline justify-between gap-1 text-[10px] leading-none">
          <span className="truncate font-medium text-neutral-700 dark:text-neutral-200">
            {label}
          </span>
          {area && <span className="shrink-0 text-neutral-400 tabular-nums">{area}</span>}
        </span>
        {active && (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-sky-400 text-white">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </button>
    </CatalogHover>
  )
}

function Header({ title }: { title: string }) {
  return (
    <h2 className="mb-2 rounded-md bg-neutral-200/80 px-3 py-1.5 font-semibold text-[12px] text-neutral-600 leading-none dark:bg-white/10 dark:text-neutral-300">
      {title}
    </h2>
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

  const query = needle.trim()
  const matches = (title: string, label: string) =>
    !query || title.includes(query) || label.includes(query)
  const isActive = (kind: RoomPresetKind, shape: RoomPresetShape) =>
    mode === 'build' && activePreset?.kind === kind && activePreset.label === shape.label

  const rooms = ROOM_PRESET_SHAPES.filter((shape) => matches('방', shape.label))
  const platforms = ROOM_PRESET_SHAPES.filter((shape) => matches('플랫폼', shape.label))
  const showRectangle = matches('방', RECTANGLE_ROOM_LABEL)
  const square = ROOM_PRESET_SHAPES[0]!

  return (
    <>
      {(showRectangle || rooms.length > 0) && (
        <section className="scroll-mt-1 px-2 pt-3" data-build-section="방">
          <Header title="방" />
          <div className="grid grid-cols-4 gap-1.5">
            {showRectangle && (
              <PresetCard
                active={mode === 'build' && tool === 'rectangle-room'}
                description="두 번 클릭해 원하는 크기의 사각형 방을 그립니다. 벽과 바닥이 함께 생깁니다."
                label={RECTANGLE_ROOM_LABEL}
                onClick={activateRectangleRoom}
                thumb={<PresetThumb dashed kind="room" shape={square} />}
              />
            )}
            {rooms.map((shape) => (
              <PresetCard
                active={isActive('room', shape)}
                area={formatArea(roomPresetArea(shape))}
                description={`${shape.size[0]} × ${shape.size[1]} m ${shape.label} 방. 클릭해 놓은 뒤 옆면 손잡이로 크기를, 화살표로 방향을 바꾸고 확인(Enter)을 누르세요.`}
                key={shape.id}
                label={shape.label}
                onClick={() => activateRoomPreset('room', shape)}
                thumb={<PresetThumb kind="room" shape={shape} />}
              />
            ))}
          </div>
        </section>
      )}
      {platforms.length > 0 && (
        <section className="scroll-mt-1 px-2 pt-3" data-build-section="플랫폼">
          <Header title="플랫폼" />
          <div className="grid grid-cols-4 gap-1.5">
            {platforms.map((shape) => (
              <PresetCard
                active={isActive('platform', shape)}
                area={formatArea(roomPresetArea(shape))}
                description={`${shape.size[0]} × ${shape.size[1]} m ${shape.label} 플랫폼 (높이 30 cm, 벽 없음). 클릭해 놓은 뒤 크기·방향을 맞추고 확인(Enter)을 누르세요.`}
                key={shape.id}
                label={shape.label}
                onClick={() => activateRoomPreset('platform', shape)}
                thumb={<PresetThumb kind="platform" shape={shape} />}
              />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
