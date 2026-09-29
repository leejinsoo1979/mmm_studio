import type { AvatarLook } from '../../../store/use-avatar-profile'
import type { EmoteCue } from './emotes'

/**
 * Other players' poses arrive about once a second. They are drawn a little in
 * the past, between the two reports around that moment, so they glide
 * instead of hopping from report to report.
 */

/** A player's feet on the floor and the way they face (rad about +Y, 0 = +Z). */
export type PresencePose = { position: [number, number, number]; yaw: number }

export type PresenceSample = PresencePose & { time: number }

/** What this player reports: the pose, the body they picked and the emote it plays. */
export type LocalPresence = PresencePose & { avatar: string; emote: EmoteCue | null }

/** What a remote player carries besides their pose: their body, its look and emote. */
export type RemotePresence = PresencePose & {
  id: string
  name: string
  avatar: string
  look?: AvatarLook | null
  emote?: EmoteCue | null
}

/** How far behind the latest report remote players are drawn (ms). */
export const PRESENCE_DELAY = 1200
const MAX_SAMPLES = 6
/** Farther than this (m) between reports is a respawn or a ride: jump, don't glide. */
const TELEPORT_DISTANCE = 6

export function pushPresenceSample(samples: PresenceSample[], sample: PresenceSample) {
  const last = samples[samples.length - 1]
  if (last && sample.time <= last.time) return
  samples.push(sample)
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Shortest-way turn from `a` to `b`, a fraction `t` of the way. */
export function lerpAngle(a: number, b: number, t: number) {
  const turn = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + turn * t
}

/** The pose at `time`: between the reports around it, else the nearest one. */
export function samplePresence(samples: PresenceSample[], time: number): PresencePose | null {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!(first && last)) return null
  if (time <= first.time) return first
  if (time >= last.time) return last
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i]!
    if (b.time < time) continue
    const a = samples[i - 1]!
    const [ax, ay, az] = a.position
    const [bx, by, bz] = b.position
    if (Math.hypot(bx - ax, by - ay, bz - az) > TELEPORT_DISTANCE) return b
    const t = (time - a.time) / (b.time - a.time)
    return {
      position: [lerp(ax, bx, t), lerp(ay, by, t), lerp(az, bz, t)],
      yaw: lerpAngle(a.yaw, b.yaw, t),
    }
  }
  return last
}
