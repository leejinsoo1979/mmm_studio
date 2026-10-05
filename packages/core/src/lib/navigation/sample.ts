import { navCellCenter } from './grid'
import type { NavGrid, NavPoint } from './types'

/** Walkable cells whose centre is within `radius` of `center`, in ascending cell order. */
function walkableCellsInRadius(
  grid: NavGrid,
  center: Readonly<NavPoint>,
  radius: number,
  region: number | null,
): number[] {
  const { cols, rows, cellSize, originX, originZ } = grid
  const c0 = Math.max(0, Math.floor((center[0] - radius - originX) / cellSize))
  const c1 = Math.min(cols - 1, Math.floor((center[0] + radius - originX) / cellSize))
  const r0 = Math.max(0, Math.floor((center[1] - radius - originZ) / cellSize))
  const r1 = Math.min(rows - 1, Math.floor((center[1] + radius - originZ) / cellSize))
  const cells: number[] = []
  for (let row = r0; row <= r1; row++) {
    const dz = originZ + (row + 0.5) * cellSize - center[1]
    for (let col = c0; col <= c1; col++) {
      const cell = row * cols + col
      if (!grid.walkable[cell]) continue
      if (region !== null && grid.region[cell] !== region) continue
      const dx = originX + (col + 0.5) * cellSize - center[0]
      if (dx * dx + dz * dz <= radius * radius) cells.push(cell)
    }
  }
  return cells
}

/**
 * A uniformly drawn walkable cell centre within `radius` of `center`, using one draw of `rand`
 * (`[0, 1)`, seeded by the caller) over the cells `accept` allows. Null when none qualify.
 */
export function randomWalkableInRadius(
  grid: NavGrid,
  center: Readonly<NavPoint>,
  radius: number,
  rand: () => number,
  region: number | null,
  accept?: (cell: number) => boolean,
): NavPoint | null {
  const cells = walkableCellsInRadius(grid, center, radius, region)
  const candidates = accept ? cells.filter(accept) : cells
  if (candidates.length === 0) return null
  const pick = Math.min(candidates.length - 1, Math.floor(rand() * candidates.length))
  return navCellCenter(grid, candidates[pick]!)
}

/**
 * The walkable cell centre within `radius` of `center` that lies farthest from `away` (a flee
 * target), ties to the lower cell index. Null when no cell qualifies.
 */
export function farthestWalkableInRadius(
  grid: NavGrid,
  center: Readonly<NavPoint>,
  radius: number,
  away: Readonly<NavPoint>,
  region: number | null,
): NavPoint | null {
  let best = -1
  let bestDistance = -1
  for (const cell of walkableCellsInRadius(grid, center, radius, region)) {
    const [x, z] = navCellCenter(grid, cell)
    const distance = (x - away[0]) ** 2 + (z - away[1]) ** 2
    if (distance > bestDistance) {
      best = cell
      bestDistance = distance
    }
  }
  return best < 0 ? null : navCellCenter(grid, best)
}
