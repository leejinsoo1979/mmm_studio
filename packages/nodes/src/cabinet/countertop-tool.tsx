'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { CountertopPreview } from './preview'
import { CountertopNode } from './schema'
import { defaultCountertop, useWallPlacement } from './tool'

/** Standard base-cabinet height (785 body + 65 toe kick): the slab sits on it. */
export const COUNTERTOP_ELEVATION_MM = 850

/** Registry tool for `tool === 'countertop'`. */
export default function CountertopTool() {
  const levelId = useViewer((s) => s.selection.levelId)
  const previewNode = useMemo(() => defaultCountertop(), [])
  const { cursorRef, visible } = useWallPlacement({
    levelId,
    footprintM: () => ({
      widthM: previewNode.lengthMm / 1000,
      depthM: previewNode.depthMm / 1000,
      elevationM: COUNTERTOP_ELEVATION_MM / 1000,
    }),
    facingDepthM: previewNode.depthMm / 1000,
    preview: (pose) =>
      ({
        ...previewNode,
        position: pose.position,
        rotation: [0, pose.rotationY, 0],
      }) as unknown as AnyNode,
    onCommit: (pose) => {
      if (!levelId) return
      const node = CountertopNode.parse({
        ...defaultCountertop(),
        id: undefined,
        position: pose.position,
        rotation: [0, pose.rotationY, 0],
      })
      useScene.getState().createNode(node as unknown as AnyNode, levelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [node.id as AnyNodeId] })
    },
  })
  if (!levelId) return null
  return (
    <group ref={cursorRef} visible={visible}>
      <CountertopPreview node={previewNode} />
    </group>
  )
}
