import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanAffordance,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, triggerSFX } from '@pascal-app/editor'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'
import type { NpcPatrolPointPayload } from './floorplan'
import type { NpcNode } from './schema'

/** The 2D twin of the 3D rotate handle: same `- delta` convention (the plan draws at `-rotation`). */
export const npcRotateAffordance: FloorplanAffordance<NpcNode> = {
  start({ node, initialPlanPoint }) {
    const npcId = node.id as AnyNodeId
    const initialRotation = node.rotation
    const cx = node.position[0]
    const cz = node.position[2]
    const initialAngle = Math.atan2(initialPlanPoint[1] - cz, initialPlanPoint[0] - cx)
    let lastRotation = initialRotation

    return {
      affectedIds: [npcId],
      apply({ planPoint, modifiers }) {
        const delta = rotateAffordanceDelta({
          center: [cx, cz],
          initialAngle,
          planPoint,
          free: modifiers.shiftKey,
        })
        lastRotation = initialRotation - delta
        useScene.getState().updateNode(npcId, { rotation: lastRotation } as Partial<AnyNode>)
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(npcId, { rotation: lastRotation } as Partial<AnyNode>)
      },
    }
  },
}

/** Drags one patrol point on the plan, on the grid when grid snapping is on. */
export const npcPatrolPointAffordance: FloorplanAffordance<NpcNode> = {
  start({ node, payload, gridSnapStep }) {
    const npcId = node.id as AnyNodeId
    const { index } = payload as NpcPatrolPointPayload
    const { behavior } = node
    const original = behavior.patrol[index]
    let last: [number, number] | null = original ? [original[0], original[1]] : null

    return {
      affectedIds: [npcId],
      apply({ planPoint }) {
        if (!original) return
        const raw: [number, number] = [planPoint[0], planPoint[1]]
        const [x, z] = isGridSnapActive() ? snapPointToGrid(raw, gridSnapStep) : raw
        if (last && last[0] === x && last[1] === z) return
        const next: [number, number] = [x, z]
        last = next
        triggerSFX('sfx:grid-snap')
        const patrol = behavior.patrol.map((point, i) => (i === index ? next : point))
        useScene
          .getState()
          .updateNode(npcId, { behavior: { ...behavior, patrol } } as Partial<AnyNode>)
      },
      canCommit() {
        return !!(original && last) && (last[0] !== original[0] || last[1] !== original[1])
      },
    }
  },
}
