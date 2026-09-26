import { type AnyNode, DEFAULT_WALL_THICKNESS, isCurvedWall, type WallNode } from '@pascal-app/core'

/** How close (m, beyond the cabinet's half depth) the cursor must be to a
 *  wall face for the cabinet to attach to it. */
const WALL_ATTACH_RANGE = 0.45
/** Edge-to-edge snap distance along a wall (m). */
const EDGE_SNAP = 0.12

export type WallAttachment = {
  wallId: string
  /** Level-local plan position of the cabinet centre and its Y rotation. */
  position: [number, number]
  rotationY: number
  /** Unit direction along the wall face (left → right seen from the front). */
  along: [number, number]
  /** Distance of the centre from the wall start, along the wall (m). */
  t: number
}

type Footprint = { widthM: number; depthM: number }

/** Front direction (+Z local) of a node rotated by `ry` about Y, in plan. */
export function frontDirection(ry: number): [number, number] {
  return [Math.sin(ry), Math.cos(ry)]
}

/**
 * Attach a cabinet to the nearest straight wall: back against the wall face
 * on the cursor's side, front facing into the room, then slide along the
 * wall to butt up to neighbouring cabinets or the wall's ends.
 */
export function attachToWall(args: {
  point: [number, number]
  footprint: Footprint
  walls: WallNode[]
  neighbours: { position: [number, number]; rotationY: number; widthM: number; depthM: number }[]
}): WallAttachment | null {
  const { point, footprint, walls } = args
  let best: {
    wall: WallNode
    dist: number
    foot: [number, number]
    n: [number, number]
    u: [number, number]
    s: number
    len: number
    half: number
  } | null = null
  for (const wall of walls) {
    if (isCurvedWall(wall)) continue
    const [sx, sz] = wall.start
    const [ex, ez] = wall.end
    const len = Math.hypot(ex - sx, ez - sz)
    if (len < 1e-6) continue
    const u: [number, number] = [(ex - sx) / len, (ez - sz) / len]
    const rel: [number, number] = [point[0] - sx, point[1] - sz]
    const s = rel[0] * u[0] + rel[1] * u[1]
    if (s < -0.2 || s > len + 0.2) continue
    const side = rel[0] * -u[1] + rel[1] * u[0]
    const n: [number, number] = side >= 0 ? [-u[1], u[0]] : [u[1], -u[0]]
    const half = (wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2
    const dist = Math.abs(side) - half
    if (dist < -0.05 || dist > footprint.depthM + WALL_ATTACH_RANGE) continue
    if (!best || dist < best.dist) {
      best = { wall, dist, foot: [sx + u[0] * s, sz + u[1] * s], n, u, s, len, half }
    }
  }
  if (!best) return null
  const { wall, n, u, len, half } = best
  let t = best.s
  const halfW = footprint.widthM / 2
  // Clamp inside the wall and snap to its ends.
  const tMin = halfW
  const tMax = len - halfW
  const edges: number[] = [tMin, tMax]
  const start = wall.start
  const faceOrigin: [number, number] = [start[0] + n[0] * half, start[1] + n[1] * half]
  const ry = Math.atan2(n[0], n[1])
  for (const other of args.neighbours) {
    const otherFront = frontDirection(other.rotationY)
    if (otherFront[0] * n[0] + otherFront[1] * n[1] < 0.99) continue
    const rel: [number, number] = [
      other.position[0] - faceOrigin[0],
      other.position[1] - faceOrigin[1],
    ]
    const offWall = rel[0] * n[0] + rel[1] * n[1] - other.depthM / 2
    if (Math.abs(offWall) > 0.05) continue
    const ot = rel[0] * u[0] + rel[1] * u[1]
    edges.push(ot - other.widthM / 2 - halfW, ot + other.widthM / 2 + halfW)
  }
  let bestEdge: number | null = null
  for (const edge of edges) {
    if (
      Math.abs(edge - t) < EDGE_SNAP &&
      (bestEdge == null || Math.abs(edge - t) < Math.abs(bestEdge - t))
    ) {
      bestEdge = edge
    }
  }
  if (bestEdge != null) t = bestEdge
  if (tMax >= tMin) t = Math.min(tMax, Math.max(tMin, t))
  const centre: [number, number] = [
    faceOrigin[0] + u[0] * t + n[0] * (footprint.depthM / 2),
    faceOrigin[1] + u[1] * t + n[1] * (footprint.depthM / 2),
  ]
  // Local +X of a node rotated by ry is (cos ry, -sin ry) in plan = (n.z, -n.x).
  return { wallId: wall.id, position: centre, rotationY: ry, along: [n[1], -n[0]], t }
}

/** Walls and cabinets on a level, as plain data for `attachToWall`. */
export function collectPlacementContext(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
  excludeId?: string,
) {
  const walls: WallNode[] = []
  const neighbours: {
    position: [number, number]
    rotationY: number
    widthM: number
    depthM: number
    family: string
  }[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.parentId !== levelId || node.id === excludeId) continue
    if (node.type === 'wall') walls.push(node as WallNode)
    const raw = node as unknown as {
      type: string
      position: [number, number, number]
      rotation: [number, number, number]
      widthMm: number
      depthMm: number
      family: string
    }
    if (raw.type === 'cabinet') {
      neighbours.push({
        position: [raw.position[0], raw.position[2]],
        rotationY: raw.rotation[1] ?? 0,
        widthM: raw.widthMm / 1000,
        depthM: raw.depthMm / 1000,
        family: raw.family,
      })
    }
  }
  return { walls, neighbours }
}

/** Plan position of a point `offsetM` along a wall face run, for laying out
 *  a row of cabinets from a starting cabinet centre. */
export function alongWall(
  origin: [number, number],
  rotationY: number,
  offsetM: number,
): [number, number] {
  // Local +X in plan for a node rotated by ry: (cos ry, -sin ry).
  return [origin[0] + Math.cos(rotationY) * offsetM, origin[1] - Math.sin(rotationY) * offsetM]
}
