'use client'

import { characterStatus } from '@pascal-app/viewer'
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
import {
  advanceGaitPhase,
  airborneJumpTime,
  GAITS,
  type Gait,
  type JumpKind,
  locomotionWeights,
  runningJumpWeight,
  type Span,
  WALKTHROUGH_CHARACTERS,
} from './locomotion'

/** A frame-to-frame jump faster than this (m/s) is a respawn or ride, not a step. */
const TELEPORT_SPEED = 12
/** Moving less than this (m) in a frame is standing still. */
const STILL_DISTANCE = 0.0005
/** How quickly (1/s) the gait follows the body's measured speed. */
const SPEED_RESPONSE = 10
/**
 * The floating controller loses the ground for a moment on stair noses and
 * slope changes; only a launch or a longer drop counts as being in the air.
 */
const AIRBORNE_DELAY = 0.12
const LAUNCH_SPEED = 0.8
/** Crouching and standing up play this much faster than the capture. */
const CROUCH_SPEEDUP = 1.3
/** Moving faster than this (m/s) while crouched stands the body straight up. */
const CROUCH_BREAK_SPEED = 0.5

const worldPosition = new Vector3()

const JUMP_KINDS: JumpKind[] = ['jump', 'jumpRun']

type CrouchClip = 'crouchIn' | 'crouchIdle' | 'crouchOut'
const CROUCH_CLIPS: CrouchClip[] = ['crouchIn', 'crouchIdle', 'crouchOut']

type Actions = { mixer: AnimationMixer } & Record<
  'idle' | Gait | JumpKind | CrouchClip,
  AnimationAction
>

type JumpState = {
  phase: 'ground' | 'air' | 'landing'
  unsupported: number
  launchSpeed: number
  takeoffY: number
  peak: number
  /** How much of this jump is the running jump, fixed at take-off. */
  running: number
  /** Progress (0–1) through the landing recovery. */
  landing: number
  times: Record<JumpKind, number>
  weight: number
}

type CrouchState = {
  phase: 'standing' | 'down' | 'held' | 'up'
  progress: number
  weight: number
  clips: Record<CrouchClip, number>
}

const approach = (value: number, target: number, rate: number, delta: number) =>
  value + (target - value) * (1 - Math.exp(-rate * delta))

