import {
  measurePath,
  type NavPath,
  type NavPoint,
  samplePathAt,
  sceneRegistry,
} from '@pascal-app/core'
import { getRemotePlayerPose, isEmoteId } from '@pascal-app/editor'
import { Quaternion, Vector3 } from 'three'
import { useNpcDialogue } from '../dialogue/store'
import type { NpcNode } from '../schema'
import type {
  NpcEmoteCue,
  NpcEngagement,
  NpcEngagementContext,
  NpcEngagementHandler,
  NpcEngagementMode,
  NpcPlayerPose,
  NpcPose,
  NpcPoseOverride,
} from '../types'
import { speakNpc } from '../voice/engine'
import { chaseEngagementHandler } from './chase'
import { effectiveEngagement, NPC_ENGAGEMENT_REFRESH_MS } from './engagement'
import { navGridFor, roomMapFor } from './nav-cache'
import { npcSeed, rngFor } from './random'
import { NPC_WALK_SPEEDS, navHeightAt, npcScheduleFor, planPath } from './schedule'
import { socialEngagementHandler } from './social'
import { avoidanceOffset, FollowSteer, walkableOffset } from './steering'
import { npcPoses, useNpcRuntime } from './store'

/**
 * An NPC's pose each frame: who holds it (its engagement, shared) or else its
 * schedule (shared, deterministic), then what only this player sees — the
 * head turning to them, a greeting, stepping aside, turning round to face
 * them. Engagement kinds are handled through ENGAGEMENT_HANDLERS, so a new
 * kind only adds its handler.
 */

/** The walker's feet are this far below the controller's centre (capsule half + radius + float). */
const FEET_BELOW_CENTER = 1.15
/** Eye height (m) the NPC's head turns to. */
const HEAD_HEIGHT = 1.6
/** A player counts as on the NPC's level within this height (m) of the floor under them. */
const ON_LEVEL_HEIGHT = 1
/** The NPC watches a player this close (m) and not behind it (cosine of the angle). */
const LOOK_DISTANCE = 4
const LOOK_FRONT_COS = -0.2
/** A standing NPC turns round (rad/s) to face a player more than this far (rad) behind it. */
const TURN_SPEED = 1.5
const TURN_ANGLE = (100 * Math.PI) / 180
/** A jump in the pose shorter than this (m) is eased over (fades at CORRECTION_DECAY /s); a
 *  longer one is a teleport. */
const CORRECTION_MAX = 3
const CORRECTION_DECAY = 4
const JUMP_SLACK = 0.05
const FASTEST = 4.5
/** A followed player gone (absent or off the level) this long (ms) is given up on… */
const FOLLOW_LOST_MS = 10_000
/** …and one further than this (m). */
const FOLLOW_MAX_DISTANCE = 20
/** A greeting gesture older than this (ms) is dropped. */
const GREET_CUE_MS = 10_000

const SAY = {
  wait: '여기서 기다릴게요',
}

/** What this player knows about an NPC between frames. */
type NpcMind = {
  pose: NpcPose | null
  /** Last frame's spot before the local overlays. */
  base: NavPoint | null
  correction: NavPoint
  avoid: NavPoint
  yawOverride: number | null
  greetInside: boolean
  greetedAt: number
  greetCount: number
  greetCue: NpcEmoteCue | null
  follow: FollowSteer | null
  followLostSince: number | null
  waitBarked: boolean
  guide: { key: string; path: NavPath; arrived: boolean } | null
}

const minds = new Map<string, NpcMind>()

function mindOf(id: string): NpcMind {
  let mind = minds.get(id)
  if (!mind) {
    mind = {
      pose: null,
      base: null,
      correction: [0, 0],
      avoid: [0, 0],
      yawOverride: null,
      greetInside: false,
      greetedAt: Number.NEGATIVE_INFINITY,
      greetCount: 0,
      greetCue: null,
      follow: null,
      followLostSince: null,
      waitBarked: false,
      guide: null,
    }
    minds.set(id, mind)
  }
  return mind
}

