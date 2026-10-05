'use client'

import { characterStatus } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type AnimationAction, AnimationMixer, type Group, type Object3D, Vector3 } from 'three'
import useAvatarProfile, { useAvatarEmote } from '../../../store/use-avatar-profile'
import useWalkthroughView from '../../../store/use-walkthrough-view'
import { bodyStrideScale } from './avatar-body'
import { useAvatarLook } from './avatar-look'
import { useAvatarBody } from './avatar-rig'
import { EmoteLayer, useEmoteClips } from './emote-player'
import {
  advanceGaitPhase,
  airborneJumpTime,
  GAITS,
  type Gait,
  type JumpKind,
  locomotionWeights,
  runningJumpWeight,
  type Span,
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

/** Most the body leans (rad): into a curve, and forward when setting off. */
const MAX_TURN_LEAN = 0.12
const MAX_START_LEAN = 0.08
/**
 * Leaning into curves is a runner's: a walker barely tilts. It fades in
 * between these speeds (m/s); a walk start keeps a trace of the forward lean.
 */
const LEAN_FROM_SPEED = 2.5
const LEAN_FULL_SPEED = 4.5
const WALK_START_LEAN = 0.3
/** A velocity change faster than this (m/s²) is a respawn or a wall, not a curve. */
const MAX_CURVE_ACCELERATION = 40
const GRAVITY = 9.81

const worldPosition = new Vector3()

/** Turns the walker's bones over its animation each frame (an arm reaching for a high five). */
export type WalkthroughBodyOverlay = (model: Object3D, delta: number) => void

let bodyOverlay: WalkthroughBodyOverlay | null = null

/** Sets (or clears, with null) what poses the walker's body over its animation. */
export function setWalkthroughBodyOverlay(overlay: WalkthroughBodyOverlay | null) {
  bodyOverlay = overlay
}

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

/**
 * The walkthrough's third-person body: any Rocketbox avatar, whose idle, walk,
 * brisk walk, run and sprint motion-capture loops blend by the speed the
 * controller actually moves at — all sharing one gait phase driven by the
 * ground covered, so the feet stay planted at every speed. Motion-capture
 * jumps (on the spot, or out of a run) follow the controller's flight
 * (rising, top, falling, landing) and a crouch plays in place. The player's
 * look (face photo, hair, skin) dresses it, and an emote plays over it until
 * it ends or the player moves off.
 */
export function WalkthroughCharacter({
  feetOffset,
  visible,
}: {
  feetOffset: number
  visible: boolean
}) {
  const look = useAvatarProfile((state) => state.look)
  const { avatar, motion, model, clips, gaitSet } = useAvatarBody(
    useWalkthroughView((state) => state.character),
    bodyStrideScale(look.body),
  )
  useAvatarLook(model, look, avatar.id)
  const emoteClips = useEmoteClips(avatar, true)
  const rootRef = useRef<Group>(null)
  const lastPositionRef = useRef<Vector3 | null>(null)
  const leanRef = useRef({ vx: 0, vz: 0, curve: 0, speed: 0, acceleration: 0, roll: 0, pitch: 0 })
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

  const actions = useMemo<Actions | null>(() => {
    const mixer = new AnimationMixer(model)
    const found: Partial<Actions> = { mixer }
    for (const name of ['idle', ...GAITS, ...JUMP_KINDS, ...CROUCH_CLIPS] as const) {
      const clip = clips.find((animation) => animation.name === name)
      if (!clip) return null
      found[name] = mixer.clipAction(clip)
    }
    return found as Actions
  }, [clips, model])

  const emotes = useMemo(() => (actions ? new EmoteLayer(actions.mixer) : null), [actions])
  useEffect(() => emotes?.setClips(emoteClips), [emotes, emoteClips])

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
    // The ground the body actually covered drives the steps, so the feet can't
    // slide whatever the frame rate; a body that didn't move (against a wall)
    // or that jumped (respawn) doesn't step.
    let stepped = 0
    const last = lastPositionRef.current
    if (last) {
      const moved = Math.hypot(worldPosition.x - last.x, worldPosition.z - last.z)
      if (moved > STILL_DISTANCE && moved / delta <= TELEPORT_SPEED) stepped = moved
      last.copy(worldPosition)
    } else {
      lastPositionRef.current = worldPosition.clone()
    }
    speedRef.current +=
      (stepped / delta - speedRef.current) * (1 - Math.exp(-delta * SPEED_RESPONSE))
    const speed = speedRef.current

    // Lean like a runner: into a curve by the angle that balances it
    // (tan θ = sideways acceleration / g, from how the path itself bends — not
    // from the body snapping round to a new heading), and a little forward
    // while speeding up.
    const lean = leanRef.current
    const { x: vx, z: vz } = characterStatus.linvel
    const moving = Math.hypot(vx, vz)
    const dvx = (vx - lean.vx) / delta
    const dvz = (vz - lean.vz) / delta
    lean.vx = vx
    lean.vz = vz
    let sideways = 0
    if (moving > CROUCH_BREAK_SPEED && Math.hypot(dvx, dvz) < MAX_CURVE_ACCELERATION) {
      // Positive bends left (the body faces +Z, its left is +X).
      sideways = (vz * dvx - vx * dvz) / moving
    }
    lean.curve = approach(lean.curve, sideways, 10, delta)
    lean.acceleration = approach(lean.acceleration, (speed - lean.speed) / delta, 8, delta)
    lean.speed = speed
    const running = Math.min(
      1,
      Math.max(0, (speed - LEAN_FROM_SPEED) / (LEAN_FULL_SPEED - LEAN_FROM_SPEED)),
    )
    const onGround = characterStatus.isOnGround
    const rollTarget = onGround
      ? -Math.max(
          -MAX_TURN_LEAN,
          Math.min(MAX_TURN_LEAN, Math.atan(lean.curve / GRAVITY) * running),
        )
      : 0
    const pitchTarget = onGround
      ? Math.max(0, Math.min(MAX_START_LEAN, Math.atan(lean.acceleration / GRAVITY) * 0.6)) *
        (WALK_START_LEAN + (1 - WALK_START_LEAN) * running)
      : 0
    lean.roll = approach(lean.roll, rollTarget, 5, delta)
    lean.pitch = approach(lean.pitch, pitchTarget, 5, delta)
    root.rotation.set(lean.pitch, 0, lean.roll)

    // Locomotion.
    const gait = locomotionWeights(speed, gaitSet)
    phaseRef.current = advanceGaitPhase(phaseRef.current, stepped / delta, delta, gait.loopDistance)
    for (const name of GAITS) {
      actions[name].time = phaseRef.current * actions[name].getClip().duration
    }

    // Jump: follow the controller's flight — on the spot or out of a run,
    // by the speed it took off at.
    const jump = jumpRef.current
    const { jumps } = motion
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
    const { crouch: spans } = motion
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

    // An emote plays standing still: stepping off (as soon as a move is
    // asked for), jumping or crouching ends it.
    const cue = useAvatarEmote.getState().emote
    const busy =
      characterStatus.inputDir.lengthSq() > 0 ||
      speed > CROUCH_BREAK_SPEED ||
      jump.phase !== 'ground' ||
      crouch.phase !== 'standing'
    const emoteWeight = emotes ? emotes.update(cue, busy, delta) : 0
    if (cue && (busy || emotes?.finished(cue))) useAvatarEmote.getState().stop()

    // Layers: an emote overrides everything, then a jump, then a crouch over the gait.
    const rest = 1 - emoteWeight
    const jumpWeight = rest * jump.weight
    const crouchWeight = (rest - jumpWeight) * crouch.weight
    const gaitWeight = (rest - jumpWeight) * (1 - crouch.weight)
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
    bodyOverlay?.(model, delta)
  })

  return (
    <group position={[0, -feetOffset, 0]} ref={rootRef} visible={visible}>
      <primitive object={model} />
    </group>
  )
}
