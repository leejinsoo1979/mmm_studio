import type { NavGrid, NavPoint } from './types'

// Parametric slack for treating a crossing as passing exactly through a cell corner.
const CORNER_EPSILON = 1e-9

/** A polyline with the arc length at each point, for O(log n) sampling. */
export type NavPath = {
  points: NavPoint[]
  /** Arc length from the start at each point. */
  distances: number[]
  length: number
}

/**
 * Whether every cell the segment `a → b` touches (supercover) is walkable. Passing exactly
 * through a corner needs both side cells open, matching A*'s no-corner-cutting rule.
 */
export function hasLineOfSight(
  grid: NavGrid,
  a: Readonly<NavPoint>,
  b: Readonly<NavPoint>,
): boolean {
  const { cols, rows, cellSize, originX, originZ, walkable } = grid
  const open = (col: number, row: number) =>
    col >= 0 && row >= 0 && col < cols && row < rows && walkable[row * cols + col] === 1

  const x0 = (a[0] - originX) / cellSize
  const z0 = (a[1] - originZ) / cellSize
  const x1 = (b[0] - originX) / cellSize
  const z1 = (b[1] - originZ) / cellSize
  let col = Math.floor(x0)
  let row = Math.floor(z0)
  const endCol = Math.floor(x1)
  const endRow = Math.floor(z1)
  if (!open(col, row)) return false

  const dx = x1 - x0
  const dz = z1 - z0
  const stepCol = Math.sign(dx)
  const stepRow = Math.sign(dz)
  const deltaCol = stepCol !== 0 ? Math.abs(1 / dx) : Number.POSITIVE_INFINITY
  const deltaRow = stepRow !== 0 ? Math.abs(1 / dz) : Number.POSITIVE_INFINITY
  let nextCol =
    stepCol > 0 ? (col + 1 - x0) / dx : stepCol < 0 ? (col - x0) / dx : Number.POSITIVE_INFINITY
  let nextRow =
    stepRow > 0 ? (row + 1 - z0) / dz : stepRow < 0 ? (row - z0) / dz : Number.POSITIVE_INFINITY

  // Every step moves one axis toward the end cell (never past it), which bounds the walk.
  while (col !== endCol || row !== endRow) {
    const colDone = col === endCol
    const rowDone = row === endRow
    if (!colDone && !rowDone && Math.abs(nextCol - nextRow) < CORNER_EPSILON) {
      if (!open(col + stepCol, row) || !open(col, row + stepRow)) return false
      col += stepCol
      row += stepRow
      nextCol += deltaCol
      nextRow += deltaRow
    } else if (rowDone || (!colDone && nextCol < nextRow)) {
      col += stepCol
      nextCol += deltaCol
    } else {
      row += stepRow
      nextRow += deltaRow
    }
    if (!open(col, row)) return false
  }
  return true
}

/** Greedy string pulling: from each anchor, jump to the farthest following point still in sight. */
export function smoothPath(grid: NavGrid, path: readonly NavPoint[]): NavPoint[] {
  if (path.length <= 2) return [...path]
  const result: NavPoint[] = [path[0]!]
  let anchor = 0
  while (anchor < path.length - 1) {
    let next = anchor + 1
    while (next + 1 < path.length && hasLineOfSight(grid, path[anchor]!, path[next + 1]!)) next++
    result.push(path[next]!)
    anchor = next
  }
  return result
}

/** Measures a polyline for arc-length sampling, dropping repeated points. */
export function measurePath(points: readonly NavPoint[]): NavPath {
  const kept: NavPoint[] = []
  const distances: number[] = []
  let length = 0
  for (const point of points) {
    const previous = kept[kept.length - 1]
    if (previous) {
      const step = Math.sqrt((point[0] - previous[0]) ** 2 + (point[1] - previous[1]) ** 2)
      if (step === 0) continue
      length += step
    }
    kept.push(point)
    distances.push(length)
  }
  return { points: kept, distances, length }
}

/**
 * Point and unit heading `[dx, dz]` at arc length `s`, clamped to the path. The heading is the
 * direction of the segment `s` falls on; the last segment's at the end, +Z for a single point.
 */
export function samplePathAt(path: NavPath, s: number): { p: NavPoint; heading: NavPoint } {
  const { points, distances } = path
  if (points.length < 2) {
    const only = points[0] ?? [0, 0]
    return { p: [only[0], only[1]], heading: [0, 1] }
  }
  const at = Math.min(Math.max(s, 0), path.length)
  let low = 0
  let high = points.length - 2
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (distances[mid]! <= at) low = mid
    else high = mid - 1
  }
  const a = points[low]!
  const b = points[low + 1]!
  const span = distances[low + 1]! - distances[low]!
  const t = (at - distances[low]!) / span
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  return {
    p: [a[0] + dx * t, a[1] + dz * t],
    heading: [dx / span, dz / span],
  }
}
