import type { CabinetCell, CellContent, CellFront } from '../schema'
import { MIN_CELL_MM, round1 } from './rules'

/** Axis-aligned rectangle on the cabinet's front plane (mm, x from the left,
 *  y from the floor). */
export type CellRect = { x0: number; x1: number; y0: number; y1: number }

export type ResolvedLeaf = {
  id: string
  rect: CellRect
  content: CellContent
}

export type ResolvedDivider = {
  /** Id of the split that owns the divider and the index of the boundary. */
  splitId: string
  index: number
  axis: 'x' | 'y'
  /** Panel rectangle on the front plane (width = thickness for `x`). For a
   *  stacked joint it spans both panels (the lower top and the upper bottom). */
  rect: CellRect
  /** Joint between two separate carcasses (two panels, 2T) — root only. */
  stacked: boolean
}

export type ResolvedFrontOwner = {
  id: string
  rect: CellRect
  front: CellFront
  /** True when the owner's subtree holds an external-drawer leaf. */
  hasExternalDrawers: boolean
}

export type ResolvedTree = {
  leaves: ResolvedLeaf[]
  dividers: ResolvedDivider[]
  /** Clear rectangle of every node, keyed by id (leaves and splits). */
  rects: Map<string, CellRect>
  issues: string[]
}

/**
 * Distribute `total` clear space over children. Fixed sizes are honoured;
 * `null` entries share the rest equally. When the fixed sizes do not fit,
 * everything is scaled down proportionally and an issue is reported.
 */
export function distributeSizes(
  sizes: (number | null)[],
  total: number,
  issues: string[],
  label: string,
): number[] {
  const fixedSum = sizes.reduce<number>((sum, s) => sum + (s ?? 0), 0)
  const flexCount = sizes.filter((s) => s == null).length
  const rest = total - fixedSum
  if (flexCount > 0 && rest >= flexCount * MIN_CELL_MM) {
    const share = rest / flexCount
    return sizes.map((s) => s ?? share)
  }
  if (flexCount === 0 && Math.abs(rest) < 0.05) return sizes.map((s) => s ?? 0)
  // Does not fit (or fixed sizes leave a remainder with nothing to absorb it):
  // scale every child proportionally to its requested/nominal size.
  const nominal = sizes.map((s) => s ?? Math.max(MIN_CELL_MM, total / sizes.length))
  const nominalSum = nominal.reduce((a, b) => a + b, 0)
  issues.push(
    `${label}: 고정 크기 합계(${round1(fixedSum)}mm)가 공간(${round1(total)}mm)과 맞지 않아 비율로 조정했습니다`,
  )
  return nominal.map((s) => (s / nominalSum) * total)
}

/** True when the root splits into separately built carcasses. */
export function isStackedRoot(root: CabinetCell): boolean {
  return root.kind === 'split' && root.axis === 'y' && root.joint === 'stack'
}

/** Walk the cell tree inside `rect`, producing leaf and divider rectangles. */
export function resolveCellTree(
  root: CabinetCell,
  rect: CellRect,
  thicknessMm: number,
): ResolvedTree {
  const leaves: ResolvedLeaf[] = []
  const dividers: ResolvedDivider[] = []
  const rects = new Map<string, CellRect>()
  const issues: string[] = []

  const walk = (cell: CabinetCell, r: CellRect) => {
    rects.set(cell.id, r)
    if (cell.kind === 'leaf') {
      leaves.push({ id: cell.id, rect: r, content: cell.content })
      return
    }
    const stacked = cell === root && isStackedRoot(cell)
    const jointMm = stacked ? 2 * thicknessMm : thicknessMm
    const n = cell.children.length
    const span = cell.axis === 'x' ? r.x1 - r.x0 : r.y1 - r.y0
    const clear = span - (n - 1) * jointMm
    const requested = cell.children.map((_, i) => cell.sizesMm[i] ?? null)
    const sizes = distributeSizes(
      requested,
      clear,
      issues,
      cell.axis === 'x' ? '세로 칸' : '가로 칸',
    )
    let cursor = cell.axis === 'x' ? r.x0 : r.y0
    cell.children.forEach((child, i) => {
      const size = sizes[i] ?? 0
      const childRect: CellRect =
        cell.axis === 'x'
          ? { x0: cursor, x1: cursor + size, y0: r.y0, y1: r.y1 }
          : { x0: r.x0, x1: r.x1, y0: cursor, y1: cursor + size }
      walk(child, childRect)
      cursor += size
      if (i < n - 1) {
        dividers.push({
          splitId: cell.id,
          index: i,
          axis: cell.axis,
          stacked,
          rect:
            cell.axis === 'x'
              ? { x0: cursor, x1: cursor + jointMm, y0: r.y0, y1: r.y1 }
              : { x0: r.x0, x1: r.x1, y0: cursor, y1: cursor + jointMm },
        })
        cursor += jointMm
      }
    })
  }
  walk(root, rect)
  return { leaves, dividers, rects, issues }
}

