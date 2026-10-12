'use client'

import {
  advanceGaitPhase,
  bodyHeightScale,
  bodyStrideScale,
  type EmoteCue,
  EmoteLayer,
  GAITS,
  type Gait,
  lerpAngle,
  locomotionWeights,
  readAvatarLook,
  useAvatarBody,
  useAvatarLook,
  useEmoteClips,
} from '@pascal-app/editor'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  type AnimationAction,
  AnimationMixer,
  type Group,
  type Mesh,
  type Object3D,
  Vector3,
} from 'three'
import { useNpcDialogue } from '../dialogue/store'
import { npcPoses, npcWorldFeet, useNpcRuntime } from '../runtime/store'
import type { NpcNode } from '../schema'
import type { NpcPose } from '../types'
import { npcSpeaking } from '../voice/engine'
import {
  NPC_EMOTE_BREAK_SPEED,
  NPC_THROTTLED_STEP,
  NpcEmotePicker,
  nearestBodies,
  npcBodyDetail,
} from './animation'
import { HeadLook, MixerPose, openJaw } from './head-look'
import { NpcOverhead } from './overhead'

/** How quickly (1/s) the gait follows the pose's speed, and the body its facing. */
const SPEED_RESPONSE = 6
const TURN_RESPONSE = 8
/** Covering ground faster than this (m/s) between frames is a jump in the pose, not steps. */
const TELEPORT_SPEED = 12

/**
 * What another module adds to a live NPC body each frame, keyed by NPC id:
 * the social acts and the chase set an entry and delete it when done.
 */
export type NpcBodyOverlay = {
  /** Offset (m, level-local) of the whole body from its pose's feet, e.g. a startled hop. */
  root?: readonly [number, number, number]
  /**
   * Turns bones over the animation, e.g. an arm reaching for a hand. Runs only
   * on frames the animation advanced (the bones hold this frame's animated
   * pose), after the head look and the jaw; the body takes the turns off again
   * before its next animation update.
   */
  pose?: (model: Object3D, delta: number) => void
}

export const npcBodyOverlays = new Map<string, NpcBodyOverlay>()

const NO_RAYCAST = () => {}

/** The NPC is picked by its proxy and capsule; a skinned mesh is slow to raycast, and in its bind pose. */
function useUnpickable(model: Object3D) {
  useEffect(() => {
    model.traverse((object) => {
      if ((object as Mesh).isMesh) object.raycast = NO_RAYCAST
    })
  }, [model])
}

/** Camera distance of every body that animates this frame, for the per-frame budget. */
const animating = new Map<string, number>()
let rankedAt = Number.NaN
let ranked = new Set<string>()

/** Whether a body is among the nearest this frame (`frame` tells frames apart). */
function inBudget(id: string, frame: number) {
  if (frame !== rankedAt) {
    rankedAt = frame
    ranked = nearestBodies(animating)
  }
  return ranked.has(id)
}

/** A line on screen or in the air: its own voice, the local conversation, or a line in a talk. */
function isSpeaking(id: string, pose: NpcPose | undefined, now: number) {
  if (npcSpeaking.has(id)) return true
  const dialogue = useNpcDialogue.getState()
  if (dialogue.npcId === id && dialogue.line) return true
  const bubble = useNpcRuntime.getState().bubbles[id]
  return pose?.state === 'talk' && bubble !== undefined && bubble.until > now
}

function useNpcLook(node: NpcNode) {
  const look = useMemo(() => readAvatarLook(node.look), [node.look])
  return {
    look,
    heightScale: bodyHeightScale(look.body),
    strideScale: bodyStrideScale(look.body),
  }
}

/** Where it was placed, in the first frame of its idle: no animating in build mode. */
function StaticBody({ node }: { node: NpcNode }) {
  const { look, strideScale } = useNpcLook(node)
  const { avatar, model, clips } = useAvatarBody(node.avatar, strideScale)
  useAvatarLook(model, look, avatar.id)
  useUnpickable(model)

  useLayoutEffect(() => {
    const idle = clips.find((clip) => clip.name === 'idle')
    if (!idle) return
    const mixer = new AnimationMixer(model)
    mixer.clipAction(idle).play()
    mixer.update(0)
    return () => {
      mixer.stopAllAction()
    }
  }, [clips, model])

  return <primitive object={model} />
}

type Actions = { mixer: AnimationMixer } & Record<'idle' | Gait, AnimationAction>

const feet = new Vector3()
const eye = new Vector3()
const lookAt = new Vector3()