/** Forgets every NPC's local state (leaving the walkthrough, or an NPC removed). */
export function resetNpcBrains(id?: string) {
  if (id === undefined) minds.clear()
  else minds.delete(id)
}

const facing = (from: Readonly<NavPoint>, to: Readonly<NavPoint>) =>
  Math.atan2(to[0] - from[0], to[1] - from[1])
const distance = (a: Readonly<NavPoint>, b: Readonly<NavPoint>) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)
const turnBetween = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from))

// ─── Players in a level's space ──────────────────────────────────────

/** A player on (or near) the NPC's level, in its level-local space. */
type PlayerView = NpcPlayerPose & { onLevel: boolean; head: [number, number, number] }

const scratch = new Vector3()
const levelTurn = new Quaternion()
const forward = new Vector3()

/** A world pose (feet, facing) seen from `levelId`'s space. */
function viewFrom(levelId: string, feet: Vector3, yaw: number): PlayerView {
  const level = sceneRegistry.nodes.get(levelId)
  const head: [number, number, number] = [feet.x, feet.y + HEAD_HEIGHT, feet.z]
  let local = scratch.copy(feet)
  let levelYaw = 0
  if (level) {
    local = level.worldToLocal(local)
    level.getWorldQuaternion(levelTurn)
    forward.set(0, 0, 1).applyQuaternion(levelTurn)
    levelYaw = Math.atan2(forward.x, forward.z)
  }
  const p: NavPoint = [local.x, local.z]
  const grid = navGridFor(levelId)
  const floor = grid ? navHeightAt(grid, p) : 0
  return {
    p,
    y: local.y,
    yaw: yaw - levelYaw,
    onLevel: Math.abs(local.y - floor) < ON_LEVEL_HEIGHT,
    head,
  }
}

/** This player's frame: where they stand (world feet) and face. */
export type NpcFrame = {
  /** Shared clock (ms). */
  now: number
  dt: number
  epoch: number
  me: string
  localFeet: Vector3 | null
  localYaw: number
}

const remoteFeet = new Vector3()

/** This player seen from `levelId` (level-local feet, whether they stand on that level). */
export function localPlayerOn(
  frame: NpcFrame,
  levelId: string,
): { p: NavPoint; onLevel: boolean } | null {
  return frame.localFeet ? viewFrom(levelId, frame.localFeet, frame.localYaw) : null
}

/** The player `by` seen from the NPC's level, wherever they are. */
function playerView(frame: NpcFrame, by: string, levelId: string): PlayerView | null {
  if (by === frame.me) {
    return frame.localFeet ? viewFrom(levelId, frame.localFeet, frame.localYaw) : null
  }
  const remote = getRemotePlayerPose(by)
  if (!remote) return null
  remoteFeet.set(remote.position[0], remote.position[1], remote.position[2])
  return viewFrom(levelId, remoteFeet, remote.yaw)
}

// ─── Engagement handlers ─────────────────────────────────────────────

const levelOf = (npc: NpcNode) => npc.parentId ?? ''

/** Talking: stand where the talk began, facing the talker. */
export const talkEngagementHandler: NpcEngagementHandler<'talk'> = ({ engagement, player }) => ({
  p: engagement.p,
  speed: 0,
  state: 'talk',
  yaw: player ? facing(engagement.p, player.p) : engagement.yaw,
})

/**
 * Following: walk to the spot behind the player over the nav grid (this
 * player's own steering). The holder gives up on a player gone for a while or
 * far off; meanwhile the NPC waits, saying so.
 */
