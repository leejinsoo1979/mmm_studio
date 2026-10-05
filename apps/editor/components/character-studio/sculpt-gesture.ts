import type { FaceHandleId, FacePin } from '@pascal-app/editor'
import { Matrix3, type Matrix4, Vector3 } from 'three'
import type { StageView } from './stage-contract'

/**
 * The face handles' gestures, pure: which handle a press lands on, how
 * far a handle shows as the face turns from the camera, and how a drag on
 * the screen becomes a move of the face's skin in its front view.
 */

/** How far (CSS px) from a handle a press still takes it: a fingertip covers more than a mouse pointer. */
export const HIT_RADIUS = { mouse: 22, touch: 30 } as const

export const hitRadius = (pointerType: string) =>
  pointerType === 'mouse' ? HIT_RADIUS.mouse : HIT_RADIUS.touch

/** How far (CSS px) a handle must be dragged before the drag counts: a press that wobbles less is a click. */
export const DRAG_THRESHOLD = 2

/** How far (front-view fractions) an arrow key nudges a grabbed handle; Shift nudges KEY_NUDGE_FAST times as far. */
export const KEY_NUDGE = 0.004
export const KEY_NUDGE_FAST = 4

/** A handle where it shows on the stage now (CSS px), and whether it can be seen (and so taken). */
export type ProjectedHandle = { handle: FaceHandleId; x: number; y: number; visible: boolean }

/** The nearest visible handle within `radius` px of a point, or null. */
export function nearestHandle(
  projected: Iterable<ProjectedHandle>,
  point: { x: number; y: number },
  radius: number,
): FaceHandleId | null {
  let best: FaceHandleId | null = null
  let nearest = radius
  for (const each of projected) {
    if (!each.visible) continue
    const distance = Math.hypot(each.x - point.x, each.y - point.y)
    if (distance <= nearest) {
      nearest = distance
      best = each.handle
    }
  }
  return best
}

/** How far a handle's skin faces the camera (the cosine) for it to show at all, and to show fully. */
export const FACING_HIDDEN = 0.1
export const FACING_SHOWN = 0.35

const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

/** How opaque a handle is for how far its skin faces the camera: none once the face has turned away. */
export function facingOpacity(facing: number): number {
  return facing < FACING_HIDDEN ? 0 : smoothstep(FACING_HIDDEN, FACING_SHOWN, facing)
}

/**
 * A grab's frame, fixed as the handle is taken: the camera's axes (right,
 * up, and towards it from the grabbed point), the world length of a CSS px
 * at the grabbed point's depth, what turns a world move back into the
 * head's bind pose (undoing its turn, its height and its size), how much
 * bigger than its bind pose the head stands (`scale`) and its front
 * view's size in the bind pose.
 */
export type GrabFrame = {
  right: Vector3
  up: Vector3
  toward: Vector3
  perPixel: number
  toBind: Matrix3
  scale: number
  size: number
}

/** What a perspective camera's frame needs of it. */
export type GrabCamera = {
  matrixWorld: Matrix4
  position: Vector3
  fov: number
}

/**
 * The frame for a grab at `point` (world), on a head whose skin matrix is
 * `skin` (bind pose to world, as the head bone carries it) and whose front
 * view is `size` across, seen by `camera` on a stage `cssHeight` px tall.
 */
export function grabFrame(
  camera: GrabCamera,
  point: Vector3,
  skin: Matrix4,
  size: number,
  cssHeight: number,
): GrabFrame {
  const e = camera.matrixWorld.elements
  const right = new Vector3(e[0], e[1], e[2]).normalize()
  const up = new Vector3(e[4], e[5], e[6]).normalize()
  const forward = new Vector3(-e[8]!, -e[9]!, -e[10]!).normalize()
  const offset = point.clone().sub(camera.position)
  const toward = offset.clone().negate().normalize()
  const depth = Math.max(1e-6, offset.dot(forward))
  const perPixel = (2 * depth * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, cssHeight)
  const toBind = new Matrix3().setFromMatrix4(skin).invert()
  const scale = new Vector3().setFromMatrixColumn(skin, 0).length()
  return { right, up, toward, perPixel, toBind, scale, size }
}

