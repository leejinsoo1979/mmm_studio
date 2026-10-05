'use client'

import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { type AnimationAction, AnimationMixer, type Group } from 'three'
import type { AvatarLook } from '../../store/use-avatar-profile'
import { bodyHeightScale, bodyStrideScale } from './first-person/avatar-body'
import { useAvatarLook } from './first-person/avatar-look'
import { useAvatarBody } from './first-person/avatar-rig'
import { EmoteLayer, useEmoteClips } from './first-person/emote-player'
import type { EmoteCue } from './first-person/emotes'
import { advanceGaitPhase, GAITS, type Gait, locomotionWeights } from './first-person/locomotion'
import {
  lerpAngle,
  PRESENCE_DELAY,
  type PresencePose,
  type PresenceSample,
  pushPresenceSample,
  type RemotePresence,
  samplePresence,
} from './first-person/presence'

/** How long a chat line floats over its speaker (ms). */
const BUBBLE_TIME = 6000
/** How quickly (1/s) a remote body's gait and heading follow its drawn motion. */
const SPEED_RESPONSE = 6
const TURN_RESPONSE = 10

type Player = { id: string; name: string; avatar: string; look: AvatarLook | null }
type Bubble = { text: string; until: number }

/** Every other player's latest reports, while `RemotePlayers` is mounted. */
const presenceSamples = new Map<string, PresenceSample[]>()

/** Another player where their body is drawn right now: world feet and facing. */
export type RemotePlayerPose = PresencePose & { id: string }

/** Where the player `id` is drawn right now, or null when they aren't here. */
export function getRemotePlayerPose(id: string): PresencePose | null {
  const buffer = presenceSamples.get(id)
  return buffer ? samplePresence(buffer, performance.now() - PRESENCE_DELAY) : null
}

/** Every other player where their body is drawn right now. */
export function listRemotePlayerPoses(): RemotePlayerPose[] {
  const time = performance.now() - PRESENCE_DELAY
  const poses: RemotePlayerPose[] = []
  for (const [id, buffer] of presenceSamples) {
    const pose = samplePresence(buffer, time)
    if (pose) poses.push({ id, position: pose.position, yaw: pose.yaw })
  }
  return poses
}

/**
 * Everyone else in the live session, as the Rocketbox body each picked in
 * the look they gave it: walking where they walk (drawn a moment behind
 * their reports, which come about once a second), playing their emotes,
 * with their name, and their chat lines as bubbles.
 *
 * The app feeds it through window events: `mmm-presence-update` with every
 * other player's `RemotePresence`, and `mmm-chat-bubble` with `{ userId, text }`.
 */