const spanTime = (span: Span, progress: number) => span.from + (span.to - span.from) * progress

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
 * The walkthrough's third-person body: a Rocketbox avatar whose idle, walk,
 * brisk walk, run and sprint motion-capture loops blend by the speed the
 * controller actually moves at — all sharing one gait phase driven by the
 * ground covered, so the feet stay planted at every speed. Motion-capture
 * jumps (on the spot, or out of a run) follow the controller's flight
 * (rising, top, falling, landing) and a crouch plays in place.
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
  const jumpRef = useRef<JumpState>({
    phase: 'ground',
    unsupported: 0,
    launchSpeed: 0,
    takeoffY: 0,
    peak: 0,
    running: 0,
    landing: 0,
    times: { jump: 0, jumpRun: 0 },
    weight: 0,
  })
  const crouchRef = useRef<CrouchState>({
    phase: 'standing',
    progress: 0,
    weight: 0,
    clips: { crouchIn: 1, crouchIdle: 0, crouchOut: 0 },
  })

  const model = useMemo(() => prepareModel(gltf.scene), [gltf.scene])

  const actions = useMemo<Actions | null>(() => {
    const mixer = new AnimationMixer(model)
    const found: Partial<Actions> = { mixer }
    for (const name of ['idle', ...GAITS, ...JUMP_KINDS, ...CROUCH_CLIPS] as const) {
      const clip = gltf.animations.find((animation) => animation.name === name)
      if (!clip) return null
      found[name] = mixer.clipAction(clip)
    }
    return found as Actions
  }, [gltf.animations, model])

  // Started here rather than in the memo so a remount (StrictMode) restarts
  // the actions its cleanup stopped.
  useEffect(() => {
    if (!actions) return
    const { mixer, ...clips } = actions
    for (const action of Object.values(clips)) {
      action.play()
      action.setEffectiveWeight(0)
      // Posed by hand from the gait phase, the flight or the crouch progress.
      action.timeScale = 0
    }
    actions.idle.timeScale = 1
    actions.crouchIdle.timeScale = 1
    actions.idle.setEffectiveWeight(1)
    return () => {
      mixer.stopAllAction()
    }
  }, [actions])

  useFrame((_, delta) => {
    const root = rootRef.current
    if (!(root && actions) || delta <= 0) return

    root.getWorldPosition(worldPosition)
    // The controller's own velocity drives the gait (its physics step is
    // capped, so on a slow frame the body covers less than delta implies); a
    // body that didn't actually move — against a wall, paused on a ride — or
    // that jumped (respawn) doesn't step.
    let measured = 0
    const last = lastPositionRef.current
    if (last) {
      const moved = Math.hypot(worldPosition.x - last.x, worldPosition.z - last.z)
      if (moved > STILL_DISTANCE && moved / delta <= TELEPORT_SPEED) {
        measured = Math.hypot(characterStatus.linvel.x, characterStatus.linvel.z)
      }
      last.copy(worldPosition)
    } else {
      lastPositionRef.current = worldPosition.clone()
    }
    speedRef.current += (measured - speedRef.current) * (1 - Math.exp(-delta * SPEED_RESPONSE))
    const speed = speedRef.current

    // Locomotion.
    const gait = locomotionWeights(speed, character)
    phaseRef.current = advanceGaitPhase(phaseRef.current, speed, delta, gait.loopDistance)
    for (const name of GAITS) {
      actions[name].time = phaseRef.current * actions[name].getClip().duration
    }

    // Jump: follow the controller's flight — on the spot or out of a run,
    // by the speed it took off at.
    const jump = jumpRef.current
    const { jumps } = character
    const verticalSpeed = characterStatus.linvel.y
    const grounded = characterStatus.isOnGround
    jump.unsupported = grounded ? 0 : jump.unsupported + delta
    if (jump.phase !== 'air') {
      const launched = !grounded && verticalSpeed > LAUNCH_SPEED
      if (launched || jump.unsupported > AIRBORNE_DELAY) {
        jump.phase = 'air'
        jump.launchSpeed = launched ? verticalSpeed : 0
        jump.takeoffY = worldPosition.y
        jump.peak = 0
        jump.running = runningJumpWeight(speed)
      }
    }
    if (jump.phase === 'air') {
      if (grounded) {
        jump.phase = 'landing'
        jump.landing = 0
      } else {
        const height = worldPosition.y - jump.takeoffY
        jump.peak = Math.max(jump.peak, height)
        for (const kind of JUMP_KINDS) {
          jump.times[kind] = airborneJumpTime(jumps[kind], {
            launchSpeed: jump.launchSpeed,
            verticalSpeed,
            height,
            peak: jump.peak,
          })
        }
      }
    }
    if (jump.phase === 'landing') {
      const recovery =
        jumps.jump.end -
        jumps.jump.land +
        (jumps.jumpRun.end - jumps.jumpRun.land - (jumps.jump.end - jumps.jump.land)) * jump.running
      // Moving on out of a landing cuts the recovery short.
      jump.landing += (delta * (speed > CROUCH_BREAK_SPEED ? 1.8 : 1)) / recovery
      if (jump.landing >= 1) jump.phase = 'ground'
      for (const kind of JUMP_KINDS) {
        const marks = jumps[kind]
        jump.times[kind] = marks.land + (marks.end - marks.land) * Math.min(1, jump.landing)
      }
    }
    const jumpTarget =
      jump.phase === 'air' ||
      (jump.phase === 'landing' && (speed <= CROUCH_BREAK_SPEED || jump.landing < 0.3))
        ? 1
        : 0
    jump.weight = approach(jump.weight, jumpTarget, jumpTarget ? 18 : 8, delta)
    for (const kind of JUMP_KINDS) {
      actions[kind].time = Math.min(jump.times[kind], actions[kind].getClip().duration)
    }

    // Crouch: down, hold, up — any step or flight stands straight back up.
    const crouch = crouchRef.current
    const { crouch: spans } = character
    const wantsCrouch = useWalkthroughView.getState().crouching
    if (jump.phase !== 'ground' || speed > CROUCH_BREAK_SPEED) {
      crouch.phase = 'standing'
    } else if (wantsCrouch && (crouch.phase === 'standing' || crouch.phase === 'up')) {
      crouch.progress = crouch.phase === 'up' ? 1 - crouch.progress : 0
      crouch.phase = 'down'
    } else if (!wantsCrouch && (crouch.phase === 'down' || crouch.phase === 'held')) {
      crouch.progress = crouch.phase === 'down' ? 1 - crouch.progress : 0
      crouch.phase = 'up'
    }
    if (crouch.phase === 'down' || crouch.phase === 'up') {
      const span = crouch.phase === 'down' ? spans.down : spans.up
      crouch.progress += (delta * CROUCH_SPEEDUP) / (span.to - span.from)
      if (crouch.progress >= 1) {
        crouch.progress = 1
        crouch.phase = crouch.phase === 'down' ? 'held' : 'standing'
      }
    }
    actions.crouchIn.time = spanTime(spans.down, crouch.phase === 'down' ? crouch.progress : 1)
    actions.crouchOut.time = spanTime(spans.up, crouch.phase === 'up' ? crouch.progress : 1)
    const activeClip: CrouchClip | null =
      crouch.phase === 'down'
        ? 'crouchIn'
        : crouch.phase === 'held'
          ? 'crouchIdle'
          : crouch.phase === 'up'
            ? 'crouchOut'
            : null
    let clipTotal = 0
    for (const clip of CROUCH_CLIPS) {
      if (activeClip) {
        crouch.clips[clip] = approach(crouch.clips[clip], clip === activeClip ? 1 : 0, 12, delta)
      }
      clipTotal += crouch.clips[clip]
    }
    // Standing up from the clip's last frame (already a standing pose) is
    // gentle; a step out of a crouch snaps up quicker.
    const crouchTarget = crouch.phase === 'standing' ? 0 : 1
    crouch.weight = approach(crouch.weight, crouchTarget, crouchTarget ? 16 : 9, delta)

    // Layers: a jump overrides everything, a crouch overrides the gait.
    const jumpWeight = jump.weight
    const crouchWeight = (1 - jumpWeight) * crouch.weight
    const gaitWeight = (1 - jumpWeight) * (1 - crouch.weight)
    actions.jump.setEffectiveWeight(jumpWeight * (1 - jump.running))
    actions.jumpRun.setEffectiveWeight(jumpWeight * jump.running)
    for (const clip of CROUCH_CLIPS) {
      actions[clip].setEffectiveWeight(
        clipTotal > 0 ? (crouchWeight * crouch.clips[clip]) / clipTotal : 0,
      )
    }
    actions.idle.setEffectiveWeight(gaitWeight * gait.idle)
    for (const name of GAITS) actions[name].setEffectiveWeight(gaitWeight * gait[name])
    actions.mixer.update(delta)
  })

  return (
    <group position={[0, -feetOffset, 0]} ref={rootRef} visible={visible}>
      <primitive object={model} />
    </group>
  )
}
