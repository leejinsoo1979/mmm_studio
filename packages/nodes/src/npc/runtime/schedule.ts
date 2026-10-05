import {
  findPath,
  measurePath,
  type NavGrid,
  type NavPath,
  type NavPoint,
  navCellAt,
  navCellCenter,
  nearestWalkableCell,
  randomWalkableInRadius,
  samplePathAt,
  smoothPath,
} from '@pascal-app/core'
import type { NpcNode, NpcSpeed } from '../schema'
import type { NpcEmoteCue } from '../types'
import { npcSeed, rngFor } from './random'
import { type NpcRoomMap, roomOfCell } from './rooms'

/**
 * The shared, deterministic day of an NPC: where it is at any moment is a pure
 * function of the scene, the NPC, the shared epoch, the last release anchor
 * and the time. Every player computes it alone and they all agree, and a
 * player who joins late finds it in O(1) (one or two legs to plan).
 *
 * Time is cut into slots. A slot walks from the previous slot's target to its
 * own and then dwells there until the slot ends (wander: random reachable
 * spots near home, patrol: the drawn points in order, stand: home). The
 * shared path uses only + − × ÷ and sqrt, candidates in cell order and seeded
 * draws; `atan2` only turns the body.
 */

export const NPC_WALK_SPEEDS: Record<NpcSpeed, number> = { slow: 0.9, normal: 1.25, brisk: 1.6 }

/** Wander and stand slot length bounds (s). */
const MIN_SLOT = 8
const MAX_SLOT = 40
/** A wander target is at most this share of a slot's walk from home, so any leg (via home)
 *  fits in 2× that. */
const TARGET_REACH_SHARE = 0.4
/** A dwell's idle emote: drawn with this chance, this long after arriving. */
const EMOTE_CHANCE = 0.35
const EMOTE_DELAY = 1.5
/** Slots closer than this (s) don't both play an idle emote. */
const EMOTE_GAP = 20
/** Patrol legs last at least this long (s), even between two equal points with no dwell. */
const MIN_PATROL_LEG = 1
/** A release catch-up leg may run over this many slots before the schedule takes over. */
const CATCH_UP_SLOTS = 6
/** A path ending this close (m) short of its goal (snapped to walkable) still steps onto it. */
const GOAL_STEP = 0.6
const LEG_CACHE = 8

/** Where a released NPC was let go: the schedule walks it back from `p` at `at` (ms). */
export type NpcScheduleAnchor = { at: number; p: readonly [number, number] }

export type NpcSchedulePose = {
  /** Level-local XZ. */
  p: NavPoint
  /** Level-local floor height (the nav cell's). */
  y: number
  yaw: number
  speed: number
  state: 'idle' | 'walk'
  /** The slot this pose is in (for tests and caches). */
  slot: number
  /** The dwell's idle emote, on the shared ms clock. */
  emote: NpcEmoteCue | null
}

const dist = (a: Readonly<NavPoint>, b: Readonly<NavPoint>) =>
  Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]))

/** A walkable route `from → to`: string-pulled A*, starting exactly at `from`. Straight when
 *  there is no grid or no way through. */
export function planPath(
  grid: NavGrid | null,
  from: Readonly<NavPoint>,
  to: Readonly<NavPoint>,
): NavPath {
  const start: NavPoint = [from[0], from[1]]
  const goal: NavPoint = [to[0], to[1]]
  const raw = grid ? findPath(grid, start, goal) : null
  if (!(grid && raw)) return measurePath([start, goal])
  const points = smoothPath(grid, raw)
  const first = points[0]
  if (first && dist(first, start) > 0) points.unshift(start)
  const last = points[points.length - 1]
  if (last && dist(last, goal) > 0 && dist(last, goal) < GOAL_STEP) points.push(goal)
  return measurePath(points)
}

/** The level-local floor height under `p` (0 off the grid). */
export function navHeightAt(grid: NavGrid | null, p: Readonly<NavPoint>): number {
  if (!grid) return 0
  const cell = navCellAt(grid, p)
  return cell < 0 ? 0 : (grid.height[cell] ?? 0)
}

const SQRT2 = Math.sqrt(2)

/** Walking distance (m) from `startCell` to every cell reachable within `limit`, by Dijkstra
 *  over the 8-connected grid without corner cutting (A*'s moves). */
