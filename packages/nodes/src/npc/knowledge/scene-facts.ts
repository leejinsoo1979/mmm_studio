import type {
  AnyNode,
  CeilingNode,
  DoorNode,
  ItemNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { type CabinetNode, resolveCabinetNode } from '../../cabinet/schema'
import { roomDisplayName } from '../../slab/room-name'
import type { LevelFact, NpcNameResolvers, RoomFact, SceneFacts } from '../types'

type Point = [number, number]
type SceneNode = AnyNode | CabinetNode
type WallSlot = 'interior' | 'exterior'

/** A room while facts are gathered: `holes` for hit tests, `slab` when the room is one. */
type Room = { fact: RoomFact; holes: Point[][]; slab?: SlabNode }

/** How far past a wall face a probe lands, so it falls inside the room on that side. */
const PROBE = 0.2
const MIN_ROOM_AREA = 0.5
const MAX_FURNITURE = 20
const ZONE_DEFAULT_NAME = /^Zone\s+(\d+)$/i

/** Nearest named colour for a cabinet front (`#rrggbb`). */
const FINISH_COLOURS: [string, number, number, number][] = [
  ['화이트', 246, 246, 243],
  ['아이보리', 236, 228, 210],
  ['베이지', 214, 196, 164],
  ['그레이', 150, 150, 150],
  ['차콜', 70, 70, 72],
  ['블랙', 24, 24, 24],
  ['우드', 150, 105, 65],
  ['네이비', 35, 45, 80],
  ['그린', 90, 120, 90],
]

/**
 * Rooms, areas, materials and furniture of a scene as plain data: what an NPC
 * may say about the house. Rooms come from zones where there are any; else
 * from slabs detected from wall loops (not under a zone); else from any slab.
 * Pure, so the AI route computes it from the stored graph and the client from
 * the live scene, with the same result.
 */
export function collectSceneFacts(
  nodes: Record<string, AnyNode>,
  names: NpcNameResolvers,
): SceneFacts {
  const all = (Object.values(nodes) as SceneNode[]).sort((a, b) => (a.id < b.id ? -1 : 1))
  const levelIds = new Map<string, string | null>()
  const levelOf = (node: SceneNode): string | null => {
    const known = levelIds.get(node.id)
    if (known !== undefined) return known
    let level: string | null = null
    let current: SceneNode | undefined = node
    for (let depth = 0; current && depth < 8; depth++) {
      if (current.type === 'level') {
        level = current.id
        break
      }
      current = current.parentId ? (nodes[current.parentId] as SceneNode | undefined) : undefined
    }
    levelIds.set(node.id, level)
    return level
  }

  const byLevel = new Map<string, SceneNode[]>()
  for (const node of all) {
    const level = node.type === 'level' ? null : levelOf(node)
    if (!level) continue
    const list = byLevel.get(level)
    if (list) list.push(node)
    else byLevel.set(level, [node])
  }

  const levelNodes = all
    .filter((node) => node.type === 'level')
    .sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : 1))

  const levels: LevelFact[] = []
  for (const level of levelNodes) {
    const children = byLevel.get(level.id) ?? []
    const rooms = collectRooms(level.id, children)
    const roomAt = (point: Point) => smallestRoomAt(rooms, point)
    const slabs = children.filter((node): node is SlabNode => node.type === 'slab')
    const ceilings = children.filter((node): node is CeilingNode => node.type === 'ceiling')

    for (const room of rooms) {
      const inside = interiorPoint(room.fact.polygon)
      const floor = room.slab ?? smallestAt(slabs, inside)
      const floorRef = floor?.slots?.surface ?? floor?.materialPreset
      const floorName = floorRef ? names.material(floorRef) : ''
      if (floorName) room.fact.floorMaterial = floorName
      const ceiling = smallestAt(ceilings, inside)
      if (ceiling) room.fact.ceilingHeight = ceiling.height
    }

    const wallMaterials = new Map<Room, Map<string, number>>()
    const furniture = new Map<Room, Map<string, number>>()
    for (const node of children) {
      if (node.type === 'wall') {
        for (const t of [0.25, 0.5, 0.75]) {
          for (const side of [1, -1]) {
            const room = roomAt(wallProbe(node, wallLength(node) * t, side))
            const ref = room && node.slots?.[wallSlot(node, side)]
            const name = ref ? names.material(ref) : ''
            if (room && name) count(wallMaterials, room, name)
          }
        }
        continue
      }
      if (node.type === 'door' || node.type === 'window') {
        const wall = hostWall(node, nodes)
        if (!wall) continue
        const sides = [1, -1].map((side) => roomAt(wallProbe(wall, node.position[0], side)))
        const [front, back] = sides
        if (node.type === 'window') {
          for (const room of new Set(sides)) if (room) room.fact.windows++
        } else if (front && back && front !== back) {
          link(front, back)
          link(back, front)
        }
        continue
      }
      if (node.visible === false) continue
      if (node.type === 'item') {
        const point = itemPlanPoint(node, nodes)
        const room = point && roomAt(point)
        if (!room) continue
        const own = node.name?.trim()
        count(furniture, room, own && own !== node.asset.name ? own : names.item(node.asset))
        if (node.asset.interactive?.effects.some((effect) => effect.kind === 'light')) {
          room.fact.lights++
        }
      } else if (node.type === 'light') {
        const room = roomAt([node.position[0], node.position[2]])
        if (room) room.fact.lights++
      } else if (node.type === 'cabinet') {
        const cabinet = resolveCabinetNode(node)
        const room = roomAt([cabinet.position[0], cabinet.position[2]])
        room?.fact.cabinets.push({
          family: cabinet.family,
          variant: cabinet.variant,
          widthMm: cabinet.widthMm,
          finish: finishName(cabinet.frontColor),
        })
      }
    }

    for (const [room, tally] of wallMaterials) {
      room.fact.wallMaterial = [...tally].sort(
        (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
      )[0]?.[0]
    }
    for (const [room, tally] of furniture) {
      room.fact.furniture = [...tally]
        .map(([name, n]) => ({ name, count: n }))
        .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
        .slice(0, MAX_FURNITURE)
    }

    levels.push({
      id: level.id,
      name: level.name?.trim() || defaultLevelName(level.level),
      index: level.level,
      rooms: rooms.map((room) => room.fact),
    })
  }

  const rooms = levels.flatMap((level) => level.rooms)
  return {
    buildings: all.filter((node) => node.type === 'building').length,
    levels,
    rooms,
    totalArea: round2(rooms.reduce((sum, room) => sum + room.area, 0)),
  }
}

