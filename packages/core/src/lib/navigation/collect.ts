import { getFloorPlacedFootprints } from '../../hooks/spatial-grid/floor-placed-elevation'
import { nodeRegistry } from '../../registry'
import type {
  AnyNode,
  BuildingNode,
  DoorNode,
  ElevatorNode,
  FenceNode,
  LevelNode,
  StairNode,
  WallNode,
} from '../../schema'
import {
  getElevatorShaftDepth,
  getElevatorShaftWallThickness,
  getElevatorShaftWidth,
} from '../../systems/elevator/elevator-geometry'
import { resolveElevatorServiceLevelIds } from '../../systems/elevator/elevator-service'
import { sampleFenceCenterline } from '../../systems/fence/fence-centerline'
import { isSplineFence } from '../../systems/fence/fence-spline'
import { stairFootprintAABB } from '../../systems/stair/stair-footprint'
import { isCurvedWall, sampleWallCenterline } from '../../systems/wall/wall-curve'
import { getWallThickness } from '../../systems/wall/wall-footprint'
import type { Point2D } from '../../systems/wall/wall-mitering'
import type { NavArea, NavGridInput, NavObstacle, NavPoint, NavWall } from './types'

// Anything lower is stepped over (rugs, mats).
const MIN_OBSTACLE_HEIGHT = 0.25
const CURVE_SEGMENTS = 16
// Mirrors the walkthrough collider's fallback floor for levels without slabs.
const FALLBACK_FLOOR_PADDING = 2
const FALLBACK_FLOOR_MIN_SIZE = 30
const SITE_GROUND_PADDING = 10

type SceneNodes = Readonly<Record<string, AnyNode>>
type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number }

export type CollectNavInputOptions = {
  /** Ground level only: the site outside the slabs is walkable at height 0 (passers-by). */
  includeSiteGround?: boolean
}

/**
 * Plain-data navigation input for one level, in level-local plan coordinates. Children are
 * visited in id order so the input and its hash don't depend on child or insertion order.
 */
export function collectNavInputForLevel(
  nodes: SceneNodes,
  levelId: string,
  options: CollectNavInputOptions = {},
): NavGridInput {
  const input: NavGridInput = { areas: [], walls: [], obstacles: [] }
  const level = nodes[levelId]
  if (level?.type !== 'level') return input

  const children = childrenOf(level.children, nodes)
  for (const child of children) {
    if (child.type === 'slab') {
      if (child.polygon.length >= 3) {
        input.areas.push({ polygon: child.polygon, holes: child.holes, height: child.elevation })
      }
    } else if (child.type === 'wall') {
      input.walls.push(...wallPieces(child, nodes))
    } else if (child.type === 'fence') {
      input.walls.push(...fencePieces(child))
    } else if (child.type === 'stair') {
      const stair = stairObstacle(child, nodes)
      if (stair) input.obstacles.push(stair)
    } else {
      input.obstacles.push(...footprintObstacles(child, nodes))
    }
  }

  if (!children.some((child) => child.type === 'slab')) {
    input.areas.push({
      polygon: rectAround(contentBounds(children), FALLBACK_FLOOR_PADDING, FALLBACK_FLOOR_MIN_SIZE),
      holes: [],
      height: 0,
    })
  }

  const parent = level.parentId ? nodes[level.parentId] : undefined
  const building = parent?.type === 'building' ? parent : null
  if (building) input.obstacles.push(...elevatorObstacles(building, level, nodes))

  if (options.includeSiteGround && level.level === 0) {
    input.areas.push(siteGround(level, building, children, nodes))
  }
  return input
}

function childrenOf(ids: readonly string[], nodes: SceneNodes): AnyNode[] {
  return [...ids]
    .sort()
    .map((id) => nodes[id])
    .filter((node): node is AnyNode => Boolean(node && node.visible !== false))
}

function toNavPoint(point: Point2D): NavPoint {
  return [point.x, point.y]
}

function polylinePieces(points: NavPoint[], halfWidth: number): NavWall[] {
  const pieces: NavWall[] = []
  for (let i = 1; i < points.length; i++) {
    pieces.push({ a: points[i - 1]!, b: points[i]!, halfWidth, openings: [] })
  }
  return pieces
}

function wallPieces(wall: WallNode, nodes: SceneNodes): NavWall[] {
  const halfWidth = getWallThickness(wall) / 2
  // Openings can't be placed on curved walls, so only straight walls carry door spans.
  if (isCurvedWall(wall)) {
    return polylinePieces(sampleWallCenterline(wall, CURVE_SEGMENTS).map(toNavPoint), halfWidth)
  }
  const openings = [...wall.children]
    .sort()
    .map((id) => nodes[id])
    .filter((node): node is DoorNode => node?.type === 'door' && node.width > 0)
    .map((door) => ({ along: door.position[0], halfWidth: door.width / 2 }))
  return [{ a: wall.start, b: wall.end, halfWidth, openings }]
}

