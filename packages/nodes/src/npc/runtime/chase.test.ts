import { beforeEach, describe, expect, test } from 'bun:test'
import { buildNavGrid, type NavGrid } from '@pascal-app/core'
import { NpcNode } from '../schema'
import type { NpcEngagement, NpcPose } from '../types'
import {
  CHASE_END_MS,
  CHASE_LINES,
  CHASE_STARTLE_MS,
  type ChaseState,
  chaseEngagementHandler,
  chaseHudText,
  chaseOutcome,
  clearSurpriseCooldowns,
  ESCAPE_DISTANCE,
  FLEE_RADIUS,
  NPC_CHASE_MS,
  nextChaseState,
  PLAYER_CHASE_MS,
  pickFleeTarget,
  resetChaseMinds,
  STARTLE_HOP_HEIGHT,
  startleHop,
  startSurpriseCooldown,
  surpriseCooldownLeft,
} from './chase'
import { SURPRISE_COOLDOWN_MS } from './social'
import { useNpcRuntime } from './store'

const T0 = 1_700_000_000_000

/** Plays the rules frame by frame: `distanceAt` is the gap at each moment, `armed` whether the NPC got away. */
function play(
  distanceAt: (ms: number, state: ChaseState) => number | null,
  armedAt: (ms: number) => boolean = () => true,
  until = 60_000,
): { phases: string[]; end: ChaseState | null; freeAt: number | null } {
  let state: ChaseState = { ph: 'startle', pt: T0 }
  const phases: string[] = ['startle']
  let end: ChaseState | null = null
  for (let now = T0; now <= T0 + until; now += 50) {
    const next = nextChaseState(state, {
      now,
      distance: distanceAt(now - T0, state),
      armed: armedAt(now - state.pt),
    })
    if (next === 'free') return { phases, end, freeAt: now - T0 }
    if (next) {
      state = next
      phases.push(next.ph)
      if (next.ph === 'end') end = next
    }
  }
  return { phases, end, freeAt: null }
}

describe('the rules of tag', () => {
  test('startled, then the NPC gives chase', () => {
    expect(
      nextChaseState({ ph: 'startle', pt: T0 }, { now: T0 + 700, distance: 1, armed: false }),
    ).toBeNull()
    expect(
      nextChaseState(
        { ph: 'startle', pt: T0 },
        { now: T0 + CHASE_STARTLE_MS, distance: 1, armed: false },
      ),
    ).toEqual({ ph: 'npc', pt: T0 + CHASE_STARTLE_MS })
  })

  test('caught by the NPC, the player is "it", and tags it back', () => {
    // Caught 3 s in, then the NPC runs off and the player tags it 5 s after.
    const result = play((ms, state) => {
      if (state.ph === 'npc') return ms < 3000 ? 3 : 0.5
      if (state.ph === 'player') return ms - state.pt + T0 < 5000 ? 4 : 0.8
      return 2
    })
    expect(result.phases).toEqual(['startle', 'npc', 'player', 'end'])
    expect(result.end?.won).toBe('player')
    expect(chaseOutcome('player', result.end?.won)).toBe('tagged')
    expect(result.freeAt! - (result.end!.pt - T0)).toBe(CHASE_END_MS)
  })

  test('the NPC does not catch in its first moments', () => {
    const state: ChaseState = { ph: 'npc', pt: T0 }
    expect(nextChaseState(state, { now: T0 + 100, distance: 0.5, armed: false })).toBeNull()
    expect(nextChaseState(state, { now: T0 + 600, distance: 0.5, armed: false })).toEqual({
      ph: 'player',
      pt: T0 + 600,
    })
  })

  test('the player escapes by distance or by holding out', () => {
    const far = play((ms) => (ms < 4000 ? 5 : ESCAPE_DISTANCE + 0.5))
    expect(far.phases).toEqual(['startle', 'npc', 'end'])
    expect(far.end?.won).toBe('player')
    expect(chaseOutcome('npc', far.end?.won)).toBe('escaped')

    const held = play(() => 4)
    expect(held.end?.won).toBe('player')
    expect(held.end!.pt - T0).toBeGreaterThanOrEqual(CHASE_STARTLE_MS + NPC_CHASE_MS)
    expect(held.end!.pt - T0).toBeLessThan(CHASE_STARTLE_MS + NPC_CHASE_MS + 100)
  })

  test('the NPC wins when the player can’t tag it in time', () => {
    const result = play((ms, state) => (state.ph === 'npc' ? 0.5 : 6))
    expect(result.phases).toEqual(['startle', 'npc', 'player', 'end'])
    expect(result.end?.won).toBe('npc')
    expect(chaseOutcome('player', 'npc')).toBe('timeUp')
    const playerPhaseStart = CHASE_STARTLE_MS + 500
    expect(result.end!.pt - T0 - playerPhaseStart).toBeGreaterThanOrEqual(PLAYER_CHASE_MS)
  })

  test('the player only tags the NPC once it has got away from them', () => {
    const state: ChaseState = { ph: 'player', pt: T0 }
    expect(nextChaseState(state, { now: T0 + 2000, distance: 0.5, armed: false })).toBeNull()
    expect(nextChaseState(state, { now: T0 + 2000, distance: 0.5, armed: true })).toEqual({
      ph: 'end',
      pt: T0 + 2000,
      won: 'player',
    })
  })

  test('a player gone from the level ends the game with no winner', () => {
    for (const ph of ['npc', 'player'] as const) {
      expect(
        nextChaseState({ ph, pt: T0 }, { now: T0 + 1000, distance: null, armed: true }),
      ).toEqual({
        ph: 'end',
        pt: T0 + 1000,
        won: 'none',
      })
    }
    expect(chaseOutcome('npc', 'none')).toBe('gone')
  })
})