/**
 * A drag's move on the screen since the grab (CSS px): `dx` right and `dy`
 * down in the screen's plane, `dz` down the screen as a push away from the
 * camera (up pulls towards it).
 */
export type ScreenMove = { dx: number; dy: number; dz: number }

/** The screen move of a pointer dragged (dx, dy) px, a depth drag taking its vertical part as push and pull. */
export const pointerMove = (dx: number, dy: number, depth: boolean): ScreenMove =>
  depth ? { dx: 0, dy: 0, dz: dy } : { dx, dy, dz: 0 }

const round = (value: number) => Math.round(value * 1e5) / 1e5 || 0

/**
 * The face move (front-view fractions: dx right, dy down, dz towards the
 * viewer) for a screen move since the grab. Seen from the front a drag
 * moves across and up; from the side, across becomes forward and back.
 */
export function dragDelta(frame: GrabFrame, move: ScreenMove): FacePin {
  const world = new Vector3()
    .addScaledVector(frame.right, move.dx * frame.perPixel)
    .addScaledVector(frame.up, -move.dy * frame.perPixel)
    .addScaledVector(frame.toward, -move.dz * frame.perPixel)
  const bind = world.applyMatrix3(frame.toBind)
  return [round(bind.x / frame.size), round(-bind.y / frame.size), round(bind.z / frame.size)]
}

/** The radius (CSS px) a handle's sculpt spreads over: `radius` front-view fractions at the head's world `scale`. */
export function ringPixels(radius: number, size: number, scale: number, perPixel: number): number {
  return (radius * size * scale) / perPixel
}

/** How many CSS px one KEY_NUDGE of the face's front view spans on the screen, for a grab's frame. */
export function nudgePixels(frame: GrabFrame): number {
  return ringPixels(KEY_NUDGE, frame.size, frame.scale, frame.perPixel)
}

/** How far (radians) from a preset angle a turn snaps to it. */
export const SNAP = (4 * Math.PI) / 180

/** The preset turns: the face's front, its three-quarter and its profile. */
export const VIEW_TURN: Record<Exclude<StageView, 'free'>, number> = {
  front: 0,
  angle: Math.PI / 4,
  side: Math.PI / 2,
}

/** A turn brought within (−π, π]. */
export function wrapAngle(angle: number): number {
  const turn = 2 * Math.PI
  const wrapped = angle - turn * Math.floor((angle + Math.PI) / turn)
  return wrapped === -Math.PI ? Math.PI : wrapped
}

/**
 * Where a turn (the turntable's yaw) comes to rest: on a preset angle
 * (either side) when within SNAP of it, and which view that is; as it is,
 * and 'free', otherwise. The rest is the same number of whole turns round.
 */
export function snapTurn(yaw: number): { yaw: number; view: StageView } {
  const wrapped = wrapAngle(yaw)
  for (const view of ['front', 'angle', 'side'] as const) {
    for (const sign of [1, -1]) {
      const angle = sign * VIEW_TURN[view]
      if (Math.abs(wrapped - angle) <= SNAP) return { yaw: yaw - wrapped + angle, view }
    }
  }
  return { yaw, view: 'free' }
}

/** `angle` taken the same number of whole turns round as `near`, so the turntable doesn't spin back round to it. */
export function nearestTurn(angle: number, near: number): number {
  return near + wrapAngle(angle - near)
}

/**
 * The turn a view button asks for. 45° and 측면 keep the side last turned
 * to (`sign`); asked again while there, they turn to the other side.
 */
export function viewTurn(
  view: Exclude<StageView, 'free'>,
  current: StageView,
  yaw: number,
  sign: 1 | -1,
): { yaw: number; sign: 1 | -1 } {
  if (view === 'front') return { yaw: nearestTurn(0, yaw), sign }
  let side = sign
  if (current === view) side = wrapAngle(yaw) >= 0 ? -1 : 1
  return { yaw: nearestTurn(side * VIEW_TURN[view], yaw), sign: side }
}
