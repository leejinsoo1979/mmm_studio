'use client'

import { type LightNode, useRegistry } from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
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
  const glowScale = useMemo(() => {
    const intensity = active ? node.intensity : 0
    return Math.min(1.2, 0.42 + Math.sqrt(intensity) * 0.12)
  }, [active, node.intensity])
  const displayColor = active ? node.color : '#777777'

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
            <sphereGeometry args={[0.13, 24, 16]} />
            <meshBasicMaterial
              color={displayColor}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          {active && (
            <mesh scale={[glowScale, glowScale, glowScale]}>
              <sphereGeometry args={[0.38, 32, 20]} />
              <meshBasicMaterial
                color={node.color}
                depthTest={false}
                depthWrite={false}
                opacity={0.16}
                toneMapped={false}
                transparent
              />
            </mesh>
          )}
          {active && (
            <mesh scale={[glowScale * 1.65, glowScale * 1.65, glowScale * 1.65]}>
              <sphereGeometry args={[0.38, 32, 20]} />
              <meshBasicMaterial
                color={node.color}
                depthTest={false}
                depthWrite={false}
                opacity={0.055}
                toneMapped={false}
                transparent
              />
            </mesh>
          )}
          {node.kind === 'spot' && (
            <mesh position={[0, -0.22, 0]} rotation={[0, 0, Math.PI]}>
              <coneGeometry args={[0.2, 0.4, 20, 1, true]} />
              <meshBasicMaterial
                color={displayColor}
                opacity={active ? 0.34 : 0.16}
                toneMapped={false}
                transparent
                wireframe
              />
            </mesh>
          )}
          {node.kind === 'area' && (
            <mesh position={[0, 0, 0.02]}>
              <planeGeometry args={[node.width, node.height]} />
              <meshBasicMaterial
                color={displayColor}
                opacity={active ? 0.48 : 0.18}
                toneMapped={false}
                transparent
              />
            </mesh>
          )}
          {node.kind === 'area' && active && (
            <mesh position={[0, 0, 0.01]} scale={[1.08, 1.08, 1]}>
              <planeGeometry args={[node.width, node.height]} />
              <meshBasicMaterial
                color={node.color}
                depthWrite={false}
                opacity={0.16}
                toneMapped={false}
                transparent
              />
            </mesh>
          )}
        </group>
      )}
    </group>
  )
}

export default LightRenderer