export const followEngagementHandler: NpcEngagementHandler<'follow'> = (ctx) => {
  const { npc, engagement, player, owner, now, dt } = ctx
  const mind = mindOf(npc.id)
  mind.follow ??= new FollowSteer(ctx.pose.p)
  const steer = mind.follow
  const here = steer.p
  if (owner) {
    const lost = player === null
    mind.followLostSince = lost ? (mind.followLostSince ?? now) : null
    const tooFar = player !== null && distance(here, player.p) > FOLLOW_MAX_DISTANCE
    if (tooFar || (mind.followLostSince !== null && now - mind.followLostSince > FOLLOW_LOST_MS)) {
      useNpcRuntime.getState().setEngagement(npc.id, { m: 'free', at: now, p: [here[0], here[1]] })
    }
  }
  if (!player) {
    if (!mind.waitBarked) {
      mind.waitBarked = true
      useNpcRuntime.getState().say(npc.id, SAY.wait)
      if (engagement.by === useNpcRuntime.getState().localPlayerId) {
        speakNpc({ npcId: npc.id, text: SAY.wait, kind: 'bark' })
      }
    }
    return { p: [here[0], here[1]], speed: 0, state: 'follow', yaw: ctx.pose.yaw }
  }
  mind.waitBarked = false
  const step = steer.step(navGridFor(levelOf(npc)), player, dt, now)
  return { p: step.p, speed: step.speed, yaw: step.yaw, state: 'follow' }
}

/**
 * Guiding: walk from where the guide began to the room's spot, the same on
 * every client (from `at` and `p`); on arrival the holder's conversation
 * describes the room.
 */
export const guideEngagementHandler: NpcEngagementHandler<'guide'> = (ctx) => {
  const { npc, engagement: e, player, owner, now } = ctx
  const mind = mindOf(npc.id)
  const key = `${e.at}|${e.p[0]}|${e.p[1]}|${e.room}`
  if (mind.guide?.key !== key) {
    const levelId = levelOf(npc)
    const spot = roomMapFor(levelId)?.spots.get(e.room) ?? null
    const path = spot ? planPath(navGridFor(levelId), e.p, spot) : measurePath([[e.p[0], e.p[1]]])
    mind.guide = { key, path, arrived: false }
  }
  const guide = mind.guide
  const speed = NPC_WALK_SPEEDS[npc.behavior.speed]
  const s = Math.max(0, (now - e.at) / 1000) * speed
  if (s < guide.path.length) {
    const { p, heading } = samplePathAt(guide.path, s)
    return { p, speed, yaw: Math.atan2(heading[0], heading[1]), state: 'guide' }
  }
  const end = guide.path.points[guide.path.points.length - 1] ?? e.p
  if (owner && !guide.arrived) {
    guide.arrived = true
    useNpcDialogue.getState().guideArrived(npc.id, e.room)
  }
  return {
    p: [end[0], end[1]],
    speed: 0,
    state: 'idle',
    yaw: player ? facing(end, player.p) : ctx.pose.yaw,
  }
}

type HandlerMap = { [M in NpcEngagementMode]: NpcEngagementHandler<M> }

/** The behaviour of each engagement kind. `free` hands the NPC back to its schedule. */
export const ENGAGEMENT_HANDLERS: HandlerMap = {
  talk: talkEngagementHandler,
  follow: followEngagementHandler,
  guide: guideEngagementHandler,
  social: socialEngagementHandler,
  chase: chaseEngagementHandler,
  free: () => ({}),
}

function handle(ctx: NpcEngagementContext<NpcEngagementMode>): NpcPoseOverride {
  const handler = ENGAGEMENT_HANDLERS[ctx.engagement.m] as NpcEngagementHandler<NpcEngagementMode>
  return handler(ctx)
}

// ─── The frame ───────────────────────────────────────────────────────

/** The newest cue that is a known emote. */
function latestCue(...cues: (NpcEmoteCue | null | undefined)[]): NpcEmoteCue | null {
  let latest: NpcEmoteCue | null = null
  for (const cue of cues) {
    if (cue && isEmoteId(cue.id) && (!latest || cue.at > latest.at)) latest = cue
  }
  return latest
}