describe('the chase effects', () => {
  test('the startled hop rises 0.22 m and lands in 0.35 s', () => {
    expect(startleHop(0)).toBe(0)
    expect(startleHop(0.175)).toBeCloseTo(STARTLE_HOP_HEIGHT, 6)
    expect(startleHop(0.36)).toBe(0)
  })

  test('the chip shows the lead or the time left', () => {
    expect(chaseHudText('npc', 9.42, 1000)).toBe('도망쳐! 9.4m')
    expect(chaseHudText('player', 2, 5_500)).toBe('잡아라! 15초')
    expect(chaseHudText('player', 2, 25_000)).toBe('잡아라! 0초')
    expect(chaseHudText('startle', 2, 0)).toBeNull()
    expect(chaseHudText('end', 2, 0)).toBeNull()
  })
})

describe('running away', () => {
  // A 24 × 24 m floor, and beside it (through a solid wall) a second one.
  const GRID: NavGrid = buildNavGrid({
    areas: [
      {
        polygon: [
          [-12, -12],
          [12, -12],
          [12, 12],
          [-12, 12],
        ],
        holes: [],
        height: 0,
      },
    ],
    walls: [{ a: [4, -12], b: [4, 12], halfWidth: 0.1, openings: [] }],
    obstacles: [],
  })

  test('runs to the far side, within reach', () => {
    const target = pickFleeTarget(GRID, [-4, 0], [-6, 0])
    expect(Math.hypot(target[0] + 4, target[1])).toBeLessThanOrEqual(FLEE_RADIUS + 0.2)
    expect(Math.hypot(target[0] + 6, target[1])).toBeGreaterThan(9)
  })

  test('stays on its own side of a wall', () => {
    // The player is west; the farthest spot east lies past the wall, which it can't reach.
    const target = pickFleeTarget(GRID, [2, 0], [-2, 0])
    expect(target[0]).toBeLessThan(4)
  })

  test('runs straight away without a grid', () => {
    expect(pickFleeTarget(null, [0, 0], [0, -1])).toEqual([0, FLEE_RADIUS])
  })
})

