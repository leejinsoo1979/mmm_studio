'use client'

import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { type AnimationAction, AnimationMixer, type Group } from 'three'
import { useAvatarBody } from './first-person/avatar-rig'
import { advanceGaitPhase, GAITS, type Gait, locomotionWeights } from './first-person/locomotion'
import {
  lerpAngle,
  PRESENCE_DELAY,
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

type Player = { id: string; name: string; avatar: string }
type Bubble = { text: string; until: number }

/**
 * Everyone else in the live session, as the Rocketbox body each picked:
 * walking where they walk (drawn a moment behind their reports, which come
 * about once a second), with their name, and their chat lines as bubbles.
 *
 * The app feeds it through window events: `mmm-presence-update` with every
 * other player's `RemotePresence`, and `mmm-chat-bubble` with `{ userId, text }`.
 */
export function RemotePlayers() {
  const [players, setPlayers] = useState<Player[]>([])
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({})
  const samplesRef = useRef(new Map<string, PresenceSample[]>())

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<RemotePresence[]>).detail
      const next = Array.isArray(detail) ? detail : []
      const now = performance.now()
      const samples = samplesRef.current
      for (const presence of next) {
        const buffer = samples.get(presence.id) ?? []
        pushPresenceSample(buffer, { time: now, position: presence.position, yaw: presence.yaw })
        samples.set(presence.id, buffer)
      }
      const present = new Set(next.map((presence) => presence.id))
      for (const id of samples.keys()) if (!present.has(id)) samples.delete(id)
      setPlayers((current) => {
        const changed =
          current.length !== next.length ||
          next.some(
            (presence, i) =>
              current[i]?.id !== presence.id ||
              current[i]?.name !== presence.name ||
              current[i]?.avatar !== presence.avatar,
          )
        return changed ? next.map(({ id, name, avatar }) => ({ id, name, avatar })) : current
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
          <RemotePlayer
            bubble={bubbles[player.id]?.text}
            player={player}
            samples={samplesRef.current}
          />
        </Suspense>
      ))}
    </group>
  )
}

type Actions = { mixer: AnimationMixer } & Record<'idle' | Gait, AnimationAction>

function RemotePlayer({
  player,
  samples,
  bubble,
}: {
  player: Player
  samples: Map<string, PresenceSample[]>
  bubble?: string
}) {
  const { avatar, model, clips, gaitSet } = useAvatarBody(player.avatar)
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
    const buffer = samples.get(player.id)
    if (!(root && actions && buffer) || delta <= 0) return
    const pose = samplePresence(buffer, performance.now() - PRESENCE_DELAY)
    if (!pose) return
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

    const weights = locomotionWeights(motion.speed, gaitSet)
    motion.phase = advanceGaitPhase(motion.phase, stepped / delta, delta, weights.loopDistance)
    actions.idle.setEffectiveWeight(weights.idle)
    for (const gait of GAITS) {
      actions[gait].setEffectiveWeight(weights[gait])
      actions[gait].time = motion.phase * actions[gait].getClip().duration
    }
    actions.mixer.update(delta)
  })

  // The top of the head sits at about twice the hip height.
  const labelHeight = avatar.hip * 2 + 0.08

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
