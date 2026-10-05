'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  FrontSide,
  type Material,
  Matrix3,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  SkinnedMesh,
  Source,
  type Texture,
} from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { avatarUrl } from './avatar-catalog'
import { headOf, type PointMove, type Shaper } from './avatar-shape'
import { BLEED_BELOW, bleedHair, pictureOf, texturePixels } from './hair-bleed'
import {
  BALD,
  type HairLibrary,
  type HairStyle,
  loadHairLibrary,
  type SkullData,
} from './hair-styles'
import { originalGeometry } from './head-geometry'
import {
  dye,
  hairMask,
  hexToRgb,
  luminance,
  maskedLuminance,
  meanColor,
  type Pixels,
  type Rgb,
} from './look-pixels'

/**
 * Borrowed hairstyles: one character's hair worn by another. A Rocketbox
 * hairstyle is two things — a shell of the head mesh itself, sculpted to
 * the hair's volume and painted with it (the "cap"), and alpha cards for
 * its loose strands (`_opacity`, with the lashes). Both are carried over
 * through a bald skull every head shares: fitted to each character by its
 * face bones, it says where the donor's hair stood over its skull and how
 * far the wearer's own hair volume is to be taken in under it.
 *
 * Lengths are in the bind pose's own units, not metres: each Rocketbox
 * body is scaled to about two of them from its feet to the top of its
 * head, so one is about 0.9 m on an adult and 0.7 m on a child. The sizes
 * below are an adult's; on a child they are a fifth smaller in metres.
 *
 * The pure geometry comes first (tested in avatar-hair.test.ts), then the
 * meshes built from it, then loading and the hook.
 */

/** Points as flat x, y, z triples. */
type Triples = ArrayLike<number>

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
const SKULL_CELL = 0.02

/** The shared skull in a character's bind pose, by the fit of its face bones (see `faceFit`). */
export function fitSkull(data: SkullData, fit: AxisFit): Skull {
  const count = data.points.length / 3
  const points = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    let length = 0
    for (let axis = 0; axis < 3; axis++) {
      points[i * 3 + axis] = data.points[i * 3 + axis]! * fit.scale[axis]! + fit.shift[axis]!
      // A normal turns by the inverse of a stretch.
      normals[i * 3 + axis] = data.normals[i * 3 + axis]! / fit.scale[axis]!
      length += normals[i * 3 + axis]! ** 2
    }
    length = Math.sqrt(length) || 1
    for (let axis = 0; axis < 3; axis++) normals[i * 3 + axis]! /= length
  }
  return { points, normals, zone: data.zone, grid: new PointGrid(points, SKULL_CELL) }
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

/**
 * Where a ray from (x, y, z) along (dx, dy, dz) (a unit direction), no
 * further than `length`, first goes into a surface from outside it near its
 * points (within `reach`: a surface may be only partly there), and on to
 * `depth` under it: how far along, 0 for a point that deep already, -1
 * where it never goes in. The surface's normal there is left in
 * `stand[1..3]`.
 */
export function crossing(
  surface: Surface,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  length: number,
  depth: number,
  reach: number,
): number {
  // How far out of the surface the ray is `along` it (NaN off the
  // surface), and how far on it surely still is.
  let ahead = 0
  const look = reach + CROSSING_LOOK
  const over = (along: number) => {
    const near = standOver(
      surface,
      null,
      x + dx * along,
      y + dy * along,
      z + dz * along,
      stand,
      look,
    )
    if (near < 0) {
      ahead = CROSSING_LOOK
      return Number.NaN
    }
    const away = Math.sqrt(distances[0]!)
    ahead = Math.max(CROSSING_STEP, away > reach ? away - reach : stand[0]!)
    return away <= reach ? stand[0]! : Number.NaN
  }
  // On `depth` under the surface from where the ray goes into it.
  const under = (along: number) => {
    const falling = -(dx * stand[1]! + dy * stand[2]! + dz * stand[3]!)
    return along + (depth + stand[0]!) / Math.max(falling, GRAZING)
  }
  const start = over(0)
  if (start <= 0) return start <= -depth ? 0 : under(0)
  // The last place it was out of the surface near it (if it has been), and how far out.
  let outside = start > 0 ? 0 : Number.NaN
  let outBy = start
  let along = 0
  while (along + ahead <= length + CROSSING_STEP) {
    along += ahead
    const at = over(along)
    if (at > 0) {
      outside = along
      outBy = at
    }
    if (!(at <= 0 && outside >= 0)) continue
    // Where it went in, between the two, as the surface lies straight.
    const inside = outside + ((along - outside) * outBy) / (outBy - at)
    if (!Number.isNaN(over(inside))) return under(inside)
    over(along)
    return under(along)
  }
  return -1
}

/**
 * The least step (bind units) a ray is walked in — a longer one where it
 * is surely that far from the surface.
 */
const CROSSING_STEP = 0.004

/**
 * How far (bind units) past its reach a ray looks for a surface's points,
 * stepping that far on where there are none.
 */
const CROSSING_LOOK = 0.02

/** A ray falling less steeply than this into a surface is taken under it as if this steeply. */
const GRAZING = 0.3

/**
 * How a head's own hair volume is taken in, for another's hair to go on —
 * or for none. Each point of its hair's shell (`shell`, 1 per such point)
 * goes in towards the middle of the head (of the neck, down the neck: the
 * skull's middle over its bottom's) until it is under the skull — fitted
 * to the head's own skin (`skin`: its points that aren't shell) where that
 * shows, see `skinFitted` — or the body (`body`), whichever it meets the
 * deeper: a little under (so no scalp shows through a borrowed cap), and
 * the further under the further out it stood (so a bun or a ponytail
 * pressed flat lies under the scalp round it, not over it). It goes over
 * the cranium above the top of the neck (`neck`, the head bone's height)
 * as much as the skull's zone there holds hair, and anywhere else where it
 * stands well off the skull, or out of the head's own skin: over the ears,
 * down the neck. A sideburn painted onto the face is neither, and stays.
 * Hair past the skull's edge that meets neither goes onto the skull's
 * nearest points, or below its bottom (a drape over a neckline a shirt
 * leaves open under long hair) to the body's, spanning the neckline.
 *
 * Returns each point's move, and the normal of the surface it is pressed
 * onto as long as how far it is pressed (0 to 1), for its shading.
 */
