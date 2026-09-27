import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  isCurvedWall,
  useScene,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { splitWallAtMidpoint } from '../components/tools/wall/wall-drafting'
import useInteractionScope from '../store/use-interaction-scope'
import { curveReshapeScope } from './interaction/scope'
import { sfxEmitter } from './sfx-bus'

/**
 * mmmcraft's selection tool bar actions, shared by the 3D and plan action
 * menus: wall arc / split, opening hinge-side and swing flips.
 */

/** A wall carrying openings or wall-mounted items can't be bent. */
export function canCurveWall(wall: WallNode, nodes: Record<AnyNodeId, AnyNode>): boolean {
  return !(wall.children ?? []).some((childId) => {
    const child = nodes[childId as AnyNodeId]
    if (!child) return false
    if (child.type === 'door' || child.type === 'window') return true
    if (child.type === 'item') {
      const attachTo = child.asset?.attachTo
      return attachTo === 'wall' || attachTo === 'wall-side'
    }
    return false
  })
}

export function startWallCurve(wall: WallNode) {
  sfxEmitter.emit('sfx:item-pick')
  useInteractionScope.getState().begin(curveReshapeScope(wall.id))
  useViewer.getState().setSelection({ selectedIds: [] })
}

export function canSplitWall(wall: WallNode): boolean {
  return !isCurvedWall(wall)
}

export function splitWall(wall: WallNode) {
  if (splitWallAtMidpoint(wall.id as AnyNodeId)) {
    useViewer.getState().setSelection({ selectedIds: [] })
  }
}

function markHostDirty(node: DoorNode | WindowNode) {
  if (node.parentId) useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
}

/** 좌우대칭: hinges to the other jamb. */
export function flipOpeningHinge(node: DoorNode | WindowNode) {
  useScene.getState().updateNode(node.id, {
    hingesSide: node.hingesSide === 'left' ? 'right' : 'left',
  })
  markHostDirty(node)
  sfxEmitter.emit('sfx:item-rotate')
}

/** 상하반전: the door swings to the other side of the wall. */
export function flipDoorSwing(node: DoorNode) {
  useScene.getState().updateNode(node.id, {
    swingDirection: node.swingDirection === 'inward' ? 'outward' : 'inward',
  })
  markHostDirty(node)
  sfxEmitter.emit('sfx:item-rotate')
}
