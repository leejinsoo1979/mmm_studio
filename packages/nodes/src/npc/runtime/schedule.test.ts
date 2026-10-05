import { describe, expect, test } from 'bun:test'
import { buildNavGrid, type NavGrid, type NavGridInput } from '@pascal-app/core'
import { NpcNode, type NpcNodeInput } from '../schema'
import { mulberry32 } from './random'
import { buildRoomMap } from './rooms'
import { NPC_WALK_SPEEDS, NpcSchedule, type NpcSchedulePose, schedulePoseAt } from './schedule'

// Two 6 × 12 m rooms side by side, joined by a 1 m door in the wall at x = 0.
const INPUT: NavGridInput = {
  areas: [
    {
      polygon: [
        [-6, -6],
        [6, -6],
        [6, 6],
        [-6, 6],
      ],
      holes: [],
      height: 0,
    },
  ],
  walls: [{ a: [0, -6], b: [0, 6], halfWidth: 0.1, openings: [{ along: 6, halfWidth: 0.5 }] }],
  obstacles: [],
}
const GRID: NavGrid = buildNavGrid(INPUT)
const EPOCH = 1_700_000_000_000

function npc(input: Partial<NpcNodeInput> & { behavior?: NpcNodeInput['behavior'] } = {}): NpcNode {
  return NpcNode.parse({ id: 'npc_test01', position: [-3, 0, 0], ...input })
}

const wanderer = npc({ behavior: { mode: 'wander', wanderRadius: 5, seed: 4242, dwell: [2, 8] } })

const near = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  Math.abs(a[0]! - b[0]!) <= eps && Math.abs(a[1]! - b[1]!) <= eps

describe('schedule determinism', () => {
  test('the same inputs give the same pose, however often and in whatever order it is asked', () => {
    const a = new NpcSchedule(wanderer, GRID, null)
    const rand = mulberry32(7)
    const times = Array.from({ length: 1000 }, () => EPOCH + Math.floor(rand() * 3_600_000))
    const first = times.map((t) => a.poseAt(EPOCH, t))
    const again = [...times]
      .reverse()
      .map((t) => new NpcSchedule(wanderer, GRID, null).poseAt(EPOCH, t))
    expect(again.reverse()).toEqual(first)
  })

  test('a player joining late sees what a player there all along sees', () => {
    const continuous = new NpcSchedule(wanderer, GRID, null)
    const seen = new Map<number, NpcSchedulePose>()
    for (let t = EPOCH; t <= EPOCH + 600_000; t += 250) seen.set(t, continuous.poseAt(EPOCH, t))
    for (const t of [EPOCH + 250, EPOCH + 61_000, EPOCH + 299_750, EPOCH + 600_000]) {
      const lateJoiner = new NpcSchedule(wanderer, GRID, null)
      expect(lateJoiner.poseAt(EPOCH, t)).toEqual(seen.get(t)!)
    }
  })

  test('schedulePoseAt matches a schedule of its own', () => {
    const t = EPOCH + 123_456
    expect(
      schedulePoseAt({ npc: wanderer, grid: GRID, rooms: null, epoch: EPOCH, anchor: null }, t),
    ).toEqual(new NpcSchedule(wanderer, GRID, null).poseAt(EPOCH, t))
  })

  test('two NPCs with different ids move differently', () => {
    const other = npc({ id: 'npc_test02', behavior: { ...wanderer.behavior, seed: 0 } })
    const t = EPOCH + 200_000
    const a = new NpcSchedule(wanderer, GRID, null).poseAt(EPOCH, t)
    const b = new NpcSchedule(other, GRID, null).poseAt(EPOCH, t)
    expect(near(a.p, b.p, 1e-6)).toBe(false)
  })
})

