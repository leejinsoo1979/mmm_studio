import { type BufferGeometry, type Mesh, type SkinnedMesh, Vector3 } from 'three'
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
 * The better-found ear is the pattern for both: the other is its mirror
 * image, so the two change alike however the mesh's points happen to lie
 * round each.
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
 * How far from the ear's points (× the front view) the ear itself fades
 * out, and how far the skin round it is carried along when the ear moves or
 * grows — further, so it stretches rather than folds.
 */
const FALLOFF = 0.05
const CARRY = 0.11

/**
 * How much further than CARRY along the surface the reshaping reaches, for
 * the mesh's edges zigzagging: out there the skin lies further than CARRY
 * from the ear straight across too, so it has no share left to lose.
 */
const REACH = 1.3

/**
 * How near (× the front view) a point of the head must lie to a point of
 * an ear's mirror image to be its twin, and the share of the ear's points
 * that must have twins for the other side's ear to be found by them.
 * Fewer, and that side has no ear of that shape: another shape, or none
 * modelled under the hair hiding it.
 */
const TWIN = 0.004
const TWIN_SHARE = 0.5

/**
 * How far (× the front view) the other ear may lie from the better one's
 * mirror image — Rocketbox ears are often modelled a few millimetres apart
 * — and the step that shift is found to.
 */
const SHIFT = 0.02
const SHIFT_STEP = 0.0015

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
 * How near an ear (× its length) a separate little piece of the head must
 * come to hang from it — an earring — and how far at most its points lie
 * from their middle (× the ear's length): a bigger piece is gear.
 */
const TOUCHING = 0.15
const HANGING_SIZE = 0.6

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
 * An ear, in the head's bind pose. `points` are the close-packed points it
 * was found by (for the mirrored ear, its twin's, mirrored): how much of the
 * ear a place is goes by how near it lies to them, so mirror-image places
 * are alike. `reached` has one per point of the head mesh: 1 where the
 * reshaping reaches (the ear and the skin round it, on its piece), 0
 * elsewhere. `fade` is how far from its points the ear itself fades out and
 * `carry` how far the skin round it goes along. `root` is on the skull under
 * the ear's middle and `hinge` at the front edge of its flap; `tip` is its
 * top. `up`, `out` (out of the skull) and `back` (towards the back of the
 * head) are its axes; `length` its size up and `standing` how far it stands
 * out of the skull. `skull` is the skull round it: its points as how far up,
 * back and out they are from the root.
 */
export type Ear = {
  points: Vector3[]
  reached: Uint8Array
  fade: number
  carry: number
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

/**
 * A mesh's surface: corners at one place are one spot (texture seams split
 * vertices that the surface still joins). Each point's spot, the spots'
 * places, which spots the triangles join and which piece (a run of joined
 * spots, numbered from 0) each spot is on.
 */
type Surface = {
  spotOf: Int32Array
  places: Vector3[]
  joined: number[][]
  pieceOf: Int32Array
}

const SIDES = [-1, 1] as const

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** Which piece each spot is on, numbered from 0. */
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

/** A mesh's surface from its points and triangles (`index`, or null for a triangle per three points). */
function surfaceOf(points: Triples, index: ArrayLike<number> | null): Surface {
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
  const sets = places.map(() => new Set<number>())
  const corners = index ? index.length : count
  for (let t = 0; t + 2 < corners; t += 3) {
    const tri = [0, 1, 2].map((k) => spotOf[index ? index[t + k]! : t + k]!)
    for (let k = 0; k < 3; k++) {
      const a = tri[k]!
      const b = tri[(k + 1) % 3]!
      if (a !== b) {
        sets[a]!.add(b)
        sets[b]!.add(a)
      }
    }
  }
  const joined = sets.map((set) => [...set])
  return { spotOf, places, joined, pieceOf: piecesOf(joined) }
}

/**
 * Finds the spots near a place: `visit` is called for each within `reach`
 * of it (no further than `cell`, the grid's size).
 */
function grid(places: readonly Vector3[], cell: number): Near {
  const cells = new Map<string, number[]>()
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  places.forEach((place, spot) => {
    const at = key(
      Math.floor(place.x / cell),
      Math.floor(place.y / cell),
      Math.floor(place.z / cell),
    )
    const list = cells.get(at)
    if (list) list.push(spot)
    else cells.set(at, [spot])
  })
  return (place: Vector3, reach: number, visit: (spot: number) => void) => {
    const [x, y, z] = [place.x, place.y, place.z].map((value) => Math.floor(value / cell))
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const spot of cells.get(key(x! + dx, y! + dy, z! + dz)) ?? []) {
            if (places[spot]!.distanceTo(place) < reach) visit(spot)
          }
        }
      }
    }
  }
}