export function deflation(
  points: Triples,
  skull: Skull,
  shell: ArrayLike<number>,
  around: { skin: Surface; body: Surface; neck: number },
): { moves: Float32Array; pressed: Float32Array } {
  const count = points.length / 3
  const moves = new Float32Array(count * 3)
  const pressed = new Float32Array(count * 3)
  const middle = skullMiddle(skull, around.neck)
  skull = skinFitted(skull, around.skin, around.neck)
  for (let i = 0; i < count; i++) {
    if (!shell[i]) continue
    const x = points[i * 3]!
    const y = points[i * 3 + 1]!
    const z = points[i * 3 + 2]!
    if (standOver(skull, skull.zone, x, y, z, stand) < 0) continue
    // Under the skull already (inside the head, not past its edge), it is
    // hidden: left be.
    if (stand[0]! <= -SINK && distances[0]! <= SKULL_REACH ** 2) continue
    const over = stand[0]!
    const far = smoothstep(OFF_FROM, OFF_TO, Math.sqrt(distances[0]!))
    const onSkull =
      smoothstep(ZONE_FROM, ZONE_TO, stand[4]!) * smoothstep(-NECK_BAND, NECK_BAND, y - around.neck)
    const out =
      standOver(around.skin, null, x, y, z, stand) < 0 ? 0 : smoothstep(OUT_FROM, OUT_TO, stand[0]!)
    const taken = over > 0 || far > 0 ? onSkull + (1 - onSkull) * Math.max(far, out) : 0
    if (taken === 0) continue
    // In towards the middle…
    const [mx, my, mz] = middle.nearest(x, y, z) as [number, number, number]
    const length = Math.hypot(mx - x, my - y, mz - z) || 1
    const dx = (mx - x) / length
    const dy = (my - y) / length
    const dz = (mz - z) / length
    // …under the deeper of the surfaces it meets.
    let along = -1
    let nx = 0
    let ny = 0
    let nz = 0
    const meet = (at: number) => {
      if (at <= along) return
      along = at
      nx = stand[1]!
      ny = stand[2]!
      nz = stand[3]!
    }
    const depth = SINK + FOLD * Math.max(0, over)
    meet(crossing(skull, x, y, z, dx, dy, dz, length, depth, SKULL_REACH))
    meet(crossing(around.body, x, y, z, dx, dy, dz, length, BODY_SINK, BODY_REACH))
    // Below the skull, where it has no neck, under the head's own.
    if (y < middle.bottom)
      meet(crossing(around.skin, x, y, z, dx, dy, dz, length, depth, SKULL_REACH))
    let tx = x + dx * along
    let ty = y + dy * along
    let tz = z + dz * along
    if (along < 0) {
      // Meeting nothing (past the skull's edge): below its bottom, into the
      // body's nearest point; above, down onto the skull as its nearest
      // points lie.
      const onto =
        y < middle.bottom
          ? standOver(around.body, null, x, y, z, stand)
          : standOver(skull, null, x, y, z, stand)
      if (onto < 0) continue
      const from = y < middle.bottom ? around.body.points : skull.points
      const sink = y < middle.bottom ? BODY_SINK : depth
      nx = stand[1]!
      ny = stand[2]!
      nz = stand[3]!
      tx = y < middle.bottom ? from[onto * 3]! - nx * sink : x - nx * (stand[0]! + sink)
      ty = y < middle.bottom ? from[onto * 3 + 1]! - ny * sink : y - ny * (stand[0]! + sink)
      tz = y < middle.bottom ? from[onto * 3 + 2]! - nz * sink : z - nz * (stand[0]! + sink)
    }
    moves[i * 3] = (tx - x) * taken
    moves[i * 3 + 1] = (ty - y) * taken
    moves[i * 3 + 2] = (tz - z) * taken
    pressed[i * 3] = nx * taken
    pressed[i * 3 + 1] = ny * taken
    pressed[i * 3 + 2] = nz * taken
  }
  return { moves, pressed }
}

/**
 * A skull fitted to the head's own surface (`skin`) where it shows: to its
 * neck, from NAPE above the top of the neck (`neck`) down — in where it is
 * thinner than the skull's (a woman's is), so hair taken in over the nape
 * meets the neck's skin below it without a step, and out where it is
 * fuller; and out to a painted-haired head's scalp over the cranium (by
 * the skull's zone), so a bun taken in lies under the scalp round it, not
 * in a pit. Each skull point goes to the skin where it has some beside it,
 * and as far as those round it do where it hasn't (under long hair, or a
 * bun).
 */
function skinFitted(skull: Skull, skin: Surface, neck: number): Skull {
  const count = skull.points.length / 3
  const known = new Float32Array(count).fill(Number.NaN)
  // How much of the way to the skin each point may go: down the neck
  // either way, over the cranium only out.
  const outward = (i: number) => smoothstep(ZONE_FROM, ZONE_TO, skull.zone[i]!)
  const inward = (y: number) => smoothstep(neck + NAPE, neck, y)
  for (let i = 0; i < count; i++) {
    const y = skull.points[i * 3 + 1]!
    if (outward(i) === 0 && inward(y) === 0) continue
    if (standOver(skin, null, skull.points[i * 3]!, y, skull.points[i * 3 + 2]!, stand) < 0)
      continue
    const sideways = Math.sqrt(Math.max(0, distances[0]! - stand[0]! ** 2))
    if (sideways <= SKIN_BESIDE && Math.abs(stand[0]!) <= SKIN_FIT) known[i] = stand[0]!
  }
  const points = new Float32Array(skull.points)
  for (let i = 0; i < count; i++) {
    let taken = known[i]!
    if (Number.isNaN(taken)) {
      // As far as the known ones round it, the nearer the more.
      const near = skull.grid.nearest(
        skull.points[i * 3]!,
        skull.points[i * 3 + 1]!,
        skull.points[i * 3 + 2]!,
        FIT_AROUND,
        found,
        distances,
      )
      let sum = 0
      let total = 0
      for (let j = 0; j < near; j++) {
        const other = known[found[j]!]!
        if (Number.isNaN(other) || distances[j]! > FIT_REACH ** 2) continue
        const weight = 1 / (distances[j]! + NEAR_SOFTEN)
        sum += other * weight
        total += weight
      }
      taken = total > 0 ? sum / total : 0
    }
    const down = inward(skull.points[i * 3 + 1]!)
    taken *= taken > 0 ? down : Math.max(down, outward(i))
    for (let axis = 0; axis < 3; axis++) {
      points[i * 3 + axis]! -= skull.normals[i * 3 + axis]! * taken
    }
  }
  return { ...skull, points, grid: new PointGrid(points, SKULL_CELL) }
}

/**
 * How far (bind units) above the top of the neck the skull's back of the
 * head comes in to the neck under it.
 */
const NAPE = 0.05

/**
 * How far (bind units) a skull point goes to the skin at most (further,
 * the skin beside it is an ear, a nose), and how far to one side of the
 * skin's nearest point it may be.
 */
const SKIN_FIT = 0.03
const SKIN_BESIDE = 0.04

/** How many skull points round one it goes as far as, and how far off they may be. */
const FIT_AROUND = 12
const FIT_REACH = 0.04

/**
 * The line down the middle of a fitted skull: from the middle of its
 * bounds above the top of the neck (`neck`) through the middle of those of
 * its bottom, and on down. `nearest` is a point's nearest place on it (no
 * higher than its top); `bottom` the skull's lowest height.
 */
function skullMiddle(skull: Skull, neck: number) {
  let bottom = Number.POSITIVE_INFINITY
  for (let i = 1; i < skull.points.length; i += 3) bottom = Math.min(bottom, skull.points[i]!)
  const low = [0, 1, 2].map(() => Number.POSITIVE_INFINITY)
  const high = low.map(() => Number.NEGATIVE_INFINITY)
  const bottomLow = [...low]
  const bottomHigh = [...high]
  for (let i = 0; i < skull.points.length / 3; i++) {
    const y = skull.points[i * 3 + 1]!
    const [from, to] = y > neck ? [low, high] : y < bottom + RIM ? [bottomLow, bottomHigh] : []
    if (!(from && to)) continue
    for (let axis = 0; axis < 3; axis++) {
      from[axis] = Math.min(from[axis]!, skull.points[i * 3 + axis]!)
      to[axis] = Math.max(to[axis]!, skull.points[i * 3 + axis]!)
    }
  }
  const top = low.map((value, axis) => (value + high[axis]!) / 2)
  const base = bottomLow.map((value, axis) => (value + bottomHigh[axis]!) / 2)
  const length = Math.hypot(...base.map((value, axis) => value - top[axis]!)) || 1
  const down = base.map((value, axis) => (value - top[axis]!) / length)
  return {
    bottom,
    nearest: (x: number, y: number, z: number) => {
      const along = Math.max(
        0,
        (x - top[0]!) * down[0]! + (y - top[1]!) * down[1]! + (z - top[2]!) * down[2]!,
      )
      return top.map((value, axis) => value + down[axis]! * along)
    },
  }
}

/**
 * A head's hair volume taken in (see `deflation`) ironed flat: its points
 * (`points`, joined by the triangles of `index`, and at one spot across a
 * texture seam) each drawn a few times towards the middle of those round
 * it, never out along the normal it was pressed onto — so the hem of long
 * hair, its outside taken in past its inside, lies flat instead of folding
 * out in flaps. Points not pressed at all (lying on the skin already) hold
 * it in place, save one with pressed points all round it. Returns the
 * ironed moves.
 */
