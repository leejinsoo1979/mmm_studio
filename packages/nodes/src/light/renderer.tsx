'use client'

import { type LightNode, useRegistry } from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import type { Group, SpotLight } from 'three'

const LightRenderer = ({ node }: { node: LightNode }) => {
  const groupRef = useRef<Group>(null!)
  const spotRef = useRef<SpotLight>(null)
  const handlers = useNodeEvents(node, 'light')
  const walkthroughMode = useViewer((state) => state.walkthroughMode)
  const shadows = useViewer((state) => state.shadows)
  useRegistry(node.id, 'light', groupRef)

  useEffect(() => {
    const light = spotRef.current
    const group = groupRef.current
    if (!(light && group)) return
    light.target.position.set(0, -1, 0)
    group.add(light.target)
    return () => {
      group.remove(light.target)
    }
  }, [])

  const active = node.visible !== false && node.enabled
  const castShadow = active && shadows && node.castShadow && node.kind !== 'area'

  return (
    <group
      position={node.position}
      ref={groupRef}
      rotation={node.rotation}
      visible={node.visible !== false}
    >
      {node.kind === 'point' && (
        <pointLight
          castShadow={castShadow}
          color={node.color}
          decay={node.decay}
          distance={node.distance}
          intensity={active ? node.intensity : 0}
          shadow-mapSize={[1024, 1024]}
        />
      )}
      {node.kind === 'spot' && (
        <spotLight
          angle={node.angle}
          castShadow={castShadow}
          color={node.color}
          decay={node.decay}
          distance={node.distance}
          intensity={active ? node.intensity : 0}
          penumbra={node.penumbra}
          ref={spotRef}
          shadow-mapSize={[1024, 1024]}
        />
      )}
      {node.kind === 'area' && (
        <rectAreaLight
          color={node.color}
          height={node.height}
          intensity={active ? node.intensity : 0}
          width={node.width}
        />
      )}

      {!walkthroughMode && (
        <group {...handlers}>
          <mesh>
            <sphereGeometry args={[0.12, 16, 12]} />
            <meshBasicMaterial color={node.color} depthTest={false} toneMapped={false} />
          </mesh>
          {node.kind === 'spot' && (
            <mesh position={[0, -0.22, 0]} rotation={[0, 0, Math.PI]}>
              <coneGeometry args={[0.2, 0.4, 20, 1, true]} />
              <meshBasicMaterial color={node.color} opacity={0.32} transparent wireframe />
            </mesh>
          )}
          {node.kind === 'area' && (
            <mesh position={[0, 0, 0.02]}>
              <planeGeometry args={[node.width, node.height]} />
              <meshBasicMaterial color={node.color} opacity={0.22} transparent wireframe />
            </mesh>
          )}
        </group>
      )}
    </group>
  )
}

export default LightRenderer