function LiveBody({ node }: { node: NpcNode }) {
  const { look, heightScale, strideScale } = useNpcLook(node)
  const { avatar, model, clips, gaitSet } = useAvatarBody(node.avatar, strideScale)
  useAvatarLook(model, look, avatar.id)
  useUnpickable(model)
  const [emoted, setEmoted] = useState(false)
  const emoteClips = useEmoteClips(avatar, emoted)
  const rootRef = useRef<Group>(null)
  const motionRef = useRef({
    placed: false,
    /** Where the last animated frame had the feet (NaN: nowhere to step from). */
    x: Number.NaN,
    z: 0,
    yaw: 0,
    speed: 0,
    phase: 0,
    /** Seconds not yet played while out of the frame budget. */
    pending: 0,
    speakingSince: null as number | null,
  })
  const picker = useMemo(() => new NpcEmotePicker(), [])

  const actions = useMemo<Actions | null>(() => {
    const mixer = new AnimationMixer(model)
    const found: Partial<Actions> = { mixer }
    for (const name of ['idle', ...GAITS] as const) {
      const clip = clips.find((animation) => animation.name === name)
      if (!clip) return null
      found[name] = mixer.clipAction(clip)
    }
    return found as Actions
  }, [clips, model])

  const emotes = useMemo(() => (actions ? new EmoteLayer(actions.mixer) : null), [actions])
  useEffect(() => emotes?.setClips(emoteClips), [emotes, emoteClips])

  useEffect(() => {
    if (!actions) return
    const { mixer, ...rest } = actions
    for (const action of Object.values(rest)) {
      action.play()
      action.setEffectiveWeight(0)
      action.timeScale = 0
    }
    actions.idle.timeScale = 1
    actions.idle.setEffectiveWeight(1)
    return () => {
      mixer.stopAllAction()
    }
  }, [actions])

  const rig = useMemo(
    () => ({
      animated: new MixerPose(model),
      look: new HeadLook(
        model.getObjectByName('Bip01_Neck') ?? null,
        model.getObjectByName('Bip01_Head') ?? null,
      ),
      jaw: model.getObjectByName('Bip01_MJaw') ?? null,
    }),
    [model],
  )

  const id = node.id
  useEffect(
    () => () => {
      npcWorldFeet.delete(id)
      animating.delete(id)
    },
    [id],
  )

  useFrame((state, delta) => {
    const root = rootRef.current
    if (!(root && actions) || delta <= 0) return
    const pose = npcPoses.get(id)
    const x = pose ? pose.p[0] : node.position[0]
    const z = pose ? pose.p[1] : node.position[2]
    const overlay = npcBodyOverlays.get(id)
    const [dx, dy, dz] = overlay?.root ?? [0, 0, 0]
    root.position.set(x + dx, (pose ? pose.y : node.position[1]) + dy, z + dz)
    const motion = motionRef.current
    const yaw = pose ? pose.yaw : node.rotation
    motion.yaw = motion.placed
      ? lerpAngle(motion.yaw, yaw, 1 - Math.exp(-delta * TURN_RESPONSE))
      : yaw
    motion.placed = true
    root.rotation.y = motion.yaw

    // Level of detail by the camera's distance: near bodies animate (the
    // nearest every frame, the rest at a lower rate), further ones hold
    // their pose, the furthest aren't drawn.
    root.getWorldPosition(feet)
    const distance = feet.distanceTo(state.camera.getWorldPosition(eye))
    const detail = pose?.visible === false ? 'hidden' : npcBodyDetail(distance)
    root.visible = detail !== 'hidden'
    if (detail === 'hidden') npcWorldFeet.delete(id)
    else npcWorldFeet.set(id, [feet.x, feet.y, feet.z])
    if (detail !== 'animated') {
      animating.delete(id)
      motion.pending = 0
      motion.x = Number.NaN
      return
    }
    animating.set(id, distance)
    motion.pending += delta
    if (!inBudget(id, state.clock.elapsedTime) && motion.pending < NPC_THROTTLED_STEP) return
    const step = motion.pending
    motion.pending = 0

    // The steps follow the ground actually covered, so the feet never slide.
    let stepped = 0
    if (!Number.isNaN(motion.x)) {
      const moved = Math.hypot(x - motion.x, z - motion.z)
      if (moved / step < TELEPORT_SPEED) stepped = moved
    }
    motion.x = x
    motion.z = z
    motion.speed += ((pose?.speed ?? 0) - motion.speed) * (1 - Math.exp(-step * SPEED_RESPONSE))

    const now = Date.now()
    motion.speakingSince = isSpeaking(id, pose, now) ? (motion.speakingSince ?? now) : null
    const own = pose?.emote ?? null
    const cue = picker.pick({
      cue: own,
      speakingSince: motion.speakingSince,
      presenter: node.role === 'guide',
      now,
    })
    if (cue && !emoted) setEmoted(true)
    const walking = motion.speed > NPC_EMOTE_BREAK_SPEED
    const rest = 1 - (emotes ? emotes.update(cue as EmoteCue | null, walking, step) : 0)
    if (own && emotes?.finished(own as EmoteCue)) picker.finish(own)

    const weights = locomotionWeights(motion.speed, gaitSet)
    motion.phase = advanceGaitPhase(motion.phase, stepped / step, step, weights.loopDistance)
    actions.idle.setEffectiveWeight(rest * weights.idle)
    for (const gait of GAITS) {
      actions[gait].setEffectiveWeight(rest * weights[gait])
      actions[gait].time = motion.phase * actions[gait].getClip().duration
    }
    rig.animated.restore()
    actions.mixer.update(step)
    rig.animated.keep()

    rig.look.update(root, pose?.lookAt ? lookAt.fromArray(pose.lookAt) : null, step)
    if (rig.jaw) openJaw(rig.jaw, npcSpeaking.get(id)?.level ?? 0)
    overlay?.pose?.(model, step)
  })

  // The top of the head sits at about twice the hip height.
  const labelHeight = avatar.hip * 2 * heightScale + 0.08

  return (
    <group ref={rootRef}>
      <primitive object={model} />
      <NpcOverhead height={labelHeight} node={node} />
    </group>
  )
}

/**
 * An NPC's Rocketbox body in its look. `static`: standing where it was
 * placed (build mode, inside the marker). `live`: in level-local space where
 * the system poses it each frame (`npcPoses`), blending idle and the gaits by
 * the pose's speed, playing its emotes and a talk while it speaks, turning its
 * head to what it looks at and moving its jaw with its voice; it reports its
 * feet to `npcWorldFeet` and carries its name tag and bubble.
 */
export function NpcBody({ node, mode }: { node: NpcNode; mode: 'static' | 'live' }) {
  return mode === 'live' ? <LiveBody node={node} /> : <StaticBody node={node} />
}
