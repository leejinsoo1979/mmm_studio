/**
 * The bald skull every Rocketbox head shares (see hair-styles.ts), fitted
 * to one character by its face bones, and the nearest-neighbour questions
 * a head's points and a hairstyle's are asked about it.
 *
 * Lengths are in the bind pose's own units, not metres: each Rocketbox
 * body is scaled to about two of them from its feet to the top of its
 * head, so one is about 0.9 m on an adult and 0.7 m on a child.
 */
import type { SkullData } from './hair-styles'

/** Points as flat x, y, z triples. */
export type Triples = ArrayLike<number>

/** A key for grid cell (x, y, z): cells are indexed ±CELL_RANGE on each axis. */
const CELL_RANGE = 512
const cellKey = (x: number, y: number, z: number) =>
  ((x + CELL_RANGE) * 2 * CELL_RANGE + (y + CELL_RANGE)) * 2 * CELL_RANGE + (z + CELL_RANGE)

/**
 * Points bucketed into cubes `cell` across, for nearest-neighbour
 * questions: a head's few thousand points answer a hairstyle's in a moment.
 */
export class PointGrid {
  private readonly cells = new Map<number, number[]>()
  private readonly low = [0, 0, 0]
  private readonly high = [0, 0, 0]

  constructor(
    readonly points: Triples,
    private readonly cell: number,
  ) {
    const count = points.length / 3
    for (let i = 0; i < count; i++) {
      const at = [0, 1, 2].map((axis) => Math.floor(points[i * 3 + axis]! / cell))
      for (let axis = 0; axis < 3; axis++) {
        this.low[axis] = i === 0 ? at[axis]! : Math.min(this.low[axis]!, at[axis]!)
        this.high[axis] = i === 0 ? at[axis]! : Math.max(this.high[axis]!, at[axis]!)
      }
      const key = cellKey(at[0]!, at[1]!, at[2]!)
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(i)
      else this.cells.set(key, [i])
    }
  }

  /**
   * The `k` points nearest (x, y, z), nearest first, into `found` (their
   * indices) and `distances` (squared); returns how many there are. The
   * search stops once all that is left is further than `within` off, so
   * there may be fewer (none where nothing is that near).
   */
  nearest(
    x: number,
    y: number,
    z: number,
    k: number,
    found: number[],
    distances: number[],
    within = Number.POSITIVE_INFINITY,
  ) {
    let count = 0
    const cell = this.cell
    const points = this.points
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    const cz = Math.floor(z / cell)
    // Past this ring of cells there is nothing left to search.
    const last = Math.max(
      Math.abs(cx - this.low[0]!),
      Math.abs(cx - this.high[0]!),
      Math.abs(cy - this.low[1]!),
      Math.abs(cy - this.high[1]!),
      Math.abs(cz - this.low[2]!),
      Math.abs(cz - this.high[2]!),
    )
    for (let ring = 0; ring <= last; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          // Only the ring's shell: its inside was searched already.
          const step = Math.abs(dx) === ring || Math.abs(dy) === ring ? 1 : 2 * ring
          for (let dz = -ring; dz <= ring; dz += Math.max(1, step)) {
            const bucket = this.cells.get(cellKey(cx + dx, cy + dy, cz + dz))
            if (!bucket) continue
            for (const i of bucket) {
              const ex = points[i * 3]! - x
              const ey = points[i * 3 + 1]! - y
              const ez = points[i * 3 + 2]! - z
              const d = ex * ex + ey * ey + ez * ez
              if (count === k && d >= distances[k - 1]!) continue
              let slot = count < k ? count++ : k - 1
              while (slot > 0 && distances[slot - 1]! > d) {
                distances[slot] = distances[slot - 1]!
                found[slot] = found[slot - 1]!
                slot--
              }
              distances[slot] = d
              found[slot] = i
            }
          }
        }
      }
      // Anything in a further ring is at least `ring` cells away.
      if ((count === k && distances[k - 1]! <= (ring * cell) ** 2) || ring * cell > within) break
    }
    return count
  }
}

/** A per-axis scale and shift: a point goes to `point · scale + shift`, axis by axis. */
export type AxisFit = { scale: [number, number, number]; shift: [number, number, number] }

/**
 * The per-axis scale and shift taking points `from` onto points `to` (the
 * same number of each) most closely, each axis on its own. Rocketbox faces
 * are one template per sex at slightly different sizes, so their bones
 * line up this way to within millimetres, and it never tilts a skull.
 */
