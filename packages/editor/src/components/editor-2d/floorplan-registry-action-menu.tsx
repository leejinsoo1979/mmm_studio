'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  getWallMidpointHandlePoint,
  getWallThickness,
  nodeRegistry,
  type SlabNode,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  canCurveWall,
  canSplitWall,
  flipDoorSwing,
  flipOpeningHinge,
  splitWall,
  startWallCurve,
} from '../../lib/selection-actions'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { useMovingNode } from '../../store/use-interaction-scope'
import { useUiHidden } from '../../store/use-ui-hidden'
import { flashAbove, NodeActionMenu } from '../editor/node-action-menu'
import {
  canRotateNode,
  duplicateFlashText,
  findNode,
  paintNode,
  rotateNode,
  toggleInspector,
} from '../editor/node-menu-actions'

type MenuPlacement = 'above' | 'below' | 'left' | 'right'
type MenuPosition = { left: number; top: number; placement: MenuPlacement }

const MENU_GAP_PX = 12
const MENU_TRANSFORMS: Record<MenuPlacement, string> = {
  above: `translate(-50%, calc(-100% - ${MENU_GAP_PX}px))`,
  below: `translate(-50%, ${MENU_GAP_PX}px)`,
  left: `translate(calc(-100% - ${MENU_GAP_PX}px), -50%)`,
  right: `translate(${MENU_GAP_PX}px, -50%)`,
}
// The wall's dimension line sits this far outside its inner (room-side) face
// (see the wall's floor-plan builder); its label (0.15 plan-unit text)
// straddles the line.
const DIMENSION_OFFSET = 0.75
const DIMENSION_LABEL_HALF_HEIGHT = 0.12
// The wall's side move arrows reach this far past its face (offset + inset +
// shaft + head in the floor-plan builder / registry layer).
const MOVE_ARROW_REACH = 0.35

// Mean of the level's wall endpoints, cached per scene snapshot so the
// per-frame anchor never rescans every node.
let centroidCache: {
  nodes: Record<string, AnyNode>
  parentId: string | null
  point: [number, number] | null
} | null = null

function levelWallCentroid(
  nodes: Record<string, AnyNode>,
  parentId: string | null,
): [number, number] | null {
  if (centroidCache?.nodes === nodes && centroidCache.parentId === parentId) {
    return centroidCache.point
  }
  let sumX = 0
  let sumZ = 0
  let count = 0
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'wall' || (node.parentId ?? null) !== parentId) continue
    sumX += node.start[0] + node.end[0]
    sumZ += node.start[1] + node.end[1]
    count += 2
  }
  const point: [number, number] | null = count > 0 ? [sumX / count, sumZ / count] : null
  centroidCache = { nodes, parentId, point }
  return point
}

function samePosition(a: MenuPosition, b: MenuPosition) {
  return (
    a.placement === b.placement && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5
  )
}

/**
 * The wall menu sits beyond the wall's dimension label (on its outer side,
 * away from the level's walls), so the length stays readable: above it for a
 * top wall, below it for a bottom wall. A side wall's label runs vertically,
 * so there the menu opens beside the wall on the room side, past its move
 * arrow.
 */
function wallMenuPosition(
  wall: WallNode,
  nodes: Record<string, AnyNode>,
  svg: SVGSVGElement,
  ctm: DOMMatrix,
): MenuPosition {
  const toScreen = (x: number, y: number) => {
    const point = svg.createSVGPoint()
    point.x = x
    point.y = y
    return point.matrixTransform(ctm)
  }
  const mid = getWallMidpointHandlePoint(wall)
  const midScreen = toScreen(mid.x, mid.y)
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return { left: midScreen.x, top: midScreen.y, placement: 'above' }

  // Same outward side the floor-plan dimension picks: away from the mean of
  // the level's wall endpoints.
  const [cx, cz] = levelWallCentroid(nodes, wall.parentId ?? null) ?? [mid.x, mid.y]
  let nx = -dz / length
  let nz = dx / length
  if ((mid.x - cx) * nx + (mid.y - cz) * nz < 0) {
    nx = -nx
    nz = -nz
  }

  const outward = toScreen(mid.x + nx, mid.y + nz)
  const sx = outward.x - midScreen.x
  const sy = outward.y - midScreen.y
  const screenLength = Math.hypot(sx, sy) || 1
  const half = getWallThickness(wall) / 2
  if (Math.abs(sy) / screenLength >= 0.5) {
    const reach = DIMENSION_OFFSET - half + DIMENSION_LABEL_HALF_HEIGHT
    const anchor = toScreen(mid.x + nx * reach, mid.y + nz * reach)
    return { left: anchor.x, top: anchor.y, placement: sy < 0 ? 'above' : 'below' }
  }
  const reach = half + MOVE_ARROW_REACH
  const inner = toScreen(mid.x - nx * reach, mid.y - nz * reach)
  return { left: inner.x, top: inner.y, placement: sx < 0 ? 'right' : 'left' }
}

