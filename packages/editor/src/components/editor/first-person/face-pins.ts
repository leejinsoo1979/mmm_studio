import { type ProportionalOptions, proportionalShares } from './face-edit'
import { FACE_PARTS, FACE_POINT_INDICES, type Point, unpackPoints } from './face-points'
import type { ShapeField } from './face-shape'

/**
 * Sculpting a face without a photo: the player grabs a point of their
 * character's face and pulls it — across the screen, or in and out — and
 * the face round it follows (proportional editing, as face-edit.ts fits a
 * photo's mask). What they did is kept as pins: how far each landmark has
 * been pulled from where the character has it, in the head's front view
 * (head-geometry.ts frames it). Pins are small and plain — they are saved
 * with the face's shape and shared — and suit any head whose landmarks are
 * known. Landmarks are MediaPipe's numbers throughout, as the pins are
 * keyed. The irises are never pinned: where an eye looks is not the face's
 * shape.
 */

/**
 * How far a landmark is pulled: across (dx, right), down (dy) and out of
 * the face (dz, towards the viewer), in fractions of the front view.
 */
export type FacePin = [dx: number, dy: number, dz: number]

/** The player's pins, by MediaPipe landmark (its number as a string, the way JSON keys it). */
export type FacePins = Record<string, FacePin>

/**
 * How far a pin may pull its landmark (fractions of the front view): about
 * half the distance between a character's eyes, past which a face stops
 * looking like one.
 */
export const MAX_PIN = 0.12

const IRISES = new Set<number>([...FACE_PARTS.rightIris, ...FACE_PARTS.leftIris])

/** The face points pins can pull (by place): every one but the irises'. */
const SKIN = FACE_POINT_INDICES.flatMap((_, i) => (IRISES.has(i) ? [] : [i]))

const SKIN_LANDMARKS = new Set(SKIN.map((i) => FACE_POINT_INDICES[i]!))

/** Rounded to 1/10000 alike either side of zero, so mirrored pins stay mirrored. */
const rounded = (value: number) => (Math.sign(value) * Math.round(Math.abs(value) * 1e4)) / 1e4 + 0

/** A pin kept within MAX_PIN and rounded as stored, or null when it pulls nothing. */
function keptPin(pin: readonly [number, number, number]): FacePin | null {
  const length = Math.hypot(pin[0], pin[1], pin[2])
  const scale = length > MAX_PIN ? MAX_PIN / length : 1
  const kept: FacePin = [rounded(pin[0] * scale), rounded(pin[1] * scale), rounded(pin[2] * scale)]
  return kept.some((value) => value !== 0) ? kept : null
}

const isPin = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n))

/**
 * Pins as saved or received: landmarks that aren't face points (or are an
 * iris's), and pins that aren't three numbers, dropped; the rest kept
 * within MAX_PIN.
 */
export function readFacePins(value: unknown): FacePins {
  const pins: FacePins = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return pins
  for (const [key, pin] of Object.entries(value)) {
    const landmark = Number(key)
    if (String(landmark) !== key || !SKIN_LANDMARKS.has(landmark) || !isPin(pin)) continue
    const kept = keptPin(pin)
    if (kept) pins[key] = kept
  }
  return pins
}

export const hasPins = (pins: FacePins | null | undefined) =>
  Boolean(pins && Object.values(pins).some((pin) => pin.some((value) => value !== 0)))

/**
 * Pins after a pull on `landmark` by `delta` (fractions of the front view;
 * dz towards the viewer): it and the landmarks round it, where they are now
 * on `target` (the character's packed front-view points), move by their
 * shares of it (proportional editing; with `symmetric`, mirrored across
 * the head's middle, which is upright in its front view, so dx flips).
 * Pulls add up, and the pins given are left as they were. An iris isn't
 * shape: grabbing one pins nothing.
 *
 * The pins come back rounded as stored, and the shares are measured where
 * the landmarks are now, so a drag is applied as dragPoints applies one:
 * every frame from the pins as they were when grabbed, with the whole way
 * moved so far. Frame by frame, the rounding and the moving landmarks would
 * make the result depend on how fast the player dragged.
 */
