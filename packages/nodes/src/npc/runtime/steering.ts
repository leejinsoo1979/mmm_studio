import {
  type NavGrid,
  type NavPath,
  type NavPoint,
  navCellAt,
  samplePathAt,
} from '@pascal-app/core'
import { planPath } from './schedule'

/**
 * Local movement that isn't part of the shared schedule: stepping aside for
 * people in the way, and following a player over the nav grid. Each player
 * steers on their own; nothing here is shared.
 */

/** Someone closer than this (m) to an NPC's spot makes it step aside… */
const AVOID_RADIUS = 0.7
/** …by at most this much (m). */
export const AVOID_MAX = 0.5
/** How fast (1/s) the step aside grows, and fades once the way is clear. */
const AVOID_GROW = 6
const AVOID_DECAY = 2

const length = (x: number, z: number) => Math.sqrt(x * x + z * z)

/**
 * The NPC's sidestep after `dt` s: away from the people (`others`, level-local
 * feet) within AVOID_RADIUS of its spot `p`, across its walking direction when
 * it walks (`heading`, unit), capped at AVOID_MAX; it fades back to nothing
 * when nobody is near.
 */
export function avoidanceOffset(
  current: Readonly<NavPoint>,
  p: Readonly<NavPoint>,
  heading: Readonly<NavPoint> | null,
  others: readonly Readonly<NavPoint>[],
  dt: number,
): NavPoint {
  let pushX = 0
  let pushZ = 0
  for (const other of others) {
    const dx = p[0] - other[0]
    const dz = p[1] - other[1]
    const d = length(dx, dz)
    if (d >= AVOID_RADIUS) continue
    const weight = AVOID_RADIUS - d
    if (d > 1e-6) {
      pushX += (dx / d) * weight
      pushZ += (dz / d) * weight
    } else if (heading) {
      // Right on the spot: step to the right of the way.
      pushX += -heading[1] * weight
      pushZ += heading[0] * weight
    } else {
      pushX += weight
    }
  }
  if (heading) {
    // Walking: only sideways, so the NPC keeps its pace along the path.
    const sideX = -heading[1]
    const sideZ = heading[0]
    const side = pushX * sideX + pushZ * sideZ
    pushX = sideX * side
    pushZ = sideZ * side
  }
  // A full push (someone on the spot) asks for the whole sidestep.
  const wanted = length(pushX, pushZ)
  const scale =
    wanted > 0 ? Math.min(AVOID_MAX, (wanted / AVOID_RADIUS) * AVOID_MAX * 1.5) / wanted : 0
  const targetX = pushX * scale
  const targetZ = pushZ * scale
  const rate = length(targetX, targetZ) > length(current[0], current[1]) ? AVOID_GROW : AVOID_DECAY
  const blend = 1 - Math.exp(-rate * dt)
  let x = current[0] + (targetX - current[0]) * blend
  let z = current[1] + (targetZ - current[1]) * blend
  const size = length(x, z)
  if (size > AVOID_MAX) {
    x *= AVOID_MAX / size
    z *= AVOID_MAX / size
  }
  if (size < 1e-4) return [0, 0]
  return [x, z]
}

/** `offset` cut back until `p + offset` stands on walkable floor (or dropped). */
export function walkableOffset(
  grid: NavGrid | null,
  p: Readonly<NavPoint>,
  offset: Readonly<NavPoint>,
): NavPoint {
  if (!grid || (offset[0] === 0 && offset[1] === 0)) return [offset[0], offset[1]]
  for (const share of [1, 0.5]) {
    const cell = navCellAt(grid, [p[0] + offset[0] * share, p[1] + offset[1] * share])
    if (cell >= 0 && grid.walkable[cell]) return [offset[0] * share, offset[1] * share]
  }
  return [0, 0]
}

/** How far (m) behind the player a follower keeps. */
export const FOLLOW_GAP = 1.2
/** Further than this (m) from the player the follower runs. */
const FOLLOW_RUN_DISTANCE = 4
const FOLLOW_RUN_SPEED = 3.5
const FOLLOW_WALK_MAX = 1.6
/** Below this (m/s) the follower just stands. */
const FOLLOW_MIN_SPEED = 0.15
/** It plans again when the spot behind the player moved this far (m), or this often (ms). */
const REPLAN_MOVE = 1
const REPLAN_MS = 1000

export type FollowStep = { p: NavPoint; speed: number; yaw: number }

/** A follower walking to the spot behind a player over the nav grid. */
export class FollowSteer {
  p: NavPoint
  private path: NavPath | null = null
  private s = 0
  private plannedFor: NavPoint | null = null
  private plannedAt = Number.NEGATIVE_INFINITY

  constructor(p: Readonly<NavPoint>) {
    this.p = [p[0], p[1]]
  }

  /** One frame toward `player` (level-local feet and facing); `now` in ms. */
  step(
    grid: NavGrid | null,
    player: { p: Readonly<NavPoint>; yaw: number },
    dt: number,
    now: number,
  ): FollowStep {
    const behind: NavPoint = [
      player.p[0] - Math.sin(player.yaw) * FOLLOW_GAP,
      player.p[1] - Math.cos(player.yaw) * FOLLOW_GAP,
    ]
    const moved = this.plannedFor
      ? length(behind[0] - this.plannedFor[0], behind[1] - this.plannedFor[1])
      : Number.POSITIVE_INFINITY
    if (!this.path || moved > REPLAN_MOVE || now - this.plannedAt > REPLAN_MS) {
      this.path = planPath(grid, this.p, behind)
      this.s = 0
      this.plannedFor = behind
      this.plannedAt = now
    }

    const toPlayer = length(player.p[0] - this.p[0], player.p[1] - this.p[1])
    let speed =
      toPlayer > FOLLOW_RUN_DISTANCE
        ? FOLLOW_RUN_SPEED
        : Math.min(FOLLOW_WALK_MAX, Math.max(0, (toPlayer - FOLLOW_GAP) * 1.5))
    const remaining = this.path.length - this.s
    if (speed < FOLLOW_MIN_SPEED || remaining <= 0.05) speed = 0

    const facePlayer = Math.atan2(player.p[0] - this.p[0], player.p[1] - this.p[1])
    if (speed === 0) return { p: [this.p[0], this.p[1]], speed: 0, yaw: facePlayer }
    this.s = Math.min(this.path.length, this.s + speed * dt)
    const { p, heading } = samplePathAt(this.path, this.s)
    this.p = p
    return { p: [p[0], p[1]], speed, yaw: Math.atan2(heading[0], heading[1]) }
  }
}