/** Keeps the holder's engagement fresh (so it doesn't expire), from where the NPC is now. */
function refresh(npc: NpcNode, stored: NpcEngagement | undefined, frame: NpcFrame, p: NavPoint) {
  if (!stored || stored.m === 'free' || stored.by !== frame.me) return
  if (frame.now - stored.at < NPC_ENGAGEMENT_REFRESH_MS) return
  if (stored.m !== 'talk' && stored.m !== 'follow' && stored.m !== 'guide') return
  // A talk stays where it began; a follow or a guide walk goes on from here.
  const at = frame.now
  const next: NpcEngagement =
    stored.m === 'talk' ? { ...stored, at } : { ...stored, at, p: [p[0], p[1]] }
  useNpcRuntime.getState().setEngagement(npc.id, next)
}

/** Greets this player on their first coming near (per cooldown): a gesture, a line, a turn. */
function greet(npc: NpcNode, mind: NpcMind, inside: boolean, now: number): boolean {
  const { greet: config, seed } = npc.behavior
  const entered = inside && !mind.greetInside
  mind.greetInside = inside
  const wall = Date.now()
  if (!(entered && config.enabled && wall - mind.greetedAt >= config.cooldown * 1000)) return false
  mind.greetedAt = wall
  mind.greetCue = { id: config.emote, at: now }
  const barks = config.barks
  if (barks.length > 0) {
    const pick = rngFor(npcSeed(seed, npc.id), npc.id, mind.greetCount, 'bark')()
    const bark = barks[Math.min(barks.length - 1, Math.floor(pick * barks.length))]
    if (bark) {
      useNpcRuntime.getState().say(npc.id, bark)
      speakNpc({ npcId: npc.id, text: bark, kind: 'bark' })
    }
  }
  mind.greetCount += 1
  return true
}