export function ironed(
  points: Triples,
  index: ArrayLike<number>,
  { moves, pressed }: { moves: Float32Array; pressed: Float32Array },
): Float32Array {
  const { spots, count } = spotsOf(points)
  const around = Array.from({ length: count }, () => new Set<number>())
  for (let t = 0; t < index.length; t += 3) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        if (a !== b) around[spots[index[t + a]!]!]!.add(spots[index[t + b]!]!)
      }
    }
  }
  let at = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const pressing = new Uint8Array(count)
  for (let i = 0; i < points.length / 3; i++) {
    const spot = spots[i]!
    for (let axis = 0; axis < 3; axis++) {
      at[spot * 3 + axis] = points[i * 3 + axis]! + moves[i * 3 + axis]!
      normal[spot * 3 + axis] = pressed[i * 3 + axis]!
    }
    if (pressed[i * 3]! || pressed[i * 3 + 1]! || pressed[i * 3 + 2]!) pressing[spot] = 1
  }
  // A few points the shell was missing (a speck the hair mask found none
  // on) with pressed points all round them are ironed with them, as they lie.
  const seen = new Uint8Array(count)
  for (let spot = 0; spot < count; spot++) {
    if (pressing[spot] || seen[spot]) continue
    const hole = [spot]
    seen[spot] = 1
    for (let k = 0; k < hole.length; k++) {
      for (const other of around[hole[k]!]!) {
        if (pressing[other] || seen[other]) continue
        seen[other] = 1
        hole.push(other)
      }
    }
    if (hole.length > HOLE || around[spot]!.size === 0) continue
    for (const each of hole) {
      for (const other of around[each]!) {
        for (let axis = 0; axis < 3; axis++) normal[each * 3 + axis]! += normal[other * 3 + axis]!
      }
    }
    for (const each of hole) pressing[each] = 1
  }
  const pull = [0, 0, 0]
  for (let round = 0; round < IRON_ROUNDS; round++) {
    const next = new Float32Array(at)
    for (let spot = 0; spot < count; spot++) {
      const others = around[spot]!
      if (!pressing[spot] || others.size === 0) continue
      pull.fill(0)
      for (const other of others) {
        for (let axis = 0; axis < 3; axis++) pull[axis]! += at[other * 3 + axis]! / others.size
      }
      for (let axis = 0; axis < 3; axis++)
        pull[axis] = (pull[axis]! - at[spot * 3 + axis]!) * IRON_PULL
      const nx = normal[spot * 3]!
      const ny = normal[spot * 3 + 1]!
      const nz = normal[spot * 3 + 2]!
      const out =
        (pull[0]! * nx + pull[1]! * ny + pull[2]! * nz) / (nx * nx + ny * ny + nz * nz || 1)
      for (let axis = 0; axis < 3; axis++) {
        next[spot * 3 + axis]! += pull[axis]! - Math.max(0, out) * normal[spot * 3 + axis]!
      }
    }
    at = next
  }
  return Float32Array.from(
    { length: points.length },
    (_, j) => at[spots[Math.floor(j / 3)]! * 3 + (j % 3)]! - points[j]!,
  )
}

/** The most points a hole in the shell has (more, and it is skin the hair surrounds, such as an ear). */
const HOLE = 6

/**
 * How many times the taken-in hair is ironed, and how far each time
 * towards the middle of the points round each.
 */
const IRON_ROUNDS = 12
const IRON_PULL = 0.5

/**
 * How far (bind units) out of the head's own skin a shell point starts to
 * be volume to take in, and surely is (a sideburn painted onto the face
 * lies on it).
 */
const OUT_FROM = 0.003
const OUT_TO = 0.008

/** Where the skull's hair zone starts taking a head's volume in, and where it takes all of it. */
const ZONE_FROM = 0.05
const ZONE_TO = 0.3

/**
 * How far (bind units) off the skull's nearest point shell starts to be
 * taken in whatever the zone, and where it all is (a face's own shape
 * strays from the skull's by 0.005 at most).
 */
const OFF_FROM = 0.006
const OFF_TO = 0.012

/**
 * How far (bind units) under the skull's surface a head's own hair volume
 * is taken, and under the body's (a collar's cloth is thin).
 */
const SINK = 0.002
const BODY_SINK = 0.01

/** How much further under the skull a point goes for each unit it stood out of it. */
const FOLD = 0.1

/**
 * How near (bind units) a point of the skull, or of the body, a ray must
 * go into it for that to count: past the edge of either (a head's skull
 * ends at its neck, a body at its neckline) the nearest point is further
 * off. The body's points are sparser.
 */
const SKULL_REACH = 0.04
const BODY_REACH = 0.06

/** Skull points this near (bind units) its bottom are round the neck's bottom. */
const RIM = 0.02

/**
 * How far (bind units) either side of the top of the neck the cranium's
 * zone gives way to taking in only what stands off.
 */
const NECK_BAND = 0.02

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** Kinds of an opacity mesh's pieces. */
export const LASH = 0
export const HAIR = 1
export const GEAR = 2
export type CardKind = typeof LASH | typeof HAIR | typeof GEAR

/**
 * Every point of a lash is this near (bind units) an eyeball's centre; no
 * hair comes within 0.06 of one.
 */
const LASH_REACH = 0.04

/**
 * A piece this far (bind units) in front of the eyes is gear worn over the
 * face — a visor, a mask, goggles (they reach 0.079 and more; the fullest
 * afro 0.071) — or, hanging from the shoulders, a scarf's fringe.
 */
const GEAR_FRONT = 0.075

/**
 * An earring is a card seen edge on from the front — no thicker across
 * than EARRING_THIN (bind units) — out at the side of the head
 * (EARRING_SIDE from the face's middle) and hanging below the eyes
 * (EARRING_BELOW under them); a lock of hair there lies the other way
 * round.
 */
const EARRING_THIN = 0.015
const EARRING_SIDE = 0.06
const EARRING_BELOW = 0.02

/** Points of a mesh this near (bind units) are at one spot (a texture seam splits them). */
const SPOT = 1e-4

/** Each point's spot (see SPOT), numbered in the order they are first met, and how many there are. */
function spotsOf(positions: Triples) {
  const count = positions.length / 3
  const numbers = new Map<string, number>()
  const spots = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    const key = [0, 1, 2].map((axis) => Math.round(positions[i * 3 + axis]! / SPOT)).join()
    let spot = numbers.get(key)
    if (spot === undefined) {
      spot = numbers.size
      numbers.set(key, spot)
    }
    spots[i] = spot
  }
  return { spots, count: numbers.size }
}

/**
 * What each triangle of an opacity mesh is, by the piece it is part of
 * (triangles joined at a corner, or at corners at one spot): lashes, all
 * round an eye; gear — worn over the face, far out in front of it, or an
 * earring; the rest hair. `eyes` are the eyeballs' centres (bind pose, x/y/z
 * each), the face looking along +z.
 */
export function cardKinds(positions: Triples, index: ArrayLike<number>, eyes: Triples): Uint8Array {
  const count = positions.length / 3
  const parent = Array.from({ length: count }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  const { spots } = spotsOf(positions)
  const first = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const other = first.get(spots[i]!)
    if (other === undefined) first.set(spots[i]!, i)
    else parent[find(i)] = find(other)
  }
  for (let t = 0; t < index.length; t += 3) {
    parent[find(index[t + 1]!)] = find(index[t]!)
    parent[find(index[t + 2]!)] = find(index[t]!)
  }
  const middle = (eyes[0]! + eyes[3]!) / 2
  const eyeLevel = (eyes[1]! + eyes[4]!) / 2
  const eyeFront = Math.max(eyes[2]!, eyes[5]!)
  const pieces = new Map<
    number,
    { nearEyes: boolean; front: number; left: number; right: number; top: number }
  >()
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!
    const y = positions[i * 3 + 1]!
    const z = positions[i * 3 + 2]!
    const toEye = Math.min(
      Math.hypot(x - eyes[0]!, y - eyes[1]!, z - eyes[2]!),
      Math.hypot(x - eyes[3]!, y - eyes[4]!, z - eyes[5]!),
    )
    const piece = pieces.get(find(i))
    if (piece) {
      piece.nearEyes &&= toEye <= LASH_REACH
      piece.front = Math.max(piece.front, z)
      piece.left = Math.min(piece.left, x)
      piece.right = Math.max(piece.right, x)
      piece.top = Math.max(piece.top, y)
    } else {
      pieces.set(find(i), { nearEyes: toEye <= LASH_REACH, front: z, left: x, right: x, top: y })
    }
  }
  const kindOf = new Map<number, CardKind>()
  for (const [root, piece] of pieces) {
    const earring =
      piece.right - piece.left <= EARRING_THIN &&
      Math.abs((piece.left + piece.right) / 2 - middle) >= EARRING_SIDE &&
      piece.top <= eyeLevel - EARRING_BELOW
    kindOf.set(
      root,
      piece.nearEyes ? LASH : earring || piece.front - eyeFront > GEAR_FRONT ? GEAR : HAIR,
    )
  }
  return Uint8Array.from({ length: index.length / 3 }, (_, t) => kindOf.get(find(index[t * 3]!))!)
}

