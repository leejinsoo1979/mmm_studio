import { type Mesh, type SkinnedMesh, Vector3 } from 'three'
import type { PointMove, Shaper } from './avatar-shape'
import type { FaceShape } from './face-shape'
import { type HeadFrame, headFrame, originalGeometry } from './head-geometry'

/**
 * The ears' sliders. A Rocketbox ear has no bones of its own: it is folded
 * skin of the head mesh standing out from the side of the skull. It is
 * found in the head's bind pose by just that — many points close together,
 * where the skull round it (and the hair shell over it, on a head whose
 * hair hides its ears) has few — and reshaped about where it joins the
 * skull, the change fading out over the skull round it so nothing tears.
 */

/** The band ears lie in, from the head's top (fractions of its front view): the brows to under the nose. */
const BAND_TOP = 0.28
const BAND_BOTTOM = 0.75

/** How far from the head's middle an ear lies at least (× the front view): out past the eyes and cheeks. */
const SIDE = 0.15

/** How far in front of or behind the head bone an ear lies at most (× the head bone's depth to the face's front). */
const DEPTH = 0.6

/**
 * How near (× the front view) points count as close together, and how many
 * close neighbours make a point an ear's: an ear's folds have a dozen or
 * more, the skull round it a couple.
 */
const DENSE_RADIUS = 0.035
const DENSE_COUNT = 6

/** Fewer close-packed points than this are no ear (a corner of a hair shell, an earring). */
const FEWEST_POINTS = 20

/**
 * How far over the skull (× the front view, along its surface) the ear
 * fades out, and how far the skin round it is carried along when the ear
 * moves or grows — further, so it stretches rather than folds.
 */
const FALLOFF = 0.05
const CARRY = 0.11

/**
 * How far out of the skull (× how far the ear stands out) a point starts
 * being the ear's free flap, which turns, and surely is: where it joins the
 * skull the ear stays on it.
 */
const FLAP_FROM = 0.08
const FLAP_TO = 0.4

/** A full earSize's growth (a share of the ear's size). */
const SIZE = 0.35

/**
 * A full earAngle's turn out from the skull (radians), and how much of the
 * way it stands out of the skull a full turn in presses the ear flat.
 */
const ANGLE = 0.45
const FLATTEN = 0.7

/** How much of the flap's turn out the skin round it (on the ear, but not standing out) takes. */
const LIFT = 0.35

/** A full earHeight's move up (× the ear's length). */
const HEIGHT = 0.3

/**
 * A full earPoint's pull on the ear's top (× the ear's length; it rises
 * from nothing at the ear's middle), and how much of the top's width it
 * draws in to the tip's line.
 */
const POINT = 0.4
const POINT_NARROW = 0.25

/**
 * How much of that pull a full setting the other way (a rounder ear) gives,
 * only shortening the top: pressed down as far, the top would fold into
 * the ear.
 */
const POINT_ROUNDING = 0.35

/** The pull's direction, up, back and a little out (a unit vector's parts). */
const POINT_UP = 0.6
const POINT_BACK = 0.7
const POINT_OUT = 0.35

/**
 * How much of the ear a point must be for its top to be drawn into a point
 * at all: the ear's top leans on the skull, so only the ear itself, not how
 * far out it stands, tells it from the skull above.
 */
const ON_EAR = 0.6

/**
 * How near an ear's root (× the ear's length) all of a separate little
 * piece of the head — an earring — lies for it to hang from the ear.
 */
const HANGING = 0.9

/**
 * The share of an ear's points taken for an edge of it: the innermost (where
 * an ear that is a piece of its own joins the skull) or the front of its flap
 * (the hinge it turns out on).
 */
const EDGE_SHARE = 0.1

/** The least an ear is taken to stand out of the skull (× its length), so a flat one still has a flap. */
const LEAST_STANDING = 0.1

/** Keeps the skull's spread from dividing by nothing right on one of its points (× the ear's length). */
const SKULL_SOFTEN = 0.02

