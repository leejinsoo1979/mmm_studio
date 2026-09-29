'use client'

import { useGLTF } from '@react-three/drei/core/Gltf'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  type AnimationAction,
  AnimationMixer,
  type Group,
  type Material,
  type Mesh,
  type Object3D,
  Vector3,
} from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import useWalkthroughView from '../../../store/use-walkthrough-view'
import { advanceGaitPhase, locomotionWeights, WALKTHROUGH_CHARACTERS } from './locomotion'

/** A frame-to-frame jump faster than this (m/s) is a respawn or ride, not a step. */
const TELEPORT_SPEED = 12
/** How quickly (1/s) the gait follows the body's measured speed. */
const SPEED_RESPONSE = 10

const worldPosition = new Vector3()

type Gait = {
  mixer: AnimationMixer
  idle: AnimationAction
  walk: AnimationAction
  run: AnimationAction
}

function prepareModel(source: Object3D): Object3D {
  const model = cloneSkinned(source)
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Skinned bounds follow the bind pose, not the animated body.
    mesh.frustumCulled = false
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]
    for (const material of materials) {
      // Hair and lashes are alpha cards: cut them out instead of sorting them.
      if (material.transparent) {
        material.transparent = false
        material.alphaTest = 0.4
        material.depthWrite = true
      }
    }
  })
  return model
}

/**
 * The walkthrough's third-person body: a Rocketbox avatar whose idle, walk and
 * run motion-capture loops blend by the speed the controller actually moves
 * at, with the walk and run sharing one gait phase driven by the ground
 * covered — so the feet stay planted at every speed.
 */
export function WalkthroughCharacter({
  feetOffset,
  visible,
}: {
  feetOffset: number
  visible: boolean
}) {
  const characterId = useWalkthroughView((state) => state.character)
  const character = WALKTHROUGH_CHARACTERS[characterId]
  const gltf = useGLTF(character.url)
  const rootRef = useRef<Group>(null)
  const lastPositionRef = useRef<Vector3 | null>(null)
  const speedRef = useRef(0)
  const phaseRef = useRef(0)

  const model = useMemo(() => prepareModel(gltf.scene), [gltf.scene])

  const gait = useMemo<Gait | null>(() => {
    const clip = (name: string) => gltf.animations.find((animation) => animation.name === name)
    const idleClip = clip('idle')
    const walkClip = clip('walk')
    const runClip = clip('run')
    if (!(idleClip && walkClip && runClip)) return null
    const mixer = new AnimationMixer(model)
    return {
      mixer,
      idle: mixer.clipAction(idleClip),
      walk: mixer.clipAction(walkClip),
      run: mixer.clipAction(runClip),
    }
  }, [gltf.animations, model])

  // Started here rather than in the memo so a remount (StrictMode) restarts
  // the actions its cleanup stopped.
  useEffect(() => {
    if (!gait) return
    for (const action of [gait.idle, gait.walk, gait.run]) {
      action.play()
      action.setEffectiveWeight(0)
    }
    gait.idle.setEffectiveWeight(1)
    // Walk and run are posed from the shared gait phase, not by the clock.
    gait.walk.timeScale = 0
    gait.run.timeScale = 0
    return () => {
      gait.mixer.stopAllAction()
    }
  }, [gait])

  useFrame((_, delta) => {
    const root = rootRef.current
    if (!(root && gait) || delta <= 0) return

    root.getWorldPosition(worldPosition)
    let measured = 0
    const last = lastPositionRef.current
    if (last) {
      measured = Math.hypot(worldPosition.x - last.x, worldPosition.z - last.z) / delta
      if (measured > TELEPORT_SPEED) measured = 0
      last.copy(worldPosition)
    } else {
      lastPositionRef.current = worldPosition.clone()
    }
    speedRef.current += (measured - speedRef.current) * (1 - Math.exp(-delta * SPEED_RESPONSE))

    const speed = speedRef.current
    const weights = locomotionWeights(speed)
    phaseRef.current = advanceGaitPhase(phaseRef.current, speed, delta, character, weights.runBlend)

    gait.idle.setEffectiveWeight(weights.idle)
    gait.walk.setEffectiveWeight(weights.walk)
    gait.run.setEffectiveWeight(weights.run)
    gait.walk.time = phaseRef.current * gait.walk.getClip().duration
    gait.run.time = phaseRef.current * gait.run.getClip().duration
    gait.mixer.update(delta)
  })

  return (
    <group position={[0, -feetOffset, 0]} ref={rootRef} visible={visible}>
      <primitive object={model} />
    </group>
  )
}
