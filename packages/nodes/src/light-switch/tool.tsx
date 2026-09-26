'use client'

import { LightSwitchNode } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useCallback } from 'react'
import { type WallMount, WallMountTool } from '../shared/wall-mount-tool'
import { SWITCH_PLATE } from './geometry'

type SwitchToolDefaults = { gangs?: number; heightM?: number }

/** Click near a wall: the switch mounts on its face at 1.2 m. */
export default function LightSwitchTool() {
  const defaults = useEditor((s) => s.toolDefaults['light-switch'] ?? {}) as SwitchToolDefaults
  const gangs = Math.min(3, Math.max(1, defaults.gangs ?? 1))
  const heightM = defaults.heightM ?? 1.2
  const build = useCallback(
    (m: WallMount) =>
      LightSwitchNode.parse({
        name: `스위치 ${gangs}구`,
        gangs,
        on: Array.from({ length: gangs }, () => false),
        position: m.position,
        rotation: [0, m.rotationY, 0],
      }),
    [gangs],
  )
  return (
    <WallMountTool
      build={build}
      depthM={SWITCH_PLATE.depth}
      heightM={heightM}
      preview={() => (
        <mesh position={[0, 0, SWITCH_PLATE.depth / 2]}>
          <boxGeometry args={[SWITCH_PLATE.width, SWITCH_PLATE.height, SWITCH_PLATE.depth]} />
          <meshBasicMaterial color="#ffd166" opacity={0.7} transparent />
        </mesh>
      )}
      widthM={SWITCH_PLATE.width}
    />
  )
}
