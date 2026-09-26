import type { AnyNode, CeilingNode } from '@pascal-app/core'

function inside(x: number, z: number, poly: readonly (readonly [number, number])[]): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i] as [number, number]
    const [xj, zj] = poly[j] as [number, number]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

/** Height (m, level-local) of the ceiling over a plan point on a level, or
 *  null when no ceiling covers it. */
export function ceilingHeightAt(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
  x: number,
  z: number,
): number | null {
  for (const n of Object.values(nodes)) {
    if (n?.type !== 'ceiling' || n.parentId !== levelId) continue
    const c = n as CeilingNode
    if (c.polygon.length >= 3 && inside(x, z, c.polygon)) return c.height ?? 2.5
  }
  return null
}