/**
 * Floating Move / Duplicate / Delete buttons that appear above the
 * selected registered kind in the floor plan view.
 *
 * Lives outside the floorplan-panel.tsx monolith. Reads selection from
 * `useViewer`, finds the rendered `[data-node-id]` <g> inside the floor
 * plan scene, polls its bounding rect via rAF while open, and portals
 * an HTML overlay positioned at the top of the bounding box.
 *
 * Buttons:
 *  - Move: sets `movingNode` in useEditor. Enabled when the kind has
 *    `capabilities.movable`, `def.floorplanMoveTarget`, OR
 *    `def.affordanceTools.move` (slab / ceiling). The
 *    `<FloorplanRegistryMoveOverlay>` / dispatcher picks the right path.
 *    Walls are excluded — their move is reached via the side-arrow
 *    handles emitted from `def.floorplan`, not via a menu button.
 *  - Add hole (slab + ceiling only): inserts a small default-square
 *    hole at the polygon centroid via `updateNode`. Mirrors the legacy
 *    `handleAddHole` in `floating-action-menu.tsx`.
 *  - Duplicate: deep-clones the node, marks it new, sets it as the
 *    movingNode (placement cursor) — same UX pattern as 3D duplicate.
 *  - Delete: calls `deleteNode(id)`. Cascade is handled by the registry's
 *    `relations.cascadeDelete` if declared on the def.
 *
 * Hidden while in a move state (so we don't show buttons over a ghost).
 */