export function RemotePlayers() {
  const [players, setPlayers] = useState<Player[]>([])
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({})
  const cuesRef = useRef(new Map<string, EmoteCue | null>())

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<RemotePresence[]>).detail
      const next = Array.isArray(detail) ? detail : []
      const now = performance.now()
      for (const presence of next) {
        const buffer = presenceSamples.get(presence.id) ?? []
        pushPresenceSample(buffer, { time: now, position: presence.position, yaw: presence.yaw })
        presenceSamples.set(presence.id, buffer)
        cuesRef.current.set(presence.id, presence.emote ?? null)
      }
      const present = new Set(next.map((presence) => presence.id))
      for (const id of presenceSamples.keys()) if (!present.has(id)) presenceSamples.delete(id)
      for (const id of cuesRef.current.keys()) if (!present.has(id)) cuesRef.current.delete(id)
      setPlayers((current) => {
        const changed =
          current.length !== next.length ||
          next.some(
            (presence, i) =>
              current[i]?.id !== presence.id ||
              current[i]?.name !== presence.name ||
              current[i]?.avatar !== presence.avatar ||
              current[i]?.look !== (presence.look ?? null),
          )
        return changed
          ? next.map(({ id, name, avatar, look }) => ({ id, name, avatar, look: look ?? null }))
          : current
      })
    }
    const say = (event: Event) => {
      const { userId, text } = (event as CustomEvent<{ userId: string; text: string }>).detail ?? {}
      if (!(userId && text)) return
      setBubbles((current) => ({
        ...current,
        [userId]: { text, until: performance.now() + BUBBLE_TIME },
      }))
    }
    window.addEventListener('mmm-presence-update', update)
    window.addEventListener('mmm-chat-bubble', say)
    return () => {
      window.removeEventListener('mmm-presence-update', update)
      window.removeEventListener('mmm-chat-bubble', say)
      presenceSamples.clear()
    }
  }, [])

  // Let spent bubbles go.
  useEffect(() => {
    if (Object.keys(bubbles).length === 0) return
    const timer = window.setInterval(() => {
      const now = performance.now()
      setBubbles((current) => {
        const kept = Object.entries(current).filter(([, bubble]) => bubble.until > now)
        return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept)
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [bubbles])

  return (
    <group name="remote-players">
      {players.map((player) => (
        <Suspense fallback={null} key={player.id}>
          <RemotePlayer bubble={bubbles[player.id]?.text} cues={cuesRef.current} player={player} />
        </Suspense>
      ))}
    </group>
  )
}

type Actions = { mixer: AnimationMixer } & Record<'idle' | Gait, AnimationAction>

function RemotePlayer({
  player,
  cues,
  bubble,
}: {
  player: Player
  cues: Map<string, EmoteCue | null>
  bubble?: string
}) {
  const heightScale = player.look ? bodyHeightScale(player.look.body) : 1
  const { avatar, model, clips, gaitSet } = useAvatarBody(
    player.avatar,
    player.look ? bodyStrideScale(player.look.body) : 1,
  )
  useAvatarLook(model, player.look, avatar.id)
  const [emoted, setEmoted] = useState(false)
  const emoteClips = useEmoteClips(avatar, emoted)
  const rootRef = useRef<Group>(null)
  const motionRef = useRef({ x: Number.NaN, z: 0, speed: 0, phase: 0, yaw: 0 })

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

  useFrame((_, delta) => {
    const root = rootRef.current
    const pose = getRemotePlayerPose(player.id)
    if (!(root && actions && pose) || delta <= 0) return
    const [x, y, z] = pose.position
    const motion = motionRef.current
    let stepped = 0
    if (!Number.isNaN(motion.x)) {
      const moved = Math.hypot(x - motion.x, z - motion.z)
      // A respawn jumps; it isn't walked.
      if (moved / delta < 12) stepped = moved
    } else {
      motion.yaw = pose.yaw
    }
    motion.x = x
    motion.z = z
    const smoothing = 1 - Math.exp(-delta * SPEED_RESPONSE)
    motion.speed += (stepped / delta - motion.speed) * smoothing
    motion.yaw = lerpAngle(motion.yaw, pose.yaw, 1 - Math.exp(-delta * TURN_RESPONSE))
    root.position.set(x, y, z)
    root.rotation.y = motion.yaw

    // Their emote, over the gait; walking off ends it here too.
    const cue = cues.get(player.id) ?? null
    if (cue && !emoted) setEmoted(true)
    const rest = 1 - (emotes ? emotes.update(cue, motion.speed > 0.5, delta) : 0)

    const weights = locomotionWeights(motion.speed, gaitSet)
    motion.phase = advanceGaitPhase(motion.phase, stepped / delta, delta, weights.loopDistance)
    actions.idle.setEffectiveWeight(rest * weights.idle)
    for (const gait of GAITS) {
      actions[gait].setEffectiveWeight(rest * weights[gait])
      actions[gait].time = motion.phase * actions[gait].getClip().duration
    }
    actions.mixer.update(delta)
  })

  // The top of the head sits at about twice the hip height.
  const labelHeight = avatar.hip * 2 * heightScale + 0.08

  return (
    <group ref={rootRef}>
      <primitive object={model} />
      <Html
        center
        position={[0, labelHeight, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[20, 0]}
      >
        <div className="flex flex-col items-center gap-1">
          {bubble && (
            <div className="w-max max-w-[220px] break-keep rounded-2xl bg-white px-3 py-1.5 text-center text-[13px] text-neutral-900 leading-snug shadow-lg">
              {bubble}
            </div>
          )}
          <div className="whitespace-nowrap rounded-full bg-black/55 px-2 py-0.5 font-medium text-[11px] text-white backdrop-blur-sm">
            {player.name}
          </div>
        </div>
      </Html>
    </group>
  )
}