describe('wander', () => {
  test('walks continuously: no jumps across slot boundaries', () => {
    const schedule = new NpcSchedule(wanderer, GRID, null)
    const step = 50
    const v = NPC_WALK_SPEEDS.normal
    let previous = schedule.poseAt(EPOCH, EPOCH)
    const slots = new Set<number>([previous.slot])
    for (let t = EPOCH + step; t <= EPOCH + 900_000; t += step) {
      const pose = schedule.poseAt(EPOCH, t)
      const moved = Math.hypot(pose.p[0] - previous.p[0], pose.p[1] - previous.p[1])
      expect(moved).toBeLessThanOrEqual(v * (step / 1000) + 1e-6)
      slots.add(pose.slot)
      previous = pose
    }
    expect(slots.size).toBeGreaterThan(20)
  })

  test('starts at home, stays within its radius and walks through the door', () => {
    const schedule = new NpcSchedule(wanderer, GRID, null)
    const start = schedule.poseAt(EPOCH, EPOCH)
    expect(Math.hypot(start.p[0] + 3, start.p[1])).toBeLessThan(5.2)
    let crossed = false
    for (let t = EPOCH; t <= EPOCH + 3_600_000; t += 1000) {
      const { p, state } = schedule.poseAt(EPOCH, t)
      if (state === 'idle') expect(Math.hypot(p[0] + 3, p[1])).toBeLessThanOrEqual(5 + 0.2)
      if (p[0] > 0.3) crossed = true
    }
    expect(crossed).toBe(true)
  })

  test('only heads for the rooms it is given', () => {
    const rooms = buildRoomMap(GRID, [
      room('room_left', [-6, -6], [0, 6]),
      room('room_right', [0, -6], [6, 6]),
    ])
    const restricted = npc({
      behavior: { mode: 'wander', wanderRadius: 6, seed: 99, rooms: ['room_right'] },
    })
    const schedule = new NpcSchedule(restricted, GRID, rooms)
    let dwells = 0
    for (let t = EPOCH + 60_000; t <= EPOCH + 3_600_000; t += 1000) {
      const { p, state } = schedule.poseAt(EPOCH, t)
      if (state !== 'idle') continue
      dwells++
      expect(p[0]).toBeGreaterThan(0)
    }
    expect(dwells).toBeGreaterThan(100)
  })

  test('idle emotes come from its list, at the same shared time for everyone', () => {
    const emoting = npc({
      behavior: { mode: 'wander', wanderRadius: 3, seed: 5, idleEmotes: ['stretch', 'yawn'] },
    })
    const a = new NpcSchedule(emoting, GRID, null)
    const cues = new Map<string, string>()
    for (let t = EPOCH; t <= EPOCH + 1_800_000; t += 500) {
      const { emote } = a.poseAt(EPOCH, t)
      if (emote) cues.set(`${emote.at}`, emote.id)
    }
    expect(cues.size).toBeGreaterThan(3)
    for (const [at, id] of cues) {
      expect(['stretch', 'yawn']).toContain(id)
      const late = new NpcSchedule(emoting, GRID, null).poseAt(EPOCH, Number(at) + 100)
      expect(late.emote).toEqual({ id, at: Number(at) })
    }
  })
})

function room(id: string, [x0, z0]: [number, number], [x1, z1]: [number, number]) {
  return {
    id,
    name: id,
    levelId: 'level_a',
    area: (x1 - x0) * (z1 - z0),
    centroid: [(x0 + x1) / 2, (z0 + z1) / 2] as [number, number],
    polygon: [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ] as [number, number][],
    windows: 0,
    doorsTo: [],
    furniture: [],
    cabinets: [],
    lights: 0,
  }
}

describe('stand', () => {
  test('stays at home, facing the way it was placed', () => {
    const stander = npc({ position: [2, 0, 3], rotation: 1.25 })
    const schedule = new NpcSchedule(stander, GRID, null)
    for (let t = EPOCH; t <= EPOCH + 600_000; t += 7_000) {
      const pose = schedule.poseAt(EPOCH, t)
      expect(pose.p).toEqual([2, 3])
      expect(pose.yaw).toBe(1.25)
      expect(pose.speed).toBe(0)
      expect(pose.state).toBe('idle')
    }
  })
})