/** The fronts to build: the shallowest node on each branch that declares a
 *  front (descendant fronts under it are ignored). */
export function collectFrontOwners(
  root: CabinetCell,
  rects: Map<string, CellRect>,
): ResolvedFrontOwner[] {
  const owners: ResolvedFrontOwner[] = []
  const walk = (cell: CabinetCell) => {
    const rect = rects.get(cell.id)
    if (cell.front && rect) {
      owners.push({
        id: cell.id,
        rect,
        front: cell.front,
        hasExternalDrawers: subtreeHasExternalDrawers(cell),
      })
      return
    }
    if (cell.kind === 'split') for (const child of cell.children) walk(child)
  }
  walk(root)
  return owners
}

export function subtreeHasExternalDrawers(cell: CabinetCell): boolean {
  if (cell.kind === 'leaf') {
    return cell.content.type === 'drawers' && cell.content.style === 'external'
  }
  return cell.children.some(subtreeHasExternalDrawers)
}

// ─── Editing operations (pure; return a new tree) ───────────────────────

let idCounter = 0
export function newCellId(): string {
  idCounter += 1
  return `c${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function findCell(root: CabinetCell, id: string): CabinetCell | null {
  if (root.id === id) return root
  if (root.kind === 'split') {
    for (const child of root.children) {
      const hit = findCell(child, id)
      if (hit) return hit
    }
  }
  return null
}

export function findParent(root: CabinetCell, id: string): CabinetCell | null {
  if (root.kind !== 'split') return null
  for (const child of root.children) {
    if (child.id === id) return root
    const hit = findParent(child, id)
    if (hit) return hit
  }
  return null
}

function mapCell(
  root: CabinetCell,
  id: string,
  fn: (cell: CabinetCell) => CabinetCell,
): CabinetCell {
  if (root.id === id) return fn(root)
  if (root.kind === 'leaf') return root
  let changed = false
  const children = root.children.map((child) => {
    const next = mapCell(child, id, fn)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...root, children } : root
}

/**
 * Split a cell into `count` parts along `axis`. A leaf keeps its content in
 * every part; its front moves to the new split so a door keeps covering the
 * whole area. Splitting a child of a same-axis split just adds siblings.
 */
export function splitCell(root: CabinetCell, id: string, axis: 'x' | 'y', count = 2): CabinetCell {
  const parts = Math.max(2, Math.min(8, Math.round(count)))
  const parent = findParent(root, id)
  const target = findCell(root, id)
  if (
    parent?.kind === 'split' &&
    parent.axis === axis &&
    target?.kind === 'leaf' &&
    !target.front
  ) {
    return mapCell(root, parent.id, (cell) => {
      if (cell.kind !== 'split') return cell
      const index = cell.children.findIndex((c) => c.id === id)
      const copies: CabinetCell[] = Array.from({ length: parts - 1 }, () => ({
        id: newCellId(),
        kind: 'leaf',
        content: target.content,
      }))
      const children = [...cell.children]
      children.splice(index + 1, 0, ...copies)
      const sizesMm = [...cell.children.map((_, i) => cell.sizesMm[i] ?? null)]
      sizesMm[index] = null
      sizesMm.splice(index + 1, 0, ...copies.map(() => null))
      return { ...cell, children, sizesMm }
    })
  }
  return mapCell(root, id, (cell) => {
    const { front, ...rest } = cell
    const base: CabinetCell =
      cell.kind === 'leaf'
        ? { id: newCellId(), kind: 'leaf', content: cell.content }
        : { ...(rest as CabinetCell), id: newCellId() }
    const children: CabinetCell[] = [base]
    for (let i = 1; i < parts; i += 1) {
      children.push(
        cell.kind === 'leaf'
          ? { id: newCellId(), kind: 'leaf', content: cell.content }
          : { id: newCellId(), kind: 'leaf', content: { type: 'empty' } },
      )
    }
    const split: CabinetCell = {
      id: cell.id,
      kind: 'split',
      axis,
      children,
      sizesMm: children.map(() => null),
    }
    return front ? { ...split, front } : split
  })
}

/** Collapse a split back into a single leaf (content of its first leaf). */
export function mergeCell(root: CabinetCell, id: string): CabinetCell {
  return mapCell(root, id, (cell) => {
    if (cell.kind === 'leaf') return cell
    const first = firstLeaf(cell)
    const leaf: CabinetCell = {
      id: cell.id,
      kind: 'leaf',
      content: first?.kind === 'leaf' ? first.content : { type: 'empty' },
    }
    return cell.front ? { ...leaf, front: cell.front } : leaf
  })
}

/** Remove one child of a split; the split collapses when one child is left. */
export function removeCell(root: CabinetCell, id: string): CabinetCell {
  const parent = findParent(root, id)
  if (parent?.kind !== 'split') return root
  return mapCell(root, parent.id, (cell) => {
    if (cell.kind !== 'split') return cell
    const index = cell.children.findIndex((c) => c.id === id)
    const children = cell.children.filter((_, i) => i !== index)
    const sizesMm = cell.sizesMm.filter((_, i) => i !== index)
    if (children.length === 1) {
      const only = children[0] as CabinetCell
      const collapsed = { ...only, id: cell.id }
      return cell.front ? { ...collapsed, front: cell.front } : collapsed
    }
    return { ...cell, children, sizesMm }
  })
}

function firstLeaf(cell: CabinetCell): CabinetCell | null {
  if (cell.kind === 'leaf') return cell
  return cell.children[0] ? firstLeaf(cell.children[0]) : null
}

export function setCellContent(root: CabinetCell, id: string, content: CellContent): CabinetCell {
  return mapCell(root, id, (cell) => (cell.kind === 'leaf' ? { ...cell, content } : cell))
}

/** Set (or clear with `null`) the front on a node. Fronts on its descendants
 *  are cleared so one door does not sit on top of another. */
export function setCellFront(root: CabinetCell, id: string, front: CellFront | null): CabinetCell {
  return mapCell(root, id, (cell) => {
    const cleared =
      cell.kind === 'split' ? { ...cell, children: cell.children.map(stripFronts) } : cell
    if (!front) {
      const { front: _drop, ...rest } = cleared
      return rest as CabinetCell
    }
    return { ...cleared, front }
  })
}

function stripFronts(cell: CabinetCell): CabinetCell {
  const { front: _drop, ...rest } = cell
  if (rest.kind === 'split') return { ...rest, children: rest.children.map(stripFronts) }
  return rest as CabinetCell
}

/** Fix (or free with `null`) a child's clear size inside its parent split. */
export function setCellSize(root: CabinetCell, id: string, sizeMm: number | null): CabinetCell {
  const parent = findParent(root, id)
  if (parent?.kind !== 'split') return root
  return mapCell(root, parent.id, (cell) => {
    if (cell.kind !== 'split') return cell
    const index = cell.children.findIndex((c) => c.id === id)
    const sizesMm = cell.children.map((_, i) =>
      i === index
        ? sizeMm == null
          ? null
          : Math.max(MIN_CELL_MM, sizeMm)
        : (cell.sizesMm[i] ?? null),
    )
    return { ...cell, sizesMm }
  })
}

/** Nearest ancestor-or-self that carries a front. */
export function frontOwnerOf(root: CabinetCell, id: string): CabinetCell | null {
  const path: CabinetCell[] = []
  const walk = (cell: CabinetCell): boolean => {
    path.push(cell)
    if (cell.id === id) return true
    if (cell.kind === 'split') for (const child of cell.children) if (walk(child)) return true
    path.pop()
    return false
  }
  if (!walk(root)) return null
  return path.find((cell) => cell.front) ?? null
}

/** Deep copy with fresh ids (for presets and "save as module"). */
export function cloneWithFreshIds(cell: CabinetCell, rootId?: string): CabinetCell {
  const id = rootId ?? newCellId()
  if (cell.kind === 'leaf') return { ...cell, id }
  return { ...cell, id, children: cell.children.map((child) => cloneWithFreshIds(child)) }
}

/** Build the root's stacked sections as separate carcasses (or join them
 *  with one shelf again). Only meaningful on a root `y` split. */
export function setSplitJoint(
  root: CabinetCell,
  id: string,
  joint: 'shelf' | 'stack',
): CabinetCell {
  return mapCell(root, id, (cell) => (cell.kind === 'split' ? { ...cell, joint } : cell))
}

/** Stacked sections only: keep or drop that section's back panel. */
export function setCellHasBack(root: CabinetCell, id: string, hasBack: boolean): CabinetCell {
  return mapCell(root, id, (cell) => {
    if (hasBack) {
      const { hasBack: _drop, ...rest } = cell
      return rest as CabinetCell
    }
    return { ...cell, hasBack: false }
  })
}
