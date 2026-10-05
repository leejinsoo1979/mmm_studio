'use client'

import { OVERLAY_LAYER } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, Vector3 } from 'three'
import { NPC_ROLE_COLORS } from '../presets'
import type { NpcNode } from '../schema'

/** Just above the floor, so the guides don't flicker in it. */
const LIFT = 0.03
const RING_WIDTH = 0.05
const POINT_RADIUS = 0.12

/**
 * What a selected NPC does when it isn't talked to: the circle it wanders in,
 * or the path it patrols. Mounted inside the NPC's marker group, it undoes the
 * marker's turn and XZ placement, so its shapes sit where they are in the
 * level (and ride the marker's floor lift).
 */
export function NpcEditOverlay({
  node,
  position,
  rotation,
}: {
  node: NpcNode
  position: readonly [number, number, number]
  rotation: number
}) {
  const color = NPC_ROLE_COLORS[node.role]
  const { mode, wanderRadius, patrol, patrolLoop } = node.behavior

  const path = useMemo(() => {
    if (mode !== 'patrol' || patrol.length < 2) return null
    const points = patrol.map(([x, z]) => new Vector3(x, LIFT, z))
    if (patrolLoop === 'loop' && points.length > 2) points.push(points[0]!.clone())
    return new BufferGeometry().setFromPoints(points)
  }, [mode, patrol, patrolLoop])
  useEffect(() => () => path?.dispose(), [path])

  return (
    <group rotation={[0, -rotation, 0]}>
      <group position={[-position[0], 0, -position[2]]}>
        {mode === 'wander' && (
          <group position={[position[0], LIFT, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh layers={OVERLAY_LAYER} renderOrder={1}>
              <circleGeometry args={[wanderRadius, 64]} />
              <meshBasicMaterial
                color={color}
                depthTest={false}
                depthWrite={false}
                opacity={0.08}
                transparent
              />
            </mesh>
            <mesh layers={OVERLAY_LAYER} renderOrder={2}>
              <ringGeometry args={[Math.max(0, wanderRadius - RING_WIDTH), wanderRadius, 96]} />
              <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent />
            </mesh>
          </group>
        )}
        {path && (
          // @ts-expect-error - R3F accepts Three line primitives, as the editor's drawing tools do.
          <line frustumCulled={false} geometry={path} layers={OVERLAY_LAYER} renderOrder={2}>
            <lineBasicNodeMaterial
              color={color}
              depthTest={false}
              depthWrite={false}
              linewidth={2}
              opacity={0.95}
              transparent
            />
          </line>
        )}
        {mode === 'patrol' &&
          patrol.map(([x, z], index) => (
            <mesh
              key={`patrol-point-${index}`}
              layers={OVERLAY_LAYER}
              position={[x, LIFT, z]}
              renderOrder={3}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <circleGeometry args={[index === 0 ? POINT_RADIUS * 1.4 : POINT_RADIUS, 24]} />
              <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent />
            </mesh>
          ))}
      </group>
    </group>
  )
}
