import {
  type AnyNode,
  emitter,
  getScaledDimensions,
  getWallCurveLength,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { formatLinearMeasurement, type LinearUnit } from '../../lib/measurements'
import { sfxEmitter } from '../../lib/sfx-bus'
import { useInspectorCollapsed } from '../../store/use-inspector-collapsed'
import { turnRotation } from '../tools/item/placement-math'

// Actions the 3D and 2D selection menus share, so both views offer the same
// vocabulary for the same object.

/** Kinds whose yaw the menu's ↺ / ↻ turn (doors and windows flip instead). */
export function canRotateNode(node: AnyNode): boolean {
  if (node.type === 'door' || node.type === 'window') return false
  if (nodeRegistry.get(node.type)?.keyboardActions?.r) return false
  const rotation = (node as { rotation?: unknown }).rotation
  return typeof rotation === 'number' || Array.isArray(rotation)
}

/** One 45° step, the same as the R (+1) and T (-1) keys. */
export function rotateNode(node: AnyNode, direction: 1 | -1) {
  const rotation = (node as { rotation?: unknown }).rotation
  const { updateNode } = useScene.getState()
  if (typeof rotation === 'number') {
    updateNode(node.id, { rotation: turnRotation(rotation, direction, false) } as Partial<AnyNode>)
  } else if (Array.isArray(rotation)) {
    updateNode(node.id, {
      rotation: [rotation[0], turnRotation(rotation[1], direction, false), rotation[2]],
    } as Partial<AnyNode>)
  } else return
  sfxEmitter.emit('sfx:item-rotate')
}

/** The host owns the palette; the editor only signals which node to paint. */
export function paintNode(node: AnyNode) {
  emitter.emit('selection:paint-node' as never, node as never)
}

/** The host reveals the node in its catalogue browser. */
export function findNode(node: AnyNode) {
  emitter.emit('selection:find-node' as never, node as never)
}

/** 속성: opens (or folds away) the inspector card for the selection. */
export function toggleInspector() {
  useInspectorCollapsed.getState().setCollapsed((collapsed) => !collapsed)
}

/** inZOI floats the cost delta over the menu after a duplicate; ours is the size. */
export function duplicateFlashText(node: AnyNode, unit: LinearUnit): string {
  if (node.type === 'wall' || node.type === 'fence') {
    return `+1 · ${formatLinearMeasurement(getWallCurveLength(node), unit)}`
  }
  if (node.type === 'item') {
    const [w, h, d] = getScaledDimensions(node)
    const value = (v: number) => formatLinearMeasurement(v, unit).replace(/[^\d.,'"]+$/, '')
    return `+1 · ${value(w)}×${value(d)}×${value(h)}`
  }
  return '+1'
}
