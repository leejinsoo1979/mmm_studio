import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_WALL_HEIGHT,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { create } from 'zustand'
import { getCabinetPreset, instantiateSpec } from './engine/presets'
import {
  firstFreeSlot,
  type Slot,
  type SlotFrameMode,
  type SlotLayout,
  slotLayout,
  wallSegments,
  widestSegment,
} from './engine/slots'
import { type WallRun, wallRun } from './kitchen'
import { CabinetNode } from './schema'

const MM = 0.001

/**
 * mmmcraft Room "슬롯 생성" mode. While on, clicking a wall makes it the
 * reference wall (its furniture is cleared, as in mmmcraft), slot guides are
 * drawn on it and double-clicking a module places it in the first free
 * slot(s), resized to the slot width. Not saved with the scene.
 */
type SlotModeState = {
  enabled: boolean
  wallId: string | null
  /** Door-split piece of the wall; null = the widest. */
  segment: number | null
  columnCount: number | null
  frameMode: SlotFrameMode
  setEnabled(enabled: boolean): void
  setWall(wallId: string | null): void
  setSegment(segment: number | null): void
  setColumnCount(count: number | null): void
  setFrameMode(mode: SlotFrameMode): void
}

export const useSlotMode = create<SlotModeState>((set) => ({
  enabled: false,
  wallId: null,
  segment: null,
  columnCount: null,
  frameMode: 'surround',
  setEnabled: (enabled) => set(enabled ? { enabled } : { enabled, wallId: null, segment: null }),
  setWall: (wallId) => set({ wallId, segment: null, columnCount: null }),
  setSegment: (segment) => set({ segment, columnCount: null }),
  setColumnCount: (columnCount) => set({ columnCount }),
  setFrameMode: (frameMode) => set({ frameMode, columnCount: null }),
}))

export type SlotGuide = {
  wall: WallNode
  /** Wall number within its level (1-based), as mmmcraft labels 기준 벽 N. */
  wallNumber: number
  run: WallRun
  segments: [number, number][]
  segment: number
  /** Slot layout with positions measured from the run's left end. */
  layout: SlotLayout
  /** Clear length of the chosen piece. */
  lengthMm: number
}

/** Door openings on the wall as [start, end] along the run, mm. */
function doorIntervals(wall: WallNode, run: WallRun, nodes: Readonly<Record<string, AnyNode>>) {
  const [sx, sz] = wall.start
  const [ex, ez] = wall.end
  const len = Math.hypot(ex - sx, ez - sz)
  const dir = [(ex - sx) / len, (ez - sz) / len]
  const out: [number, number][] = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'door' || node.parentId !== wall.id) continue
    const door = node as unknown as { position: [number, number, number]; width: number }
    const cx = sx + (dir[0] ?? 0) * door.position[0]
    const cz = sz + (dir[1] ?? 0) * door.position[0]
    const along = ((cx - run.origin[0]) * run.along[0] + (cz - run.origin[1]) * run.along[1]) / MM
    const half = door.width / 2 / MM
    const round = (v: number) => Math.round(v * 10) / 10
    out.push([round(along - half), round(along + half)])
  }
  return out
}

export function slotGuideFor(
  wallId: string,
  state: Pick<SlotModeState, 'segment' | 'columnCount' | 'frameMode'>,
  nodes: Readonly<Record<string, AnyNode>>,
): SlotGuide | null {
  const wall = nodes[wallId] as WallNode | undefined
  if (wall?.type !== 'wall') return null
  const run = wallRun(wall, nodes)
  if (!run) return null
  const segments = wallSegments(run.lengthMm, doorIntervals(wall, run, nodes))
  if (segments.length === 0) return null
  const segment =
    state.segment !== null && state.segment < segments.length
      ? state.segment
      : widestSegment(segments)
  const [a, b] = segments[segment] ?? [0, 0]
  const layout = slotLayout({
    lengthMm: b - a,
    heightMm: (wall.height ?? DEFAULT_WALL_HEIGHT) / MM,
    mode: state.frameMode,
    columnCount: state.columnCount ?? undefined,
  })
  const shift = (s: Slot): Slot => ({
    ...s,
    left: s.left + a,
    right: s.right + a,
    center: s.center + a,
  })
  const levelWalls = Object.values(nodes).filter(
    (n) => n?.type === 'wall' && n.parentId === wall.parentId,
  )
  return {
    wall,
    wallNumber: levelWalls.findIndex((n) => n.id === wall.id) + 1,
    run,
    segments,
    segment,
    layout: { ...layout, slots: layout.slots.map(shift) },
    lengthMm: b - a,
  }
}

/** A cabinet's centre in run coordinates (mm along the face, mm into the room). */
function runCoords(run: WallRun, node: { position: [number, number, number] }) {
  const dx = node.position[0] - run.origin[0]
  const dz = node.position[2] - run.origin[1]
  return {
    along: (dx * run.along[0] + dz * run.along[1]) / MM,
    away: (dx * run.normal[0] + dz * run.normal[1]) / MM,
  }
}

function levelCabinets(levelId: string, nodes: Readonly<Record<string, AnyNode>>) {
  return Object.values(nodes).filter(
    (n): n is AnyNode & CabinetNode =>
      (n as { type?: string })?.type === 'cabinet' && n.parentId === levelId,
  ) as unknown as CabinetNode[]
}

/**
 * mmmcraft `furnitureOnSlotWall`: cabinets standing in front of the slotted
 * piece — centre within the piece ± half its width, and between −depth and
 * 1.5 × depth from the wall.
 */
