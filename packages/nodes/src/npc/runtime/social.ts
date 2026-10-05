import { type NavGrid, type NavPath, type NavPoint, samplePathAt } from '@pascal-app/core'
import type { ArmSide, BodyAnchors } from '@pascal-app/editor'
import { Vector3 } from 'three'
import { isChildAvatar } from '../schema'
import type { NpcEmoteCue, NpcEngagementHandler, NpcSocialAct } from '../types'
import { navGridFor } from './nav-cache'
import { NPC_WALK_SPEEDS, planPath } from './schedule'
import { useNpcRuntime } from './store'

/**
 * The friendly gestures a player shares with an NPC (a high five, a
 * handshake, a dance, a photo, …) and what the E menu offers. The NPC walks
 * to a stance point in front of the player and the two act out the gesture
 * together; the timing and the arm targets here are pure, so every client
 * plays the same choreography from the shared engagement. The list of acts is
 * closed: friendly, non-violent gestures only, and a hug only between adults.
 */

// ─── The menu ────────────────────────────────────────────────────────

export const SOCIAL_LABELS: Record<NpcSocialAct, string> = {
  highFive: '하이파이브',
  handshake: '악수',
  fistBump: '주먹 인사',
  shoulderPat: '어깨 토닥이기',
  hug: '포옹',
  dance: '같이 춤추기',
  photo: '같이 사진 찍기',
}

/** In menu order (keys 2–8). */
export const SOCIAL_ACTS: readonly NpcSocialAct[] = [
  'highFive',
  'handshake',
  'fistBump',
  'shoulderPat',
  'hug',
  'dance',
  'photo',
]

export type NpcMenuAction = 'talk' | NpcSocialAct | 'follow' | 'stopFollow' | 'surprise'

export type NpcMenuItem = {
  action: NpcMenuAction
  label: string
  enabled: boolean
  /** Why it can't be picked now (one line), when disabled. */
  reason: string | null
}

/** "왁!" works from this close (m)… */
export const SURPRISE_REACH = 1.8
/** …behind the NPC: the player is more than this far (rad) off its facing. */
export const SURPRISE_BEHIND_ANGLE = (100 * Math.PI) / 180
/** An NPC can't be surprised again for this long (ms) after a chase. */
export const SURPRISE_COOLDOWN_MS = 20_000

export const MENU_REASONS = {
  busy: '다른 방문자와 함께 있어요',
  notTalkable: '대화를 나누지 않는 이웃이에요',
  hugAdults: '포옹은 어른끼리만 할 수 있어요',
  sneak: '뒤에서 몰래 다가가야 해요',
  cooldown: (seconds: number) => `${seconds}초 뒤에 다시 놀래킬 수 있어요`,
}

/** A hug only when both bodies are adults. */
export function hugAllowed(playerAvatar: string, npcAvatar: string): boolean {
  return !(isChildAvatar(playerAvatar) || isChildAvatar(npcAvatar))
}

/** The player stands behind the NPC (facing `yaw`, 0 = +Z): more than 100° off its facing. */
export function isBehind(
  npc: Readonly<NavPoint>,
  yaw: number,
  player: Readonly<NavPoint>,
): boolean {
  const dx = player[0] - npc[0]
  const dz = player[1] - npc[1]
  const d = Math.sqrt(dx * dx + dz * dz)
  if (d < 1e-6) return false
  const cos = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / d
  return cos < Math.cos(SURPRISE_BEHIND_ANGLE)
}

/** Sneaked up close behind the NPC. */
export function canSurprise(
  npc: Readonly<NavPoint>,
  yaw: number,
  player: Readonly<NavPoint>,
): boolean {
  const d = Math.hypot(player[0] - npc[0], player[1] - npc[1])
  return d <= SURPRISE_REACH && isBehind(npc, yaw, player)
}