/** Calls `visit` for each spot within `reach` of a place (see grid). */
type Near = (place: Vector3, reach: number, visit: (spot: number) => void) => void

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

/** The piece most of the spots are on, and those spots on it. */
function onMainPiece(spots: readonly number[], pieceOf: Int32Array): number[] {
  const counts = new Map<number, number>()
  for (const spot of spots) counts.set(pieceOf[spot]!, (counts.get(pieceOf[spot]!) ?? 0) + 1)
  const main = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [-1, 0])
  return spots.filter((spot) => pieceOf[spot] === main[0])
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

/** Which points of the head the reshaping of an ear found at `seeds` reaches: near them along the surface. */
function reachedFrom(seeds: readonly number[], surface: Surface, carry: number): Uint8Array {
  const distances = surfaceDistances(seeds, surface.places, surface.joined, REACH * carry)
  return Uint8Array.from(surface.spotOf, (spot) =>
    distances[spot]! < Number.POSITIVE_INFINITY ? 1 : 0,
  )
}

/**
 * The close-packed spots of the ear on one side of the head (−1 is the
 * image's left), few or none where there is no ear.
 */
function earGroup({ places, pieceOf }: Surface, frame: HeadFrame, side: number): number[] {
  const depth = Math.max(frame.front - frame.neck.z, 1e-6)
  const radius = DENSE_RADIUS * frame.size
  const candidates: number[] = []
  places.forEach((place, spot) => {
    const down = (frame.top - place.y) / frame.size
    if (
      down > BAND_TOP &&
      down < BAND_BOTTOM &&
      side * (place.x - frame.neck.x) > SIDE * frame.size &&
      Math.abs(place.z - frame.neck.z) < DEPTH * depth
    ) {
      candidates.push(spot)
    }
  })
  // Neighbours on the same piece only: an earring's points close by are no
  // part of how close-packed the ear is.
  const dense = candidates.filter((spot) => {
    let near = 0
    for (const other of candidates) {
      if (
        other !== spot &&
        pieceOf[other] === pieceOf[spot] &&
        places[other]!.distanceTo(places[spot]!) < radius
      ) {
        near++
      }
    }
    return near >= DENSE_COUNT
  })
  return onMainPiece(largestGroup(dense, places, radius), pieceOf)
}