/**
 * An opacity mesh's triangles (`index`) with its cards' twins folded into
 * one. Rocketbox models a card two-sided — each triangle again at its
 * corners' spots, wound the other way — and the material draws both sides
 * of both: at one depth, so either copy wins a pixel, and a back copy's
 * normals are often its front's, which, turned for the side it shows, face
 * away from the light: the hair goes black in patches. Of each such pair the
 * copy whose normals agree with its winding is kept (the first, when both
 * or neither do): drawn double-sided, it shows from behind with them
 * turned. Returns the corners kept, in order; a triangle with no twin
 * stays.
 */
export function foldTwins(
  positions: Triples,
  normals: Triples,
  index: ArrayLike<number>,
): number[] {
  const { spots } = spotsOf(positions)
  const at = (corner: number, axis: number) => positions[index[corner]! * 3 + axis]!
  // Each triangle's winding, as its corners turn (unnormalised), and
  // whether its normals agree with it.
  const winding = (t: number) => {
    const e = [0, 1, 2].map((axis) => at(t * 3 + 1, axis) - at(t * 3, axis))
    const f = [0, 1, 2].map((axis) => at(t * 3 + 2, axis) - at(t * 3, axis))
    return [
      e[1]! * f[2]! - e[2]! * f[1]!,
      e[2]! * f[0]! - e[0]! * f[2]!,
      e[0]! * f[1]! - e[1]! * f[0]!,
    ]
  }
  const agrees = (t: number, w: number[]) => {
    let along = 0
    for (let k = 0; k < 3; k++) {
      for (let axis = 0; axis < 3; axis++)
        along += normals[index[t * 3 + k]! * 3 + axis]! * w[axis]!
    }
    return along > 0
  }
  const coincident = new Map<string, number[]>()
  const count = index.length / 3
  for (let t = 0; t < count; t++) {
    const key = [0, 1, 2]
      .map((k) => spots[index[t * 3 + k]!]!)
      .sort((a, b) => a - b)
      .join()
    const found = coincident.get(key)
    if (found) found.push(t)
    else coincident.set(key, [t])
  }
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  const dropped = new Uint8Array(count)
  for (const triangles of coincident.values()) {
    if (triangles.length < 2) continue
    const windings = triangles.map(winding)
    // Copies wound the same way are no two-sided card: left be.
    if (!windings.some((w) => dot(w, windings[0]!) < 0)) continue
    const kept = triangles.find((t, i) => agrees(t, windings[i]!)) ?? triangles[0]!
    for (const t of triangles) if (t !== kept) dropped[t] = 1
  }
  const corners: number[] = []
  for (let t = 0; t < count; t++) {
    if (!dropped[t]) corners.push(index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!)
  }
  return corners
}

const foldedGeometries = new WeakSet<BufferGeometry>()

/**
 * Folds an opacity mesh's twin cards (see `foldTwins`) in its geometry
 * itself, once: every copy of the character shares it.
 */
export function foldCardTwins(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (foldedGeometries.has(geometry) || !(position && normal)) return
  foldedGeometries.add(geometry)
  // As stored (often quantised, interleaved): read a component at a time.
  const values = (attribute: typeof position) =>
    Float32Array.from({ length: attribute.count * 3 }, (_, j) =>
      attribute.getComponent(Math.floor(j / 3), j % 3),
    )
  const index = indexOf(geometry)
  const kept = foldTwins(values(position), values(normal), index)
  if (kept.length < index.length) geometry.setIndex(kept)
}

/**
 * Each of a donor's bone slots as one of the wearer's bones: by name, and
 * anything the wearer lacks on its head.
 */
export function remapBones(
  names: readonly string[],
  wearer: readonly string[],
  head: number,
): Uint16Array {
  const byName = new Map(wearer.map((name, index) => [name, index]))
  return Uint16Array.from(names, (name) => byName.get(name) ?? head)
}

/**
 * A donor's hair points carried onto the wearer, each by the bones that
 * carry it: a bone slot's anchor on the donor (`from`, xyz per slot) goes
 * to its anchor on the wearer (`to`), the point keeping its offset from it
 * scaled axis by axis. The head's anchors are the skull fit's (the origin
 * to its shift), so hair on the head keeps its place over the skull; hair
 * lying on the back and shoulders keeps its place over them.
 */
export function carryPoints(
  points: Triples,
  skinIndex: ArrayLike<number>,
  skinWeight: ArrayLike<number>,
  anchors: { from: Triples; to: Triples },
  scale: readonly number[],
): Float32Array {
  const count = points.length / 3
  const influences = skinIndex.length / count
  const carried = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    let total = 0
    for (let k = 0; k < influences; k++) {
      const weight = skinWeight[i * influences + k]!
      if (weight <= 0) continue
      const slot = skinIndex[i * influences + k]!
      total += weight
      for (let axis = 0; axis < 3; axis++) {
        carried[i * 3 + axis]! +=
          weight *
          (anchors.to[slot * 3 + axis]! +
            (points[i * 3 + axis]! - anchors.from[slot * 3 + axis]!) * scale[axis]!)
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      carried[i * 3 + axis] = total > 0 ? carried[i * 3 + axis]! / total : points[i * 3 + axis]!
    }
  }
  return carried
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

/** A triangle with less area (texels²) than this on its texture covers none of it. */
const FLAT = 1e-12

/**
 * Fills a triangle's texels on a `width` × `height` texture (corners in
 * 0–1 UVs), calling `visit` with each texel whose centre is inside and its
 * barycentric weights.
 */
function fillTexels(
  width: number,
  height: number,
  u: readonly number[],
  v: readonly number[],
  visit: (texel: number, w0: number, w1: number, w2: number) => void,
) {
  const ax = u[0]! * width
  const ay = v[0]! * height
  const bx = u[1]! * width
  const by = v[1]! * height
  const cx = u[2]! * width
  const cy = v[2]! * height
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  if (Math.abs(area) < FLAT) return
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const x = px + 0.5
      const y = py + 0.5
      const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area
      const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area
      const w2 = 1 - w0 - w1
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) visit(py * width + px, w0, w1, w2)
    }
  }
}

/** Grows a mask by a texel each way (the largest value round each texel), so a UV island's rim keeps it. */
function grown(mask: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(mask)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let most = out[y * width + x]!
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
            most = Math.max(most, mask[ny * width + nx]!)
          }
        }
      }
      out[y * width + x] = most
    }
  }
  return out
}

/**
 * The cap's texture: the donor's head texture with everything but its hair
 * cut away (alpha 0) — the skin round the hairline, where the cap reaches
 * past the hair. A triangle all of whose corners are the hair's shell
 * (`shell`, 1 or 0 per corner) is hair whatever its colour (a highlight
 * can pass for skin); along the hairline, hair is what is nearer the
 * hair's colour than the skin's, and less so towards corners off the
 * shell (a pale skin can pass for blond hair).
 */