export function fitAxes(from: Triples, to: Triples): AxisFit {
  const count = from.length / 3
  const scale: [number, number, number] = [1, 1, 1]
  const shift: [number, number, number] = [0, 0, 0]
  for (let axis = 0; axis < 3; axis++) {
    let meanFrom = 0
    let meanTo = 0
    for (let i = 0; i < count; i++) {
      meanFrom += from[i * 3 + axis]!
      meanTo += to[i * 3 + axis]!
    }
    meanFrom /= count
    meanTo /= count
    let across = 0
    let spread = 0
    for (let i = 0; i < count; i++) {
      const d = from[i * 3 + axis]! - meanFrom
      across += d * (to[i * 3 + axis]! - meanTo)
      spread += d * d
    }
    scale[axis] = spread > 0 ? across / spread : 1
    shift[axis] = meanTo - scale[axis]! * meanFrom
  }
  return { scale, shift }
}

/** `outer` after `inner`. */
export const composeFits = (outer: AxisFit, inner: AxisFit): AxisFit => ({
  scale: [0, 1, 2].map((axis) => outer.scale[axis]! * inner.scale[axis]!) as AxisFit['scale'],
  shift: [0, 1, 2].map(
    (axis) => outer.scale[axis]! * inner.shift[axis]! + outer.shift[axis]!,
  ) as AxisFit['shift'],
})

export const invertFit = (fit: AxisFit): AxisFit => ({
  scale: fit.scale.map((scale) => 1 / scale) as AxisFit['scale'],
  shift: fit.shift.map((shift, axis) => -shift / fit.scale[axis]!) as AxisFit['shift'],
})

/** The shared skull fitted onto one character, in its bind pose. */
export type Skull = {
  points: Float32Array
  normals: Float32Array
  zone: Float32Array
  grid: PointGrid
}

/** Grid cells for a head's points: a couple of points across each. */
export const SKULL_CELL = 0.02

/** The shared skull in a character's bind pose, by the fit of its face bones (see `faceFit`). */
export function fitSkull(data: SkullData, fit: AxisFit): Skull {
  return fitted(data.points, data.normals, data.zone, fit)
}

/** The bald cranium on the shared skull's triangles (see `SkullData`) in a character's bind pose, by a fit. */
export function fitBald(data: SkullData, fit: AxisFit): Skull {
  return fitted(data.bald, data.baldNormals, data.zone, fit)
}

function fitted(from: Float32Array, turned: Float32Array, zone: Float32Array, fit: AxisFit): Skull {
  const count = from.length / 3
  const points = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    let length = 0
    for (let axis = 0; axis < 3; axis++) {
      points[i * 3 + axis] = from[i * 3 + axis]! * fit.scale[axis]! + fit.shift[axis]!
      // A normal turns by the inverse of a stretch.
      normals[i * 3 + axis] = turned[i * 3 + axis]! / fit.scale[axis]!
      length += normals[i * 3 + axis]! ** 2
    }
    length = Math.sqrt(length) || 1
    for (let axis = 0; axis < 3; axis++) normals[i * 3 + axis]! /= length
  }
  return { points, normals, zone, grid: new PointGrid(points, SKULL_CELL) }
}

/**
 * How the shared skull fits a character: from its bones' bind positions by
 * name, those of the skull's face bones it has. Null without enough of them.
 */
export function faceFit(
  data: SkullData,
  bones: ReadonlyMap<string, readonly number[]>,
): AxisFit | null {
  const from: number[] = []
  const to: number[] = []
  for (const [name, place] of Object.entries(data.bones)) {
    const own = bones.get(name)
    if (!own) continue
    from.push(...place)
    to.push(own[0]!, own[1]!, own[2]!)
  }
  // Two points fix a scale and shift on each axis; the face has dozens.
  return from.length >= 3 * FEWEST_FACE_BONES ? fitAxes(from, to) : null
}

/** A fit on fewer face bones than this is not trusted. */
const FEWEST_FACE_BONES = 8

/**
 * A head's own points over the cranium (at least CRANIUM_ZONE) whose
 * nearest point of the bald cranium faces along an axis (at least FACING)
 * say how big its cranium is that way. Where they lie within TIGHT of each
 * other (from LOW to HIGH) they are the scalp itself — a bald head, or hair
 * painted on — and the cranium is as big as their middle; where hair is
 * modelled over it, it is no bigger than the lowest tenth of them (LOW)
 * allow: the scalp is under the hair. Never more than REACH bigger or
 * smaller; too few of them (EVIDENCE) say nothing.
 */
const CRANIUM_ZONE = 0.3
const FACING = 0.85
const LOW = 0.1
const HIGH = 0.9
const TIGHT = 0.005
const REACH = 0.1
const EVIDENCE = 8