/** The ear round a group of close-packed spots on one side, and the skull its reshaping fades out over. */
function earOf(group: readonly number[], surface: Surface, frame: HeadFrame, side: number): Ear {
  const { places, joined } = surface
  const fade = FALLOFF * frame.size
  const carry = CARRY * frame.size
  const points = group.map((spot) => places[spot]!.clone())
  // The skull round the ear lies near it along the surface. An ear on a
  // piece of its own has none, and joins the skull at its innermost points.
  const distances = surfaceDistances(group, places, joined, fade)
  const around = places.filter((_, spot) => distances[spot]! > 0 && distances[spot]! <= fade)
  const inner = quantile(
    points.map((point) => side * point.x),
    EDGE_SHARE,
  )
  const skullPlaces = around.length ? around : points.filter((point) => side * point.x <= inner)
  // Its axes and root from the middle of its own points, which the few
  // points of skin round it, lying as the mesh happens to, would shift.
  const centre = points
    .reduce((sum, point) => sum.add(point), new Vector3())
    .divideScalar(points.length)
  const out = new Vector3(centre.x - frame.neck.x, 0, centre.z - frame.neck.z)
  if (out.lengthSq() < 1e-12) out.set(side, 0, 0)
  out.normalize()
  const up = new Vector3(0, 1, 0)
  const back = new Vector3(0, 0, -1).addScaledVector(out, out.z).normalize()
  const offset = new Vector3()
  const from = (origin: Vector3, place: Vector3) => {
    offset.copy(place).sub(origin)
    return [offset.dot(up), offset.dot(back), offset.dot(out)] as const
  }
  const heights = points.map((point) => point.y)
  const top = Math.max(...heights)
  const length = top - Math.min(...heights)
  // The root on the skull's surface, under the ear's middle.
  const rise = skullUnder(
    { skull: skullPlaces.flatMap((place) => from(centre, place)), length },
    0,
    0,
  )
  const root = centre.clone().addScaledVector(out, rise)
  const skull = skullPlaces.flatMap((place) => from(root, place))
  const standings = points.map((point) => {
    const [u, b, o] = from(root, point)
    return o - skullUnder({ skull, length }, u, b)
  })
  const standing = Math.max(...standings, LEAST_STANDING * length)
  const flap = points.filter((_, k) => standings[k]! > FLAP_FROM * standing)
  const front = quantile(
    flap.map((point) => from(root, point)[1]),
    EDGE_SHARE,
  )
  const hinge = root
    .clone()
    .addScaledVector(back, front)
    .addScaledVector(out, skullUnder({ skull, length }, 0, front))
  const tip = points[heights.indexOf(top)]!.clone()
  const reached = reachedFrom(group, surface, carry)
  return { points, reached, fade, carry, root, hinge, tip, up, out, back, length, standing, skull }
}

/** A place mirrored across the head's middle (at x = `middle`), then moved by `shift`. */
const mirrored = (place: Vector3, middle: number, shift: Vector3) =>
  new Vector3(2 * middle - place.x, place.y, place.z).add(shift)

/** A direction mirrored across the head's middle. */
const flipped = (direction: Vector3) => new Vector3(-direction.x, direction.y, direction.z)

/**
 * Where the other side's ear lies against `image` (an ear's points
 * mirrored): the shift most of them agree on — each votes for every spot
 * near it, and only the twins agree — and the share of them that have a
 * twin there.
 */
function twinShift(
  image: readonly Vector3[],
  places: readonly Vector3[],
  near: Near,
  frame: HeadFrame,
) {
  const reach = SHIFT * frame.size
  const step = SHIFT_STEP * frame.size
  const votes = new Map<string, number>()
  let best = ''
  let most = 0
  const offset = new Vector3()
  for (const point of image) {
    near(point, reach, (spot) => {
      offset.copy(places[spot]!).sub(point).divideScalar(step).round()
      const key = `${offset.x},${offset.y},${offset.z}`
      const count = (votes.get(key) ?? 0) + 1
      votes.set(key, count)
      if (count > most) {
        best = key
        most = count
      }
    })
  }
  const shift = new Vector3()
  if (most > 0) shift.fromArray(best.split(',').map(Number)).multiplyScalar(step)
  const at = new Vector3()
  let twins = 0
  for (const point of image) {
    let twin = false
    near(at.copy(point).add(shift), TWIN * frame.size, () => {
      twin = true
    })
    if (twin) twins++
  }
  return { shift, share: image.length ? twins / image.length : 0 }
}

/**
 * The ear on the other side of the head as the mirror image of `ear`,
 * moved by `shift`: the same shape in the same frame, so the two move as
 * mirror images. It reaches the skin round the points of that side lying
 * near its own.
 */