export function capPixels(
  head: Pixels,
  hair: Rgb,
  skin: Rgb,
  triangles: readonly { u: number[]; v: number[]; shell: number[] }[],
): Pixels {
  const mask = hairMask(head, hair, skin)
  const solid = new Float32Array(mask.length)
  const edge = new Float32Array(mask.length)
  for (const tri of triangles) {
    const [a, b, c] = tri.shell as [number, number, number]
    fillTexels(head.width, head.height, tri.u, tri.v, (texel, w0, w1, w2) => {
      if (a && b && c) solid[texel] = 1
      else edge[texel] = Math.max(edge[texel]!, mask[texel]! * (a * w0 + b * w1 + c * w2))
    })
  }
  const shell = grown(solid, head.width, head.height)
  const out: Pixels = {
    data: new Uint8ClampedArray(head.data),
    width: head.width,
    height: head.height,
  }
  for (let i = 0; i < mask.length; i++) {
    out.data[i * 4 + 3] = Math.round(255 * Math.max(edge[i]!, shell[i]!))
  }
  return out
}

/** How far (bind units) round a cheek bone the skin's colour is sampled. */
const CHEEK_REACH = 0.015

/**
 * The donor's skin colour, for telling its hair from its skin: the median
 * (by lightness, so a pore or a highlight doesn't pull it off) of its head
 * texture round its cheek bones. Null when it has none to sample.
 */
function skinTone(head: Pixels, uvs: Triples, points: Triples, cheeks: Triples[]): Rgb | null {
  const samples: Rgb[] = []
  const count = points.length / 3
  for (let i = 0; i < count; i++) {
    const near = cheeks.some(
      (cheek) =>
        Math.hypot(
          points[i * 3]! - cheek[0]!,
          points[i * 3 + 1]! - cheek[1]!,
          points[i * 3 + 2]! - cheek[2]!,
        ) <= CHEEK_REACH,
    )
    if (!near) continue
    const x = Math.min(head.width - 1, Math.max(0, Math.floor(uvs[i * 2]! * head.width)))
    const y = Math.min(head.height - 1, Math.max(0, Math.floor(uvs[i * 2 + 1]! * head.height)))
    const p = (y * head.width + x) * 4
    samples.push([head.data[p]!, head.data[p + 1]!, head.data[p + 2]!])
  }
  if (samples.length === 0) return null
  samples.sort((a, b) => luminance(...a) - luminance(...b))
  return samples[Math.floor(samples.length / 2)]!
}

/** A skinned mesh's bones' places in the bind pose (xyz per bone). */
function boneBindPositions(mesh: SkinnedMesh): Float32Array {
  const places = new Float32Array(mesh.skeleton.bones.length * 3)
  const inverse = new Matrix4()
  mesh.skeleton.boneInverses.forEach((boneInverse, i) => {
    inverse.copy(boneInverse).invert()
    places[i * 3] = inverse.elements[12]!
    places[i * 3 + 1] = inverse.elements[13]!
    places[i * 3 + 2] = inverse.elements[14]!
  })
  return places
}

function bonePlaces(mesh: SkinnedMesh): Map<string, number[]> {
  const places = boneBindPositions(mesh)
  return new Map(
    mesh.skeleton.bones.map((bone, i) => [
      bone.name,
      [places[i * 3]!, places[i * 3 + 1]!, places[i * 3 + 2]!],
    ]),
  )
}

const isHeadBone = (name: string) => /Head$/.test(name)

/**
 * A skeleton's bone names, the face's bones (the head's children: jaw,
 * lips, brows, lids) named as the head: hair a face bone carried would
 * otherwise flap with a smile or a blink on the wearer.
 */
function hairBoneNames(mesh: SkinnedMesh): string[] {
  const head = mesh.skeleton.bones.find((bone) => isHeadBone(bone.name))
  return mesh.skeleton.bones.map((bone) => {
    for (let up = bone.parent; up && head; up = up.parent) if (up === head) return head.name
    return bone.name
  })
}

/** A mesh's points (or normals) in the bind pose, flat. */
function bindPoints(mesh: Mesh, geometry: BufferGeometry, name: 'position' | 'normal') {
  const attribute = geometry.getAttribute(name)
  const skinned = mesh as SkinnedMesh
  const bind = skinned.isSkinnedMesh ? skinned.bindMatrix : new Matrix4()
  const normalMatrix = new Matrix3().getNormalMatrix(bind)
  const out = new Float32Array(attribute.count * 3)
  const e = bind.elements
  const n = normalMatrix.elements
  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i)
    const y = attribute.getY(i)
    const z = attribute.getZ(i)
    if (name === 'position') {
      out[i * 3] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!
      out[i * 3 + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!
      out[i * 3 + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!
    } else {
      const nx = n[0]! * x + n[3]! * y + n[6]! * z
      const ny = n[1]! * x + n[4]! * y + n[7]! * z
      const nz = n[2]! * x + n[5]! * y + n[8]! * z
      const length = Math.hypot(nx, ny, nz) || 1
      out[i * 3] = nx / length
      out[i * 3 + 1] = ny / length
      out[i * 3 + 2] = nz / length
    }
  }
  return out
}

/**
 * Meshes' surfaces as one (bind pose, as loaded), with `more` surfaces
 * joined on.
 */
function surfaceOf(meshes: readonly Mesh[], more: readonly Surface[] = []): Surface {
  const parts = [
    ...meshes.map((mesh) => {
      const geometry = originalGeometry(mesh)
      return {
        points: bindPoints(mesh, geometry, 'position'),
        normals: bindPoints(mesh, geometry, 'normal'),
      }
    }),
    ...more,
  ]
  const joined = (name: 'points' | 'normals') => {
    const out = new Float32Array(parts.reduce((sum, part) => sum + part[name].length, 0))
    let at = 0
    for (const part of parts) {
      out.set(part[name], at)
      at += part[name].length
    }
    return out
  }
  const points = joined('points')
  return { points, normals: joined('normals'), grid: new PointGrid(points, SKULL_CELL) }
}

const indexOf = (geometry: BufferGeometry) =>
  geometry.index
    ? Array.from(geometry.index.array as ArrayLike<number>)
    : Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i)

/** The material a look found on a mesh (the look swaps in its own dressed copies). */
const ownMaterial = (mesh: Mesh) => (mesh.userData.lookOriginal ?? mesh.material) as Material

/** The character's own meshes of one part (by their material's name ending). */
function ownMeshes(model: Object3D, part: 'body' | 'opacity'): SkinnedMesh[] {
  const found: SkinnedMesh[] = []
  model.traverse((object) => {
    const mesh = object as SkinnedMesh
    if (!mesh.isSkinnedMesh || Array.isArray(mesh.material)) return
    if (ownMaterial(mesh).name.endsWith(`_${part}`)) found.push(mesh)
  })
  return found
}

/** The eyeballs' centres (bind pose), from the eye bones. */
function eyesOf(mesh: SkinnedMesh): number[] | null {
  const places = bonePlaces(mesh)
  const left = [...places].find(([name]) => /LEye$/.test(name))?.[1]
  const right = [...places].find(([name]) => /REye$/.test(name))?.[1]
  return left && right ? [...left, ...right] : null
}

const kindsCache = new WeakMap<BufferGeometry, Uint8Array>()

/** What each triangle of an opacity mesh is (see `cardKinds`), worked out once per geometry. */
function kindsOf(mesh: SkinnedMesh): Uint8Array {
  const geometry = originalGeometry(mesh)
  let kinds = kindsCache.get(geometry)
  if (!kinds) {
    const eyes = eyesOf(mesh)
    kinds = eyes
      ? cardKinds(bindPoints(mesh, geometry, 'position'), indexOf(geometry), eyes)
      : new Uint8Array(indexOf(geometry).length / 3).fill(HAIR)
    kindsCache.set(geometry, kinds)
  }
  return kinds
}

/**
 * What a hairstyle is carried over by: the shared skull, and which points
 * of each card-haired head (by its material's name) are its hair's shell.
 */
export type HairBasis = Pick<HairLibrary, 'skull' | 'shells'>