function collectRooms(levelId: string, children: SceneNode[]): Room[] {
  const zones = children.filter(
    (node): node is ZoneNode => node.type === 'zone' && node.polygon.length >= 3,
  )
  const slabs = children.filter(
    (node): node is SlabNode => node.type === 'slab' && node.polygon.length >= 3,
  )
  let unnamed = 0
  const nameOr = (name: string | undefined) => name || `공간 ${++unnamed}`

  const rooms: Room[] = zones.map((zone) =>
    room(zone.id, nameOr(zoneName(zone.name)), levelId, zone.polygon),
  )
  const zoneRooms = [...rooms]
  const slabRoom = (slab: SlabNode) => ({
    ...room(slab.id, nameOr(roomDisplayName(slab)), levelId, slab.polygon, slab.holes),
    slab,
  })
  for (const slab of slabs) {
    if (!slab.autoFromWalls) continue
    if (smallestRoomAt(zoneRooms, interiorPoint(slab.polygon))) continue
    rooms.push(slabRoom(slab))
  }
  if (rooms.length === 0) rooms.push(...slabs.map(slabRoom))
  return rooms
    .filter((candidate) => candidate.fact.area >= MIN_ROOM_AREA)
    .sort((a, b) => b.fact.area - a.fact.area || (a.fact.id < b.fact.id ? -1 : 1))
}