export type NpcMenuInput = {
  talkable: boolean
  npcAvatar: string
  playerAvatar: string
  /** Another player holds the NPC. */
  busy: boolean
  /** The NPC follows this player. */
  following: boolean
  /** The NPC's feet (level-local) and facing, and the player's feet, when known. */
  npc: { p: Readonly<NavPoint>; yaw: number } | null
  player: Readonly<NavPoint> | null
  /** Time (ms) left before this NPC may be surprised again. */
  surpriseCooldownMs: number
}

/** The E menu's ten items in key order (1–9, then 0), each enabled or with its reason. */
export function npcMenuItems(input: NpcMenuInput): NpcMenuItem[] {
  const item = (action: NpcMenuAction, label: string, reason: string | null): NpcMenuItem => {
    const why = input.busy ? MENU_REASONS.busy : reason
    return { action, label, enabled: why === null, reason: why }
  }
  const items: NpcMenuItem[] = [
    item('talk', '대화하기', input.talkable ? null : MENU_REASONS.notTalkable),
  ]
  for (const act of SOCIAL_ACTS) {
    const adultsOnly = act === 'hug' && !hugAllowed(input.playerAvatar, input.npcAvatar)
    items.push(item(act, SOCIAL_LABELS[act], adultsOnly ? MENU_REASONS.hugAdults : null))
  }
  items.push(
    input.following ? item('stopFollow', '그만 따라와요', null) : item('follow', '따라와요', null),
  )
  let surprise: string | null = null
  if (input.surpriseCooldownMs > 0) {
    surprise = MENU_REASONS.cooldown(Math.ceil(input.surpriseCooldownMs / 1000))
  } else if (
    !(input.npc && input.player && canSurprise(input.npc.p, input.npc.yaw, input.player))
  ) {
    surprise = MENU_REASONS.sneak
  }
  items.push(item('surprise', '왁! 놀래키기', surprise))
  return items
}

// ─── Standing for a gesture ──────────────────────────────────────────

/** How far (m) the NPC stands from the player for each gesture. */
export const SOCIAL_DISTANCE: Record<NpcSocialAct, number> = {
  highFive: 0.75,
  handshake: 0.75,
  fistBump: 0.75,
  shoulderPat: 0.65,
  hug: 0.42,
  dance: 1.3,
  photo: 2.2,
}
/** For a pat the NPC stands this much (m) to the player's right. */
export const SHOULDER_PAT_SIDE = 0.25

/**
 * Where the NPC stands for `act`: `toNpc` (rad, 0 = +Z) is the heading from
 * the player toward the NPC; the spot is that far along it, and a little to
 * the player's right for a pat on the shoulder.
 */
export function socialStance(
  act: NpcSocialAct,
  player: Readonly<NavPoint>,
  toNpc: number,
): NavPoint {
  const fx = Math.sin(toNpc)
  const fz = Math.cos(toNpc)
  // Facing +Z the right hand is toward -X.
  const side = act === 'shoulderPat' ? SHOULDER_PAT_SIDE : 0
  const d = SOCIAL_DISTANCE[act]
  return [player[0] + fx * d - fz * side, player[1] + fz * d + fx * side]
}

// ─── Choreography (seconds after the NPC reached its spot) ───────────

/** When each gesture is over and the NPC is let go. */
export const SOCIAL_DURATION: Record<NpcSocialAct, number> = {
  highFive: 2.6,
  handshake: 3,
  fistBump: 2.3,
  shoulderPat: 3,
  hug: 3,
  dance: 12,
  photo: 3,
}

/** Hands meet for a high five (the clap) and fists for a bump. */
export const SOCIAL_CONTACT: Partial<Record<NpcSocialAct, { at: number; sound: 'clap' | 'tap' }>> =
  {
    highFive: { at: 0.45, sound: 'clap' },
    fistBump: { at: 0.45, sound: 'tap' },
  }

/** The photo is taken this long (s) after the pose starts. */
export const PHOTO_SNAP_AT = 1.2

/** A dance's two styles: a second press switches to the silly one. */
export type DanceStyle = 'groove' | 'silly'

/**
 * The NPC's gesture for `act` (its emote and when, in s), varied by the
 * engagement's time so every client picks the same.
 */