export function sculpt(
  pins: FacePins,
  landmark: number,
  delta: FacePin,
  options: ProportionalOptions,
  target: readonly number[],
): FacePins {
  if (!SKIN_LANDMARKS.has(landmark)) return pins
  const now = unpackPoints(target).map(([x, y], i): Point => {
    const pin = pins[FACE_POINT_INDICES[i]!]
    return pin ? [x + pin[0], y + pin[1]] : [x, y]
  })
  const shares = proportionalShares(now, landmark, options)
  const next: FacePins = {}
  for (const i of SKIN) {
    const key = FACE_POINT_INDICES[i]!
    const { weight, across } = shares[i]!
    const [x, y, z] = pins[key] ?? [0, 0, 0]
    const kept = keptPin([
      x + weight * across * delta[0],
      y + weight * delta[1],
      z + weight * delta[2],
    ])
    if (kept) next[key] = kept
  }
  return next
}

/**
 * How far a pinned landmark's pull spreads, in the distances from it to
 * its third-nearest landmark: far enough that the pulls of neighbouring
 * landmarks overlap, so a region pulled as one moves as one, without
 * dimples between its landmarks; near enough that a small pull stays
 * small where landmarks crowd (round the eyes and lips).
 */
const SPREAD = 4

/**
 * How far a pull spreads at least, in the lengths of its move across the
 * face: a long pull drags more skin along, which stretches and squeezes
 * gently rather than bunching up into a crease.
 */
const DRAG = 2

/**
 * A pull shorter than a neighbour's by this share of the neighbour's, or
 * more, stops short of the neighbour's landmark, so that landmark lands
 * where it is pinned; one nearly as long reaches on past it (the nearer
 * their lengths, the further), so that pulls alike blend as one.
 */
const YIELD = 0.25

/**
 * How many steps the pins' flow is followed in: enough that where pulls
 * meet steeply, a step can't carry skin past the skin ahead of it.
 */
const FLOW_STEPS = 6

/** A pinned landmark's pull: where the landmark is, its pin, and how far the pull spreads. */
type Pull = { x: number; y: number; pin: FacePin; length: number; reach: number }

/** Wendland's compactly supported kernel: smooth, 1 at the middle, 0 from `r` = 1 on. */
function wendland(r: number): number {
  if (r >= 1) return 0
  const s = 1 - r
  return s * s * s * s * (4 * r + 1)
}

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/** How closely landmarks sit round skin point `i`: the distance to its third-nearest. */
function spacing(points: readonly Point[], i: number): number {
  let first = Number.POSITIVE_INFINITY
  let second = Number.POSITIVE_INFINITY
  let third = Number.POSITIVE_INFINITY
  const [x, y] = points[i]!
  for (const j of SKIN) {
    if (j === i) continue
    const point = points[j]!
    const d2 = (point[0] - x) ** 2 + (point[1] - y) ** 2
    if (d2 >= third) continue
    if (d2 < first) {
      third = second
      second = first
      first = d2
    } else if (d2 < second) {
      third = second
      second = d2
    } else {
      third = d2
    }
  }
  return Math.sqrt(third)
}

/**
 * The pinned landmarks' pulls, strongest first, each spreading SPREAD
 * times its landmark spacing, cut short of stronger neighbours (YIELD),
 * and never less than DRAG times its move across the face.
 */
function pulls(pins: FacePins, points: readonly Point[]): Pull[] {
  const list: Pull[] = []
  for (const i of SKIN) {
    const pin = pins[FACE_POINT_INDICES[i]!]
    if (!pin?.some((value) => value !== 0)) continue
    const [x, y] = points[i]!
    list.push({ x, y, pin, length: Math.hypot(...pin), reach: SPREAD * spacing(points, i) })
  }
  list.sort((a, b) => b.length - a.length)
  list.forEach((pull, k) => {
    for (let j = 0; j < k; j++) {
      const stronger = list[j]!
      const give = smoothstep((stronger.length - pull.length) / (YIELD * stronger.length))
      if (give === 0) continue
      const apart = Math.sqrt((stronger.x - pull.x) ** 2 + (stronger.y - pull.y) ** 2)
      pull.reach = Math.min(pull.reach, apart / give)
    }
    pull.reach = Math.max(pull.reach, DRAG * Math.hypot(pull.pin[0], pull.pin[1]))
  })
  return list
}

