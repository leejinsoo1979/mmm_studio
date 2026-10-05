import {
  farthestWalkableInRadius,
  type NavGrid,
  type NavPoint,
  navCellAt,
  nearestWalkableCell,
} from '@pascal-app/core'
import type { NpcChasePhase, NpcEmoteCue, NpcEngagement, NpcEngagementHandler } from '../types'
import { navGridFor } from './nav-cache'
import { PathRunner, SURPRISE_COOLDOWN_MS } from './social'
import { useNpcRuntime } from './store'

/**
 * "왁!": a playful game of tag. The player sneaks up behind an NPC and
 * startles it; it hops, turns and gives chase (it is "it") until it catches
 * the player — then the player is it and the NPC runs away — or the player
 * escapes, or time runs out. Catching is closeness only (tag), never a grab.
 * The holder's client decides each step and writes it to the engagement;
 * every client steers the NPC after the holder's player.
 */

/** The startled hop and turn (ms) before the NPC gives chase. */
export const CHASE_STARTLE_MS = 800
/** The startled hop: this high (m), this long (s). */
export const STARTLE_HOP_HEIGHT = 0.22
export const STARTLE_HOP_S = 0.35
/** The NPC as "it": this fast (m/s; a walking player is 1.8, a running one 5), re-aiming this often (ms). */
export const NPC_CHASE_SPEED = 4.2
const CHASE_REPLAN_MS = 400
/** The NPC catches the player this close (m), from this long (ms) into its chase. */
export const NPC_CATCH_DISTANCE = 0.9
const NPC_CATCH_AFTER_MS = 500
/** The player escapes beyond this (m) or by holding out this long (ms). */
export const ESCAPE_DISTANCE = 12
export const NPC_CHASE_MS = 15_000
/** The player as "it": the NPC laughs this long (ms) before running away… */
export const FLEE_GRACE_MS = 1000
/** …this fast (m/s), to the walkable spot within this (m) farthest from the player… */
export const NPC_FLEE_SPEED = 3.6
export const FLEE_RADIUS = 10
/** …picking a new one when the player comes this close (m), at most this often (ms). */
const FLEE_REPICK_DISTANCE = 3
const FLEE_REPICK_MS = 600
/** The player catches the NPC this close (m), once it has got this far (m) away first. */
export const PLAYER_CATCH_DISTANCE = 1
const PLAYER_CATCH_ARMED = 1.5
/** The player has this long (ms) to catch the NPC. */
export const PLAYER_CHASE_MS = 20_000
/** The closing beat (ms) before the NPC is let go. */
export const CHASE_END_MS = 1500
/** The NPC stops this close (m) to the player it chases, rather than walk into them. */
const CHASE_STOP = 0.6

export type ChaseWinner = 'npc' | 'player' | 'none'

export type ChaseState = { ph: NpcChasePhase; pt: number; won?: ChaseWinner }

export type ChaseInput = {
  now: number
  /** Between the NPC and the player (m), or null when the player is gone (off the level). */
  distance: number | null
  /** As "it", the player only catches the NPC once it has got away from them. */
  armed: boolean
}

/** What happens next: a new phase (from `now`), `free` (the game is over), or null (no change). */
export type ChaseTransition = ChaseState | 'free' | null

/** The game's rules, a pure step: where `state` goes at `input`. */
export function nextChaseState(state: ChaseState, input: ChaseInput): ChaseTransition {
  const { now, distance, armed } = input
  const elapsed = now - state.pt
  switch (state.ph) {
    case 'startle':
      return elapsed >= CHASE_STARTLE_MS ? { ph: 'npc', pt: now } : null
    case 'npc':
      if (distance === null) return { ph: 'end', pt: now, won: 'none' }
      if (distance < NPC_CATCH_DISTANCE && elapsed >= NPC_CATCH_AFTER_MS) {
        return { ph: 'player', pt: now }
      }
      if (distance > ESCAPE_DISTANCE || elapsed >= NPC_CHASE_MS) {
        return { ph: 'end', pt: now, won: 'player' }
      }
      return null
    case 'player':
      if (distance === null) return { ph: 'end', pt: now, won: 'none' }
      if (armed && distance < PLAYER_CATCH_DISTANCE) return { ph: 'end', pt: now, won: 'player' }
      if (elapsed >= PLAYER_CHASE_MS) return { ph: 'end', pt: now, won: 'npc' }
      return null
    case 'end':
      return elapsed >= CHASE_END_MS ? 'free' : null
  }
}

/** How a game ended, from the phase it ended in and who won. */
export type ChaseOutcome = 'escaped' | 'tagged' | 'timeUp' | 'gone'

export function chaseOutcome(
  from: NpcChasePhase | null,
  won: ChaseWinner | undefined,
): ChaseOutcome {
  if (won === 'npc') return 'timeUp'
  if (won === 'player') return from === 'player' ? 'tagged' : 'escaped'
  return 'gone'
}