function fencePieces(fence: FenceNode): NavWall[] {
  const halfWidth = fence.thickness / 2
  if (!isSplineFence(fence) && !isCurvedWall(fence)) {
    return [{ a: fence.start, b: fence.end, halfWidth, openings: [] }]
  }
  return polylinePieces(sampleFenceCenterline(fence, CURVE_SEGMENTS).map(toNavPoint), halfWidth)
}

function boxFromBounds(bounds: Bounds): NavObstacle {
  return {
    center: [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
    halfExtents: [(bounds.maxX - bounds.minX) / 2, (bounds.maxZ - bounds.minZ) / 2],
    yaw: 0,
  }
}

// NPCs don't climb yet, so a stair is a solid block on the level it starts from.
function stairObstacle(stair: StairNode, nodes: SceneNodes): NavObstacle | null {
  const bounds = stairFootprintAABB(stair, nodes)
  return bounds ? boxFromBounds(bounds) : null
}

/** Kinds that opt into floor collision (items, cabinets, shelves, columns) resting on the level. */
function footprintObstacles(node: AnyNode, nodes: SceneNodes): NavObstacle[] {
  const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
  if (!floorPlaced?.collides) return []
  if (floorPlaced.applies && !floorPlaced.applies(node)) return []
  const position = (node as { position?: [number, number, number] }).position
  const obstacles: NavObstacle[] = []
  for (const footprint of getFloorPlacedFootprints(floorPlaced, node, { nodes })) {
    const [width, height, depth] = footprint.dimensions
    const at = footprint.position ?? position
    if (height < MIN_OBSTACLE_HEIGHT || !at) continue
    obstacles.push({
      center: [at[0], at[2]],
      halfExtents: [width / 2, depth / 2],
      yaw: footprint.rotation[1],
    })
  }
  return obstacles
}

function elevatorObstacles(building: BuildingNode, level: LevelNode, nodes: SceneNodes) {
  const obstacles: NavObstacle[] = []
  for (const node of childrenOf(building.children, nodes)) {
    if (node.type !== 'elevator') continue
    if (!resolveElevatorServiceLevelIds(node, nodes).includes(level.id)) continue
    obstacles.push(elevatorShaft(node))
  }
  return obstacles
}

function elevatorShaft(elevator: ElevatorNode): NavObstacle {
  const wall = getElevatorShaftWallThickness(elevator)
  return {
    center: [elevator.position[0], elevator.position[2]],
    halfExtents: [
      getElevatorShaftWidth(elevator) / 2 + wall,
      getElevatorShaftDepth(elevator) / 2 + wall,
    ],
    yaw: elevator.rotation,
  }
}

function siteGround(
  level: LevelNode,
  building: BuildingNode | null,
  children: AnyNode[],
  nodes: SceneNodes,
): NavArea {
  let node: AnyNode | undefined = building ?? level
  while (node && node.type !== 'site') node = node.parentId ? nodes[node.parentId] : undefined
  const points = node?.type === 'site' ? node.polygon?.points : undefined
  const polygon =
    points && points.length >= 3
      ? points.map((point) => toBuildingLocal(point, building))
      : rectAround(contentBounds(children), SITE_GROUND_PADDING, 0)
  return { polygon, holes: [], height: 0, ground: true }
}

/** Site coordinates → the building's frame, which is the level-local plan frame. */
function toBuildingLocal(point: readonly [number, number], building: BuildingNode | null) {
  if (!building) return [point[0], point[1]] as NavPoint
  const dx = point[0] - building.position[0]
  const dz = point[1] - building.position[2]
  const cos = Math.cos(building.rotation[1])
  const sin = Math.sin(building.rotation[1])
  return [dx * cos - dz * sin, dx * sin + dz * cos] as NavPoint
}

function contentBounds(children: AnyNode[]): Bounds | null {
  const points: NavPoint[] = []
  for (const child of children) {
    if (child.type === 'wall' || child.type === 'fence') {
      points.push(child.start, child.end)
    } else if (child.type === 'slab' || child.type === 'zone') {
      points.push(...child.polygon)
    } else {
      const position = (child as { position?: unknown }).position
      if (Array.isArray(position) && position.length >= 3) points.push([position[0], position[2]])
    }
  }
  if (points.length === 0) return null
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity }
  for (const [x, z] of points) {
    bounds.minX = Math.min(bounds.minX, x)
    bounds.minZ = Math.min(bounds.minZ, z)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.maxZ = Math.max(bounds.maxZ, z)
  }
  return bounds
}

function rectAround(bounds: Bounds | null, padding: number, minSize: number): NavPoint[] {
  const cx = bounds ? (bounds.minX + bounds.maxX) / 2 : 0
  const cz = bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0
  const halfX = Math.max((bounds ? bounds.maxX - bounds.minX : 0) + padding * 2, minSize) / 2
  const halfZ = Math.max((bounds ? bounds.maxZ - bounds.minZ : 0) + padding * 2, minSize) / 2
  return [
    [cx - halfX, cz - halfZ],
    [cx + halfX, cz - halfZ],
    [cx + halfX, cz + halfZ],
    [cx - halfX, cz + halfZ],
  ]
}