export function reachWithin(grid: NavGrid, startCell: number, limit: number): Map<number, number> {
  const reach = new Map<number, number>()
  if (startCell < 0 || !grid.walkable[startCell]) return reach
  const { cols, rows, walkable, cellSize } = grid
  const open = (col: number, row: number) =>
    col >= 0 && row >= 0 && col < cols && row < rows && walkable[row * cols + col] === 1
  // Binary heap of [distance, cell], ties to the lower cell.
  const heap: [number, number][] = []
  const less = (a: [number, number], b: [number, number]) =>
    a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])
  const push = (item: [number, number]) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!less(heap[i]!, heap[parent]!)) break
      ;[heap[i], heap[parent]] = [heap[parent]!, heap[i]!]
      i = parent
    }
  }
  const pop = () => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && less(heap[l]!, heap[m]!)) m = l
        if (r < heap.length && less(heap[r]!, heap[m]!)) m = r
        if (m === i) break
        ;[heap[i], heap[m]] = [heap[m]!, heap[i]!]
        i = m
      }
    }
    return top
  }

  const best = new Map<number, number>([[startCell, 0]])
  push([0, startCell])
  while (heap.length > 0) {
    const [d, cell] = pop()
    if (reach.has(cell) || d > (best.get(cell) ?? Infinity)) continue
    reach.set(cell, d)
    const col = cell % cols
    const row = (cell - col) / cols
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        if (!open(col + dc, row + dr)) continue
        const diagonal = dr !== 0 && dc !== 0
        if (diagonal && !(open(col + dc, row) && open(col, row + dr))) continue
        const next = (row + dr) * cols + col + dc
        const nd = d + (diagonal ? SQRT2 : 1) * cellSize
        if (nd > limit || reach.has(next) || nd >= (best.get(next) ?? Infinity)) continue
        best.set(next, nd)
        push([nd, next])
      }
    }
  }
  return reach
}

/** How a mode cuts schedule time (seconds from the epoch, phase-shifted) into slots. */
type Plan = {
  slotOf(u: number): number
  start(k: number): number
  end(k: number): number
  /** Slot k's walk, from slot k-1's target to its own. */
  leg(k: number): NavPath
  /** Facing while dwelling at the end of a leg; null = the leg's last heading. */
  restYaw: number | null
  /** How long (s) the schedule takes to come round (a slot; a whole patrol). */
  period: number
}

