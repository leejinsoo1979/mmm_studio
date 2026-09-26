import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_WALL_THICKNESS,
  isCurvedWall,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { getCabinetPreset, instantiateSpec } from './engine/presets'
import { COUNTERTOP_DEPTH_MM } from './engine/rules'
import { equalSlotWidths, planKitchenRun } from './engine/run'
import { CabinetNode, CountertopNode } from './schema'

const MM = 0.001
const ENDPOINT_EPS = 1e-3

export type WallRun = {
  levelId: string
  /** Left end of the usable wall face (seen from the room), plan metres. */
  origin: [number, number]
  /** Unit direction along the face, left → right seen from the room. */
  along: [number, number]
  /** Unit normal pointing into the room. */
  normal: [number, number]
  rotationY: number
  lengthMm: number
}

/**
 * The room-side face of a straight wall, trimmed by half the thickness of
 * any wall joined at either end (the inside corner). The room side is the
 * one facing the centroid of the level's walls.
 */
export function wallRun(wall: WallNode, nodes: Readonly<Record<string, AnyNode>>): WallRun | null {
  if (isCurvedWall(wall) || !wall.parentId) return null
  const [sx, sz] = wall.start
  const [ex, ez] = wall.end
  const len = Math.hypot(ex - sx, ez - sz)
  if (len < 0.3) return null
  const u: [number, number] = [(ex - sx) / len, (ez - sz) / len]
  const siblings = Object.values(nodes).filter(
    (n): n is WallNode => n?.type === 'wall' && n.parentId === wall.parentId,
  )
  let cx = 0
  let cz = 0
  for (const w of siblings) {
    cx += (w.start[0] + w.end[0]) / 2
    cz += (w.start[1] + w.end[1]) / 2
  }
  cx /= Math.max(1, siblings.length)
  cz /= Math.max(1, siblings.length)
  const left: [number, number] = [-u[1], u[0]]
  const toCentre = (cx - (sx + ex) / 2) * left[0] + (cz - (sz + ez) / 2) * left[1]
  const normal: [number, number] = toCentre >= 0 ? left : [u[1], -u[0]]
  const half = (wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2

  const joinedHalf = (point: readonly [number, number]) => {
    let trim = 0
    for (const w of siblings) {
      if (w.id === wall.id) continue
      const touches =
        Math.hypot(w.start[0] - point[0], w.start[1] - point[1]) < ENDPOINT_EPS ||
        Math.hypot(w.end[0] - point[0], w.end[1] - point[1]) < ENDPOINT_EPS
      if (touches) trim = Math.max(trim, (w.thickness ?? DEFAULT_WALL_THICKNESS) / 2)
    }
    return trim
  }
  const trimStart = joinedHalf(wall.start)
  const trimEnd = joinedHalf(wall.end)
  const faceStart: [number, number] = [
    sx + normal[0] * half + u[0] * trimStart,
    sz + normal[1] * half + u[1] * trimStart,
  ]
  const faceEnd: [number, number] = [
    ex + normal[0] * half - u[0] * trimEnd,
    ez + normal[1] * half - u[1] * trimEnd,
  ]
  // Local +X of a cabinet facing `normal` is (normal.z, -normal.x).
  const along: [number, number] = [normal[1], -normal[0]]
  const startsLeft =
    (faceEnd[0] - faceStart[0]) * along[0] + (faceEnd[1] - faceStart[1]) * along[1] > 0
  return {
    levelId: wall.parentId,
    origin: startsLeft ? faceStart : faceEnd,
    along,
    normal,
    rotationY: Math.atan2(normal[0], normal[1]),
    lengthMm: Math.round((len - trimStart - trimEnd) * 1000),
  }
}

function placeOnRun(
  run: WallRun,
  offsetMm: number,
  widthMm: number,
  depthMm: number,
): [number, number] {
  const t = (offsetMm + widthMm / 2) * MM
  const d = (depthMm / 2) * MM
  return [
    run.origin[0] + run.along[0] * t + run.normal[0] * d,
    run.origin[1] + run.along[1] * t + run.normal[1] * d,
  ]
}

function cabinetOnRun(
  run: WallRun,
  presetId: string,
  widthMm: number,
  offsetMm: number,
): CabinetNode {
  const preset = getCabinetPreset(presetId)
  if (!preset) throw new Error(`unknown cabinet preset ${presetId}`)
  const spec = instantiateSpec(preset.spec())
  const node = CabinetNode.parse({ ...spec, name: preset.label, widthMm })
  const [x, z] = placeOnRun(run, offsetMm, widthMm, node.depthMm)
  return { ...node, position: [x, preset.elevationMm * MM, z], rotation: [0, run.rotationY, 0] }
}

/**
 * Lay a straight kitchen along a wall in one undo step: base run (sink,
 * optional dishwasher, fillers, cooktop), a countertop with sink / cooktop
 * cutouts over it, and upper cabinets that leave the hood space free.
 */
export function createKitchenOnWall(
  wall: WallNode,
  options: { dishwasher?: boolean } = {},
): { created: number; leftoverMm: number } | null {
  const nodes = useScene.getState().nodes
  const run = wallRun(wall, nodes)
  if (!run) return null
  const plan = planKitchenRun({ lengthMm: run.lengthMm, dishwasher: options.dishwasher })
  if (plan.base.length === 0) return null
  const ops: { node: AnyNode; parentId: AnyNodeId }[] = []
  for (const m of [...plan.base, ...plan.upper]) {
    ops.push({
      node: cabinetOnRun(run, m.presetId, m.widthMm, m.offsetMm) as unknown as AnyNode,
      parentId: run.levelId as AnyNodeId,
    })
  }
  const baseLength = plan.base.reduce((sum, m) => sum + m.widthMm, 0)
  const top = CountertopNode.parse({
    name: '상판',
    lengthMm: baseLength,
    depthMm: COUNTERTOP_DEPTH_MM,
    cutouts: [
      ...(plan.countertop.sink
        ? [{ id: 'sink', kind: 'sink' as const, ...plan.countertop.sink }]
        : []),
      ...(plan.countertop.cooktop
        ? [{ id: 'cooktop', kind: 'cooktop' as const, ...plan.countertop.cooktop }]
        : []),
    ],
  })
  const [tx, tz] = placeOnRun(run, 0, baseLength, top.depthMm)
  const baseHeightMm = getCabinetPreset('lower-half-cabinet')?.spec().heightMm ?? 850
  ops.push({
    node: {
      ...top,
      position: [tx, baseHeightMm * MM, tz],
      rotation: [0, run.rotationY, 0],
    } as unknown as AnyNode,
    parentId: run.levelId as AnyNodeId,
  })
  useScene.getState().createNodes(ops)
  return { created: ops.length, leftoverMm: plan.leftoverMm }
}

/** Fill a wall with one wardrobe preset in Configurator-style equal slots. */
export function createWardrobesOnWall(
  wall: WallNode,
  presetId: string,
): { created: number } | null {
  const nodes = useScene.getState().nodes
  const run = wallRun(wall, nodes)
  if (!run) return null
  const widths = equalSlotWidths(run.lengthMm, 400, 1200)
  if (widths.length === 0) return null
  let offset = 0
  const ops = widths.map((w) => {
    const node = cabinetOnRun(run, presetId, w, offset)
    offset += w
    return { node: node as unknown as AnyNode, parentId: run.levelId as AnyNodeId }
  })
  useScene.getState().createNodes(ops)
  return { created: ops.length }
}