/** Which points of a head are its hair's shell (1), or null for a head whose hair is only painted on. */
const shellOf = (head: Mesh, basis: HairBasis) => basis.shells.get(ownMaterial(head).name) ?? null

/**
 * Some of a geometry's triangles as a geometry of their own, holding only
 * the points they use and all they carry — positions and normals (into the
 * bind pose when `toBind`), texture coordinates, vertex colours (which the
 * material multiplies by, where there are any), the skin's bone slots and
 * weights — as plain numbers.
 */
function subset(
  mesh: SkinnedMesh,
  geometry: BufferGeometry,
  triangles: readonly number[],
  toBind: boolean,
): BufferGeometry {
  const index = indexOf(geometry)
  const remap = new Map<number, number>()
  const corners: number[] = []
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const old = index[t * 3 + k]!
      let fresh = remap.get(old)
      if (fresh === undefined) {
        fresh = remap.size
        remap.set(old, fresh)
      }
      corners.push(fresh)
    }
  }
  const olds = [...remap.keys()]
  const bound = toBind
    ? {
        position: bindPoints(mesh, geometry, 'position'),
        normal: bindPoints(mesh, geometry, 'normal'),
      }
    : null
  const out = new BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const size = attribute.itemSize
    const values =
      name === 'skinIndex'
        ? new Uint16Array(olds.length * size)
        : new Float32Array(olds.length * size)
    const from = bound?.[name as 'position' | 'normal']
    olds.forEach((old, i) => {
      for (let c = 0; c < size; c++) {
        values[i * size + c] = from ? from[old * size + c]! : attribute.getComponent(old, c)
      }
    })
    out.setAttribute(name, new BufferAttribute(values, size))
  }
  out.setIndex(corners)
  return out
}

/** One part of a borrowed hairstyle: the cap, or the cards. */
export type HairPart = {
  name: 'cap' | 'cards'
  /** In the donor's bind pose; its skin's bone slots are the donor's. */
  geometry: BufferGeometry
  /** Holds the part's texture where it was loaded in a browser. */
  material: Material
  /** Its texture's pixels (the cap's with the skin cut away), to dye; null where there are none. */
  pixels: Pixels | null
  /** Which of those pixels a dye takes (all that show, when null), and their usual lightness. */
  dyeMask: Float32Array | null
  lum: number
  /**
   * Its texels less opaque than this (0–255) are cut away: the rest's
   * colour is bled under them (see `bleedHair`).
   */
  bleedBelow: number
  /** How far (bind units) it is kept off the wearer's head and body. */
  clearance: number
}

/**
 * A hairstyle ready to put on anyone (see `wearHair`): the donor's hair,
 * its bones' names (the face's named as the head) and bind places by skin
 * slot, and how the shared skull fits the donor.
 */
export type HairAsset = {
  id: string
  parts: HairPart[]
  bones: string[]
  anchors: Float32Array
  fit: AxisFit
  basis: HairBasis
}

/**
 * The skull's hair share a cap triangle's every corner has at least, when
 * on the skull: a beard or sideburn painted onto the face stays the donor's.
 */
const CAP_ZONE = 0.1

/** How far (bind units) the cap and the cards are kept off the wearer. */
const CAP_CLEARANCE = 0.0015
const CARD_CLEARANCE = 0.003

/** Deeper (bind units) into the wearer than this, a point is left be by `pushOut`. */
const PUSH_REACH = 0.03

/** The cards' cut-out, as the characters' own (see avatar-rig.ts). */
const CARD_ALPHA_TEST = 0.4

/** The cap's cut-out: its hair against the skin cut away round it. */
const CAP_ALPHA_TEST = 0.5
const CAP_BLEED_BELOW = Math.round(CAP_ALPHA_TEST * 255)

/**
 * A hairstyle from a donor's loaded scene: the cap (its head's triangles
 * touching its hair's shell, clear of the face) and the hair cards (its
 * opacity mesh without the lashes and any gear). `pixels` are its head and
 * opacity textures', for the cap's cut-out and dyeing; without them
 * (offline) the parts have geometry only.
 */
export function hairAssetOf(
  id: string,
  scene: Object3D,
  basis: HairBasis,
  pixels: { head: Pixels; opacity: Pixels | null } | null,
): HairAsset {
  const head = headOf(scene) as SkinnedMesh | null
  if (!head?.isSkinnedMesh) throw new Error(`hair ${id}: no head`)
  const fit = faceFit(basis.skull, bonePlaces(head))
  if (!fit) throw new Error(`hair ${id}: no face bones`)
  const skull = fitSkull(basis.skull, fit)
  const geometry = originalGeometry(head)
  const points = bindPoints(head, geometry, 'position')
  const count = points.length / 3
  const { zone, off } = standingOver(points, skull)
  const shell = shellOf(head, basis)
  const index = indexOf(geometry)
  const clearOfFace = (i: number) => zone[i]! >= CAP_ZONE || off[i]! > OFF_FROM
  const capTriangles: number[] = []
  for (let t = 0; shell && t < index.length / 3; t++) {
    const corners = [0, 1, 2].map((k) => index[t * 3 + k]!)
    if (corners.some((i) => shell[i]) && corners.every(clearOfFace)) capTriangles.push(t)
  }
  const opacity = ownMeshes(scene, 'opacity')[0]
  const parts: HairPart[] = []
  const opacityMaterial = opacity && ownMaterial(opacity)
  const hair = pixels?.opacity ? meanColor(pixels.opacity) : null
  if (capTriangles.length > 0) {
    const material = ownMaterial(head).clone()
    material.name = `${id}:hair-cap`
    Object.assign(material, {
      transparent: false,
      alphaTest: CAP_ALPHA_TEST,
      side: FrontSide,
      // Where the cap lies on the wearer's own scalp, it is drawn over it.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    const cap: HairPart = {
      name: 'cap',
      geometry: subset(head, geometry, capTriangles, true),
      material,
      pixels: null,
      dyeMask: null,
      lum: 0,
      bleedBelow: CAP_BLEED_BELOW,
      clearance: CAP_CLEARANCE,
    }
    const uv = geometry.getAttribute('uv')
    const uvs = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = uv.getX(i)
      uvs[i * 2 + 1] = uv.getY(i)
    }
    const places = bonePlaces(head)
    const cheeks = [...places].filter(([name]) => /Cheek$/.test(name)).map(([, place]) => place)
    const skin = pixels && skinTone(pixels.head, uvs, points, cheeks)
    if (pixels && hair && skin) {
      cap.pixels = capPixels(
        pixels.head,
        hair,
        skin,
        capTriangles.map((t) => {
          const at = [0, 1, 2].map((k) => index[t * 3 + k]!)
          return {
            u: at.map((i) => uvs[i * 2]!),
            v: at.map((i) => uvs[i * 2 + 1]!),
            shell: at.map((i) => shell![i]!),
          }
        }),
      )
      cap.dyeMask = Float32Array.from(
        { length: cap.pixels.width * cap.pixels.height },
        (_, i) => cap.pixels!.data[i * 4 + 3]! / 255,
      )
      cap.lum = maskedLuminance(cap.pixels, cap.dyeMask)
    }
    parts.push(cap)
  }
  if (opacity && opacityMaterial) {
    const kinds = kindsOf(opacity)
    const hairTriangles = [...kinds.keys()].filter((t) => kinds[t] === HAIR)
    if (hairTriangles.length > 0) {
      const material = opacityMaterial.clone()
      material.name = `${id}:hair-cards`
      Object.assign(material, { transparent: false, alphaTest: CARD_ALPHA_TEST, depthWrite: true })
      parts.push({
        name: 'cards',
        geometry: subset(opacity, originalGeometry(opacity), hairTriangles, true),
        material,
        pixels: pixels?.opacity ?? null,
        dyeMask: null,
        lum: hair ? luminance(...hair) : 0,
        bleedBelow: BLEED_BELOW,
        clearance: CARD_CLEARANCE,
      })
    }
  }
  return {
    id,
    parts,
    bones: hairBoneNames(head),
    anchors: boneBindPositions(head),
    fit,
    basis,
  }
}

