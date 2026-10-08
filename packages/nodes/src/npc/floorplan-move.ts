import {
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  movingFootprintAnchors,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  getFloorStackPreviewPosition,
  isGridSnapActive,
  isMagneticSnapActive,
  triggerSFX,
  useEditor,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import type { NpcNode } from './schema'

/**
 * 2D floor-plan move for an NPC (the column pattern): previews through live
 * transforms and commits once on release, so the scene store isn't churned on
 * every pointermove. Grid snap follows the active snapping mode, with
 * footprint alignment layered on top.
 */
export const npcFloorplanMoveTarget: FloorplanMoveTarget<NpcNode> = ({ node, nodes }) => {
  const npcId = node.id as AnyNodeId
  const originalPosition: [number, number, number] = [...node.position]
  const resolveCursor = createFloorplanCursorResolver({
    original: [originalPosition[0], originalPosition[2]],
    metadata: node.metadata,
  })
  let lastPosition: [number, number, number] = originalPosition
  let lastSnapKey: string | null = null
  const candidates = collectAlignmentAnchors(nodes, npcId)

  const session: FloorplanMoveTargetSession = {
    affectedIds: [npcId],
    apply({ planPoint }) {
      const snap = (value: number) => {
        if (!isGridSnapActive()) return value
        const step = useEditor.getState().gridSnapStep
        return Math.round(value / step) * step
      }
      const gridSnapped = resolveCursor(planPoint, { snap }) as WallPlanPoint
      const { point: snapped } = applyFloorplanAlignment(
        gridSnapped,
        movingFootprintAnchors(
          node as unknown as AnyNode,
          gridSnapped[0],
          gridSnapped[1],
          node.rotation,
        ),
        candidates,
        { applySnap: isMagneticSnapActive() },
      )
      const next: [number, number, number] = [snapped[0], originalPosition[1], snapped[1]]
      lastPosition = next

      const snapKey = `${snapped[0]},${snapped[1]}`
      if (snapKey !== lastSnapKey) {
        triggerSFX('sfx:grid-snap')
        lastSnapKey = snapKey
      }
      const visualPosition = getFloorStackPreviewPosition({
        node: node as unknown as AnyNode,
        position: next,
        rotation: node.rotation,
        levelId: node.parentId ?? null,
      })
      sceneRegistry.nodes.get(npcId)?.position.set(...visualPosition)
      useLiveTransforms.getState().set(npcId, { position: next, rotation: node.rotation })
      // The live transform re-renders the marker at base Y; the mark lifts it again.
      useScene.getState().markDirty(npcId)
    },
    canCommit() {
      const live = useScene.getState().nodes[npcId] as { type: string } | undefined
      if (live?.type !== 'npc') return false
      return !(lastPosition[0] === originalPosition[0] && lastPosition[2] === originalPosition[2])
    },
    commit() {
      useScene
        .getState()
        .updateNodes([{ id: npcId, data: { position: lastPosition } as Partial<AnyNode> }])
    },
  }
  return session
}