describe('patrol', () => {
  const points: [number, number][] = [
    [-4.1, -4.1],
    [-4.1, 4.1],
    [-1.1, 4.1],
  ]

  /** The points it dwells at, in order, deduplicated. */
  function stops(node: NpcNode, count: number): [number, number][] {
    const schedule = new NpcSchedule(node, GRID, null)
    const seen: [number, number][] = []
    for (let t = EPOCH; seen.length < count && t < EPOCH + 3_600_000; t += 200) {
      const { p, state } = schedule.poseAt(EPOCH, t)
      if (state !== 'idle') continue
      const last = seen[seen.length - 1]
      if (!last || !near(last, p, 1e-6)) seen.push([p[0], p[1]])
    }
    return seen
  }

  const index = (p: [number, number]) =>
    points.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.2)

  test('loops through its points in order', () => {
    const node = npc({ behavior: { mode: 'patrol', patrol: points, dwell: [1, 2], seed: 3 } })
    const order = stops(node, 7).map(index)
    expect(order.every((i) => i >= 0)).toBe(true)
    for (let i = 1; i < order.length; i++) expect(order[i]).toBe((order[i - 1]! + 1) % 3)
  })

  test('ping-pongs back along its points', () => {
    const node = npc({
      behavior: { mode: 'patrol', patrol: points, patrolLoop: 'pingpong', dwell: [1, 2], seed: 3 },
    })
    const order = stops(node, 9).map(index)
    const cycle = [0, 1, 2, 1]
    const start = cycle.findIndex(
      (value, i) => value === order[0] && cycle[(i + 1) % 4] === order[1],
    )
    expect(start).toBeGreaterThanOrEqual(0)
    for (const [i, value] of order.entries()) expect(value).toBe(cycle[(start + i) % 4]!)
  })
})

describe('release anchor', () => {
  test('the walk back starts where the NPC was let go and rejoins the schedule', () => {
    const schedule = new NpcSchedule(wanderer, GRID, null)
    const anchor = { at: EPOCH + 100_000, p: [3.5, -2] as const }
    const atRelease = schedule.poseAt(EPOCH, anchor.at, anchor)
    expect(near(atRelease.p, [3.5, -2], 1e-9)).toBe(true)
    // Walks back without jumping.
    let previous = atRelease
    for (let t = anchor.at + 50; t <= anchor.at + 120_000; t += 50) {
      const pose = schedule.poseAt(EPOCH, t, anchor)
      const moved = Math.hypot(pose.p[0] - previous.p[0], pose.p[1] - previous.p[1])
      expect(moved).toBeLessThanOrEqual(NPC_WALK_SPEEDS.normal * 0.05 + 1e-6)
      previous = pose
    }
    // Later on it is wherever its schedule says.
    const later = anchor.at + 200_000
    expect(schedule.poseAt(EPOCH, later, anchor)).toEqual(schedule.poseAt(EPOCH, later))
    // Before the release the anchor plays no part.
    expect(schedule.poseAt(EPOCH, anchor.at - 1, anchor)).toEqual(
      schedule.poseAt(EPOCH, anchor.at - 1),
    )
  })

  test('every client agrees on the walk back', () => {
    const anchor = { at: EPOCH + 42_000, p: [-1.5, 3.25] as const }
    for (const t of [anchor.at, anchor.at + 1_500, anchor.at + 9_000, anchor.at + 30_000]) {
      expect(new NpcSchedule(wanderer, GRID, null).poseAt(EPOCH, t, anchor)).toEqual(
        new NpcSchedule(wanderer, GRID, null).poseAt(EPOCH, t, anchor),
      )
    }
  })

  test('a standing NPC walks back home', () => {
    const stander = npc({ position: [-3, 0, 2], rotation: 0.5 })
    const schedule = new NpcSchedule(stander, GRID, null)
    const anchor = { at: EPOCH + 10_000, p: [3, 2] as const }
    expect(schedule.poseAt(EPOCH, anchor.at + 500, anchor).state).toBe('walk')
    const back = schedule.poseAt(EPOCH, anchor.at + 120_000, anchor)
    expect(back.p).toEqual([-3, 2])
    expect(back.yaw).toBe(0.5)
  })
})