/** A head's own hair volume taken in (see `deflation`), and where its points stood (bind pose). */
type Deflation = { moves: Float32Array; pressed: Float32Array; points: Float32Array }

const deflations = new WeakMap<BufferGeometry, Deflation>()

/**
 * How a head's own hair volume is taken in under the skull (see
 * `deflation`, `ironed`), in its bind pose, worked out once per head
 * geometry. Null for a head whose hair is only painted on, or that the
 * skull doesn't fit.
 */
function headDeflation(model: Object3D, head: SkinnedMesh, basis: HairBasis): Deflation | null {
  const shell = shellOf(head, basis)
  if (!shell) return null
  const geometry = originalGeometry(head)
  let taken = deflations.get(geometry)
  if (!taken) {
    const fit = faceFit(basis.skull, bonePlaces(head))
    if (!fit) return null
    const points = bindPoints(head, geometry, 'position')
    const normals = bindPoints(head, geometry, 'normal')
    const skin = (values: Float32Array) => values.filter((_, i) => !shell[Math.floor(i / 3)])
    const skinPoints = skin(points)
    const neck =
      boneBindPositions(head)[
        head.skeleton.bones.findIndex((bone) => isHeadBone(bone.name)) * 3 + 1
      ]!
    const pressed = deflation(points, fitSkull(basis.skull, fit), shell, {
      skin: {
        points: skinPoints,
        normals: skin(normals),
        grid: new PointGrid(skinPoints, SKULL_CELL),
      },
      body: surfaceOf(ownMeshes(model, 'body')),
      neck,
    })
    taken = {
      moves: ironed(points, indexOf(geometry), pressed),
      pressed: pressed.pressed,
      points,
    }
    deflations.set(geometry, taken)
  }
  return taken
}

/**
 * Of the flatness a point pressed all the way onto a surface is given
 * across it, what is kept (the reshaping needs its stretch not to vanish).
 */
const PRESS_KEEP = 0.02

/**
 * A deflation's moves for the reshaping: each point's own, the same
 * wherever the point is — save across the surface it is pressed onto,
 * where its surroundings are squashed flat. The reshaping turns a point's
 * normal by how its surroundings stretch, so hair pressed flat is shaded
 * as the skull it lies on, not as the bun or the lock it was.
 */
function pressedMoves({ moves, pressed, points }: Deflation): PointMove {
  return (point, index, move) => {
    move.fromArray(moves, index * 3)
    const px = pressed[index * 3]!
    const py = pressed[index * 3 + 1]!
    const pz = pressed[index * 3 + 2]!
    const press = Math.hypot(px, py, pz)
    if (press === 0) return
    const across =
      (((point.x - points[index * 3]!) * px +
        (point.y - points[index * 3 + 1]!) * py +
        (point.z - points[index * 3 + 2]!) * pz) *
        (1 - PRESS_KEEP)) /
      press
    move.x -= px * across
    move.y -= py * across
    move.z -= pz * across
  }
}

/**
 * The reshaping a character needs to wear another's hair, or none: its own
 * hair volume (a shell of its head, where it has hair cards) taken in under
 * the skull, for the borrowed hair to sit on — or, bald, to show the skull.
 * A character whose hair is only painted on keeps its head as it is.
 */
export function hairShaper(model: Object3D, basis: HairBasis): Shaper {
  const head = headOf(model) as SkinnedMesh | null
  const taken = head?.isSkinnedMesh ? headDeflation(model, head, basis) : null
  const move = taken && pressedMoves(taken)
  return (mesh) => (move && mesh === head ? move : null)
}

/** Puts a new skinned mesh beside another, on its skeleton, bound as it is. */
function besides(beside: SkinnedMesh, geometry: BufferGeometry, material: Material, name: string) {
  const mesh = new SkinnedMesh(geometry, material)
  mesh.name = name
  mesh.position.copy(beside.position)
  mesh.quaternion.copy(beside.quaternion)
  mesh.scale.copy(beside.scale)
  mesh.bind(beside.skeleton, beside.bindMatrix)
  mesh.castShadow = beside.castShadow
  mesh.receiveShadow = beside.receiveShadow
  // Skinned bounds follow the bind pose, not the animated body.
  mesh.frustumCulled = false
  beside.parent?.add(mesh)
  return mesh
}

/**
 * Hides a character's own hair cards (steps to undo them into `undo`),
 * keeping what else its opacity mesh holds — its lashes, and gear such as
 * a visor — as a mesh of its own beside it: same skeleton, its geometry
 * reshaped with the rest, and the same material, dressed as the mesh's is
 * until the look (which finds it by that material's name) dresses it too.
 */
function hideOwnHair(model: Object3D, undo: (() => void)[]) {
  for (const mesh of ownMeshes(model, 'opacity')) {
    const kinds = kindsOf(mesh)
    if (!kinds.includes(HAIR)) continue
    const wasVisible = mesh.visible
    mesh.visible = false
    const kept = [...kinds.keys()].filter((t) => kinds[t] !== HAIR)
    const keptMesh =
      kept.length > 0
        ? besides(
            mesh,
            subset(mesh, originalGeometry(mesh), kept, false),
            mesh.material as Material,
            `${mesh.name}:kept`,
          )
        : null
    if (keptMesh && mesh.userData.lookOriginal) {
      keptMesh.userData.lookOriginal = mesh.userData.lookOriginal
    }
    undo.push(() => {
      mesh.visible = wasVisible
      if (keptMesh) {
        keptMesh.removeFromParent()
        keptMesh.geometry.dispose()
      }
    })
  }
}

/** A copy of `template` (its sampling, colour space, flip) showing `pixels`. */
function textureFrom(pixels: Pixels, template: Texture): Texture {
  const texture = template.clone()
  texture.source = new Source(pictureOf(pixels))
  texture.needsUpdate = true
  return texture
}

/** Frees a texture no one needs again: its picture too. */
function freeTexture(texture: Texture) {
  texture.dispose()
  const image = texture.image as ImageBitmap | null
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
}

/**
 * Frees the GPU's copies of a material's textures. Another wearer of the
 * same hairstyle still showing them has them uploaded again; one taken off
 * for good leaves nothing on the GPU.
 */
function releaseTextures(material: Material) {
  for (const value of Object.values(material))
    if ((value as Texture | null)?.isTexture) value.dispose()
}

/**
 * Puts a hairstyle on a character (steps to undo it into `undo`): each part
 * carried from the donor's bind pose into the wearer's, on the wearer's
 * skeleton, kept off its head (as the borrowed hair will find it, its own
 * volume taken in) and body, dyed `dyeHex` when given.
 */
