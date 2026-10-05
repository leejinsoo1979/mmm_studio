import { pointInPolygon } from '../../hooks/spatial-grid/spatial-grid-manager'
import type { NavArea, NavGrid, NavGridInput, NavObstacle, NavPoint, NavWall } from './types'

export const NAV_CELL_SIZE = 0.2
/** The walkthrough player's capsule radius. */
export const NAV_AGENT_RADIUS = 0.25
const MAX_CELLS = 400
const BOUNDS_MARGIN = 0.5

const FLOOR_SLAB = 1
const FLOOR_GROUND = 2

type Frame = {
  originX: number
  originZ: number
  cols: number
  rows: number
  cellSize: number
}

type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number }

export function buildNavGrid(input: NavGridInput): NavGrid {
  const frame = gridFrame(input.areas)
  const count = frame.cols * frame.rows
  const floor = new Uint8Array(count)
  const height = new Float32Array(count)
  for (const area of input.areas) {
    if (!area.ground) fillArea(frame, area, floor, height)
  }
  for (const area of input.areas) {
    if (area.ground) fillArea(frame, area, floor, height)
  }

  const walkable = erodeFloor(frame, floor)
  for (const wall of input.walls) blockWall(frame, wall, walkable)
  for (const obstacle of input.obstacles) blockBox(frame, obstacle, walkable)

  const { region, regionCount } = labelRegions(frame, walkable)
  return {
    version: hashNavInput(input),
    ...frame,
    walkable,
    height,
    region,
    regionCount,
  }
}