function mirrorEar(ear: Ear, surface: Surface, near: Near, frame: HeadFrame, shift: Vector3): Ear {
  const middle = frame.neck.x
  const points = ear.points.map((point) => mirrored(point, middle, shift))
  const seeds = new Set<number>()
  for (const point of points) near(point, SHIFT * frame.size, (spot) => seeds.add(spot))
  return {
    ...ear,
    points,
    reached: reachedFrom(onMainPiece([...seeds], surface.pieceOf), surface, ear.carry),
    root: mirrored(ear.root, middle, shift),
    hinge: mirrored(ear.hinge, middle, shift),
    tip: mirrored(ear.tip, middle, shift),
    up: flipped(ear.up),
    out: flipped(ear.out),
    back: flipped(ear.back),
  }
}

/**
 * A head's ears on its surface: none, or both — the better-found one and
 * its mirror image, moved to where the other side's ear lies (just
 * mirrored, where that ear is shaped otherwise). A lone ear the other side
 * has no likeness of (hair hides that side, with no ear modelled under it)
 * is none: shaped alone, it would make the head lopsided.
 */
function earsOn(surface: Surface, frame: HeadFrame): Ear[] {
  const found = SIDES.map((side) => ({ side, group: earGroup(surface, frame, side) }))
  const [better, other] = [...found].sort((a, b) => b.group.length - a.group.length) as [
    (typeof found)[number],
    (typeof found)[number],
  ]
  if (better.group.length < FEWEST_POINTS) return []
  const ear = earOf(better.group, surface, frame, better.side)
  const image = ear.points.map((point) => mirrored(point, frame.neck.x, new Vector3()))
  const near = grid(surface.places, SHIFT * frame.size)
  const { shift, share } = twinShift(image, surface.places, near, frame)
  const twinned = share >= TWIN_SHARE
  if (!twinned && other.group.length < FEWEST_POINTS) return []
  const twin = mirrorEar(ear, surface, near, frame, twinned ? shift : new Vector3())
  return better.side < 0 ? [ear, twin] : [twin, ear]
}

/**
 * A head's ears (none or two) in its bind pose, from its points (flat x,
 * y, z) and triangles (`index`, or null for a triangle per three points)
 * and where it sits (head-geometry's frame).
 */
export function findEars(
  points: Triples,
  index: ArrayLike<number> | null,
  frame: HeadFrame,
): Ear[] {
  return earsOn(surfaceOf(points, index), frame)
}

/**
 * How much of an ear a place is (1 on it, fading to 0 over the skull round
 * it), and how much it goes along when the ear moves or grows (further out
 * over the skull): by how near it lies to the ear's points, so the skin's
 * stretch round the ear turns its normals as the place moves.
 */
export function earShares(ear: Ear, place: Vector3): [onEar: number, carried: number] {
  let nearest = Number.POSITIVE_INFINITY
  for (const point of ear.points) nearest = Math.min(nearest, point.distanceToSquared(place))
  const distance = Math.sqrt(nearest)
  return [1 - smoothstep(0, ear.fade, distance), 1 - smoothstep(0, ear.carry, distance)]
}

/** The ear sliders' settings (−1–1). */
type EarSettings = { size: number; angle: number; height: number; point: number }

const q = new Vector3()
const h = new Vector3()

/**
 * Adds to `move` how the ear reshapes a place of the head: grown about its
 * root, moved up, its free flap (what stands out of the skull) turned out
 * about its hinge or pressed flat against the skull, and its top drawn up
 * and back into a point.
 */
