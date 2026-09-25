import {
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  movingFootprintAnchors,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  isMagneticSnapActive,
  triggerSFX,
  useEditor,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import type { CabinetNode, CountertopNode } from './schema'

type Positioned = CabinetNode | CountertopNode

/**
 * 2D move for cabinets and countertops — the same pattern as the shelf: each
 * pointer move writes the absolute position straight to the scene (history
 * is paused by the overlay, which folds the drag into one undo step), with
 * grid snap plus alignment to neighbours and wall faces. The elevation
 * (`position[1]`) is kept, so an upper cabinet stays at its mounting height.
 */
export const positionedFloorplanMoveTarget: FloorplanMoveTarget<Positioned> = ({ node, nodes }) => {
  const id = node.id as AnyNodeId
  const original: [number, number, number] = [...node.position]
  const rotationY = node.rotation[1] ?? 0
  const resolveCursor = createFloorplanCursorResolver({
    original: [original[0], original[2]],
    metadata: node.metadata,
  })
  let last = original
  let lastKey: string | null = null
  const candidates = collectAlignmentAnchors(nodes, id)

  const session: FloorplanMoveTargetSession = {
    affectedIds: [id],
    apply({ planPoint, modifiers }) {
      const snap = (value: number) => {
        if (modifiers.shiftKey) return value
        const step = useEditor.getState().gridSnapStep
        return Math.round(value / step) * step
      }
      const gridSnapped = resolveCursor(planPoint, { snap }) as WallPlanPoint
      const { point } = applyFloorplanAlignment(
        gridSnapped,
        movingFootprintAnchors(
          node as unknown as AnyNode,
          gridSnapped[0],
          gridSnapped[1],
          rotationY,
        ),
        candidates,
        { applySnap: isMagneticSnapActive(), bypass: modifiers.altKey || modifiers.shiftKey },
      )
      last = [point[0], original[1], point[1]]
      const key = `${point[0]},${point[1]}`
      if (!modifiers.shiftKey && key !== lastKey) {
        triggerSFX('sfx:grid-snap')
        lastKey = key
      }
      useScene.getState().updateNodes([{ id, data: { position: last } as never }])
    },
    canCommit() {
      const live = useScene.getState().nodes[id] as unknown as Positioned | undefined
      if (live?.type !== node.type) return false
      return !(last[0] === original[0] && last[2] === original[2])
    },
  }
  return session
}