const quantile = (values: number[], at: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.round(at * (sorted.length - 1))]!
}

/**
 * The bald cranium's fit (`fit`, by the face bones) to a head's own: the
 * face stays where `fit` puts it — the scale is about `eyes` (their middle
 * x, level y and front z) — and the cranium is scaled on each axis to the
 * head's own points (`points`, bind pose; see CRANIUM_ZONE).
 */
export function craniumFit(
  data: SkullData,
  fit: AxisFit,
  points: Triples,
  eyes: readonly [number, number, number],
): AxisFit {
  const skull = fitBald(data, fit)
  const heights: number[][] = [[], [], []]
  // Per point, the scale that would take the cranium to it: its height
  // along the axis over its distance from the eyes along it.
  const ratios: number[][] = [[], [], []]
  const count = points.length / 3
  for (let i = 0; i < count; i++) {
    const x = points[i * 3]!
    const y = points[i * 3 + 1]!
    const z = points[i * 3 + 2]!
    const nearest = standOver(skull, skull.zone, x, y, z, stand)
    if (nearest < 0 || stand[4]! < CRANIUM_ZONE) continue
    // Out to the sides, up, or back.
    const facing = [Math.abs(stand[1]!), stand[2]!, -stand[3]!]
    const axis = facing.findIndex((value) => value >= FACING)
    if (axis < 0) continue
    const arm = Math.abs(skull.points[nearest * 3 + axis]! - eyes[axis]!)
    if (arm <= 0) continue
    heights[axis]!.push(stand[0]!)
    ratios[axis]!.push((stand[0]! * facing[axis]!) / arm)
  }
  const scale = [0, 1, 2].map((axis) => {
    const along = heights[axis]!
    if (along.length < EVIDENCE) return 1
    const tight = quantile(along, HIGH) - quantile(along, LOW) < TIGHT
    const by = ratios[axis]!
    const out = tight ? quantile(by, 0.5) : Math.min(0, quantile(by, LOW))
    return 1 + Math.max(-REACH, Math.min(REACH, out))
  }) as AxisFit['scale']
  const about: AxisFit = {
    scale,
    shift: [0, 1, 2].map((axis) => eyes[axis]! * (1 - scale[axis]!)) as AxisFit['shift'],
  }
  return composeFits(about, fit)
}

/** Neighbours a point's place on a surface is averaged over, so it doesn't jump from one to the next. */
const NEIGHBOURS = 4

/** Softens the nearest neighbour's weight so a point right on one doesn't divide by zero. */
const NEAR_SOFTEN = 1e-6

const found: number[] = []
const distances: number[] = []

/**
 * Where a point stands over a surface of points and normals, averaged over
 * its nearest few: its height along the surface's normal (negative inside)
 * into out[0], the normal into out[1..3], and the neighbours' weighted zone
 * (when given) into out[4]. The nearest point's index is returned (-1 for
 * an empty surface, or none within `within`), its squared distance left in
 * `distances[0]`.
 */
function standOver(
  surface: { points: Triples; normals: Triples; grid: PointGrid },
  zone: Triples | null,
  x: number,
  y: number,
  z: number,
  out: number[],
  within = Number.POSITIVE_INFINITY,
) {
  const count = surface.grid.nearest(x, y, z, NEIGHBOURS, found, distances, within)
  let height = 0
  let nx = 0
  let ny = 0
  let nz = 0
  let share = 0
  let total = 0
  for (let j = 0; j < count; j++) {
    const i = found[j]!
    const w = 1 / (distances[j]! + NEAR_SOFTEN)
    const px = surface.normals[i * 3]!
    const py = surface.normals[i * 3 + 1]!
    const pz = surface.normals[i * 3 + 2]!
    height +=
      w *
      ((x - surface.points[i * 3]!) * px +
        (y - surface.points[i * 3 + 1]!) * py +
        (z - surface.points[i * 3 + 2]!) * pz)
    nx += w * px
    ny += w * py
    nz += w * pz
    if (zone) share += w * zone[i]!
    total += w
  }
  const length = Math.hypot(nx, ny, nz) || 1
  out[0] = total > 0 ? height / total : 0
  out[1] = nx / length
  out[2] = ny / length
  out[3] = nz / length
  out[4] = total > 0 ? share / total : 0
  return count > 0 ? found[0]! : -1
}

const stand = [0, 0, 0, 0, 0]

/**
 * How far each point stands over the skull (bind units, negative under
 * it), the skull's hair share where it stands, and how far it is off the
 * skull's nearest point.
 */