/** `holes` defaults because a stored slab may predate the field. */
function room(
  id: string,
  name: string,
  levelId: string,
  polygon: Point[],
  holes: Point[][] = [],
): Room {
  const holeArea = holes.reduce((sum, hole) => sum + polygonArea(hole), 0)
  const fact: RoomFact = {
    id,
    name,
    levelId,
    area: round2(Math.max(0, polygonArea(polygon) - holeArea)),
    centroid: centroid(polygon),
    polygon,
    windows: 0,
    doorsTo: [],
    furniture: [],
    cabinets: [],
    lights: 0,
  }
  return { fact, holes }
}

/** The editor names new zones "Zone N"; say "구역 N" instead. */
function zoneName(name: string): string {
  const trimmed = name.trim()
  const auto = ZONE_DEFAULT_NAME.exec(trimmed)
  return auto ? `구역 ${auto[1]}` : trimmed
}

/** Core's `getDefaultLevelName`, which only its root entry (not server-safe) exports. */
function defaultLevelName(level: number): string {
  return level >= 0 ? `${level + 1}층` : `지하 ${-level}층`
}

function link(from: Room, to: Room) {
  if (!from.fact.doorsTo.includes(to.fact.id)) from.fact.doorsTo.push(to.fact.id)
}

function count(tallies: Map<Room, Map<string, number>>, room: Room, name: string) {
  let tally = tallies.get(room)
  if (!tally) {
    tally = new Map()
    tallies.set(room, tally)
  }
  tally.set(name, (tally.get(name) ?? 0) + 1)
}

function finishName(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  let best = FINISH_COLOURS[0]![0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const [name, cr, cg, cb] of FINISH_COLOURS) {
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
    if (distance < bestDistance) {
      best = name
      bestDistance = distance
    }
  }
  return best
}

// ─── Walls and what they host ────────────────────────────────────────

function hostWall(node: DoorNode | WindowNode, nodes: Record<string, AnyNode>): WallNode | null {
  const host = nodes[node.wallId ?? node.parentId ?? '']
  return host?.type === 'wall' ? host : null
}

function wallLength(wall: WallNode): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

/**
 * A point `along` metres from the wall's start, just past its face on `side`:
 * +1 is the front face (left of start → end), -1 the back.
 */
function wallProbe(wall: WallNode, along: number, side: number): Point {
  const length = wallLength(wall) || 1
  const dx = (wall.end[0] - wall.start[0]) / length
  const dz = (wall.end[1] - wall.start[1]) / length
  const offset = side * ((wall.thickness ?? 0.1) / 2 + PROBE)
  return [wall.start[0] + dx * along - dz * offset, wall.start[1] + dz * along + dx * offset]
}

/** The material slot painted on a wall face, as the wall renderer assigns it. */
function wallSlot(wall: WallNode, side: number): WallSlot {
  const semantic = side > 0 ? wall.frontSide : wall.backSide
  if (semantic === 'interior' || semantic === 'exterior') return semantic
  return side > 0 ? 'interior' : 'exterior'
}

type PlanPose = { x: number; z: number; yaw: number }

/**
 * Where an item stands on the level plan: items on walls, shelves and other
 * items are placed in their host's frame (the floor plan's convention).
 */
function itemPlanPoint(item: ItemNode, nodes: Record<string, AnyNode>): Point | null {
  const pose = itemPlanPose(item, nodes, 0)
  return pose ? [pose.x, pose.z] : null
}

