import type { WalkthroughCharacterId } from '../../../store/use-walkthrough-view'

/** A looping motion-capture cycle and the ground it covers per loop (m). */
export type GaitClip = { duration: number; distance: number }

/** The looping gaits, slowest first; each blends into the next by speed. */
export const GAITS = ['walk', 'walkFast', 'run', 'runFast'] as const
export type Gait = (typeof GAITS)[number]

/** Where a jump clip's phases fall (s): leaving the ground, the top, touching down. */
export type JumpMarks = { takeoff: number; apex: number; land: number; end: number }

/** The stretch (s) of a crouch clip where the body actually goes down or up. */
export type Span = { from: number; to: number }

export type CrouchSpans = { down: Span; up: Span }

/** A jump on the spot, and one out of a run. */
export type JumpKind = 'jump' | 'jumpRun'

export type WalkthroughCharacter = {
  url: string
  label: string
  gaits: Record<Gait, GaitClip>
  jumps: Record<JumpKind, JumpMarks>
  /** Crouch-in and crouch-out clips, trimmed to the motion (they open and close on long holds). */
  crouch: CrouchSpans
}

/** CMU 16_01 and 75_01, retargeted onto both avatars, so both share their timing. */
const JUMPS: Record<JumpKind, JumpMarks> = {
  jump: { takeoff: 0.1667, apex: 0.3667, land: 0.6, end: 1 },
  jumpRun: { takeoff: 0.1333, apex: 0.2667, land: 0.3833, end: 0.5667 },
}

/**
 * Microsoft Rocketbox avatars (MIT) with their own motion-capture clips plus a
 * CMU motion-capture jump, converted by
 * `scripts/characters/build-rocketbox-character.py`. Cycle lengths and
 * distances are measured from the clips' extracted root motion.
 */
export const WALKTHROUGH_CHARACTERS: Record<WalkthroughCharacterId, WalkthroughCharacter> = {
  male: {
    url: '/characters/rocketbox-male.glb',
    label: '남성',
    gaits: {
      walk: { duration: 1.2, distance: 1.214 },
      walkFast: { duration: 1.0667, distance: 1.5951 },
      run: { duration: 0.7333, distance: 2.1118 },
      runFast: { duration: 0.6, distance: 3.5037 },
    },
    jumps: JUMPS,
    crouch: { down: { from: 1.4, to: 2.9 }, up: { from: 0.9, to: 2.3 } },
  },
  female: {
    url: '/characters/rocketbox-female.glb',
    label: '여성',
    gaits: {
      walk: { duration: 1.2, distance: 1.4565 },
      walkFast: { duration: 1.0333, distance: 1.5815 },
      run: { duration: 0.7667, distance: 2.12 },
      runFast: { duration: 0.7, distance: 3.765 },
    },
    jumps: JUMPS,
    crouch: { down: { from: 0.4, to: 1.8 }, up: { from: 0.2, to: 1.4 } },
  },
}

/** Walking and running speeds (m/s); Shift runs. */
export const WALK_SPEED = 2
export const RUN_SPEED = 5.5

/**
 * Each gait plays alone at this multiple of the speed it was recorded at: the
 * stride stays the performer's, the cadence picks up to a brisker, game pace.
 */
const GAIT_PACE = 1.25

/** Taking off faster than this (m/s) starts to blend in the running jump… */
const RUNNING_JUMP_FROM = 1.2
/** …and from this speed it is the running jump alone. */
const RUNNING_JUMP_TO = 3.2

/** Below this horizontal speed (m/s) the body stands still. */
const STANDING_SPEED = 0.05

export type LocomotionWeights = Record<'idle' | Gait, number> & {
  /** Ground covered by one loop of the blended gait (m). */
  loopDistance: number
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/** The speed (m/s) at which a gait plays alone. */
export const gaitSpeed = (clip: GaitClip) => (GAIT_PACE * clip.distance) / clip.duration

/**
 * Blend for a horizontal speed: standing fades into the walk, and each gait
 * hands over to the next one between the speeds they play alone at, so every
 * speed is played by the clips recorded closest to it.
 */
export function locomotionWeights(
  speed: number,
  character: Pick<WalkthroughCharacter, 'gaits'>,
): LocomotionWeights {
  const weights: LocomotionWeights = {
    idle: 0,
    walk: 0,
    walkFast: 0,
    run: 0,
    runFast: 0,
    loopDistance: character.gaits.walk.distance,
  }
  const first = character.gaits.walk
  if (speed <= STANDING_SPEED) {
    weights.idle = 1
    return weights
  }
  if (speed <= gaitSpeed(first)) {
    const walk = smoothstep(clamp01(speed / gaitSpeed(first)))
    weights.idle = 1 - walk
    weights.walk = walk
    return weights
  }
  for (let i = 0; i < GAITS.length - 1; i++) {
    const from = GAITS[i]!
    const to = GAITS[i + 1]!
    const low = gaitSpeed(character.gaits[from])
    const high = gaitSpeed(character.gaits[to])
    if (speed > high && i < GAITS.length - 2) continue
    const t = smoothstep(clamp01((speed - low) / (high - low)))
    weights[from] = 1 - t
    weights[to] = t
    weights.loopDistance =
      character.gaits[from].distance +
      (character.gaits[to].distance - character.gaits[from].distance) * t
    return weights
  }
  return weights
}

/**
 * Advances the shared gait phase (0–1, one loop of any gait) by the ground
 * actually covered, so the feet never slide: a loop lasts as long as it takes
 * to cover the blended gaits' stride at the current speed.
 */
export function advanceGaitPhase(
  phase: number,
  speed: number,
  delta: number,
  loopDistance: number,
): number {
  if (speed <= STANDING_SPEED) return phase
  const next = phase + (speed * delta) / loopDistance
  return next - Math.floor(next)
}

/**
 * The jump clip's time for a body in the air: rising plays take-off → top as
 * the upward speed runs out, falling plays top → touch-down as the body drops
 * back to where it left the ground.
 */
export function airborneJumpTime(
  marks: JumpMarks,
  air: { launchSpeed: number; verticalSpeed: number; height: number; peak: number },
): number {
  if (air.verticalSpeed > 0 && air.launchSpeed > 0) {
    const rise = clamp01(1 - air.verticalSpeed / air.launchSpeed)
    return marks.takeoff + (marks.apex - marks.takeoff) * rise
  }
  const fall = air.peak > 0 ? clamp01(1 - air.height / air.peak) : 1
  return marks.apex + (marks.land - marks.apex) * fall
}

/** How much of a jump is the running jump, for the speed (m/s) it took off at. */
export function runningJumpWeight(speed: number): number {
  return smoothstep(clamp01((speed - RUNNING_JUMP_FROM) / (RUNNING_JUMP_TO - RUNNING_JUMP_FROM)))
}
