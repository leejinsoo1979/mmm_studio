import { type AnyNodeId, useScene } from '@pascal-app/core'

/** 1-based position of a node among its parent's children of the same type,
 *  for numbered default names ('벽 1', '문 2'). */
export function useSiblingNumber(nodeId: AnyNodeId): number {
  return useScene((s) => {
    const node = s.nodes[nodeId]
    const parent = node?.parentId ? s.nodes[node.parentId as AnyNodeId] : undefined
    const siblings = parent && 'children' in parent ? (parent.children as AnyNodeId[]) : []
    const sameType = siblings.filter((id) => s.nodes[id]?.type === node?.type)
    return sameType.indexOf(nodeId) + 1
  })
}