/** FNV-1a over the canonical JSON of the input. Used as the grid `version` and as a cache key. */
export function hashNavInput(input: NavGridInput): string {
  const text = JSON.stringify(input)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Cell index under a plan point, or -1 outside the grid. */
export function navCellAt(grid: NavGrid, p: Readonly<NavPoint>): number {
  const col = Math.floor((p[0] - grid.originX) / grid.cellSize)
  const row = Math.floor((p[1] - grid.originZ) / grid.cellSize)
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return -1
  return row * grid.cols + col
}

export function navCellCenter(grid: NavGrid, cell: number): NavPoint {
  const col = cell % grid.cols
  const row = (cell - col) / grid.cols
  return [grid.originX + (col + 0.5) * grid.cellSize, grid.originZ + (row + 0.5) * grid.cellSize]
}

/** Walkable region under a plan point, or -1. */
export function navRegionAt(grid: NavGrid, p: Readonly<NavPoint>): number {
  const cell = navCellAt(grid, p)
  return cell < 0 ? -1 : grid.region[cell]!
}

function pointsBounds(points: readonly NavPoint[], into: Bounds | null): Bounds | null {
  let bounds = into
  for (const [x, z] of points) {
    if (!bounds) {
      bounds = { minX: x, minZ: z, maxX: x, maxZ: z }
      continue
    }
    if (x < bounds.minX) bounds.minX = x
    if (x > bounds.maxX) bounds.maxX = x
    if (z < bounds.minZ) bounds.minZ = z
    if (z > bounds.maxZ) bounds.maxZ = z
  }
  return bounds
}

function areasBounds(areas: readonly NavArea[]): Bounds | null {
  let bounds: Bounds | null = null
  for (const area of areas) bounds = pointsBounds(area.polygon, bounds)
  return bounds
}

function gridFrame(areas: readonly NavArea[]): Frame {
  const all = areasBounds(areas)
  if (!all) return { originX: 0, originZ: 0, cols: 0, rows: 0, cellSize: NAV_CELL_SIZE }
  const focus = areasBounds(areas.filter((area) => !area.ground)) ?? all
  const minX = all.minX - BOUNDS_MARGIN
  const minZ = all.minZ - BOUNDS_MARGIN
  const maxX = all.maxX + BOUNDS_MARGIN
  const maxZ = all.maxZ + BOUNDS_MARGIN
  const cellSize =
    Math.max(maxX - minX, maxZ - minZ) > MAX_CELLS * NAV_CELL_SIZE
      ? NAV_CELL_SIZE * 2
      : NAV_CELL_SIZE
  const [originX, cols] = frameAxis(minX, maxX, (focus.minX + focus.maxX) / 2, cellSize)
  const [originZ, rows] = frameAxis(minZ, maxZ, (focus.minZ + focus.maxZ) / 2, cellSize)
  return { originX, originZ, cols, rows, cellSize }
}

// Snapped to whole cells so the lattice doesn't shift when the floor grows or shrinks.
function frameAxis(min: number, max: number, focus: number, cellSize: number): [number, number] {
  let start = Math.floor(min / cellSize)
  const end = Math.ceil(max / cellSize)
  if (end - start <= MAX_CELLS) return [start * cellSize, end - start]
  // Too large even for coarse cells: keep the window over the building, not the site's far edges.
  start = Math.min(Math.max(Math.round(focus / cellSize - MAX_CELLS / 2), start), end - MAX_CELLS)
  return [start * cellSize, MAX_CELLS]
}

/** Inclusive cell range whose centres may fall inside `[min, max]` on one axis. */
function cellRange(origin: number, cellSize: number, cells: number, min: number, max: number) {
  const first = Math.max(0, Math.floor((min - origin) / cellSize - 0.5))
  const last = Math.min(cells - 1, Math.ceil((max - origin) / cellSize - 0.5))
  return [first, last] as const
}

function fillArea(frame: Frame, area: NavArea, floor: Uint8Array, height: Float32Array) {
  const bounds = pointsBounds(area.polygon, null)
  if (!bounds || area.polygon.length < 3) return
  const { originX, originZ, cellSize, cols } = frame
  const [c0, c1] = cellRange(originX, cellSize, cols, bounds.minX, bounds.maxX)
  const [r0, r1] = cellRange(originZ, cellSize, frame.rows, bounds.minZ, bounds.maxZ)
  const holes = area.holes.filter((hole) => hole.length >= 3)
  const kind = area.ground ? FLOOR_GROUND : FLOOR_SLAB
  for (let row = r0; row <= r1; row++) {
    const z = originZ + (row + 0.5) * cellSize
    for (let col = c0; col <= c1; col++) {
      const x = originX + (col + 0.5) * cellSize
      if (!pointInPolygon(x, z, area.polygon)) continue
      if (holes.some((hole) => pointInPolygon(x, z, hole))) continue
      const cell = row * cols + col
      const current = floor[cell]!
      if (kind === FLOOR_GROUND && current === FLOOR_SLAB) continue
      height[cell] = current === kind ? Math.max(height[cell]!, area.height) : area.height
      floor[cell] = kind
    }
  }
}

/** Walkable = on the floor with the whole agent disc on the floor too (stair wells, slab edges). */
function erodeFloor(frame: Frame, floor: Uint8Array): Uint8Array {
  const { cols, rows } = frame
  const reach = NAV_AGENT_RADIUS / frame.cellSize
  const span = Math.ceil(reach)
  const offsets: Array<readonly [number, number]> = []
  for (let dr = -span; dr <= span; dr++) {
    for (let dc = -span; dc <= span; dc++) {
      if ((dr !== 0 || dc !== 0) && dr * dr + dc * dc < reach * reach) offsets.push([dc, dr])
    }
  }

  const walkable = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col
      if (!floor[cell]) continue
      walkable[cell] = offsets.every(([dc, dr]) => {
        const c = col + dc
        const r = row + dr
        return c >= 0 && r >= 0 && c < cols && r < rows && floor[r * cols + c] !== 0
      })
        ? 1
        : 0
    }
  }
  return walkable
}

// A blocked band narrower than a cell diagonal could let 8-connected moves slip through a thin
// wall on coarse grids, so the clearance never drops below three quarters of a cell.
function clearanceFor(cellSize: number, halfWidth: number) {
  return Math.max(halfWidth + NAV_AGENT_RADIUS, cellSize * 0.75)
}