export function npcSocialEmote(
  act: NpcSocialAct,
  at: number,
  style: DanceStyle = 'groove',
): { id: string; t: number } {
  const odd = Math.round(at) % 2 === 1
  switch (act) {
    case 'highFive':
      return { id: odd ? 'laugh' : 'cheer', t: 1 }
    case 'handshake':
      return { id: 'nod', t: 2 }
    case 'fistBump':
      return { id: 'laugh', t: 0.65 }
    case 'shoulderPat':
      return { id: odd ? 'laugh' : 'nod', t: 1.5 }
    case 'hug':
      return { id: 'laugh', t: 2.3 }
    case 'dance':
      return { id: style === 'silly' ? 'danceSilly' : 'danceGroove', t: 0 }
    case 'photo':
      return { id: odd ? 'wave' : 'hooray', t: 0 }
  }
}

/**
 * The player's own gesture for `act`: the shared dance, the camera pose for a
 * photo, and for the arm gestures the nearest emote, which is what other
 * players see of them (their view has no arm reach).
 */
export function playerSocialEmote(act: NpcSocialAct, style: DanceStyle = 'groove'): string | null {
  switch (act) {
    case 'dance':
      return style === 'silly' ? 'danceSilly' : 'danceGroove'
    case 'photo':
      return 'photo'
    case 'highFive':
    case 'fistBump':
      return 'wave'
    case 'handshake':
      return 'nod'
    default:
      return null
  }
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** 0 → 1 over `[in0, in1]`, held, then 1 → 0 over `[out0, out1]`. */
export function envelope(t: number, in0: number, in1: number, out0: number, out1: number): number {
  if (t <= in0 || t >= out1) return 0
  if (t < in1) return smooth((t - in0) / (in1 - in0))
  if (t <= out0) return 1
  return 1 - smooth((t - out0) / (out1 - out0))
}

export type ArmGoal = {
  who: 'npc' | 'player'
  side: ArmSide
  target: Vector3
  weight: number
  /** Fingers curled into a fist (0..1). */
  fist: number
}

const UP = new Vector3(0, 1, 0)

function midpoint(a: Vector3, b: Vector3, y: number): Vector3 {
  return new Vector3((a.x + b.x) / 2, y, (a.z + b.z) / 2)
}

/**
 * Where the arms go `t` s into `act`: the right hands meeting between the two
 * for a high five, a handshake or a fist bump, the player's hand on the NPC's
 * shoulder for a pat, both pairs of arms round the other's upper back for a
 * hug. A dance or a photo uses no arms.
 */
export function socialArmGoals(
  act: NpcSocialAct,
  t: number,
  npc: BodyAnchors,
  player: BodyAnchors,
): ArmGoal[] {
  const goals: ArmGoal[] = []
  const both = (target: (body: BodyAnchors) => Vector3, weight: number, fist = 0) => {
    if (weight <= 0) return
    goals.push({ who: 'npc', side: 'right', target: target(npc), weight, fist })
    goals.push({ who: 'player', side: 'right', target: target(player), weight, fist })
  }
  switch (act) {
    case 'highFive': {
      const y = (npc.head.y + player.head.y) / 2 + 0.15
      const meet = midpoint(npc.rightShoulder, player.rightShoulder, y)
      both(
        (body) => meet.clone().addScaledVector(body.forward, -0.03),
        envelope(t, 0, 0.45, 0.6, 1),
      )
      break
    }
    case 'handshake': {
      const pump = t > 0.5 && t < 1.6 ? 0.045 * Math.sin((2 * Math.PI * 3 * (t - 0.5)) / 1.1) : 0
      const y = (npc.waist.y + player.waist.y) / 2 + 0.1 + pump
      const meet = midpoint(npc.rightShoulder, player.rightShoulder, y)
      both((body) => meet.clone().addScaledVector(body.forward, -0.02), envelope(t, 0, 0.5, 1.6, 2))
      break
    }
    case 'fistBump': {
      const y = (npc.chest.y + player.chest.y) / 2
      const meet = midpoint(npc.rightShoulder, player.rightShoulder, y)
      const recoil = 0.12 * smooth((t - 0.45) / 0.2)
      both(
        (body) => meet.clone().addScaledVector(body.forward, -0.04 - recoil),
        envelope(t, 0, 0.45, 0.65, 1.1),
        envelope(t, 0, 0.3, 0.9, 1.1),
      )
      break
    }
    case 'shoulderPat': {
      const weight = envelope(t, 0, 0.4, 1.5, 1.9)
      if (weight <= 0) break
      const pat =
        t > 0.4 && t < 1.5 ? 0.05 * Math.abs(Math.sin((Math.PI * 3 * (t - 0.4)) / 1.1)) : 0
      const target = npc.leftShoulder.clone().addScaledVector(UP, 0.07 + pat)
      goals.push({ who: 'player', side: 'right', target, weight, fist: 0 })
      break
    }
    case 'hug': {
      const weight = envelope(t, 0, 0.5, 2, 2.5)
      if (weight <= 0) break
      // Each pair of arms goes round the other's upper back, never lower than the chest.
      const around = (who: 'npc' | 'player', self: BodyAnchors, other: BodyAnchors) => {
        const back = other.chest
          .clone()
          .addScaledVector(UP, 0.04)
          .addScaledVector(other.forward, -0.14)
        goals.push({
          who,
          side: 'right',
          target: back.clone().addScaledVector(self.right, 0.12).addScaledVector(UP, 0.05),
          weight,
          fist: 0,
        })
        goals.push({
          who,
          side: 'left',
          target: back.clone().addScaledVector(self.right, -0.12),
          weight,
          fist: 0,
        })
      }
      around('npc', npc, player)
      around('player', player, npc)
      break
    }
    case 'dance':
    case 'photo':
      break
  }
  return goals
}

// ─── Walking a route ─────────────────────────────────────────────────

/** An NPC walking to a moving goal over the nav grid (this client's own steering). */
export class PathRunner {
  p: NavPoint
  heading: number | null = null
  private path: NavPath | null = null
  private s = 0
  private goal: NavPoint | null = null
  private plannedAt = Number.NEGATIVE_INFINITY

  constructor(p: Readonly<NavPoint>) {
    this.p = [p[0], p[1]]
  }

  /**
   * One frame toward `goal` at `speed`; plans again when the goal moved more
   * than `replanMove` m or `replanMs` passed. Returns the ground left (m).
   */
  step(
    grid: NavGrid | null,
    goal: Readonly<NavPoint>,
    speed: number,
    dt: number,
    now: number,
    replanMs = 1000,
    replanMove = 0.25,
  ): number {
    const moved = this.goal
      ? Math.hypot(goal[0] - this.goal[0], goal[1] - this.goal[1])
      : Number.POSITIVE_INFINITY
    if (!this.path || moved > replanMove || now - this.plannedAt >= replanMs) {
      this.path = planPath(grid, this.p, goal)
      this.s = 0
      this.goal = [goal[0], goal[1]]
      this.plannedAt = now
    }
    this.s = Math.min(this.path.length, this.s + speed * dt)
    const { p, heading } = samplePathAt(this.path, this.s)
    if (heading[0] !== 0 || heading[1] !== 0) this.heading = Math.atan2(heading[0], heading[1])
    this.p = [p[0], p[1]]
    return this.path.length - this.s
  }

  /** Stands at `p` (a fresh route is planned on the next step). */
  place(p: Readonly<NavPoint>) {
    this.p = [p[0], p[1]]
    this.path = null
  }
}

// ─── The engagement ──────────────────────────────────────────────────

/** The NPC gives up walking to its spot after this long (ms) and steps onto it. */
const APPROACH_MAX_MS = 5000
/** At its spot within this (m). */
const ARRIVED = 0.05
const APPROACH_MIN_SPEED = 1.25
/** A new gesture straight after a dance (no release between) within this (ms) is a second press. */
const SECOND_PRESS_MS = 500

type SocialMind = {
  key: string
  act: NpcSocialAct
  runner: PathRunner
  startedAt: number
  /** Shared ms when it reached its spot, or null while walking there. */
  arrivedAt: number | null
  style: DanceStyle
  seenAt: number
}

const minds = new Map<string, SocialMind>()

/** Where an NPC is in its gesture, for the bodies and effects: null when it isn't in one. */
export type SocialProgress = {
  key: string
  act: NpcSocialAct
  /** Shared ms when the choreography began (the NPC at its spot), or null while it walks there. */
  arrivedAt: number | null
  style: DanceStyle
}

export function socialProgress(npcId: string, now: number): SocialProgress | null {
  const mind = minds.get(npcId)
  if (!mind || now - mind.seenAt > SECOND_PRESS_MS) return null
  return { key: mind.key, act: mind.act, arrivedAt: mind.arrivedAt, style: mind.style }
}

export function resetSocialMinds(npcId?: string) {
  if (npcId === undefined) minds.clear()
  else minds.delete(npcId)
}

const facing = (from: Readonly<NavPoint>, to: Readonly<NavPoint>) =>
  Math.atan2(to[0] - from[0], to[1] - from[1])

/**
 * A gesture: the NPC walks to its spot in front of the player (from `p`,
 * re-aimed as the player shifts), faces them and plays its part from when it
 * got there. The holder lets it go once the choreography is over or the
 * player is gone. `yaw` is the NPC's facing at its spot (toward the player).
 */
export const socialEngagementHandler: NpcEngagementHandler<'social'> = (ctx) => {
  const { npc, engagement: e, player, pose, owner, now, dt } = ctx
  const key = `${e.at}|${e.act}`
  let mind = minds.get(npc.id)
  if (mind?.key !== key) {
    const secondPress =
      mind !== undefined &&
      mind.act === 'dance' &&
      e.act === 'dance' &&
      now - mind.seenAt < SECOND_PRESS_MS
    const style: DanceStyle = secondPress && mind?.style === 'groove' ? 'silly' : 'groove'
    mind = {
      key,
      act: e.act,
      runner: new PathRunner(mind && now - mind.seenAt < SECOND_PRESS_MS ? mind.runner.p : pose.p),
      startedAt: now,
      arrivedAt: secondPress ? now : null,
      style,
      seenAt: now,
    }
    minds.set(npc.id, mind)
  }
  mind.seenAt = now

  const toNpc = e.yaw + Math.PI
  const spot = player ? socialStance(e.act, player.p, toNpc) : e.p
  const runner = mind.runner
  let speed = 0
  if (mind.arrivedAt === null) {
    const pace = Math.max(APPROACH_MIN_SPEED, NPC_WALK_SPEEDS[npc.behavior.speed])
    const left = runner.step(navGridFor(npc.parentId), spot, pace, dt, now)
    speed = pace
    if (left <= ARRIVED || now - mind.startedAt > APPROACH_MAX_MS) {
      runner.place(spot)
      mind.arrivedAt = now
      speed = 0
    }
  } else {
    // Keeps its distance as the player shifts on the spot.
    const ease = 1 - Math.exp(-6 * dt)
    runner.place([
      runner.p[0] + (spot[0] - runner.p[0]) * ease,
      runner.p[1] + (spot[1] - runner.p[1]) * ease,
    ])
  }

  const p: NavPoint = [runner.p[0], runner.p[1]]
  const yaw =
    speed > 0 && runner.heading !== null ? runner.heading : player ? facing(p, player.p) : e.yaw

  let emote: NpcEmoteCue | null = null
  if (mind.arrivedAt !== null) {
    const gesture = npcSocialEmote(e.act, e.at, mind.style)
    emote = { id: gesture.id, at: Math.round(mind.arrivedAt + gesture.t * 1000) }
  }

  if (owner) {
    const over = mind.arrivedAt !== null && now - mind.arrivedAt >= SOCIAL_DURATION[e.act] * 1000
    if (over || !player) {
      useNpcRuntime.getState().setEngagement(npc.id, { m: 'free', at: now, p })
    }
  }

  return { p, speed, yaw, state: 'social', emote }
}