describe('cooldown', () => {
  beforeEach(() => clearSurpriseCooldowns())

  test('an NPC can’t be surprised again for 20 s', () => {
    expect(surpriseCooldownLeft('npc_a', T0)).toBe(0)
    startSurpriseCooldown('npc_a', T0)
    expect(surpriseCooldownLeft('npc_a', T0 + 1000)).toBe(SURPRISE_COOLDOWN_MS - 1000)
    expect(surpriseCooldownLeft('npc_b', T0 + 1000)).toBe(0)
    expect(surpriseCooldownLeft('npc_a', T0 + SURPRISE_COOLDOWN_MS)).toBe(0)
  })
})

describe('the chase engagement', () => {
  const npc = NpcNode.parse({ id: 'npc_chase01', position: [0, 0, 0] })
  const pose: NpcPose = {
    levelId: 'level_x',
    p: [0, 0],
    y: 0,
    yaw: 0,
    speed: 0,
    state: 'idle',
    emote: null,
    lookAt: null,
    visible: true,
  }

  beforeEach(() => {
    resetChaseMinds()
    clearSurpriseCooldowns()
    useNpcRuntime.setState({ engagements: {}, bubbles: {}, localPlayerId: 'me' })
  })

  test('the holder plays a whole game: startle, chase, caught, flee, tagged, free', () => {
    useNpcRuntime.getState().setEngagement(npc.id, {
      m: 'chase',
      by: 'me',
      at: T0,
      p: [0, 0],
      ph: 'startle',
      pt: T0,
    })
    // The player stands still 3 m off until the NPC is "it" no more, then walks after it
    // at 5 m/s.
    const player = { p: [0, -3] as [number, number], y: 0, yaw: 0 }
    let last = pose
    const seen: string[] = []
    const lines: string[] = []
    const dt = 1 / 30
    for (let now = T0; now < T0 + 60_000; now += dt * 1000) {
      const stored = useNpcRuntime.getState().engagements[npc.id]
      if (stored?.m !== 'chase') break
      if (seen[seen.length - 1] !== stored.ph) seen.push(stored.ph)
      const bubble = useNpcRuntime.getState().bubbles[npc.id]?.text
      if (bubble && lines[lines.length - 1] !== bubble) lines.push(bubble)
      const override = chaseEngagementHandler({
        npc,
        engagement: stored as Extract<NpcEngagement, { m: 'chase' }>,
        pose: last,
        player,
        owner: true,
        now,
        dt,
      })
      last = { ...last, p: override.p!, speed: override.speed!, yaw: override.yaw! }
      if (stored.ph === 'npc') expect(override.state).toBe('chase')
      if (stored.ph === 'player' && now - stored.pt > 1500) {
        // The player runs after the NPC.
        const dx = last.p[0] - player.p[0]
        const dz = last.p[1] - player.p[1]
        const d = Math.hypot(dx, dz)
        const step = Math.min(d, 5 * dt)
        player.p = [player.p[0] + (dx / d) * step, player.p[1] + (dz / d) * step]
      }
    }
    expect(seen).toEqual(['startle', 'npc', 'player', 'end'])
    const released = useNpcRuntime.getState().engagements[npc.id]
    expect(released?.m).toBe('free')
    expect(surpriseCooldownLeft(npc.id, released!.at + 1)).toBeGreaterThan(
      SURPRISE_COOLDOWN_MS - 50,
    )
    expect(CHASE_LINES.startle).toContain(lines[0] as (typeof CHASE_LINES.startle)[number])
    expect(lines).toContain(CHASE_LINES.chase)
    expect(lines).toContain(CHASE_LINES.caught)
    expect(lines).toContain(CHASE_LINES.flee)
    expect(lines[lines.length - 1]).toBe(CHASE_LINES.tagged)
  })

  test('another client steers but never writes', () => {
    const engagement: Extract<NpcEngagement, { m: 'chase' }> = {
      m: 'chase',
      by: 'someone',
      at: T0,
      p: [0, 0],
      ph: 'startle',
      pt: T0,
    }
    useNpcRuntime.getState().setEngagement(npc.id, engagement)
    chaseEngagementHandler({
      npc,
      engagement,
      pose,
      player: { p: [0, -3], y: 0, yaw: 0 },
      owner: false,
      now: T0 + 5000,
      dt: 0.016,
    })
    expect(useNpcRuntime.getState().engagements[npc.id]).toEqual(engagement)
  })
})