function wearBorrowed(
  model: Object3D,
  head: SkinnedMesh,
  asset: HairAsset,
  dyeHex: string | null,
  undo: (() => void)[],
) {
  const fit = faceFit(asset.basis.skull, bonePlaces(head))
  if (!fit) return
  const carry = composeFits(fit, invertFit(asset.fit))
  const headSurface = surfaceOf([head])
  const taken = headDeflation(model, head, asset.basis)
  if (taken) {
    const points = headSurface.points as Float32Array
    for (let i = 0; i < points.length; i++) points[i]! += taken.moves[i]!
  }
  // The head as the borrowed hair will find it, its own volume taken in.
  const surface = surfaceOf([], [headSurface, surfaceOf(ownMeshes(model, 'body'))])

  const names = head.skeleton.bones.map((bone) => bone.name)
  const headIndex = names.findIndex(isHeadBone)
  const slots = remapBones(asset.bones, names, headIndex)
  const places = boneBindPositions(head)
  const from = new Float32Array(asset.anchors.length)
  const to = new Float32Array(asset.anchors.length)
  slots.forEach((bone, slot) => {
    for (let axis = 0; axis < 3; axis++) {
      // Hair on the head keeps its place over the skull; on the body, over its bones.
      from[slot * 3 + axis] = bone === headIndex ? 0 : asset.anchors[slot * 3 + axis]!
      to[slot * 3 + axis] = bone === headIndex ? carry.shift[axis]! : places[bone * 3 + axis]!
    }
  })
  const unbind = head.bindMatrix.clone().invert()
  const unbindNormal = new Matrix3().getNormalMatrix(unbind)

  for (const part of asset.parts) {
    const geometry = part.geometry.clone()
    const skinIndex = geometry.getAttribute('skinIndex')
    const carried = carryPoints(
      part.geometry.getAttribute('position').array as Float32Array,
      skinIndex.array as Uint16Array,
      geometry.getAttribute('skinWeight').array as Float32Array,
      { from, to },
      carry.scale,
    )
    pushOut(carried, surface, part.clearance, PUSH_REACH)
    const normal = geometry.getAttribute('normal')
    for (let i = 0; i < normal.count; i++) {
      // A normal turns by the inverse of a stretch.
      const nx = normal.getX(i) / carry.scale[0]
      const ny = normal.getY(i) / carry.scale[1]
      const nz = normal.getZ(i) / carry.scale[2]
      const length = Math.hypot(nx, ny, nz) || 1
      normal.setXYZ(i, nx / length, ny / length, nz / length)
    }
    geometry.setAttribute('position', new BufferAttribute(carried, 3))
    geometry.getAttribute('position').applyMatrix4(unbind)
    normal.applyNormalMatrix(unbindNormal)
    for (let i = 0; i < skinIndex.array.length; i++)
      skinIndex.array[i] = slots[skinIndex.array[i]!]!

    const material = part.material.clone()
    const map = (part.material as MeshStandardMaterial).map
    const dyed =
      dyeHex && map && part.pixels
        ? (() => {
            const pixels: Pixels = {
              data: new Uint8ClampedArray(part.pixels.data),
              width: part.pixels.width,
              height: part.pixels.height,
            }
            dye(pixels, hexToRgb(dyeHex), part.lum, part.dyeMask)
            // The dye leaves the cut-away texels as they were.
            bleedHair(pixels, part.bleedBelow)
            return textureFrom(pixels, map)
          })()
        : null
    if (dyed) (material as MeshStandardMaterial).map = dyed
    const mesh = besides(head, geometry, material, `hair:${part.name}`)
    undo.push(() => {
      mesh.removeFromParent()
      geometry.dispose()
      releaseTextures(material)
      material.dispose()
      if (dyed) freeTexture(dyed)
    })
  }
}

/**
 * Puts a hairstyle on a character, bald (`asset` null) taking its own hair
 * cards off and no more: its lashes and any gear stay (a mesh of their own
 * beside its hidden opacity mesh). Its own hair volume, a shell of its
 * head, is the shape's to take in: pass `hairShaper(model, …)` to the
 * body's reshaping. Returns what takes it all off again.
 */
export function wearHair(
  model: Object3D,
  asset: HairAsset | null,
  options: { dye: string | null },
): () => void {
  const head = headOf(model) as SkinnedMesh | null
  if (!head?.isSkinnedMesh) return () => {}
  const undo: (() => void)[] = []
  hideOwnHair(model, undo)
  if (asset) wearBorrowed(model, head, asset, options.dye, undo)
  return () => {
    for (const step of undo.reverse()) step()
  }
}

/** The side (px) the cap's texture is read at: the head's 2048 is more than hair needs. */
const CAP_TEXTURE = 1024

/** The donor's materials a hairstyle needs (its head's and its cards'); the rest load bare. */
const HAIR_MATERIAL = /_(head|opacity)$/

/** Loads a donor without its body's textures, which a hairstyle never shows. */
function loadDonor(id: string) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  loader.register((parser) => ({
    name: 'hair-materials-only',
    loadMaterial: (index: number) =>
      HAIR_MATERIAL.test(parser.json.materials[index].name ?? '')
        ? null
        : Promise.resolve(new MeshBasicMaterial()),
  }))
  return loader.loadAsync(avatarUrl(id))
}

/** How many donors' hairstyles are kept loaded (each holds a few MB of pictures). */
const ASSETS_KEPT = 4

const assets = new Map<string, Promise<HairAsset>>()

/**
 * A donor's hairstyle, loaded once (a few are kept; a failed load may be
 * tried again): its cap's texture cut out and its parts' pixels read, so
 * wearing it, dyed or not, is quick.
 */
export function loadHairAsset(donorId: string): Promise<HairAsset> {
  let found = assets.get(donorId)
  if (found) {
    assets.delete(donorId)
  } else {
    found = Promise.all([loadHairLibrary(), loadDonor(donorId)]).then(([library, gltf]) => {
      for (const mesh of ownMeshes(gltf.scene, 'opacity')) foldCardTwins(mesh.geometry)
      const head = headOf(gltf.scene)
      const headMap = head && (ownMaterial(head) as MeshStandardMaterial).map
      if (!headMap) throw new Error(`hair ${donorId}: no head texture`)
      const opacityMap = ownMeshes(gltf.scene, 'opacity')
        .map((mesh) => (ownMaterial(mesh) as MeshStandardMaterial).map)
        .find((map) => map)
      const asset = hairAssetOf(donorId, gltf.scene, library, {
        head: texturePixels(headMap, CAP_TEXTURE),
        opacity: opacityMap ? texturePixels(opacityMap) : null,
      })
      // Each part shows its own pixels — the cap's cut out, both bled
      // (after the cap and the dyes have read the colours as painted).
      for (const part of asset.parts) {
        const material = part.material as MeshStandardMaterial
        if (part.pixels && material.map) {
          bleedHair(part.pixels, part.bleedBelow)
          const original = material.map
          material.map = textureFrom(part.pixels, original)
          freeTexture(original)
        }
      }
      return asset
    })
    found.catch(() => assets.delete(donorId))
  }
  assets.set(donorId, found)
  if (assets.size > ASSETS_KEPT) assets.delete(assets.keys().next().value!)
  return found
}

/** Donors whose hairstyle failed to load, warned of once each. */
const warned = new Set<string>()

/**
 * Keeps a character in a hairstyle: none (null) leaves its own; BALD takes
 * its hair cards off; a donor's id in the library puts that donor's hair
 * on, dyed `dye` when given — any other id (an old or a foreign save) is
 * the character's own hair. A new style replaces the old one only once it
 * has loaded, so the character never shows bald in between.
 *
 * Returns the reshaping the hair needs (see `hairShaper`) — a new one each
 * time hair goes on, so the body's reshaping, given it, runs again over the
 * new meshes too — or null while the character's own hair is on.
 */
export function useAvatarHair(
  model: Object3D,
  style: HairStyle,
  dyeHex: string | null,
): Shaper | null {
  const worn = useRef<{ model: Object3D; undo: () => void } | null>(null)
  const [shaper, setShaper] = useState<{ model: Object3D; shaper: Shaper } | null>(null)
  useEffect(() => {
    const takeOff = () => {
      worn.current?.undo()
      worn.current = null
      setShaper(null)
    }
    if (worn.current && (worn.current.model !== model || style === null)) takeOff()
    if (style === null) return
    let current = true
    loadHairLibrary()
      .then(async (library) => {
        const offered = style === BALD || library.styles.some((entry) => entry.id === style)
        const asset = offered && style !== BALD ? await loadHairAsset(style) : null
        if (!current) return
        if (!offered) {
          takeOff()
          return
        }
        worn.current?.undo()
        worn.current = { model, undo: wearHair(model, asset, { dye: dyeHex }) }
        setShaper({ model, shaper: hairShaper(model, library) })
      })
      .catch((error: unknown) => {
        if (warned.has(style)) return
        warned.add(style)
        console.warn(`[look] could not put on hairstyle ${style}`, error)
      })
    return () => {
      current = false
    }
  }, [model, style, dyeHex])

  useEffect(
    () => () => {
      worn.current?.undo()
      worn.current = null
    },
    [],
  )
  return shaper?.model === model ? shaper.shaper : null
}