/**
 * The pins as a displacement of the head's front view (the ShapeField
 * contract: at (x, y), fractions, out = [dx, dy, dz]); null when nothing
 * is pinned. `target` is the character's packed front-view points.
 *
 * It is a flow: over a moment every pinned landmark slides straight to
 * where it is pinned, and the skin is carried along by the pulls round it.
 * Carried, never pushed through, the skin stretches and squeezes but can't
 * fold over itself, however the pulls meet. A lone pin's landmark lands
 * exactly where it is pinned and a pull's grabbed landmark all but; one
 * between stronger pulls is carried a little towards them. Unpinned
 * landmarks aren't held: a pull drags the skin round it, the further the
 * longer it is. The field is nothing past the pulls' reach and never more
 * than the longest pin. faceShaper applies it to everything in front of
 * the neck, eyeballs too, so a pull reaching over an eye carries the
 * eyeball along.
 */
export function pinsField(pins: FacePins, target: readonly number[]): ShapeField | null {
  const list = pulls(pins, unpackPoints(target))
  if (list.length === 0) return null
  // The pulls laid out flat: the field is followed a dozen steps for each
  // of thousands of points per reshape, every time a drag moves.
  const xs = Float64Array.from(list, (pull) => pull.x)
  const ys = Float64Array.from(list, (pull) => pull.y)
  const dxs = Float64Array.from(list, (pull) => pull.pin[0])
  const dys = Float64Array.from(list, (pull) => pull.pin[1])
  const dzs = Float64Array.from(list, (pull) => pull.pin[2])
  const reaches = Float64Array.from(list, (pull) => pull.reach)
  // Skin further than this from a pull's landmark never comes within its
  // reach: the pull's centre slides by its pin, the skin by the longest.
  const longest = Math.max(...list.map(({ pin }) => Math.hypot(pin[0], pin[1])))
  const margins = list.map((pull) => pull.reach + Math.hypot(pull.pin[0], pull.pin[1]) + longest)
  const left = Math.min(...list.map((pull, k) => pull.x - margins[k]!))
  const right = Math.max(...list.map((pull, k) => pull.x + margins[k]!))
  const top = Math.min(...list.map((pull, k) => pull.y - margins[k]!))
  const bottom = Math.max(...list.map((pull, k) => pull.y + margins[k]!))
  const step = 1 / FLOW_STEPS
  const near = new Int32Array(list.length)
  let nearCount = 0
  const move = [0, 0, 0]

  /**
   * How the skin at (x, y) moves at time `t` of the flow, into `move`: the
   * pulls blended by their kernels, each centred where its landmark has
   * slid to by then, against the face staying put — which counts for
   * nothing where a pull is at full weight, and for everything where none
   * reaches.
   */
  const velocity = (x: number, y: number, t: number) => {
    let dx = 0
    let dy = 0
    let dz = 0
    let total = 0
    let stay = 1
    for (let k = 0; k < nearCount; k++) {
      const j = near[k]!
      const ex = x - xs[j]! - t * dxs[j]!
      const ey = y - ys[j]! - t * dys[j]!
      const d2 = ex * ex + ey * ey
      const reach = reaches[j]!
      if (d2 >= reach * reach) continue
      const weight = wendland(Math.sqrt(d2) / reach)
      dx += weight * dxs[j]!
      dy += weight * dys[j]!
      dz += weight * dzs[j]!
      total += weight
      stay *= 1 - weight
    }
    const all = total + stay
    move[0] = dx / all
    move[1] = dy / all
    move[2] = dz / all
  }

  return (x, y, out) => {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    if (x <= left || x >= right || y <= top || y >= bottom) return
    // The rest add nothing anywhere along this skin's way (a sculpted face
    // has hundreds of pins, few of them near any one place).
    nearCount = 0
    for (let j = 0; j < list.length; j++) {
      const ex = x - xs[j]!
      const ey = y - ys[j]!
      if (ex * ex + ey * ey < margins[j]! * margins[j]!) near[nearCount++] = j
    }
    if (nearCount === 0) return
    let px = x
    let py = y
    for (let k = 0; k < FLOW_STEPS; k++) {
      const t = k * step
      velocity(px, py, t)
      velocity(px + 0.5 * step * move[0]!, py + 0.5 * step * move[1]!, t + 0.5 * step)
      px += step * move[0]!
      py += step * move[1]!
      out[2]! += step * move[2]!
    }
    out[0] = px - x
    out[1] = py - y
  }
}