function blockWall(frame: Frame, wall: NavWall, walkable: Uint8Array) {
  const { originX, originZ, cellSize, cols } = frame
  const reach = clearanceFor(cellSize, wall.halfWidth)
  const [ax, az] = wall.a
  const [bx, bz] = wall.b
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  const length = Math.sqrt(lengthSq)
  // A doorway keeps the agent radius off each jamb, but never narrows below two cells so the
  // lattice always has a way through.
  const spans = wall.openings.map((opening) => {
    const half = Math.max(
      opening.halfWidth - NAV_AGENT_RADIUS,
      Math.min(opening.halfWidth, cellSize),
    )
    return [opening.along - half, opening.along + half] as const
  })

  const [c0, c1] = cellRange(
    originX,
    cellSize,
    cols,
    Math.min(ax, bx) - reach,
    Math.max(ax, bx) + reach,
  )
  const [r0, r1] = cellRange(
    originZ,
    cellSize,
    frame.rows,
    Math.min(az, bz) - reach,
    Math.max(az, bz) + reach,
  )
  for (let row = r0; row <= r1; row++) {
    const pz = originZ + (row + 0.5) * cellSize - az
    for (let col = c0; col <= c1; col++) {
      const px = originX + (col + 0.5) * cellSize - ax
      const t = lengthSq > 0 ? (px * dx + pz * dz) / lengthSq : 0
      if (t > 0 && t < 1) {
        const along = t * length
        if (spans.some(([from, to]) => along >= from && along <= to)) continue
      }
      const clamped = t < 0 ? 0 : t > 1 ? 1 : t
      const ex = px - clamped * dx
      const ez = pz - clamped * dz
      if (ex * ex + ez * ez < reach * reach) walkable[row * cols + col] = 0
    }
  }
}

function blockBox(frame: Frame, box: NavObstacle, walkable: Uint8Array) {
  const { originX, originZ, cellSize, cols } = frame
  const reach = clearanceFor(cellSize, 0)
  const [cx, cz] = box.center
  const [hx, hz] = box.halfExtents
  const cos = Math.cos(box.yaw)
  const sin = Math.sin(box.yaw)
  const extentX = Math.abs(cos) * hx + Math.abs(sin) * hz + reach
  const extentZ = Math.abs(sin) * hx + Math.abs(cos) * hz + reach

  const [c0, c1] = cellRange(originX, cellSize, cols, cx - extentX, cx + extentX)
  const [r0, r1] = cellRange(originZ, cellSize, frame.rows, cz - extentZ, cz + extentZ)
  for (let row = r0; row <= r1; row++) {
    const dz = originZ + (row + 0.5) * cellSize - cz
    for (let col = c0; col <= c1; col++) {
      const dx = originX + (col + 0.5) * cellSize - cx
      // Inverse of the Y rotation three.js applies to the node.
      const lx = dx * cos - dz * sin
      const lz = dx * sin + dz * cos
      const ox = Math.max(Math.abs(lx) - hx, 0)
      const oz = Math.max(Math.abs(lz) - hz, 0)
      if (ox * ox + oz * oz < reach * reach) walkable[row * cols + col] = 0
    }
  }
}

function labelRegions(frame: Frame, walkable: Uint8Array) {
  const { cols, rows } = frame
  const region = new Int32Array(cols * rows).fill(-1)
  const queue = new Int32Array(cols * rows)
  let regionCount = 0
  let tail = 0
  const visit = (cell: number) => {
    if (!walkable[cell] || region[cell] !== -1) return
    region[cell] = regionCount
    queue[tail++] = cell
  }
  for (let seed = 0; seed < walkable.length; seed++) {
    if (!walkable[seed] || region[seed] !== -1) continue
    let head = 0
    tail = 0
    visit(seed)
    while (head < tail) {
      const cell = queue[head++]!
      const col = cell % cols
      const row = (cell - col) / cols
      if (col > 0) visit(cell - 1)
      if (col < cols - 1) visit(cell + 1)
      if (row > 0) visit(cell - cols)
      if (row < rows - 1) visit(cell + cols)
    }
    regionCount++
  }
  return { region, regionCount }
}
