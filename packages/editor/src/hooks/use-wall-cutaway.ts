import { sceneRegistry } from '@pascal-app/core'
import { isWallCutaway } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useState } from 'react'

/**
 * Whether the wall currently shows as its low cutaway stub. The cut follows
 * the camera, so it is polled per frame; only a flip re-renders.
 */
export function useWallCutaway(wallId: string | null | undefined): boolean {
  const [cutaway, setCutaway] = useState(false)
  useFrame(() => {
    const next = wallId ? isWallCutaway(sceneRegistry.nodes.get(wallId)) : false
    if (next !== cutaway) setCutaway(next)
  })
  return cutaway
}
