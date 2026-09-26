'use client'

import { ElectricPanelNode } from '@pascal-app/core'
import { useCallback } from 'react'
import { type WallMount, WallMountTool } from '../shared/wall-mount-tool'
import { PANEL_BOX } from './geometry'

/** Click near a wall: the 분전반 mounts on its face, centred 1.5 m up. */
export default function ElectricPanelTool() {
  const build = useCallback(
    (m: WallMount) =>
      ElectricPanelNode.parse({
        name: '분전반',
        position: m.position,
        rotation: [0, m.rotationY, 0],
      }),
    [],
  )
  return (
    <WallMountTool
      build={build}
      depthM={PANEL_BOX.depth}
      heightM={1.5}
      preview={() => (
        <mesh position={[0, 0, PANEL_BOX.depth / 2]}>
          <boxGeometry args={[PANEL_BOX.width, PANEL_BOX.height, PANEL_BOX.depth]} />
          <meshBasicMaterial color="#adb5bd" opacity={0.7} transparent />
        </mesh>
      )}
      widthM={PANEL_BOX.width}
    />
  )
}