/** What the NPC says at each step. */
export const CHASE_LINES = {
  startle: ['으악!', '깜짝이야!', '엄마야!'],
  chase: '거기 서!',
  caught: '잡았다!',
  flee: '나 잡아 봐라~',
  escaped: '헉헉… 다음엔 꼭 잡는다!',
  tagged: '졌다 졌어!',
  timeUp: '내가 이겼지롱~',
} as const

/** The player's own notes. */
export const CHASE_TOASTS = {
  caught: '잡혔다! 이제 네가 술래야',
  escaped: '도망 성공!',
  tagged: '잡았다! 술래잡기 성공',
  timeUp: '시간 끝! 다음엔 꼭 잡아 봐요',
} as const

/** The startled line, the same on every client. */
export const startleLine = (at: number) =>
  CHASE_LINES.startle[Math.abs(Math.round(at)) % CHASE_LINES.startle.length]!

/** The HUD chip for the player: how far ahead as the hunted, the time left as "it". */
export function chaseHudText(
  ph: NpcChasePhase,
  distance: number | null,
  elapsedMs: number,
): string | null {
  if (ph === 'npc' && distance !== null) return `도망쳐! ${distance.toFixed(1)}m`
  if (ph === 'player') {
    return `잡아라! ${Math.max(0, Math.ceil((PLAYER_CHASE_MS - elapsedMs) / 1000))}초`
  }
  return null
}

/** Height (m) of the startled hop `t` s after the startle. */
export function startleHop(t: number): number {
  return t > 0 && t < STARTLE_HOP_S
    ? STARTLE_HOP_HEIGHT * Math.sin((Math.PI * t) / STARTLE_HOP_S)
    : 0
}

/**
 * Where the NPC runs to as the hunted: the walkable spot within FLEE_RADIUS
 * of it, in its own walkable region, farthest from the player. Straight away
 * from the player without a grid.
 */
export function pickFleeTarget(
  grid: NavGrid | null,
  npc: Readonly<NavPoint>,
  player: Readonly<NavPoint>,
): NavPoint {
  if (grid) {
    const cell = navCellAt(grid, npc)
    const start = cell >= 0 && grid.walkable[cell] ? cell : nearestWalkableCell(grid, npc)
    const region = start >= 0 ? (grid.region[start] ?? null) : null
    const spot = farthestWalkableInRadius(grid, npc, FLEE_RADIUS, player, region)
    if (spot) return spot
  }
  const dx = npc[0] - player[0]
  const dz = npc[1] - player[1]
  const d = Math.hypot(dx, dz)
  if (d < 1e-6) return [npc[0] + FLEE_RADIUS, npc[1]]
  return [npc[0] + (dx / d) * FLEE_RADIUS, npc[1] + (dz / d) * FLEE_RADIUS]
}

// ─── Cooldown (this client's) ────────────────────────────────────────

const cooldowns = new Map<string, number>()

/** The NPC can't be surprised again until `now + SURPRISE_COOLDOWN_MS`. */
export function startSurpriseCooldown(npcId: string, now: number) {
  cooldowns.set(npcId, now + SURPRISE_COOLDOWN_MS)
}

/** Time (ms) before the NPC may be surprised again; 0 when it may. */
export function surpriseCooldownLeft(npcId: string, now: number): number {
  const until = cooldowns.get(npcId)
  if (until === undefined) return 0
  if (now >= until) {
    cooldowns.delete(npcId)
    return 0
  }
  return until - now
}

export function clearSurpriseCooldowns() {
  cooldowns.clear()
}

// ─── The engagement ──────────────────────────────────────────────────

type ChaseMind = {
  key: string
  ph: NpcChasePhase
  /** The phase before this one, for how the game ended. */
  from: NpcChasePhase | null
  runner: PathRunner
  flee: NavPoint | null
  fleePickedAt: number
  armed: boolean
  fleeSaid: boolean
  seenAt: number
}

const minds = new Map<string, ChaseMind>()

export type ChaseProgress = {
  ph: NpcChasePhase
  pt: number
  from: NpcChasePhase | null
  won?: ChaseWinner
}

/** The phase this client has the NPC in, for the effects and the HUD; null when not chasing. */
export function chaseProgress(npcId: string, now: number): ChaseProgress | null {
  const mind = minds.get(npcId)
  if (!mind || now - mind.seenAt > 500) return null
  const [, pt, , won] = mind.key.split('|')
  return {
    ph: mind.ph,
    pt: Number(pt),
    from: mind.from,
    won: won ? (won as ChaseWinner) : undefined,
  }
}

export function resetChaseMinds(npcId?: string) {
  if (npcId === undefined) minds.clear()
  else minds.delete(npcId)
}

const facing = (from: Readonly<NavPoint>, to: Readonly<NavPoint>) =>
  Math.atan2(to[0] - from[0], to[1] - from[1])

/** The NPC's gesture as it ends a game. */
function endEmote(outcome: ChaseOutcome): string | null {
  switch (outcome) {
    case 'escaped':
      return 'scratchHead'
    case 'tagged':
      return 'laugh'
    case 'timeUp':
      return 'cheer'
    default:
      return null
  }
}