export function FloorplanRegistryActionMenu() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0]) as AnyNodeId | undefined
  const movingNode = useMovingNode()
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setMovingNodeOrigin = useEditor((s) => s.setMovingNodeOrigin)
  // Gate on floorplan hover so this 2D menu never coexists with the 3D
  // FloatingActionMenu in split view — that menu hides while the floorplan
  // is hovered, so this one must only show then. Mirrors the legacy
  // FloorplanActionMenuLayer guard. Without it a registry kind (e.g. a
  // duct) shows two Duplicate buttons whenever the pointer is outside the
  // 2D panel.
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)

  const unit = useViewer((s) => s.unit)
  const canFindNode = useEditor((s) => s.canFindNode)
  const canPaintNode = useEditor((s) => s.canPaintNode)

  const [position, setPosition] = useState<MenuPosition | null>(null)

  // Only show for registered kinds (skip legacy kinds — they have their
  // own FloorplanActionMenuLayer entries).
  const selectedKind = useScene((s) => (selectedId ? (s.nodes[selectedId]?.type ?? null) : null))
  const def = selectedKind ? nodeRegistry.get(selectedKind) : null
  const isRegistryKind = !!def
  // The paint card's customize mode steps the menu aside, as in 3D.
  const customizing = useUiHidden((s) => s.customizing)
  const isVisible = isRegistryKind && !movingNode && isFloorplanHovered && !customizing
  const isWall = selectedKind === 'wall'

  useEffect(() => {
    if (!(isVisible && selectedId)) {
      setPosition(null)
      return
    }
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const sceneEl = document.querySelector('[data-floorplan-scene]') as SVGGElement | null
      const svgEl = sceneEl?.ownerSVGElement ?? null
      const ctm = sceneEl?.getScreenCTM() ?? null
      if (!(sceneEl && svgEl && ctm)) {
        setPosition(null)
        return
      }

      // Walls: anchor at the wall midpoint in screen space so the menu
      // sits over the centre of the wall (not the top of its screen-axis
      // bounding box). Menu itself stays horizontal. Read live overrides
      // too so the anchor tracks the wall during side-arrow / endpoint
      // drags. For curved walls `getWallMidpointHandlePoint` returns the
      // apex point on the arc at t=0.5, matching what the renderer draws.
      if (isWall) {
        const { nodes } = useScene.getState()
        const sceneNode = nodes[selectedId] as WallNode | undefined
        if (!sceneNode) {
          setPosition(null)
          return
        }
        const overrides = useLiveNodeOverrides.getState().get(selectedId) as
          | Partial<WallNode>
          | undefined
        const wall = (overrides ? { ...sceneNode, ...overrides } : sceneNode) as WallNode
        const next = wallMenuPosition(wall, nodes, svgEl, ctm)
        setPosition((prev) => (prev && samePosition(prev, next) ? prev : next))
        return
      }

      // The node draws in a base pass (its body, first in the DOM) and an
      // overlay pass that carries its handles (resize / rotate arrows): the
      // menu centres on the body and clears the handles above it.
      const entries = sceneEl.querySelectorAll(`[data-node-id="${selectedId}"]`)
      let top = Number.POSITIVE_INFINITY
      let left: number | null = null
      for (const entry of entries) {
        const rect = entry.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        top = Math.min(top, rect.top)
        left ??= rect.left + rect.width / 2
      }
      if (left !== null) {
        const next: MenuPosition = { left, top, placement: 'above' }
        setPosition((prev) => (prev && samePosition(prev, next) ? prev : next))
      } else {
        setPosition(null)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isVisible, selectedId, isWall])

  if (!(isVisible && selectedId && position && def)) return null

  const node = useScene.getState().nodes[selectedId]
  if (!node) return null

  // Move button is enabled when any of:
  //   - `capabilities.movable` (generic translate-on-XZ — shelf / spawn / fence)
  //   - `def.floorplanMoveTarget` (anchor-aware 2D — door / window / item)
  //   - `def.affordanceTools.move` (kind-owned 3D mover — slab / ceiling / wall)
  // From the menu's perspective all three are "this kind can move from
  // the floor plan." The `MoveTool` dispatcher resolves the right path —
  // walls land on their bespoke `MoveWallTool` (perpendicular slide
  // with linked-wall cascade) via `affordanceTools.move`.
  const canMove =
    !!def.capabilities.movable || !!def.floorplanMoveTarget || !!def.affordanceTools?.move
  const canDuplicate = def.capabilities.duplicable !== false
  const canDelete = def.capabilities.deletable !== false
  const canAddHole = node.type === 'slab' || node.type === 'ceiling'
  const wall = node.type === 'wall' ? node : null
  const opening = node.type === 'door' || node.type === 'window' ? node : null
  const nodes = useScene.getState().nodes

  const handleMove = () => {
    sfxEmitter.emit('sfx:item-pick')
    setMovingNode(node as never)
    // 2D-owned move: `FloorplanRegistryMoveOverlay` runs the whole gesture.
    // Mark the origin (after `setMovingNode`, which resets it to null) so
    // `ToolManager` keeps the 3D affordance mover from also adopting the node
    // and reverting it on unmount. Mirrors the orange move-dot path.
    setMovingNodeOrigin('2d')
    // Match the legacy 3D `floating-action-menu`: clear selection so
    // selection-gated affordances unmount during the drag. Specifically
    // the slab / ceiling boundary editor (`ToolManager` shows it when
    // `selectedSlabId !== undefined`) would otherwise stay visible
    // and render its vertex / edge handles on top of the moving mesh
    // in split-view 3D. The move overlay reads `movingNode`, not the
    // selection, so clearing it doesn't disturb the move itself; the
    // commit path re-selects the node when it ends.
    useViewer.getState().setSelection({ selectedIds: [] })
  }

  const handleAddHole = () => {
    if (!canAddHole) return
    const surfaceNode = node as SlabNode | CeilingNode
    const polygon = surfaceNode.polygon
    if (!polygon || polygon.length < 3) return

    let cx = 0
    let cz = 0
    for (const [x, z] of polygon) {
      cx += x
      cz += z
    }
    cx /= polygon.length
    cz /= polygon.length

    const holeSize = 0.5
    const newHole: Array<[number, number]> = [
      [cx - holeSize, cz - holeSize],
      [cx + holeSize, cz - holeSize],
      [cx + holeSize, cz + holeSize],
      [cx - holeSize, cz + holeSize],
    ]
    const currentHoles = surfaceNode.holes ?? []
    const currentMetadata = currentHoles.map(
      (_, index) => surfaceNode.holeMetadata?.[index] ?? { source: 'manual' as const },
    )
    sfxEmitter.emit('sfx:structure-build')
    useScene.getState().updateNode(
      selectedId as AnyNodeId,
      {
        holes: [...currentHoles, newHole],
        holeMetadata: [...currentMetadata, { source: 'manual' as const }],
      } as Partial<AnyNode>,
    )
  }

  const handleDuplicate = () => {
    if (!node.parentId) return
    sfxEmitter.emit('sfx:item-pick')
    useScene.temporal.getState().pause()
    const cloned = structuredClone(node) as AnyNode & { id?: AnyNodeId }
    delete (cloned as { id?: AnyNodeId }).id
    const prevMeta =
      cloned.metadata && typeof cloned.metadata === 'object' && !Array.isArray(cloned.metadata)
        ? (cloned.metadata as Record<string, unknown>)
        : {}
    // Mark fresh + hand to the placement cursor so the copy follows the
    // pointer and only lands on the next click — same gesture for every
    // kind. Polyline runs (duct / pipe / lineset) ride the same path:
    // `FloorplanRegistryMoveOverlay` translates their whole `path`, so they
    // no longer need the old "offset + drop already-placed" special case.
    cloned.metadata = { ...prevMeta, isNew: true }
    const parsed = def.schema.parse(cloned) as AnyNode
    useScene.getState().createNode(parsed, node.parentId as AnyNodeId)
    setMovingNode(parsed as never)
    useScene.temporal.getState().resume()
  }

  const handleDelete = () => {
    sfxEmitter.emit('sfx:item-delete')
    useScene.getState().deleteNode(selectedId)
    useViewer.getState().setSelection({ selectedIds: [] })
  }

  const canRotate = canRotateNode(node)
  const stop =
    (action: () => void) =>
    (event: { stopPropagation: () => void }): void => {
      event.stopPropagation()
      action()
    }

  return createPortal(
    <div
      className="pointer-events-none fixed z-30"
      style={{
        left: position.left,
        top: position.top,
        transform: MENU_TRANSFORMS[position.placement],
      }}
    >
      <NodeActionMenu
        onFind={canFindNode ? stop(() => findNode(node)) : undefined}
        onInspect={stop(toggleInspector)}
        onPaint={canPaintNode?.(node) ? stop(() => paintNode(node)) : undefined}
        onRotateLeft={canRotate ? stop(() => rotateNode(node, 1)) : undefined}
        onRotateRight={canRotate ? stop(() => rotateNode(node, -1)) : undefined}
        tail={
          position.placement === 'above' ? 'down' : position.placement === 'below' ? 'up' : 'none'
        }
        onAddHole={canAddHole ? handleAddHole : undefined}
        onCurve={
          wall && canSplitWall(wall) && canCurveWall(wall, nodes)
            ? () => startWallCurve(wall)
            : undefined
        }
        onDelete={canDelete ? handleDelete : undefined}
        onDuplicate={
          canDuplicate
            ? (event) => {
                flashAbove(event.currentTarget, duplicateFlashText(node, unit))
                handleDuplicate()
              }
            : undefined
        }
        onFlipHinge={opening ? () => flipOpeningHinge(opening) : undefined}
        onFlipSwing={node.type === 'door' ? () => flipDoorSwing(node) : undefined}
        onMove={canMove ? handleMove : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onSplit={wall && canSplitWall(wall) ? () => splitWall(wall) : undefined}
      />
    </div>,
    document.body,
  )
}
