import {
  type NavGrid,
  type NavPoint,
  navCellAt,
  navCellCenter,
  pointInPolygon,
} from '@pascal-app/core'
import type { RoomFact } from '../types'

/**
 * Which room each walkable cell of a level's nav grid lies in (the smallest
 * room containing its centre), and the spot an NPC heads for to show a room:
 * the walkable cell inside it nearest its centroid. Pure; the same on every
 * client for the same scene.
 */
export type NpcRoomMap = {
  /** Room ids; `cellRoom` holds indices into it. */
  ids: string[]
  /** Room index per grid cell, -1 outside every room or where not walkable. */
  cellRoom: Int32Array
  /** Where an NPC stands to show each room (level-local XZ). */
  spots: Map<string, NavPoint>
}

type Box = { minX: number; minZ: number; maxX: number; maxZ: number }

function boundsOf(polygon: readonly NavPoint[]): Box {
  const box = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity }
  for (const [x, z] of polygon) {
    box.minX = Math.min(box.minX, x)
    box.maxX = Math.max(box.maxX, x)
    box.minZ = Math.min(box.minZ, z)
    box.maxZ = Math.max(box.maxZ, z)
  }
  return box
}

/** The room map of one level, from the scene's rooms on it. */
export function buildRoomMap(grid: NavGrid, rooms: readonly RoomFact[]): NpcRoomMap {
  // Smallest first, so a room inside another (a closet in a bedroom) wins its cells.
  const sorted = rooms
    .filter((room) => room.polygon.length >= 3)
    .sort((a, b) => a.area - b.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const ids = sorted.map((room) => room.id)
  const cellRoom = new Int32Array(grid.cols * grid.rows).fill(-1)
  const spots = new Map<string, NavPoint>()

  sorted.forEach((room, index) => {
    const box = boundsOf(room.polygon)
    const c0 = Math.max(0, Math.floor((box.minX - grid.originX) / grid.cellSize))
    const c1 = Math.min(grid.cols - 1, Math.floor((box.maxX - grid.originX) / grid.cellSize))
    const r0 = Math.max(0, Math.floor((box.minZ - grid.originZ) / grid.cellSize))
    const r1 = Math.min(grid.rows - 1, Math.floor((box.maxZ - grid.originZ) / grid.cellSize))
    let spot = -1
    let spotDistance = Infinity
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = row * grid.cols + col
        if (!grid.walkable[cell] || cellRoom[cell] !== -1) continue
        const [x, z] = navCellCenter(grid, cell)
        if (!pointInPolygon(x, z, room.polygon)) continue
        cellRoom[cell] = index
        const distance = (x - room.centroid[0]) ** 2 + (z - room.centroid[1]) ** 2
        if (distance < spotDistance) {
          spot = cell
          spotDistance = distance
        }
      }
    }
    if (spot >= 0) spots.set(room.id, navCellCenter(grid, spot))
  })
  return { ids, cellRoom, spots }
}

/** The room id of a walkable cell, or null. */
export function roomOfCell(map: NpcRoomMap, cell: number): string | null {
  const index = cell >= 0 ? (map.cellRoom[cell] ?? -1) : -1
  return index >= 0 ? (map.ids[index] ?? null) : null
}

/** The room id under a level-local point, or null. */
export function roomAtPoint(map: NpcRoomMap, grid: NavGrid, p: Readonly<NavPoint>): string | null {
  return roomOfCell(map, navCellAt(grid, p))
}
