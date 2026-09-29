import type { WalkthroughCharacterId } from '../../../store/use-walkthrough-view'

/** A looping motion-capture cycle and the ground it covers per loop (m). */
export type GaitClip = { duration: number; distance: number }

export type WalkthroughCharacter = {
  url: string
  label: string
  walk: GaitClip
  run: GaitClip
}

/**
 * Microsoft Rocketbox avatars (MIT) with their own motion-capture clips,
 * converted by `scripts/characters/build-rocketbox-character.py`. Cycle
 * lengths and distances are measured from the clips' extracted root motion.
 */
export const WALKTHROUGH_CHARACTERS: Record<WalkthroughCharacterId, WalkthroughCharacter> = {
  male: {
    url: '/characters/rocketbox-male.glb',
    label: '남성',
    walk: { duration: 1.2, distance: 1.214 },
    run: { duration: 0.7333, distance: 2.1118 },
  },
  female: {
    url: '/characters/rocketbox-female.glb',
    label: '여성',
    walk: { duration: 1.2, distance: 1.4565 },
    run: { duration: 0.7667, distance: 2.12 },
  },
}

/** Third-person walking and running speeds (m/s); Shift runs. */
export const THIRD_PERSON_WALK_SPEED = 1.3
export const THIRD_PERSON_RUN_SPEED = 3.3

/** Below this horizontal speed (m/s) the body stands still. */
const STANDING_SPEED = 0.05

export type LocomotionWeights = { idle: number; walk: number; run: number; runBlend: number }

const smoothstep = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/**
 * Idle → walk → run blend for a horizontal speed: idle fades into the walk
 * up to walking speed, then the walk hands over to the run.
 */
export function locomotionWeights(
  speed: number,
  walkSpeed = THIRD_PERSON_WALK_SPEED,
  runSpeed = THIRD_PERSON_RUN_SPEED,
): LocomotionWeights {
  if (speed <= STANDING_SPEED) return { idle: 1, walk: 0, run: 0, runBlend: 0 }
  if (speed <= walkSpeed) {
    const walk = smoothstep(clamp01(speed / walkSpeed))
    return { idle: 1 - walk, walk, run: 0, runBlend: 0 }
  }
  const run = smoothstep(clamp01((speed - walkSpeed) / (runSpeed - walkSpeed)))
  return { idle: 0, walk: 1 - run, run, runBlend: run }
}

/**
 * Advances the shared gait phase (0–1, one loop of either clip) by the ground
 * actually covered, so the feet never slide: a loop lasts as long as it takes
 * to cover the blended clips' stride at the current speed.
 */
export function advanceGaitPhase(
  phase: number,
  speed: number,
  delta: number,
  character: Pick<WalkthroughCharacter, 'walk' | 'run'>,
  runBlend: number,
): number {
  if (speed <= STANDING_SPEED) return phase
  const loopDistance =
    character.walk.distance + (character.run.distance - character.walk.distance) * runBlend
  const next = phase + (speed * delta) / loopDistance
  return next - Math.floor(next)
}
