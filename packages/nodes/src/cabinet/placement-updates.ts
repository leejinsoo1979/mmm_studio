import { frontDirection } from './placement'
import type { CabinetNode } from './schema'

/**
 * Node patches for the mmmcraft furniture-popup edits that move the cabinet
 * as well as resize it. Pure, so the rules are testable without the panel.
 */

type Patch = Partial<CabinetNode>

/** `position` moved `mm` towards the cabinet front (negative = back). */
function shifted(node: CabinetNode, mm: number): CabinetNode['position'] {
  const [fx, fz] = frontDirection(node.rotation[1])
  return [
    node.position[0] + fx * (mm / 1000),
    node.position[1],
    node.position[2] + fz * (mm / 1000),
  ]
}

/** The gap the body actually keeps from the wall: mmmcraft moves the body
 *  by the positive part only, and upper cabinets ignore it. */
export function effectiveBackWallGapMm(node: Pick<CabinetNode, 'family' | 'backWallGapMm'>) {
  return node.family === 'upper' ? 0 : Math.max(0, node.backWallGapMm)
}

/** 뒷벽 이격: the body slides forward/back by the change in its gap. */
export function backWallGapPatch(node: CabinetNode, gapMm: number): Patch {
  const next = { ...node, backWallGapMm: gapMm }
  return {
    backWallGapMm: gapMm,
    position: shifted(node, effectiveBackWallGapMm(next) - effectiveBackWallGapMm(node)),
  }
}

/**
 * Depth change under 뒤고정 / 앞고정. 뒤고정 keeps the back face. 앞고정
 * keeps the front face; for base/tall cabinets the space that opens behind
 * becomes 뒷벽 이격 (mmmcraft stores the front line as a back-wall gap, never
 * below 0 — a deeper cabinet pushes the front out once the gap is used up).
 */
export function depthPatch(node: CabinetNode, depthMm: number): Patch {
  const change = depthMm - node.depthMm
  if (node.depthAnchor === 'back') {
    return { depthMm, position: shifted(node, change / 2) }
  }
  if (node.family === 'upper') {
    return { depthMm, position: shifted(node, -change / 2) }
  }
  const oldGap = effectiveBackWallGapMm(node)
  const backWallGapMm = Math.max(0, node.backWallGapMm - change)
  const newGap = effectiveBackWallGapMm({ family: node.family, backWallGapMm })
  // Back face moves by the gap change; the centre sits half the new depth in front.
  return {
    depthMm,
    backWallGapMm,
    position: shifted(node, newGap - oldGap + change / 2),
  }
}

/**
 * 띄움 (toe kick off): the body's lift off the floor. A base cabinet rises
 * whole; a tall cabinet keeps its top line and its body grows or shrinks
 * underneath (mmmcraft absorbs the float into the body height).
 */
export function floatPatch(node: CabinetNode, floatMm: number): Patch {
  const change = floatMm - Math.round(node.position[1] * 1000)
  const position: CabinetNode['position'] = [node.position[0], floatMm / 1000, node.position[2]]
  if (node.family === 'tall') return { position, heightMm: node.heightMm - change }
  return { position }
}

/**
 * 상단몰딩 height changes (switching it on/off counts as 0 ↔ height). The
 * cabinet top plus moulding stays on the ceiling line: a tall body gives up
 * the height, an upper cabinet hangs lower.
 */
export function topMouldingPatch(node: CabinetNode, next: CabinetNode['topMoulding']): Patch {
  const used = (m: CabinetNode['topMoulding']) => (m.enabled ? m.heightMm : 0)
  const change = used(next) - used(node.topMoulding)
  if (change === 0) return { topMoulding: next }
  if (node.family === 'tall') return { topMoulding: next, heightMm: node.heightMm - change }
  if (node.family === 'upper') {
    return {
      topMoulding: next,
      position: [node.position[0], node.position[1] - change / 1000, node.position[2]],
    }
  }
  return { topMoulding: next }
}