function itemPlanPose(
  item: ItemNode,
  nodes: Record<string, AnyNode>,
  depth: number,
): PlanPose | null {
  if (depth > 8) return null
  const parent = item.parentId ? nodes[item.parentId] : undefined
  const [x, , z] = item.position
  const yaw = item.rotation[1]
  if (parent?.type === 'wall') {
    // `x` runs along the wall; the item hangs on the face its side (or local z) points to.
    const face = item.asset.attachTo === 'wall-side' ? (item.side === 'front' ? 1 : -1) : z
    const [px, pz] = wallProbe(parent, x, face < 0 ? -1 : 1)
    const wallYaw = -Math.atan2(parent.end[1] - parent.start[1], parent.end[0] - parent.start[0])
    return { x: px, z: pz, yaw: wallYaw + yaw }
  }
  if (parent?.type === 'item' || parent?.type === 'shelf') {
    const host =
      parent.type === 'shelf'
        ? { x: parent.position[0], z: parent.position[2], yaw: parent.rotation[1] }
        : itemPlanPose(parent, nodes, depth + 1)
    if (!host) return null
    const [ox, oz] = rotatePlan(x, z, host.yaw)
    return { x: host.x + ox, z: host.z + oz, yaw: host.yaw + yaw }
  }
  if (parent?.type === 'roof-segment') return null
  return { x, z, yaw }
}

/** The floor plan's clockwise rotation (item/floorplan.ts `rotateVec`). */
function rotatePlan(x: number, z: number, angle: number): Point {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [x * c + z * s, -x * s + z * c]
}

// ─── Polygons ────────────────────────────────────────────────────────

function smallestRoomAt(rooms: Room[], point: Point): Room | null {
  let best: Room | null = null
  for (const candidate of rooms) {
    if (!inPolygon(point, candidate.fact.polygon)) continue
    if (candidate.holes.some((hole) => inPolygon(point, hole))) continue
    if (!best || candidate.fact.area < best.fact.area) best = candidate
  }
  return best
}

function smallestAt<T extends { polygon: Point[]; holes?: Point[][] }>(
  surfaces: T[],
  point: Point,
): T | undefined {
  let best: T | undefined
  let bestArea = Number.POSITIVE_INFINITY
  for (const surface of surfaces) {
    if (!inPolygon(point, surface.polygon)) continue
    if ((surface.holes ?? []).some((hole) => inPolygon(point, hole))) continue
    const area = polygonArea(surface.polygon)
    if (area < bestArea) {
      best = surface
      bestArea = area
    }
  }
  return best
}

function polygonArea(polygon: Point[]): number {
  let twice = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i]!
    const [x2, z2] = polygon[(i + 1) % polygon.length]!
    twice += x1 * z2 - x2 * z1
  }
  return Math.abs(twice) / 2
}

function centroid(polygon: Point[]): Point {
  let twice = 0
  let cx = 0
  let cz = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i]!
    const [x2, z2] = polygon[(i + 1) % polygon.length]!
    const cross = x1 * z2 - x2 * z1
    twice += cross
    cx += (x1 + x2) * cross
    cz += (z1 + z2) * cross
  }
  if (Math.abs(twice) < 1e-9) {
    const n = polygon.length || 1
    return [
      round2(polygon.reduce((sum, p) => sum + p[0], 0) / n),
      round2(polygon.reduce((sum, p) => sum + p[1], 0) / n),
    ]
  }
  return [round2(cx / (3 * twice)), round2(cz / (3 * twice))]
}

function inPolygon([px, pz]: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/**
 * A point inside the polygon: the centroid when it is (convex rooms), else
 * the middle of the widest span of the horizontal line through it (an L-shape).
 */
function interiorPoint(polygon: Point[]): Point {
  const center = centroid(polygon)
  if (inPolygon(center, polygon)) return center
  const z = center[1]
  const crossings: number[] = []
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (zi > z !== zj > z) crossings.push(((xj - xi) * (z - zi)) / (zj - zi) + xi)
  }
  crossings.sort((a, b) => a - b)
  let best = center
  let widest = 0
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const width = crossings[i + 1]! - crossings[i]!
    if (width > widest) {
      widest = width
      best = [(crossings[i]! + crossings[i + 1]!) / 2, z]
    }
  }
  return best
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