/** This frame's pose of `npc`. */
export function stepNpc(npc: NpcNode, frame: NpcFrame): NpcPose {
  const { now, dt, epoch, me } = frame
  const levelId = levelOf(npc)
  const grid = navGridFor(levelId)
  const mind = mindOf(npc.id)
  const runtime = useNpcRuntime.getState()
  const stored = runtime.engagements[npc.id]
  const engagement = effectiveEngagement(stored, now)
  const anchor = engagement?.m === 'free' ? engagement : null
  const scheduled = npcScheduleFor(npc, grid, roomMapFor(levelId)).poseAt(epoch, now, anchor)

  // Shared: the engagement's pose, else the schedule's.
  let base: {
    p: NavPoint
    yaw: number
    speed: number
    state: NpcPose['state']
    emote: NpcEmoteCue | null
  } = { ...scheduled }
  const held = engagement && engagement.m !== 'free' ? engagement : null
  const holder = held ? playerView(frame, held.by, levelId) : null
  const engaged = holder?.onLevel ? holder : null
  if (held) {
    const previous: NpcPose = mind.pose ?? {
      levelId,
      ...scheduled,
      lookAt: null,
      visible: true,
    }
    const override = handle({
      npc,
      engagement: held,
      pose: previous,
      player: engaged ? { p: engaged.p, y: engaged.y, yaw: engaged.yaw } : null,
      owner: held.by === me,
      now,
      dt,
    })
    base = {
      p: override.p ? [override.p[0], override.p[1]] : base.p,
      yaw: override.yaw ?? base.yaw,
      speed: override.speed ?? 0,
      state: override.state ?? base.state,
      emote: override.emote !== undefined ? override.emote : null,
    }
  }
  if (held?.m !== 'follow') {
    mind.follow = null
    mind.followLostSince = null
    mind.waitBarked = false
  }
  if (held?.m !== 'guide') mind.guide = null
  refresh(npc, stored, frame, base.p)

  // Local: ease over jumps (a late engagement, another player's release spot).
  if (mind.base) {
    const jump = distance(base.p, mind.base)
    if (jump > FASTEST * dt + JUMP_SLACK) {
      mind.correction =
        jump < CORRECTION_MAX
          ? [
              mind.base[0] + mind.correction[0] - base.p[0],
              mind.base[1] + mind.correction[1] - base.p[1],
            ]
          : [0, 0]
    }
  }
  const decay = Math.exp(-CORRECTION_DECAY * dt)
  mind.correction = [mind.correction[0] * decay, mind.correction[1] * decay]
  mind.base = base.p
  const spot: NavPoint = [base.p[0] + mind.correction[0], base.p[1] + mind.correction[1]]

  const local = frame.localFeet ? viewFrom(levelId, frame.localFeet, frame.localYaw) : null
  const near = local?.onLevel ? local : null

  // Local: step aside for this player and the other NPCs.
  const avoids = !held || held.m === 'follow'
  if (avoids) {
    const others: NavPoint[] = near ? [near.p] : []
    for (const [id, pose] of npcPoses) {
      if (id !== npc.id && pose.levelId === levelId && pose.visible) others.push(pose.p)
    }
    const heading: NavPoint | null =
      base.speed > 0 ? [Math.sin(base.yaw), Math.cos(base.yaw)] : null
    mind.avoid = walkableOffset(grid, spot, avoidanceOffset(mind.avoid, spot, heading, others, dt))
  } else {
    mind.avoid = [0, 0]
  }
  const p: NavPoint = [spot[0] + mind.avoid[0], spot[1] + mind.avoid[1]]

  // Local: watch, greet and turn to this player.
  const talking = useNpcDialogue.getState().npcId === npc.id
  const toLocal = near ? distance(p, near.p) : Number.POSITIVE_INFINITY
  const greeted = !held && !talking && greet(npc, mind, toLocal <= npc.behavior.greet.radius, now)
  if (held || talking) mind.greetInside = toLocal <= npc.behavior.greet.radius

  let lookAt: [number, number, number] | null = null
  if (held && holder?.onLevel && (held.m !== 'follow' || base.speed === 0)) {
    lookAt = holder.head
  } else if (!held && near && npc.behavior.lookAtPlayer && toLocal <= LOOK_DISTANCE) {
    const ahead = facing(p, near.p)
    if (Math.cos(ahead - base.yaw) > LOOK_FRONT_COS) lookAt = near.head
  }

  let yaw = base.yaw
  const standing = !held && base.speed === 0
  const watching = standing && near && npc.behavior.lookAtPlayer && toLocal <= LOOK_DISTANCE
  const keepTurned = Math.max(LOOK_DISTANCE, npc.behavior.greet.radius)
  if (near && standing && (watching || greeted || mind.yawOverride !== null)) {
    const want = facing(p, near.p)
    if (
      mind.yawOverride === null &&
      (greeted || Math.abs(turnBetween(base.yaw, want)) > TURN_ANGLE)
    ) {
      mind.yawOverride = base.yaw
    }
    if (mind.yawOverride !== null) {
      const turn = turnBetween(mind.yawOverride, want)
      const step = TURN_SPEED * dt
      mind.yawOverride += Math.max(-step, Math.min(step, turn))
      yaw = mind.yawOverride
      if (Math.abs(turn) < TURN_ANGLE && !lookAt) lookAt = near.head
    }
    if (toLocal > keepTurned) mind.yawOverride = null
  } else {
    mind.yawOverride = null
  }

  if (mind.greetCue && now - mind.greetCue.at > GREET_CUE_MS) mind.greetCue = null
  const emote = latestCue(base.emote, mind.greetCue, useNpcDialogue.getState().emotes[npc.id])

  const pose: NpcPose = {
    levelId,
    p,
    y: grid ? navHeightAt(grid, p) : npc.position[1],
    yaw,
    speed: base.speed,
    state: base.state,
    emote,
    lookAt,
    visible: npc.visible !== false,
  }
  mind.pose = pose
  return pose
}
