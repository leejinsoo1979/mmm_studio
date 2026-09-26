import { type AnyNodeId, type FloorplanAffordance, useScene } from '@pascal-app/core'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'
import type { CabinetNode, CountertopNode } from './schema'

export type CabinetResizePayload = {
  dim: 'width' | 'depth'
  /** Plan direction of the arrow tip, captured when the arrow was emitted. */
  planAxis: [number, number]
}

/** Snap step for dragged sizes; Shift drags in whole millimetres. */
const SIZE_SNAP_MM = 10

function snapMm(valueMm: number, free: boolean): number {
  return free ? Math.round(valueMm) : Math.round(valueMm / SIZE_SNAP_MM) * SIZE_SNAP_MM
}

/**
 * One-sided resize: the arrow's face follows the cursor while the opposite
 * face stays put (a cabinet against a neighbour or wall keeps that edge), so
 * the centre shifts by half the change along the arrow axis.
 */
function oneSidedResize<N extends { id: string; position: [number, number, number] }>(
  node: N,
  payload: CabinetResizePayload,
  initialPlanPoint: readonly [number, number],
  initialMm: number,
  limits: { min: number; max: number },
  patchFor: (valueMm: number) => Partial<N>,
) {
  const id = node.id as AnyNodeId
  const [ax, ay] = payload.planAxis
  const start = initialPlanPoint[0] * ax + initialPlanPoint[1] * ay
  let lastPatch: Partial<N> | null = null
  return {
    affectedIds: [id],
    apply({
      planPoint,
      modifiers,
    }: {
      planPoint: readonly [number, number]
      modifiers: { shiftKey: boolean }
    }) {
      const deltaMm = (planPoint[0] * ax + planPoint[1] * ay - start) * 1000
      const value = Math.min(
        limits.max,
        Math.max(limits.min, snapMm(initialMm + deltaMm, modifiers.shiftKey)),
      )
      const shift = ((value - initialMm) / 2) * 0.001
      lastPatch = {
        ...patchFor(value),
        position: [node.position[0] + ax * shift, node.position[1], node.position[2] + ay * shift],
      } as Partial<N>
      useScene.getState().updateNode(id, lastPatch as never)
    },
    canCommit() {
      return lastPatch != null
    },
    commit() {
      if (lastPatch) useScene.getState().updateNode(id, lastPatch as never)
    },
  }
}

export const cabinetResizeAffordance: FloorplanAffordance<CabinetNode> = {
  start({ node, payload, initialPlanPoint }) {
    const p = payload as CabinetResizePayload
    if (p.dim === 'width') {
      return oneSidedResize(
        node,
        p,
        initialPlanPoint,
        node.widthMm,
        { min: 150, max: 2400 },
        (v) => ({
          widthMm: v,
        }),
      )
    }
    return oneSidedResize(node, p, initialPlanPoint, node.depthMm, { min: 250, max: 900 }, (v) => ({
      depthMm: v,
    }))
  },
}

export const countertopResizeAffordance: FloorplanAffordance<CountertopNode> = {
  start({ node, payload, initialPlanPoint }) {
    return oneSidedResize(
      node,
      payload as CabinetResizePayload,
      initialPlanPoint,
      node.lengthMm,
      { min: 300, max: 6000 },
      (v) => ({ lengthMm: v }),
    )
  },
}

/** Rotation drag around the footprint centre; 15° steps unless Shift. */
export const cabinetRotateAffordance: FloorplanAffordance<CabinetNode> = {
  start({ node, initialPlanPoint }) {
    const id = node.id as AnyNodeId
    const r = node.rotation
    const cx = node.position[0]
    const cz = node.position[2]
    const initialAngle = Math.atan2(initialPlanPoint[1] - cz, initialPlanPoint[0] - cx)
    let last: [number, number, number] = [...r]
    return {
      affectedIds: [id],
      apply({ planPoint, modifiers }) {
        const delta = rotateAffordanceDelta({
          center: [cx, cz],
          initialAngle,
          planPoint,
          free: modifiers.shiftKey,
        })
        last = [r[0], (r[1] ?? 0) - delta, r[2]]
        useScene.getState().updateNode(id, { rotation: last })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(id, { rotation: last })
      },
    }
  },
}