/**
 * An ear, in the head's bind pose. `onEar` and `carried` have one per point
 * of the head mesh: how much of the ear it is (1 on it, fading to 0 over the
 * skull round it), and how much it goes along when the ear moves or grows
 * (further out over the skull). `root` is on the skull under the ear's
 * middle and `hinge` at the front edge of its flap; `tip` is its top. `up`,
 * `out` (out of the skull) and `back` (towards the back of the head) are its
 * axes; `length` its size up and `standing` how far it stands out of the
 * skull. `skull` is the skull round it: its points as how far up, back and
 * out they are from the root.
 */
export type Ear = {
  onEar: Float32Array
  carried: Float32Array
  root: Vector3
  hinge: Vector3
  tip: Vector3
  up: Vector3
  out: Vector3
  back: Vector3
  length: number
  standing: number
  skull: number[]
}

/** Points as flat x, y, z triples. */
type Triples = ArrayLike<number>

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/**
 * Corners at one place are one spot (texture seams split vertices that the
 * surface still joins): each point's spot, the spots' places and which
 * spots the triangles join.
 */
function spotsOf(points: Triples, index: ArrayLike<number> | null) {
  const count = points.length / 3
  const spotOf = new Int32Array(count)
  const places: Vector3[] = []
  const keys = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`
    let spot = keys.get(key)
    if (spot === undefined) {
      spot = places.length
      places.push(new Vector3(x, y, z))
      keys.set(key, spot)
    }
    spotOf[i] = spot
  }
  const joined = places.map(() => new Set<number>())
  const corners = index ? index.length : count
  for (let t = 0; t + 2 < corners; t += 3) {
    const tri = [0, 1, 2].map((k) => spotOf[index ? index[t + k]! : t + k]!)
    for (let k = 0; k < 3; k++) {
      const a = tri[k]!
      const b = tri[(k + 1) % 3]!
      if (a !== b) {
        joined[a]!.add(b)
        joined[b]!.add(a)
      }
    }
  }
  return { spotOf, places, joined: joined.map((set) => [...set]) }
}

/** Which piece (a run of joined spots) each spot is on, numbered from 0. */
function piecesOf(joined: readonly number[][]): Int32Array {
  const pieceOf = new Int32Array(joined.length).fill(-1)
  let pieces = 0
  joined.forEach((_, start) => {
    if (pieceOf[start]! >= 0) return
    const piece = [start]
    pieceOf[start] = pieces
    for (let k = 0; k < piece.length; k++) {
      for (const next of joined[piece[k]!]!) {
        if (pieceOf[next]! < 0) {
          pieceOf[next] = pieces
          piece.push(next)
        }
      }
    }
    pieces++
  })
  return pieceOf
}

/** The largest group of the spots each within `reach` of another of the group. */
function largestGroup(spots: readonly number[], places: readonly Vector3[], reach: number) {
  const left = new Set(spots)
  let largest: number[] = []
  for (const start of spots) {
    if (!left.has(start)) continue
    left.delete(start)
    const group = [start]
    for (let k = 0; k < group.length; k++) {
      const place = places[group[k]!]!
      for (const other of left) {
        if (places[other]!.distanceTo(place) < reach) {
          left.delete(other)
          group.push(other)
        }
      }
    }
    if (group.length > largest.length) largest = group
  }
  return largest
}

/** How far each spot is along the surface from the nearest of `from` (Infinity past `limit`). */
function surfaceDistances(
  from: readonly number[],
  places: readonly Vector3[],
  joined: readonly number[][],
  limit: number,
) {
  const distances = new Float64Array(places.length).fill(Number.POSITIVE_INFINITY)
  const open: number[] = []
  for (const spot of from) {
    distances[spot] = 0
    open.push(spot)
  }
  const done = new Uint8Array(places.length)
  while (open.length > 0) {
    let best = 0
    for (let k = 1; k < open.length; k++) {
      if (distances[open[k]!]! < distances[open[best]!]!) best = k
    }
    const spot = open[best]!
    open[best] = open[open.length - 1]!
    open.pop()
    if (done[spot]) continue
    done[spot] = 1
    for (const next of joined[spot]!) {
      const distance = distances[spot]! + places[spot]!.distanceTo(places[next]!)
      if (distance < distances[next]! && distance <= limit) {
        distances[next] = distance
        open.push(next)
      }
    }
  }
  return distances
}

/** The value `share` of the way up the sorted values. */
const quantile = (values: number[], share: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!
}

/**
 * How high the skull stands (out from the ear's root) under a place on the
 * ear, `up` and `back` from its root: spread from the skull round the ear
 * by nearness (inverse distance squared), a membrane over the ear's place.
 */
function skullUnder(ear: Pick<Ear, 'skull' | 'length'>, up: number, back: number): number {
  const { skull } = ear
  const soften = (SKULL_SOFTEN * ear.length) ** 2
  let total = 0
  let height = 0
  for (let k = 0; k < skull.length; k += 3) {
    const weight = 1 / ((up - skull[k]!) ** 2 + (back - skull[k + 1]!) ** 2 + soften)
    total += weight
    height += weight * skull[k + 2]!
  }
  return total > 0 ? height / total : 0
}

/** The ear round a group of close-packed spots, and the skull its reshaping fades out over. */
function earOf(
  group: readonly number[],
  spotOf: Int32Array,
  places: readonly Vector3[],
  joined: readonly number[][],
  frame: HeadFrame,
  side: number,
): Ear {
  const falloff = FALLOFF * frame.size
  const carry = CARRY * frame.size
  const distances = surfaceDistances(group, places, joined, carry)
  const around = places.filter((_, spot) => distances[spot]! > 0 && distances[spot]! <= falloff)
  // The middle of the skull round the ear lies under the ear (in the skull,
  // which curves away round it). An ear on a piece of its own has no skull
  // round it, and joins the skull at its innermost points.
  const inner = quantile(
    group.map((spot) => side * places[spot]!.x),
    EDGE_SHARE,
  )
  const base = around.length
    ? around
    : group.filter((spot) => side * places[spot]!.x <= inner).map((spot) => places[spot]!)
  const root = base.reduce((sum, place) => sum.add(place), new Vector3()).divideScalar(base.length)
  const middle = frame.left + frame.size / 2
  const out = new Vector3(root.x - middle, 0, root.z - frame.neck.z)
  if (out.lengthSq() < 1e-12) out.set(side, 0, 0)
  out.normalize()
  const up = new Vector3(0, 1, 0)
  const back = new Vector3(0, 0, -1).addScaledVector(out, out.z).normalize()
  const offset = new Vector3()
  const along = (place: Vector3) => {
    offset.copy(place).sub(root)
    return [offset.dot(up), offset.dot(back), offset.dot(out)] as const
  }
  const heights = group.map((spot) => along(places[spot]!)[0])
  const top = Math.max(...heights)
  const length = top - Math.min(...heights)
  const skull = around.flatMap((place) => along(place))
  // The root on the skull's surface, under the ear's middle.
  const rise = skullUnder({ skull, length }, 0, 0)
  root.addScaledVector(out, rise)
  for (let k = 2; k < skull.length; k += 3) skull[k]! -= rise
  const standings = group.map((spot) => {
    const [u, b, o] = along(places[spot]!)
    return o - skullUnder({ skull, length }, u, b)
  })
  const standing = Math.max(...standings, LEAST_STANDING * length)
  const flap = group.filter((_, k) => standings[k]! > FLAP_FROM * standing)
  const front = quantile(
    flap.map((spot) => along(places[spot]!)[1]),
    EDGE_SHARE,
  )
  const hinge = root
    .clone()
    .addScaledVector(back, front)
    .addScaledVector(out, skullUnder({ skull, length }, 0, front))

  const onEar = new Float32Array(spotOf.length)
  const carried = new Float32Array(spotOf.length)
  spotOf.forEach((spot, i) => {
    onEar[i] = 1 - smoothstep(0, falloff, distances[spot]!)
    carried[i] = 1 - smoothstep(0, carry, distances[spot]!)
  })
  const tip = places[group[heights.indexOf(top)]!]!.clone()
  return { onEar, carried, root, hinge, tip, up, out, back, length, standing, skull }
}

/**
 * A head's ears (none, one or two) in its bind pose, from its points
 * (flat x, y, z) and triangles (`index`, or null for a triangle per three
 * points) and where it sits (head-geometry's frame).
 */
export function findEars(
  points: Triples,
  index: ArrayLike<number> | null,
  frame: HeadFrame,
): Ear[] {
  const { spotOf, places, joined } = spotsOf(points, index)
  const pieceOf = piecesOf(joined)
  const middle = frame.left + frame.size / 2
  const depth = Math.max(frame.front - frame.neck.z, 1e-6)
  const radius = DENSE_RADIUS * frame.size
  const ears: Ear[] = []
  for (const side of [-1, 1]) {
    const candidates: number[] = []
    places.forEach((place, spot) => {
      const down = (frame.top - place.y) / frame.size
      if (
        down > BAND_TOP &&
        down < BAND_BOTTOM &&
        side * (place.x - middle) > SIDE * frame.size &&
        Math.abs(place.z - frame.neck.z) < DEPTH * depth
      ) {
        candidates.push(spot)
      }
    })
    const dense = candidates.filter((spot) => {
      let near = 0
      for (const other of candidates) {
        if (other !== spot && places[other]!.distanceTo(places[spot]!) < radius) near++
      }
      return near >= DENSE_COUNT
    })
    // Only the piece most of it is on: an earring close by is no part of the ear.
    const close = largestGroup(dense, places, radius)
    const counts = new Map<number, number>()
    for (const spot of close) counts.set(pieceOf[spot]!, (counts.get(pieceOf[spot]!) ?? 0) + 1)
    const main = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [-1, 0])
    const group = close.filter((spot) => pieceOf[spot] === main[0])
    if (group.length >= FEWEST_POINTS) {
      ears.push(earOf(group, spotOf, places, joined, frame, side))
    }
  }
  return ears
}

/** The ear sliders' settings (−1–1). */
type EarSettings = { size: number; angle: number; height: number; point: number }

const q = new Vector3()
const h = new Vector3()

/**
 * Adds to `move` how the ear reshapes a point of the head (`index`, at
 * `point`): grown about its root, moved up, its free flap (what
 * stands out of the skull) turned out about its hinge or pressed flat
 * against the skull, and its top drawn up and back into a point.
 */
function addEarMove(ear: Ear, settings: EarSettings, point: Vector3, index: number, move: Vector3) {
  const { root, hinge, up, out, back, length } = ear
  const onEar = ear.onEar[index]!
  const carried = ear.carried[index]!
  q.copy(point).sub(root)
  const standing = q.dot(out) - skullUnder(ear, q.dot(up), q.dot(back))
  const flap = onEar * smoothstep(FLAP_FROM * ear.standing, FLAP_TO * ear.standing, standing)
  if (settings.size) move.addScaledVector(q, SIZE * settings.size * carried)
  if (settings.height) move.addScaledVector(up, HEIGHT * length * settings.height * carried)
  if (settings.angle > 0 && onEar > 0) {
    h.copy(point).sub(hinge)
    const behind = h.dot(back)
    const outward = h.dot(out)
    const angle = ANGLE * settings.angle
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // The skin round the flap lifts a little with it: the long triangles
    // joining the ear's back to the skull would otherwise turn over.
    const turned = flap + (onEar - flap) * LIFT
    move.addScaledVector(back, (behind * cos - outward * sin - behind) * turned)
    move.addScaledVector(out, (behind * sin + outward * cos - outward) * turned)
  }
  // Turned in, the flap would go into the skull behind it: pressed, it
  // can't. The pressing is a share of how far each point stands out, all
  // alike, so the ear's folds flatten without turning over.
  if (settings.angle < 0 && standing > 0) {
    move.addScaledVector(out, FLATTEN * settings.angle * standing * onEar)
  }
  if (settings.point) {
    const middle = h.copy(ear.tip).sub(root).dot(up) - length / 2
    const rise = smoothstep(0, 1, (q.dot(up) - middle) / (length / 2))
    const pointing = settings.point > 0 ? settings.point : settings.point * POINT_ROUNDING
    // Drawn further the nearer the top: up and back with the skin above,
    // which the ear's top joins by long triangles that would turn over
    // were it left behind; out from the skull and in towards the tip's
    // line the ear alone.
    const pull = POINT * length * rise * rise * pointing
    const top = smoothstep(ON_EAR, 1, onEar)
    move
      .addScaledVector(up, POINT_UP * pull * carried)
      .addScaledVector(back, POINT_BACK * pull * carried)
      .addScaledVector(out, POINT_OUT * pull * top)
    if (pointing > 0) {
      const tipBehind = h.copy(ear.tip).sub(root).dot(back)
      move.addScaledVector(back, (tipBehind - q.dot(back)) * POINT_NARROW * rise * pointing * top)
    }
  }
}

/** The ear sliders' settings in a face shape, or null when none is set. */
function earSettings(shape: FaceShape): EarSettings | null {
  const { earSize = 0, earAngle = 0, earHeight = 0, earPoint = 0 } = shape.sliders
  if (!(earSize || earAngle || earHeight || earPoint)) return null
  return { size: earSize, angle: earAngle, height: earHeight, point: earPoint }
}

/** A mesh's points in the bind pose, flat, as it was loaded (not as a shape left it). */
function bindPoints(mesh: Mesh): Float32Array {
  const position = originalGeometry(mesh).getAttribute('position')
  const skinned = mesh as SkinnedMesh
  const points = new Float32Array((position?.count ?? 0) * 3)
  const point = new Vector3()
  for (let i = 0; i < (position?.count ?? 0); i++) {
    point.fromBufferAttribute(position!, i)
    if (skinned.isSkinnedMesh) point.applyMatrix4(skinned.bindMatrix)
    point.toArray(points, i * 3)
  }
  return points
}

/**
 * The little separate pieces of the head hanging from its ears — earrings
 * — each moved as a whole with the point of its ear nearest it: per point
 * of the head, its move, or null for a point of no such piece. Only the
 * head's own: what other meshes have by the ears is gear (a helmet's
 * buckles, a headset) fixed to the rest of it.
 */
function hangingMoves(
  points: Triples,
  index: ArrayLike<number> | null,
  ears: readonly Ear[],
  settings: EarSettings,
): (Vector3 | null)[] {
  const { spotOf, places, joined } = spotsOf(points, index)
  const pieceOf = piecesOf(joined)
  const pieces: number[][] = []
  pieceOf.forEach((piece, spot) => {
    pieces[piece] ??= []
    pieces[piece]!.push(spot)
  })
  // An ear that is a piece of its own is reshaped, not hung.
  const earSpots = new Set<number>()
  spotOf.forEach((spot, i) => {
    if (ears.some((ear) => ear.onEar[i]! >= 1)) earSpots.add(spot)
  })
  const at = new Vector3()
  const pieceMoves = pieces.map((piece) => {
    if (piece.some((spot) => earSpots.has(spot))) return null
    const ear = ears.find((ear) =>
      piece.every((spot) => places[spot]!.distanceTo(ear.root) < HANGING * ear.length),
    )
    if (!ear) return null
    const centre = new Vector3()
    for (const spot of piece) centre.add(places[spot]!)
    centre.divideScalar(piece.length)
    // The ear's point it hangs from: the nearest wholly the ear's.
    let nearest = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    ear.onEar.forEach((share, i) => {
      if (share < 1) return
      const distance = at.fromArray(points, i * 3).distanceToSquared(centre)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = i
      }
    })
    if (nearest < 0) return null
    const move = new Vector3()
    addEarMove(ear, settings, at.fromArray(points, nearest * 3), nearest, move)
    return move
  })
  return Array.from(spotOf, (spot) => pieceMoves[pieceOf[spot]!] ?? null)
}

/**
 * The ear sliders' reshaping of a body whose head mesh is `head`: its ears
 * and what hangs from them. Null when no ear slider is set, or the head has
 * no ears to find (a hood, or hair modelled as a shell with none under it).
 */
export function earShaper(head: Mesh, shape: FaceShape): Shaper | null {
  const settings = earSettings(shape)
  if (!settings) return null
  const points = bindPoints(head)
  const index = originalGeometry(head).index?.array ?? null
  const ears = findEars(points, index, headFrame(head))
  if (ears.length === 0) return null
  const hanging = hangingMoves(points, index, ears, settings)
  const move: PointMove = (point, i, out) => {
    const whole = hanging[i]
    if (whole) {
      out.copy(whole)
      return
    }
    out.set(0, 0, 0)
    for (const ear of ears) {
      if (ear.carried[i]! > 0) addEarMove(ear, settings, point, i, out)
    }
  }
  return (mesh) => (mesh === head ? move : null)
}