function remember<T>(cache: Map<number, T>, k: number, make: () => T): T {
  const known = cache.get(k)
  if (known !== undefined) return known
  const value = make()
  cache.set(k, value)
  if (cache.size > LEG_CACHE) cache.delete(cache.keys().next().value as number)
  return value
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Stands at home; slots only pace the idle emotes. */
function standPlan(home: NavPoint, dwellMax: number, homeYaw: number): Plan {
  const D = clamp(dwellMax, MIN_SLOT, MAX_SLOT)
  const still = measurePath([home])
  return {
    slotOf: (u) => Math.floor(u / D),
    start: (k) => k * D,
    end: (k) => (k + 1) * D,
    leg: () => still,
    restYaw: homeYaw,
    period: D,
  }
}

function wanderPlan(
  npc: NpcNode,
  seed: number,
  grid: NavGrid,
  rooms: NpcRoomMap | null,
  v: number,
): Plan | null {
  const { wanderRadius: r, dwell } = npc.behavior
  const homeCell = nearestWalkableCell(grid, [npc.position[0], npc.position[2]])
  if (homeCell < 0) return null
  const home = navCellCenter(grid, homeCell)
  const region = grid.region[homeCell] ?? null
  const D = clamp((2 * r) / v + dwell[1], MIN_SLOT, MAX_SLOT)
  const reach = reachWithin(grid, homeCell, TARGET_REACH_SHARE * v * D)
  const allowed = npc.behavior.rooms.length > 0 && rooms ? new Set(npc.behavior.rooms) : null
  const accept = (cell: number) => {
    if (!reach.has(cell)) return false
    if (!allowed || !rooms) return true
    const room = roomOfCell(rooms, cell)
    return room !== null && allowed.has(room)
  }
  const targets = new Map<number, NavPoint>()
  const legs = new Map<number, NavPath>()
  const target = (k: number): NavPoint =>
    k < 0
      ? home
      : remember(
          targets,
          k,
          () =>
            randomWalkableInRadius(
              grid,
              home,
              r,
              rngFor(seed, npc.id, k, 'target'),
              region,
              accept,
            ) ?? home,
        )
  return {
    slotOf: (u) => Math.floor(u / D),
    start: (k) => k * D,
    end: (k) => (k + 1) * D,
    leg: (k) => remember(legs, k, () => planPath(grid, target(k - 1), target(k))),
    restYaw: null,
    period: D,
  }
}

function patrolPlan(npc: NpcNode, seed: number, grid: NavGrid | null, v: number): Plan | null {
  const { patrol, patrolLoop, dwell } = npc.behavior
  if (patrol.length < 2) return null
  let points: NavPoint[] = patrol.map(([x, z]) => [x, z])
  if (grid) {
    const first = nearestWalkableCell(grid, points[0]!)
    const region = first >= 0 ? (grid.region[first] ?? null) : null
    points = points.map((p) => {
      const cell = nearestWalkableCell(grid, p, region)
      return cell < 0 ? p : navCellCenter(grid, cell)
    })
  }
  const order =
    patrolLoop === 'pingpong'
      ? [...points.keys(), ...[...points.keys()].reverse().slice(1)]
      : [...points.keys(), 0]
  const legs: NavPath[] = []
  const prefix: number[] = []
  const durations: number[] = []
  let period = 0
  for (let j = 0; j + 1 < order.length; j++) {
    const path = planPath(grid, points[order[j]!]!, points[order[j + 1]!]!)
    const rest = dwell[0] + rngFor(seed, npc.id, j, 'dwell')() * (dwell[1] - dwell[0])
    const duration = Math.max(MIN_PATROL_LEG, path.length / v + rest)
    legs.push(path)
    prefix.push(period)
    durations.push(duration)
    period += duration
  }
  const m = legs.length
  const split = (k: number) => {
    const c = Math.floor(k / m)
    return [c, k - c * m] as const
  }
  return {
    slotOf: (u) => {
      const c = Math.floor(u / period)
      const within = u - c * period
      let low = 0
      let high = m - 1
      while (low < high) {
        const mid = (low + high + 1) >> 1
        if (prefix[mid]! <= within) low = mid
        else high = mid - 1
      }
      return c * m + low
    },
    start: (k) => {
      const [c, j] = split(k)
      return c * period + prefix[j]!
    },
    end: (k) => {
      const [c, j] = split(k)
      return c * period + prefix[j]! + durations[j]!
    },
    leg: (k) => legs[split(k)[1]]!,
    restYaw: null,
    period,
  }
}

type CatchUp = { key: string; slot: number; path: NavPath; from: number; until: number }

/** One NPC's schedule over one nav grid. Reuse it: it caches the legs it planned. */
export class NpcSchedule {
  readonly speed: number
  /** Phase shift (s) so NPCs placed together don't move in step. */
  private readonly offset: number
  private readonly seed: number
  private readonly plan: Plan
  private readonly homeYaw: number
  private readonly emoteDraws = new Map<number, { id: string } | null>()
  private catchUp: CatchUp | null = null

  constructor(
    readonly npc: NpcNode,
    readonly grid: NavGrid | null,
    readonly rooms: NpcRoomMap | null,
  ) {
    this.seed = npcSeed(npc.behavior.seed, npc.id)
    this.speed = NPC_WALK_SPEEDS[npc.behavior.speed]
    this.homeYaw = npc.rotation
    const home: NavPoint = [npc.position[0], npc.position[2]]
    const mode = npc.behavior.mode
    this.plan =
      (mode === 'wander' && grid ? wanderPlan(npc, this.seed, grid, rooms, this.speed) : null) ??
      (mode === 'patrol' ? patrolPlan(npc, this.seed, grid, this.speed) : null) ??
      standPlan(home, npc.behavior.dwell[1], this.homeYaw)
    this.offset = rngFor(this.seed, npc.id, 0, 'phase')() * this.plan.period
  }

  /** The pose at `t` (shared ms) for the schedule started at `epoch`, after the last release. */
  poseAt(epoch: number, t: number, anchor: NpcScheduleAnchor | null = null): NpcSchedulePose {
    const u = (t - epoch) / 1000 + this.offset
    if (anchor && t >= anchor.at) {
      const catchUp = this.catchUpLeg(epoch, anchor)
      if (u < catchUp.until) return this.walk(catchUp.path, u - catchUp.from, catchUp.slot, null)
    }
    const k = this.plan.slotOf(u)
    const start = this.plan.start(k)
    return this.walk(this.plan.leg(k), Math.max(0, u - start), k, this.emoteOf(k, epoch))
  }

  /** From the anchor to the target of the slot it fell in, or of a later slot when the walk
   *  back wouldn't end within that slot; the schedule takes over after that slot. */
  private catchUpLeg(epoch: number, anchor: NpcScheduleAnchor): CatchUp {
    const key = `${epoch}|${anchor.at}|${anchor.p[0]}|${anchor.p[1]}`
    if (this.catchUp?.key === key) return this.catchUp
    const from = (anchor.at - epoch) / 1000 + this.offset
    let slot = this.plan.slotOf(from)
    let path: NavPath
    let arrive: number
    for (let i = 0; ; i++) {
      const points = this.plan.leg(slot).points
      const target = points[points.length - 1] ?? [anchor.p[0], anchor.p[1]]
      path = planPath(this.grid, anchor.p, target)
      arrive = from + path.length / this.speed
      if (arrive <= this.plan.end(slot) || i === CATCH_UP_SLOTS - 1) break
      slot++
    }
    this.catchUp = { key, slot, path, from, until: Math.max(arrive, this.plan.end(slot)) }
    return this.catchUp
  }

  private walk(
    path: NavPath,
    elapsed: number,
    slot: number,
    emote: { id: string; atU: number; at: number } | null,
  ): NpcSchedulePose {
    const s = elapsed * this.speed
    if (s < path.length) {
      const { p, heading } = samplePathAt(path, s)
      return {
        p,
        y: navHeightAt(this.grid, p),
        yaw: Math.atan2(heading[0], heading[1]),
        speed: this.speed,
        state: 'walk',
        slot,
        emote: null,
      }
    }
    const last = path.points[path.points.length - 1] ?? [this.npc.position[0], this.npc.position[2]]
    const p: NavPoint = [last[0], last[1]]
    let yaw = this.plan.restYaw ?? this.homeYaw
    if (this.plan.restYaw === null && path.points.length >= 2) {
      const { heading } = samplePathAt(path, path.length)
      yaw = Math.atan2(heading[0], heading[1])
    }
    return {
      p,
      y: navHeightAt(this.grid, p),
      yaw,
      speed: 0,
      state: 'idle',
      slot,
      emote: emote ? { id: emote.id, at: emote.at } : null,
    }
  }

  /** Whether slot k draws an idle emote, and which (seeded, cached). */
  private drawEmote(k: number): { id: string } | null {
    return remember(this.emoteDraws, k, () => {
      const emotes = this.npc.behavior.idleEmotes
      if (emotes.length === 0) return null
      const rand = rngFor(this.seed, this.npc.id, k, 'emote')
      if (rand() >= EMOTE_CHANCE) return null
      const id = emotes[Math.min(emotes.length - 1, Math.floor(rand() * emotes.length))]
      return id ? { id } : null
    })
  }

  /** Slot k's idle emote, shortly after it arrives, unless the slot before had one too soon. */
  private emoteOf(k: number, epoch: number) {
    const drawn = this.drawEmote(k)
    if (!drawn) return null
    const start = this.plan.start(k)
    if (start - this.plan.start(k - 1) < EMOTE_GAP && this.drawEmote(k - 1)) return null
    const atU = start + this.plan.leg(k).length / this.speed + EMOTE_DELAY
    if (atU >= this.plan.end(k)) return null
    return { id: drawn.id, atU, at: Math.round(epoch + (atU - this.offset) * 1000) }
  }
}

const schedules = new WeakMap<NpcNode, NpcSchedule>()

/** The schedule of `npc` on `grid` (cached while the node, grid and rooms stay the same). */
export function npcScheduleFor(
  npc: NpcNode,
  grid: NavGrid | null,
  rooms: NpcRoomMap | null,
): NpcSchedule {
  const known = schedules.get(npc)
  if (known && known.grid === grid && known.rooms === rooms) return known
  const schedule = new NpcSchedule(npc, grid, rooms)
  schedules.set(npc, schedule)
  return schedule
}

export type NpcScheduleInput = {
  npc: NpcNode
  grid: NavGrid | null
  rooms: NpcRoomMap | null
  epoch: number
  anchor: NpcScheduleAnchor | null
}

/** Where the NPC is at `t` (shared ms) by its schedule. */
export function schedulePoseAt(input: NpcScheduleInput, t: number): NpcSchedulePose {
  return npcScheduleFor(input.npc, input.grid, input.rooms).poseAt(input.epoch, t, input.anchor)
}
