import { navCellAt, navCellCenter } from './grid'
import type { NavGrid, NavPoint } from './types'

const DEFAULT_MAX_EXPANDED = 40_000
// Fixed order so ties expand identically on every client.
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

export type FindPathOptions = { maxExpanded?: number }

/**
 * Nearest walkable cell to `p` (by centre distance, ties to the lower index), optionally limited
 * to one region; -1 when there is none.
 */
export function nearestWalkableCell(
  grid: NavGrid,
  p: Readonly<NavPoint>,
  region: number | null = null,
): number {
  const { cols, rows, cellSize, originX, originZ } = grid
  if (cols === 0 || rows === 0) return -1
  const col0 = Math.min(cols - 1, Math.max(0, Math.floor((p[0] - originX) / cellSize)))
  const row0 = Math.min(rows - 1, Math.max(0, Math.floor((p[1] - originZ) / cellSize)))

  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  const consider = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= cols || row >= rows) return
    const cell = row * cols + col
    if (!grid.walkable[cell]) return
    if (region !== null && grid.region[cell] !== region) return
    const dx = originX + (col + 0.5) * cellSize - p[0]
    const dz = originZ + (row + 0.5) * cellSize - p[1]
    const distance = dx * dx + dz * dz
    if (distance < bestDistance || (distance === bestDistance && cell < best)) {
      best = cell
      bestDistance = distance
    }
  }

  const maxRing = Math.max(cols, rows)
  for (let ring = 0; ring <= maxRing; ring++) {
    // Every centre on this ring is at least (ring - 0.5) cells from `p`.
    const nearest = Math.max(0, ring - 0.5) * cellSize
    if (best >= 0 && nearest * nearest > bestDistance) break
    if (ring === 0) {
      consider(col0, row0)
      continue
    }
    for (let col = col0 - ring; col <= col0 + ring; col++) {
      consider(col, row0 - ring)
      consider(col, row0 + ring)
    }
    for (let row = row0 - ring + 1; row <= row0 + ring - 1; row++) {
      consider(col0 - ring, row)
      consider(col0 + ring, row)
    }
  }
  return best
}

export function nearestWalkable(
  grid: NavGrid,
  p: Readonly<NavPoint>,
  region: number | null = null,
): NavPoint | null {
  const cell = nearestWalkableCell(grid, p, region)
  return cell < 0 ? null : navCellCenter(grid, cell)
}

/**
 * A* over the grid (8-connected, no corner cutting). An off-grid or blocked start snaps to the
 * nearest walkable cell; a blocked goal snaps to the nearest walkable cell in the start's
 * region. A walkable goal in another region, or a search over `maxExpanded`, returns null.
 * The result runs from the start point through cell centres to the goal point.
 */
export function findPath(
  grid: NavGrid,
  from: Readonly<NavPoint>,
  to: Readonly<NavPoint>,
  options: FindPathOptions = {},
): NavPoint[] | null {
  const fromCell = navCellAt(grid, from)
  const fromWalkable = fromCell >= 0 && grid.walkable[fromCell] === 1
  const start = fromWalkable ? fromCell : nearestWalkableCell(grid, from)
  if (start < 0) return null
  const region = grid.region[start]!

  const toCell = navCellAt(grid, to)
  let goal: number
  let goalPoint: NavPoint
  if (toCell >= 0 && grid.walkable[toCell] === 1) {
    if (grid.region[toCell] !== region) return null
    goal = toCell
    goalPoint = [to[0], to[1]]
  } else {
    goal = nearestWalkableCell(grid, to, region)
    if (goal < 0) return null
    goalPoint = navCellCenter(grid, goal)
  }

  const startPoint: NavPoint = fromWalkable ? [from[0], from[1]] : navCellCenter(grid, start)
  if (start === goal) return [startPoint, goalPoint]
  const cells = search(grid, start, goal, options.maxExpanded ?? DEFAULT_MAX_EXPANDED)
  if (!cells) return null
  return [startPoint, ...cells.slice(1, -1).map((cell) => navCellCenter(grid, cell)), goalPoint]
}

function search(grid: NavGrid, start: number, goal: number, maxExpanded: number) {
  const { cols, rows, walkable } = grid
  const count = cols * rows
  const cost = new Float64Array(count).fill(Number.POSITIVE_INFINITY)
  const parent = new Int32Array(count).fill(-1)
  const closed = new Uint8Array(count)
  const open = new OpenSet()
  const goalCol = goal % cols
  const goalRow = (goal - goalCol) / cols
  const heuristic = (col: number, row: number) => {
    const dx = Math.abs(col - goalCol)
    const dz = Math.abs(row - goalRow)
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)
  }

  const startCol = start % cols
  const startH = heuristic(startCol, (start - startCol) / cols)
  cost[start] = 0
  open.push(startH, startH, start)
  let expanded = 0
  while (open.size > 0) {
    const cell = open.pop()
    if (closed[cell]) continue
    if (cell === goal) return reconstruct(parent, goal)
    closed[cell] = 1
    if (++expanded > maxExpanded) return null

    const col = cell % cols
    const row = (cell - col) / cols
    for (const [dc, dr] of DIRECTIONS) {
      const nextCol = col + dc
      const nextRow = row + dr
      if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) continue
      const next = nextRow * cols + nextCol
      if (!walkable[next] || closed[next]) continue
      const diagonal = dc !== 0 && dr !== 0
      if (diagonal && (!walkable[row * cols + nextCol] || !walkable[nextRow * cols + col])) continue
      const nextCost = cost[cell]! + (diagonal ? Math.SQRT2 : 1)
      if (nextCost >= cost[next]!) continue
      cost[next] = nextCost
      parent[next] = cell
      const h = heuristic(nextCol, nextRow)
      open.push(nextCost + h, h, next)
    }
  }
  return null
}

function reconstruct(parent: Int32Array, goal: number): number[] {
  const cells = [goal]
  for (let cell = parent[goal]!; cell >= 0; cell = parent[cell]!) cells.push(cell)
  return cells.reverse()
}

/** Binary min-heap ordered by (f, h, cell) so equal-cost ties break the same way everywhere. */
class OpenSet {
  private readonly f: number[] = []
  private readonly h: number[] = []
  private readonly cell: number[] = []

  get size() {
    return this.cell.length
  }

  push(f: number, h: number, cell: number) {
    this.f.push(f)
    this.h.push(h)
    this.cell.push(cell)
    let i = this.cell.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (!this.less(i, up)) break
      this.swap(i, up)
      i = up
    }
  }

  pop(): number {
    const top = this.cell[0]!
    const last = this.cell.length - 1
    this.swap(0, last)
    this.f.pop()
    this.h.pop()
    this.cell.pop()
    let i = 0
    for (;;) {
      const left = i * 2 + 1
      const right = left + 1
      let smallest = i
      if (left < last && this.less(left, smallest)) smallest = left
      if (right < last && this.less(right, smallest)) smallest = right
      if (smallest === i) return top
      this.swap(i, smallest)
      i = smallest
    }
  }

  private less(a: number, b: number) {
    const fa = this.f[a]!
    const fb = this.f[b]!
    if (fa !== fb) return fa < fb
    const ha = this.h[a]!
    const hb = this.h[b]!
    if (ha !== hb) return ha < hb
    return this.cell[a]! < this.cell[b]!
  }

  private swap(a: number, b: number) {
    const { f, h, cell } = this
    ;[f[a], f[b]] = [f[b]!, f[a]!]
    ;[h[a], h[b]] = [h[b]!, h[a]!]
    ;[cell[a], cell[b]] = [cell[b]!, cell[a]!]
  }
}