export function cabinetsOnSlotWall(guide: SlotGuide, nodes: Readonly<Record<string, AnyNode>>) {
  const slots = guide.layout.slots
  const first = slots[0]
  const last = slots.at(-1)
  if (!first || !last) return []
  return levelCabinets(guide.run.levelId, nodes).filter((c) => {
    const { along, away } = runCoords(guide.run, c)
    return (
      along > first.left - c.widthMm / 2 &&
      along < last.right + c.widthMm / 2 &&
      away > -c.depthMm &&
      away < c.depthMm * 1.5
    )
  })
}

/** Select `wallId` as the reference wall and clear its furniture in one
 *  undo step. Returns how many cabinets were removed. */
export function selectSlotWall(wallId: string): number {
  const store = useSlotMode.getState()
  store.setWall(wallId)
  const nodes = useScene.getState().nodes
  const guide = slotGuideFor(wallId, useSlotMode.getState(), nodes)
  if (!guide) return 0
  const doomed = cabinetsOnSlotWall(guide, nodes)
  if (doomed.length > 0) useScene.getState().deleteNodes(doomed.map((c) => c.id as AnyNodeId))
  return doomed.length
}

/** Plan-view footprint corners of a cabinet (metres). */
function footprint(c: {
  position: [number, number, number]
  rotation: [number, number, number]
  widthMm: number
  depthMm: number
}): [number, number][] {
  const ry = c.rotation[1] ?? 0
  const ax: [number, number] = [Math.cos(ry), -Math.sin(ry)]
  const az: [number, number] = [Math.sin(ry), Math.cos(ry)]
  const hw = (c.widthMm / 2) * MM
  const hd = (c.depthMm / 2) * MM
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sz]) => [
    c.position[0] + ax[0] * hw * (sx ?? 0) + az[0] * hd * (sz ?? 0),
    c.position[2] + ax[1] * hw * (sx ?? 0) + az[1] * hd * (sz ?? 0),
  ])
}

/** Separating-axis test for two convex quads (touching faces don't count). */
function overlaps(a: [number, number][], b: [number, number][]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i] ?? [0, 0]
      const q = poly[(i + 1) % poly.length] ?? [0, 0]
      const axis: [number, number] = [q[1] - p[1], p[0] - q[0]]
      const project = (pts: [number, number][]) => pts.map((v) => v[0] * axis[0] + v[1] * axis[1])
      const pa = project(a)
      const pb = project(b)
      const eps = 1e-6
      if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps) {
        return false
      }
    }
  }
  return true
}

/** Vertical extent of a cabinet, mm from the floor. */
function verticalRange(c: CabinetNode): [number, number] {
  const y = c.position[1] / MM
  return [y, y + c.heightMm]
}

/**
 * mmmcraft `placeModuleInSlot`: put a preset in the first free slot run of
 * the reference wall (dual presets take two slots), sized to the slots —
 * width = slot span, full-height units fill the slot height on the 60 base.
 * Returns an error message (mmmcraft's wording) or the new cabinet id.
 */
export function placePresetInSlot(presetId: string): { id: string } | { error: string } {
  const state = useSlotMode.getState()
  if (!state.wallId) return { error: '기준 벽을 먼저 선택해 주세요.' }
  const nodes = useScene.getState().nodes
  const guide = slotGuideFor(state.wallId, state, nodes)
  if (!guide) return { error: '기준 벽을 먼저 선택해 주세요.' }
  const preset = getCabinetPreset(presetId)
  if (!preset) return { error: '모듈을 찾을 수 없습니다.' }
  const spec = CabinetNode.parse({ ...instantiateSpec(preset.spec()), presetId: preset.id })
  const needed = preset.id.startsWith('dual-') ? 2 : 1
  const cabinets = levelCabinets(guide.run.levelId, nodes)
  const start = firstFreeSlot(
    guide.layout.slots,
    needed,
    cabinets.map((c) => runCoords(guide.run, c)),
    spec.depthMm,
  )
  const first = start === null ? undefined : guide.layout.slots[start]
  const last = start === null ? undefined : guide.layout.slots[start + needed - 1]
  if (!first || !last) return { error: '기준 벽에 빈 슬롯이 없습니다.' }

  const widthMm = last.right - first.left
  const fullHeight = spec.family === 'tall'
  const sized: CabinetNode = fullHeight
    ? {
        ...spec,
        widthMm,
        heightMm: guide.layout.topMm,
        toeKick: { ...spec.toeKick, enabled: true, heightMm: guide.layout.bottomMm },
      }
    : { ...spec, widthMm }
  const centre = (first.left + last.right) / 2
  const { run } = guide
  const x = run.origin[0] + run.along[0] * centre * MM + run.normal[0] * (sized.depthMm / 2) * MM
  const z = run.origin[1] + run.along[1] * centre * MM + run.normal[1] * (sized.depthMm / 2) * MM
  const node: CabinetNode = {
    ...sized,
    name: preset.label,
    position: [x, preset.elevationMm * MM, z],
    rotation: [0, run.rotationY, 0],
  }

  const mine = footprint(node)
  const [y0, y1] = verticalRange(node)
  const clash = cabinets.some((c) => {
    const [cy0, cy1] = verticalRange(c)
    return cy0 < y1 && y0 < cy1 && overlaps(mine, footprint(c))
  })
  if (clash) return { error: '다른 가구와 겹칩니다.' }

  useScene.getState().createNode(node as unknown as AnyNode, run.levelId as AnyNodeId)
  return { id: node.id }
}