export function standingOver(points: Triples, skull: Skull) {
  const count = points.length / 3
  const height = new Float32Array(count)
  const zone = new Float32Array(count)
  const off = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    standOver(skull, skull.zone, points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!, stand)
    height[i] = stand[0]!
    zone[i] = stand[4]!
    off[i] = Math.sqrt(distances[0]!)
  }
  return { height, zone, off }
}

/** A body's surface as points with normals (bind pose), for hair to stay out of. */
export type Surface = { points: Triples; normals: Triples; grid: PointGrid }

/**
 * Lifts points out of a surface (in place): each one inside it, or nearer
 * it than `clearance` (bind units), goes out along its normal to that
 * clearance. A point deeper in than `reach` is left be: the surface
 * nearest it is not one it went through.
 */
export function pushOut(points: Float32Array, surface: Surface, clearance: number, reach: number) {
  const count = points.length / 3
  for (let i = 0; i < count; i++) {
    const x = points[i * 3]!
    const y = points[i * 3 + 1]!
    const z = points[i * 3 + 2]!
    if (standOver(surface, null, x, y, z, stand) < 0) continue
    const lift = clearance - stand[0]!
    if (lift <= 0 || lift > reach) continue
    points[i * 3] = x + stand[1]! * lift
    points[i * 3 + 1] = y + stand[2]! * lift
    points[i * 3 + 2] = z + stand[3]! * lift
  }
}

/**
 * Tucks points under a surface (in place): each one out of it, or nearer
 * its outside than `depth` (bind units), goes in along its normal to that
 * depth — where the surface is within `reach` of it.
 */
export function tuckUnder(points: Float32Array, surface: Surface, depth: number, reach: number) {
  const count = points.length / 3
  for (let i = 0; i < count; i++) {
    const x = points[i * 3]!
    const y = points[i * 3 + 1]!
    const z = points[i * 3 + 2]!
    if (standOver(surface, null, x, y, z, stand, reach) < 0 || distances[0]! > reach * reach)
      continue
    const sink = stand[0]! + depth
    if (sink <= 0) continue
    points[i * 3] = x - stand[1]! * sink
    points[i * 3 + 1] = y - stand[2]! * sink
    points[i * 3 + 2] = z - stand[3]! * sink
  }
}

/**
 * Points (in place) put back as far over a surface as they stood over
 * another (`standoff`, bind units, per point): hair carried from a donor's
 * head keeps its height over the wearer's. Wholly where it stood within
 * `near` of the donor's head, not at all from `far` (hair hanging free
 * keeps its place), and only where the surface is within `reach` of where
 * it should be.
 */
export function keepStandoff(
  points: Float32Array,
  standoff: ArrayLike<number>,
  surface: Surface,
  near: number,
  far: number,
  reach: number,
) {
  for (let i = 0; i < points.length / 3; i++) {
    const share = 1 - smoothstep(near, far, standoff[i]!)
    if (share <= 0) continue
    const x = points[i * 3]!
    const y = points[i * 3 + 1]!
    const z = points[i * 3 + 2]!
    if (standOver(surface, null, x, y, z, stand, far + reach) < 0) continue
    const move = (standoff[i]! - stand[0]!) * share
    if (Math.abs(move) > reach) continue
    points[i * 3] = x + stand[1]! * move
    points[i * 3 + 1] = y + stand[2]! * move
    points[i * 3 + 2] = z + stand[3]! * move
  }
}

/**
 * Points (with their normals) moved onto a surface along its normal (a
 * copy), each within `reach` (bind units) of it where the surface there
 * faces as the point does (at least `agree`, the cosine between them): not
 * onto another shape's ear or fold. The rest stay where they are.
 */
export function ontoSurface(
  points: Triples,
  normals: Triples,
  surface: Surface,
  reach: number,
  agree: number,
): Float32Array {
  const out = Float32Array.from(points)
  for (let i = 0; i < out.length / 3; i++) {
    const x = out[i * 3]!
    const y = out[i * 3 + 1]!
    const z = out[i * 3 + 2]!
    if (standOver(surface, null, x, y, z, stand, reach) < 0 || Math.abs(stand[0]!) > reach) continue
    const facing =
      stand[1]! * normals[i * 3]! +
      stand[2]! * normals[i * 3 + 1]! +
      stand[3]! * normals[i * 3 + 2]!
    if (facing < agree) continue
    out[i * 3] = x - stand[1]! * stand[0]!
    out[i * 3 + 1] = y - stand[2]! * stand[0]!
    out[i * 3 + 2] = z - stand[3]! * stand[0]!
  }
  return out
}

export const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}