/** Says a line over the NPC (every client sees the same step). */
function sayOnEntry(
  npcId: string,
  ph: NpcChasePhase,
  e: Extract<NpcEngagement, { m: 'chase' }>,
  from: NpcChasePhase | null,
) {
  const say = useNpcRuntime.getState().say
  switch (ph) {
    case 'startle':
      say(npcId, startleLine(e.at), 1500)
      break
    case 'npc':
      say(npcId, CHASE_LINES.chase, 2500)
      break
    case 'player':
      say(npcId, CHASE_LINES.caught, 1500)
      break
    case 'end': {
      const outcome = chaseOutcome(from, e.won)
      if (outcome !== 'gone') say(npcId, CHASE_LINES[outcome], 3000)
      break
    }
  }
}

/**
 * Tag: the startled hop and turn, the NPC running after the player (it is
 * "it"), the NPC running away (the player is), the closing beat. Each client
 * steers the NPC itself from where it sees it; the holder writes each step.
 */
export const chaseEngagementHandler: NpcEngagementHandler<'chase'> = (ctx) => {
  const { npc, engagement: e, player, pose, owner, now, dt } = ctx
  const key = `${e.ph}|${e.pt}|${e.at}|${e.won ?? ''}`
  let mind = minds.get(npc.id)
  if (mind?.key !== key) {
    const fresh = !mind || now - mind.seenAt > 500
    const from = fresh ? null : mind!.ph
    const start: NavPoint = fresh ? [pose.p[0], pose.p[1]] : mind!.runner.p
    // Another client's step: far from where it says the NPC was, take its word.
    const gap = Math.hypot(start[0] - e.p[0], start[1] - e.p[1])
    mind = {
      key,
      ph: e.ph,
      from,
      runner: new PathRunner(gap > 3 ? e.p : start),
      flee: null,
      fleePickedAt: Number.NEGATIVE_INFINITY,
      armed: false,
      fleeSaid: false,
      seenAt: now,
    }
    minds.set(npc.id, mind)
    sayOnEntry(npc.id, e.ph, e, from)
  }
  mind.seenAt = now

  const grid = navGridFor(npc.parentId)
  const runner = mind.runner
  const elapsed = now - e.pt
  let speed = 0
  let yaw = player ? facing(runner.p, player.p) : pose.yaw
  let state: 'startled' | 'chase' | 'flee' | 'idle' = 'idle'
  let emote: NpcEmoteCue | null = null

  switch (e.ph) {
    case 'startle':
      state = 'startled'
      break
    case 'npc': {
      state = 'chase'
      if (player) {
        const d = Math.hypot(player.p[0] - runner.p[0], player.p[1] - runner.p[1])
        if (d > CHASE_STOP) {
          runner.step(grid, player.p, NPC_CHASE_SPEED, dt, now, CHASE_REPLAN_MS, 0.5)
          speed = NPC_CHASE_SPEED
          if (runner.heading !== null) yaw = runner.heading
        }
      }
      break
    }
    case 'player': {
      state = 'flee'
      if (elapsed < FLEE_GRACE_MS) {
        emote = { id: 'laugh', at: e.pt }
        break
      }
      if (!mind.fleeSaid) {
        mind.fleeSaid = true
        useNpcRuntime.getState().say(npc.id, CHASE_LINES.flee, 3000)
      }
      if (player) {
        const d = Math.hypot(player.p[0] - runner.p[0], player.p[1] - runner.p[1])
        if (d > PLAYER_CATCH_ARMED) mind.armed = true
        const reached =
          mind.flee !== null &&
          Math.hypot(mind.flee[0] - runner.p[0], mind.flee[1] - runner.p[1]) < 0.3
        const pressed = d < FLEE_REPICK_DISTANCE && now - mind.fleePickedAt > FLEE_REPICK_MS
        if (!mind.flee || reached || pressed) {
          mind.flee = pickFleeTarget(grid, runner.p, player.p)
          mind.fleePickedAt = now
        }
      }
      if (mind.flee) {
        const left = runner.step(grid, mind.flee, NPC_FLEE_SPEED, dt, now, 1000, 0.25)
        if (left > 0.05) {
          speed = NPC_FLEE_SPEED
          if (runner.heading !== null) yaw = runner.heading
        }
      }
      break
    }
    case 'end': {
      const gesture = endEmote(chaseOutcome(mind.from, e.won))
      if (gesture) emote = { id: gesture, at: e.pt }
      break
    }
  }

  if (owner) {
    const distance = player
      ? Math.hypot(player.p[0] - runner.p[0], player.p[1] - runner.p[1])
      : null
    const next = nextChaseState(e, { now, distance, armed: mind.armed })
    const p: NavPoint = [runner.p[0], runner.p[1]]
    if (next === 'free') {
      startSurpriseCooldown(npc.id, now)
      useNpcRuntime.getState().setEngagement(npc.id, { m: 'free', at: now, p })
    } else if (next) {
      const step: NpcEngagement = { m: 'chase', by: e.by, at: now, p, ph: next.ph, pt: next.pt }
      if (next.won) step.won = next.won
      useNpcRuntime.getState().setEngagement(npc.id, step)
    }
  }

  return { p: [runner.p[0], runner.p[1]], speed, yaw, state, emote }
}