function addEarMove(ear: Ear, settings: EarSettings, point: Vector3, move: Vector3) {
  const { root, hinge, up, out, back, length } = ear
  const [onEar, carried] = earShares(ear, point)
  if (carried === 0) return
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

/** A little piece of the head hanging from an ear, and the place on the ear it hangs from. */
type Hanging = { ear: Ear; at: Vector3 }

/**
 * The little separate pieces of the head hanging from its ears — earrings:
 * per point of the head, which of `hanging` it is on (−1 for none). Each
 * goes as a whole with the point of its ear nearest it. Only the head's
 * own: what other meshes have by the ears is gear (a helmet's buckles, a
 * headset) fixed to the rest of it.
 */
function hangingOn({ spotOf, places, pieceOf }: Surface, ears: readonly Ear[]) {
  const pieces: number[][] = []
  pieceOf.forEach((piece, spot) => {
    pieces[piece] ??= []
    pieces[piece]!.push(spot)
  })
  // An ear that is a piece of its own is reshaped, not hung.
  const reshaped = new Set<number>()
  spotOf.forEach((spot, i) => {
    if (ears.some((ear) => ear.reached[i])) reshaped.add(pieceOf[spot]!)
  })
  const hanging: Hanging[] = []
  const nearestOf = (points: readonly Vector3[], place: Vector3) =>
    points.reduce((best, point) =>
      point.distanceToSquared(place) < best.distanceToSquared(place) ? point : best,
    )
  const pieceHangs = pieces.map((piece, number) => {
    if (reshaped.has(number)) return -1
    const centre = new Vector3()
    for (const spot of piece) centre.add(places[spot]!)
    centre.divideScalar(piece.length)
    const size = Math.max(...piece.map((spot) => places[spot]!.distanceTo(centre)))
    let from: Ear | null = null
    let nearest = Number.POSITIVE_INFINITY
    for (const ear of ears) {
      if (size > HANGING_SIZE * ear.length) continue
      for (const spot of piece) {
        const distance = nearestOf(ear.points, places[spot]!).distanceTo(places[spot]!)
        if (distance <= TOUCHING * ear.length && distance < nearest) {
          nearest = distance
          from = ear
        }
      }
    }
    if (!from) return -1
    hanging.push({ ear: from, at: nearestOf(from.points, centre) })
    return hanging.length - 1
  })
  return { hangs: Int32Array.from(spotOf, (spot) => pieceHangs[pieceOf[spot]!]!), hanging }
}

/** A head's ears and what hangs from them (see hangingOn). */
type Fitted = { ears: Ear[]; hangs: Int32Array; hanging: Hanging[] }

const fittedHeads = new WeakMap<BufferGeometry, Fitted>()

/**
 * A head's ears, found on its geometry as loaded the first time they are
 * asked for: they depend on nothing else, and a slider being dragged
 * reshapes the head many times a second.
 */
function fitted(head: Mesh): Fitted {
  const geometry = originalGeometry(head)
  const known = fittedHeads.get(geometry)
  if (known) return known
  const surface = surfaceOf(bindPoints(head), geometry.index?.array ?? null)
  const ears = earsOn(surface, headFrame(head))
  const found = { ears, ...hangingOn(surface, ears) }
  fittedHeads.set(geometry, found)
  return found
}

/**
 * Whether the ear sliders have ears to shape on a head: not on a hood, or
 * hair modelled as a shell with none (or only one) under it.
 */
export function hasEars(head: Mesh): boolean {
  return fitted(head).ears.length > 0
}

/**
 * The ear sliders' reshaping of a body whose head mesh is `head`: its ears
 * and what hangs from them. Null when no ear slider is set, or the head has
 * no ears (see hasEars).
 */
export function earShaper(head: Mesh, shape: FaceShape): Shaper | null {
  const settings = earSettings(shape)
  if (!settings) return null
  const { ears, hangs, hanging } = fitted(head)
  if (ears.length === 0) return null
  const hung = hanging.map(({ ear, at }) => {
    const move = new Vector3()
    addEarMove(ear, settings, at, move)
    return move
  })
  const move: PointMove = (point, i, out) => {
    const piece = hangs[i]!
    if (piece >= 0) {
      out.copy(hung[piece]!)
      return
    }
    out.set(0, 0, 0)
    for (const ear of ears) {
      if (ear.reached[i]) addEarMove(ear, settings, point, out)
    }
  }
  return (mesh) => (mesh === head ? move : null)
}
