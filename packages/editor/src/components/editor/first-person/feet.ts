import {
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
  type Material,
  Matrix4,
  type Mesh,
  type SkinnedMesh,
  Vector3,
} from 'three'
import type { PointMove, Shaper } from './avatar-shape'
import {
  curve,
  footTop,
  HEEL_BACK,
  halfWidth,
  heelBack,
  INSTEP_FROM,
  INSTEP_TO,
  smoothstep,
  TOE_TIP,
  toeFront,
} from './bare-foot'
import { type FootFrame, type FootGeometry, type FootTriangle, packFeet } from './feet-paint'
import type { AvatarFeet } from './footwear'
import { originalGeometry } from './head-geometry'

/**
 * A Rocketbox body's shoes are part of its body mesh, with no feet inside
 * them: going barefoot (or in socks) takes each shoe in to a foot's shape
 * (see bare-foot.ts) — only the shoe's points, and those at its top edge,
 * where the trouser leg or the bare leg carries on up, not at all.
 */

type Attribute = BufferAttribute | InterleavedBufferAttribute

/** The body's own mesh, which has the shoes (its material ends `_body`, or names only the character when it is all one). */
const BODY_MESH = /_body$|^[a-z]+\d+$/

/**
 * A foot's bones, by the end of their names once plain (Rocketbox's
 * "Bip01 L Foot" arrives as "Bip01_L_Foot"): its side and whether it is a
 * toe's.
 */
const FOOT_BONE = /([lr])(foot|toe\d*)$/

/**
 * A texture island is a shoe's (a foot's) when at least this share of its
 * points are skinned to the foot's bones at all: the trouser leg's island,
 * whose hem the foot carries too, is mostly the calf's and thigh's.
 */
const SHOE_ISLAND = 0.9

/** Points closer than this (bind-pose units) are one: a texture seam splits a point into copies. */
const WELD = 1e-5

/**
 * How finely (in the foot's lengths) a shoe is sampled to find its outline:
 * each triangle at this many steps a side, into cells this big.
 */
const SAMPLE_STEPS = 6
const CELL = 0.05

/**
 * How far (in the foot's lengths) a shoe's points ease into their move from
 * its top edge, where the leg or the trouser leg carries on: none at the
 * edge (the two stay joined), all of it this far off.
 */
const BLEND = 0.06

/**
 * The same where the leg is dressed at the edge (a trouser leg sewn onto
 * the shoe's collar, a boot's shaft): the foot eases in from it further,
 * which the trouser leg mostly hides.
 */
const DRESSED_BLEND = 0.2

/**
 * A shoe's top edge no longer than this (in the foot's lengths, seen from
 * the side) goes round the bare leg itself, which the foot then takes the
 * outline of; a longer one is a trouser leg's hem or a boot's shaft.
 */
const LEG_EDGE = 0.75

/**
 * How far (in the foot's lengths) below the shoe's top edge the foot takes
 * the edge's own outline (the leg's, where it carries on bare) rather than
 * a bare foot's, so a padded collar wider than the leg closes onto it.
 */
const CONFORM = 0.12

/** How far (in the foot's lengths) either side of the edge's outline, seen from above, a point passes from inside it to outside. */
const OUTSIDE_EDGE = 0.03

/** The least half-width (in the foot's lengths) the edge's outline narrows a foot to, either side of its middle. */
const LEAST_HALF = 0.03

/** How much fuller (in the foot's lengths) a sock is than the bare foot in it. */
const SOCK = 0.015

/**
 * The shoe's sole is found per stretch along it from the lowest points in
 * strips this wide across it; the middle of those is its sole there (a heel
 * spike, a strip or two, is left under it and flattened onto the ground).
 */
const SOLE_STRIP = 0.05

/** Where along the foot (in its lengths) its ball is, forward of which the sole is taken as found. */
const BALL = 0.8

/** A foot of the body: its frame, its shoe's outline, and the edge where the shoe meets the leg. */
type Foot = {
  frame: FootFrame
  origin: Vector3
  forward: Vector3
  outward: Vector3
  up: Vector3
  /** The foot's length (bind-pose units): the ankle to the ball along the ground. */
  length: number
  shoe: Outline
  /** The shoe's top edge as segments, six numbers (two bind-pose points) each. */
  edge: Float32Array
}

/**
 * A shoe's outline in its foot's coordinates (see bare-foot.ts), on a grid
 * of CELL-sized cells: `low` and `high`, how far across it reaches at each
 * height along it (rows of `rows` cells up, one row per column along), and
 * per column its sole's height, its top and its middle across; `back` and
 * `front` how far back and forward it reaches at all, and `backs` how far
 * back at each height.
 */
type Outline = {
  from: number
  columns: number
  rows: number
  low: Float32Array
  high: Float32Array
  sole: Float32Array
  top: Float32Array
  middle: Float32Array
  back: number
  front: number
  /** How far back the shoe reaches at each height (one per row). */
  backs: Float32Array
  /** Where along the foot each point along the shoe goes (see `ontoFoot`). */
  onto: (along: number) => number
  rim: Rim | null
}

/**
 * The shoe's top edge where the bare leg carries on from it (see LEG_EDGE),
 * seen from above on its outline's columns: how far across it reaches either
 * side along it (`low`, `high`) and how high it is there (`lowUp`,
 * `highUp`); how far back (at `backUp` high) and forward it reaches.
 */
type Rim = {
  low: Float32Array
  high: Float32Array
  lowUp: Float32Array
  highUp: Float32Array
  back: number
  backUp: number
  front: number
  /** Its widest across. */
  widest: number
}

/** A body's feet (none for a body without foot bones or shoes), and which foot each of its points' shoe is, -1 for none. */
type Feet = { feet: Foot[]; footOf: Int8Array }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** Sets of numbers joined together: `find` names the set a number is in. */
function unions(count: number) {
  const parent = Int32Array.from({ length: count }, (_, index) => index)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  const join = (a: number, b: number) => {
    parent[find(b)] = find(a)
  }
  return { find, join }
}

/** A bone's name plain: lower case, letters and digits only. */
const bonePlain = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Which foot (0 left, 1 right) a bone is, or null. */
function footBoneSide(name: string): 0 | 1 | null {
  const match = FOOT_BONE.exec(bonePlain(name))
  if (!match) return null
  return match[1] === 'l' ? 0 : 1
}

/** A bone's place in the bind pose. */
function bindPosition(mesh: SkinnedMesh, bone: number) {
  return new Vector3().setFromMatrixPosition(
    new Matrix4().copy(mesh.skeleton.boneInverses[bone]!).invert(),
  )
}

/** The corners of a geometry's triangles. */
const cornersOf = (geometry: BufferGeometry, count: number): ArrayLike<number> =>
  geometry.index?.array ?? Array.from({ length: count }, (_, index) => index)

/**
 * Which foot each point's shoe is: the texture islands (triangles joined by
 * their corners, so a texture seam parts them) nearly all skinned to one
 * foot's bones.
 */
function shoesOf(
  mesh: SkinnedMesh,
  corners: ArrayLike<number>,
  skinIndex: Attribute,
  skinWeight: Attribute,
): Int8Array {
  const sides = mesh.skeleton.bones.map((bone) => footBoneSide(bone.name))
  const count = skinIndex.count
  const { find, join } = unions(count)
  for (let i = 0; i < corners.length; i += 3) {
    join(corners[i]!, corners[i + 1]!)
    join(corners[i]!, corners[i + 2]!)
  }
  const tally = new Map<number, [number, number, number]>()
  for (let index = 0; index < count; index++) {
    const island = find(index)
    const entry = tally.get(island) ?? [0, 0, 0]
    entry[0]++
    const on = [false, false]
    for (let k = 0; k < skinIndex.itemSize; k++) {
      const side = sides[skinIndex.getComponent(index, k)]
      if (side !== null && side !== undefined && skinWeight.getComponent(index, k) > 0)
        on[side] = true
    }
    if (on[0]) entry[1]++
    if (on[1]) entry[2]++
    tally.set(island, entry)
  }
  const footOf = new Int8Array(count).fill(-1)
  for (let index = 0; index < count; index++) {
    const [all, left, right] = tally.get(find(index))!
    if (left >= all * SHOE_ISLAND) footOf[index] = 0
    else if (right >= all * SHOE_ISLAND) footOf[index] = 1
  }
  return footOf
}

/**
 * A foot's shoe's outline, from points sampled over its triangles (in the
 * foot's coordinates), each [along, out, up].
 */
function outlineOf(samples: readonly (readonly [number, number, number])[]): Outline {
  let back = Number.POSITIVE_INFINITY
  let front = Number.NEGATIVE_INFINITY
  let highest = 0
  for (const [along, , up] of samples) {
    back = Math.min(back, along)
    front = Math.max(front, along)
    highest = Math.max(highest, up)
  }
  const from = Math.floor(back / CELL) * CELL
  const columns = Math.max(1, Math.ceil((front - from) / CELL) + 1)
  const rows = Math.max(1, Math.ceil(highest / CELL) + 1)
  const low = new Float32Array(columns * rows).fill(Number.POSITIVE_INFINITY)
  const high = new Float32Array(columns * rows).fill(Number.NEGATIVE_INFINITY)
  const top = new Float32Array(columns).fill(Number.NEGATIVE_INFINITY)
  const backs = new Float32Array(rows).fill(Number.NaN)
  const lowest = new Map<number, number>()
  const column = (along: number) => clamp(Math.floor((along - from) / CELL), 0, columns - 1)
  for (const [along, out, up] of samples) {
    const c = column(along)
    const row = clamp(Math.floor(up / CELL), 0, rows - 1)
    const cell = c * rows + row
    if (!(along >= backs[row]!)) backs[row] = along
    low[cell] = Math.min(low[cell]!, out)
    high[cell] = Math.max(high[cell]!, out)
    top[c] = Math.max(top[c]!, up)
    const strip = c * 4096 + Math.floor(out / SOLE_STRIP) + 2048
    lowest.set(strip, Math.min(lowest.get(strip) ?? Number.POSITIVE_INFINITY, up))
  }
  const sole = new Float32Array(columns).fill(Number.NaN)
  const strips: number[][] = Array.from({ length: columns }, () => [])
  for (const [strip, up] of lowest) strips[Math.floor(strip / 4096)]!.push(up)
  strips.forEach((ups, c) => {
    if (ups.length === 0) return
    ups.sort((a, b) => a - b)
    sole[c] = ups[Math.floor(ups.length / 2)]!
  })
  fillColumns(low, high, columns, rows)
  fillAlong(sole, columns)
  fillAlong(backs, rows)
  smoothGrid(backs, 1, rows)
  // The foot stands no lower under its heel than under its arch: a heel's
  // block reaches down to the ground, but the foot on it is as high as the
  // shank in front of it (or higher), and comes down with it.
  for (let c = columns - 2; c >= 0; c--) {
    if (from + (c + 0.5) * CELL < BALL) sole[c] = Math.max(sole[c]!, sole[c + 1]!)
  }
  fillAlong(top, columns, Number.NEGATIVE_INFINITY)
  const middle = new Float32Array(columns)
  for (let c = 0; c < columns; c++) {
    // The middle across just over the sole (a heel's seat, not its spike),
    // where the shoe's outline is most the foot's.
    const first = clamp(Math.floor(sole[c]! / CELL), 0, rows - 1)
    let sum = 0
    let n = 0
    for (let r = first; r < Math.min(rows, first + 4); r++) {
      sum += (low[c * rows + r]! + high[c * rows + r]!) / 2
      n++
    }
    middle[c] = sum / n
  }
  // Widened by a cell before it is smoothed, so the smoothed outline still
  // takes in the shoe where it changes sharply (a collar's top): a point
  // left outside it would be taken for the shoe's widest and kept whole.
  spread(low, columns, rows, Math.min)
  spread(high, columns, rows, Math.max)
  for (let pass = 0; pass < 2; pass++) {
    smoothGrid(low, columns, rows)
    smoothGrid(high, columns, rows)
    smoothGrid(sole, columns, 1)
    smoothGrid(top, columns, 1)
    smoothGrid(middle, columns, 1)
  }
  const outline = { from, columns, rows, low, high, sole, top, middle, back, front, backs }
  return { ...outline, onto: ontoFoot(outline), rim: null }
}

/** The shoe's top edge (see Rim) from points sampled along it, each [along, out, up], on an outline's columns. */
function rimOf(
  samples: readonly (readonly [number, number, number])[],
  { from, columns }: Pick<Outline, 'from' | 'columns'>,
): Rim | null {
  if (samples.length === 0) return null
  const low = new Float32Array(columns).fill(Number.NaN)
  const high = new Float32Array(columns).fill(Number.NaN)
  const lowUp = new Float32Array(columns).fill(Number.NaN)
  const highUp = new Float32Array(columns).fill(Number.NaN)
  let [back, backUp, front] = [Number.POSITIVE_INFINITY, 0, Number.NEGATIVE_INFINITY]
  for (const [along, out, up] of samples) {
    const c = clamp(Math.floor((along - from) / CELL), 0, columns - 1)
    if (!(out >= low[c]!)) {
      low[c] = out
      lowUp[c] = up
    }
    if (!(out <= high[c]!)) {
      high[c] = out
      highUp[c] = up
    }
    if (along < back) [back, backUp] = [along, up]
    front = Math.max(front, along)
  }
  for (const values of [low, high, lowUp, highUp]) {
    fillAlong(values, columns)
    smoothGrid(values, columns, 1)
  }
  let widest = 0
  for (let c = 0; c < columns; c++) widest = Math.max(widest, high[c]! - low[c]!)
  return { low, high, lowUp, highUp, back, backUp, front, widest }
}

/** Fills a grid's empty cells from the nearest filled one up or down their column, or failing that, along. */
function fillColumns(low: Float32Array, high: Float32Array, columns: number, rows: number) {
  const filled = new Uint8Array(columns)
  for (let c = 0; c < columns; c++) {
    let nearest = -1
    for (let r = 0; r < rows; r++) if (Number.isFinite(low[c * rows + r]!)) nearest = r
    if (nearest < 0) continue
    filled[c] = 1
    for (let r = 0; r < rows; r++) {
      if (Number.isFinite(low[c * rows + r]!)) continue
      let found = -1
      for (let d = 1; d < rows && found < 0; d++) {
        if (r - d >= 0 && Number.isFinite(low[c * rows + r - d]!)) found = r - d
        else if (r + d < rows && Number.isFinite(low[c * rows + r + d]!)) found = r + d
      }
      low[c * rows + r] = low[c * rows + found]!
      high[c * rows + r] = high[c * rows + found]!
    }
  }
  for (let c = 0; c < columns; c++) {
    if (filled[c]) continue
    let found = -1
    for (let d = 1; d < columns && found < 0; d++) {
      if (c - d >= 0 && filled[c - d]) found = c - d
      else if (c + d < columns && filled[c + d]) found = c + d
    }
    if (found < 0) {
      low.fill(0)
      high.fill(0)
      return
    }
    low.copyWithin(c * rows, found * rows, found * rows + rows)
    high.copyWithin(c * rows, found * rows, found * rows + rows)
  }
}

/** Fills a row's empty values (NaN or `empty`) from the nearest filled one. */
function fillAlong(values: Float32Array, count: number, empty = Number.NaN) {
  const isEmpty = (value: number) => Number.isNaN(value) || value === empty
  for (let c = 0; c < count; c++) {
    if (!isEmpty(values[c]!)) continue
    for (let d = 1; d < count; d++) {
      if (c - d >= 0 && !isEmpty(values[c - d]!)) {
        values[c] = values[c - d]!
        break
      }
      if (c + d < count && !isEmpty(values[c + d]!)) {
        values[c] = values[c + d]!
        break
      }
    }
    if (isEmpty(values[c]!)) values[c] = 0
  }
}

/** Each cell of a grid (columns of `rows`) the most (by `pick`) of it and its eight neighbours. */
function spread(
  values: Float32Array,
  columns: number,
  rows: number,
  pick: (...values: number[]) => number,
) {
  const copy = values.slice()
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < rows; r++) {
      const around: number[] = []
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const [cc, rr] = [c + dc, r + dr]
          if (cc >= 0 && cc < columns && rr >= 0 && rr < rows) around.push(copy[cc * rows + rr]!)
        }
      }
      values[c * rows + r] = pick(...around)
    }
  }
}

/** Blurs a grid (columns of `rows`) by [1 2 1] each way, its edges held. */
function smoothGrid(values: Float32Array, columns: number, rows: number) {
  const copy = values.slice()
  const at = (c: number, r: number) =>
    copy[clamp(c, 0, columns - 1) * rows + clamp(r, 0, rows - 1)]!
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < rows; r++) {
      const along = at(c - 1, r) + 2 * at(c, r) + at(c + 1, r)
      values[c * rows + r] = rows > 1 ? (along + at(c, r - 1) + at(c, r + 1)) / 6 : along / 4
    }
  }
}

/** The uniform cubic B-spline's weights for a point `t` (0–1) past the second of four knots. */
function spline(t: number, out: number[]) {
  const t2 = t * t
  const t3 = t2 * t
  out[0] = (1 - t) ** 3 / 6
  out[1] = (3 * t3 - 6 * t2 + 4) / 6
  out[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6
  out[3] = t3 / 6
}

const alongWeights = [0, 0, 0, 0]
const upWeights = [0, 0, 0, 0]

/**
 * A grid's value at a point between its cells' centres, as a cubic B-spline
 * over them: smooth to its second derivative, so the surface it reshapes
 * turns without a crease where it passes from one cell to the next (the
 * reshaped normals follow its slope).
 */
function sampleGrid(
  values: Float32Array,
  outline: Outline,
  along: number,
  up: number,
  rows = outline.rows,
) {
  const x = (along - outline.from) / CELL - 0.5
  const y = up / CELL - 0.5
  const c0 = Math.floor(x)
  const r0 = Math.floor(y)
  spline(x - c0, alongWeights)
  spline(y - r0, upWeights)
  let sum = 0
  for (let i = 0; i < 4; i++) {
    const c = clamp(c0 - 1 + i, 0, outline.columns - 1)
    let column = 0
    for (let j = 0; j < 4; j++) {
      column += upWeights[j]! * values[c * rows + clamp(r0 - 1 + j, 0, rows - 1)]!
    }
    sum += alongWeights[i]! * column
  }
  return sum
}

const sampleColumn = (values: Float32Array, outline: Outline, along: number) =>
  sampleGrid(values, outline, along, 0, 1)

/** A value kept per row (height) of an outline, at a height between the rows' middles. */
function sampleRow(values: Float32Array, up: number) {
  const y = up / CELL - 0.5
  const r0 = Math.floor(y)
  spline(y - r0, upWeights)
  let sum = 0
  for (let j = 0; j < 4; j++)
    sum += upWeights[j]! * values[clamp(r0 - 1 + j, 0, values.length - 1)]!
  return sum
}

/**
 * Where a shoe's toe ends for the foot in it: where, forward of the ball,
 * it has narrowed to this share of its width there (a pointed toe's tip is
 * empty); that falls this far behind the foot's toes' tip, the rest of the
 * shoe pressed into the toes' front.
 */
const TOE_SHARE = 0.6
const TOE_SQUEEZE = 0.06

/** How far along a shoe it is as wide as a foot's toes can fill (see TOE_SHARE). */
function toeEnd(outline: Omit<Outline, 'onto' | 'rim'>) {
  const { from, columns, rows, low, high } = outline
  const widths = Array.from({ length: columns }, (_, c) => {
    let widest = 0
    for (let r = 0; r < rows; r++)
      widest = Math.max(widest, high[c * rows + r]! - low[c * rows + r]!)
    return widest
  })
  const alongOf = (c: number) => from + (c + 0.5) * CELL
  let ball = 0
  for (let c = 0; c < columns; c++) {
    if (alongOf(c) >= 0.6 && alongOf(c) <= 1.2) ball = Math.max(ball, widths[c]!)
  }
  for (let c = 1; c < columns; c++) {
    if (alongOf(c) > 0.9 && widths[c]! < ball * TOE_SHARE) {
      const [a, b] = [widths[c - 1]!, widths[c]!]
      const t = a > b ? (a - ball * TOE_SHARE) / (a - b) : 1
      return alongOf(c - 1) + clamp(t, 0, 1) * CELL
    }
  }
  return outline.front
}

/**
 * Where along the foot each point along its shoe goes: the shoe's length
 * onto the foot's (never longer), the ankle staying put and a pointed toe's
 * empty tip pressed into the toes' front, as a smooth curve (so the stretch
 * changes without a crease).
 */
function ontoFoot(outline: Omit<Outline, 'onto' | 'rim'>) {
  const back = Math.min(outline.back, -CELL)
  const front = Math.max(outline.front, CELL)
  const knots: [number, number][] = [
    [back, Math.max(HEEL_BACK, back)],
    [0, 0],
  ]
  const tip = Math.min(TOE_TIP, front)
  const end = toeEnd(outline)
  if (end > 0.5 && end < front - TOE_SQUEEZE && tip - TOE_SQUEEZE > 0.5) {
    knots.push([end, tip - TOE_SQUEEZE])
  }
  knots.push([front, tip])
  return curve(knots)
}

/**
 * How far either side of a shoe's middle a point passes from its inside's
 * outline onto the foot's to its outside's: gradually, so the foot's top
 * doesn't crease along its middle where the two differ.
 */
const SIDES_MEET = 0.08

/**
 * A height softly held under a cap: as it is well below, eased in towards
 * the cap and never over it (SOFT_CAP the width of the easing). Not a hard
 * cap: the reshaped normals follow the moves' slope (see avatar-shape.ts),
 * and a surface flattened outright would keep its old ones.
 */
const SOFT_CAP = 0.08
function softCap(height: number, cap: number) {
  const from = cap - SOFT_CAP
  return height <= from ? height : from + SOFT_CAP * (1 - Math.exp(-(height - from) / SOFT_CAP))
}

/**
 * Where a point of a foot's shoe goes on the foot (see bare-foot.ts), in the
 * foot's coordinates, written into `out` as [along, out, up]: lowered off
 * the shoe's sole (a heel's too) onto the ground, the forefoot's top down to
 * the foot's, along onto the foot's length (its heel rounded under and its
 * toes' fronts round), and across, each height's outline of the shoe onto
 * the foot's about its own middle. Nothing grows: where the shoe is already
 * slighter than a foot, it stays.
 */
function onFoot(
  shoe: Outline,
  along: number,
  across: number,
  up: number,
  fuller: number,
  out: number[],
) {
  const sole = sampleColumn(shoe.sole, shoe, along)
  const top = sampleColumn(shoe.top, shoe, along)
  const lifted = Math.max(0, up - sole)
  // Each height's rearmost point goes to the heel's back, so a sole's lip
  // sticking out behind the upper is taken in with it.
  const rear = Math.min(-CELL, sampleRow(shoe.backs, up))
  const onto = shoe.onto(along < 0 ? (along * shoe.back) / Math.min(rear, along) : along)
  const fore = smoothstep(INSTEP_FROM, INSTEP_TO, onto)
  const footsTop = footTop(onto) + fuller
  const lowered = Math.min(1, footsTop / Math.max(1e-3, top - sole))
  let height = lifted * (1 - fore + fore * lowered)
  // Whatever stands in front of the leg's own tube down from the shoe's top
  // edge (a tongue) settles onto the foot's top.
  const { rim } = shoe
  if (rim) {
    const inFront = smoothstep(rim.front - 0.02, rim.front + 0.06, along)
    height += (softCap(height, footsTop) - height) * inFront
  }
  // The heel rounds under and the Achilles tendon is further in (fading
  // out towards the ankle) — up by the shoe's top edge, as far in as the
  // leg's own back is; the toes' fronts round (fading out behind them).
  const toBack = rim ? smoothstep(rim.backUp - CONFORM, rim.backUp, up) : 0
  const back = heelBack(height) + ((rim?.back ?? 0) - heelBack(height)) * toBack
  const length =
    onto +
    (back - HEEL_BACK) * smoothstep(0, -HEEL_BACK, -onto) +
    (toeFront(height) - TOE_TIP) * smoothstep(0.5, TOE_TIP, onto)
  const low = sampleGrid(shoe.low, shoe, along, up)
  const high = sampleGrid(shoe.high, shoe, along, up)
  const centre = (low + high) / 2
  const toward = smoothstep(-SIDES_MEET, SIDES_MEET, across - centre)
  let inside = halfWidth(length, height, true) + fuller
  let outside = halfWidth(length, height, false) + fuller
  // Up by the shoe's top edge the foot takes the edge's outline, which the
  // leg (or the trouser leg) carries on from; nothing of it rises above the
  // edge (a collar's wings, a tongue, a pull tab settle onto it).
  if (rim) {
    const onRim = (values: Float32Array) => sampleColumn(values, shoe, along)
    // Only where the edge is wide: towards its front and back it narrows to
    // nothing, and a foot taking that in would be pinched there.
    const present = smoothstep(0.35, 0.7, (onRim(rim.high) - onRim(rim.low)) / rim.widest)
    const lowUp = onRim(rim.lowUp)
    const highUp = onRim(rim.highUp)
    const toInside = present * smoothstep(lowUp - CONFORM, lowUp, up)
    const toOutside = present * smoothstep(highUp - CONFORM, highUp, up)
    inside += (Math.max(LEAST_HALF, centre - onRim(rim.low)) - inside) * toInside
    outside += (Math.max(LEAST_HALF, onRim(rim.high) - centre) - outside) * toOutside
    // Only what stands outside the edge seen from above: inside it, a shoe
    // may carry on up under a trouser leg hanging over it.
    const beyond = Math.max(
      across - onRim(rim.high),
      onRim(rim.low) - across,
      along - rim.front,
      rim.back - along,
    )
    const edgeUp = lowUp + (highUp - lowUp) * toward
    height +=
      (softCap(height, edgeUp) - height) *
      smoothstep(edgeUp - CONFORM, edgeUp, up) *
      smoothstep(-OUTSIDE_EDGE, OUTSIDE_EDGE, beyond)
  }
  const share = (half: number, shoeHalf: number) => Math.min(1, half / Math.max(1e-3, shoeHalf))
  out[0] = length
  out[1] =
    centre +
    (across - centre) *
      (share(inside, centre - low) * (1 - toward) + share(outside, high - centre) * toward)
  out[2] = height
}

/** The foot's coordinates of a bind-pose point. */
function toFoot(foot: Foot, point: Vector3, out: number[]) {
  const x = point.x - foot.origin.x
  const y = point.y - foot.origin.y
  const z = point.z - foot.origin.z
  const { forward, outward, up, length } = foot
  out[0] = (x * forward.x + y * forward.y + z * forward.z) / length
  out[1] = (x * outward.x + y * outward.y + z * outward.z) / length
  out[2] = (x * up.x + y * up.y + z * up.z) / length
}

/** A bind-pose point from the foot's coordinates. */
function fromFoot(foot: Foot, coordinates: readonly number[], out: Vector3) {
  const [along, across, up] = coordinates as [number, number, number]
  out
    .copy(foot.origin)
    .addScaledVector(foot.forward, along * foot.length)
    .addScaledVector(foot.outward, across * foot.length)
    .addScaledVector(foot.up, up * foot.length)
}

const segment = new Vector3()
const offset = new Vector3()

/** How far (bind-pose units) a point is from the shoe's top edge; infinite when it has none. */
function fromEdge(edge: Float32Array, point: Vector3) {
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i < edge.length; i += 6) {
    segment.set(edge[i + 3]! - edge[i]!, edge[i + 4]! - edge[i + 1]!, edge[i + 5]! - edge[i + 2]!)
    offset.set(point.x - edge[i]!, point.y - edge[i + 1]!, point.z - edge[i + 2]!)
    const lengthSq = segment.lengthSq()
    const t = lengthSq > 0 ? clamp(offset.dot(segment) / lengthSq, 0, 1) : 0
    nearest = Math.min(nearest, offset.addScaledVector(segment, -t).lengthSq())
  }
  return Math.sqrt(nearest)
}

/**
 * How much of its move a point of a foot's shoe takes: none at the shoe's
 * top edge, all of it BLEND off (DRESSED_BLEND where the leg is dressed).
 */
const easing = (foot: Foot, point: Vector3) =>
  smoothstep(0, foot.shoe.rim ? BLEND : DRESSED_BLEND, fromEdge(foot.edge, point) / foot.length)

const coordinates = [0, 0, 0]
const moved = [0, 0, 0]
const target = new Vector3()

/** Where a point of a foot's shoe moves to (bind pose), eased off the shoe's top edge, into `out`. */
function reshapePoint(foot: Foot, point: Vector3, fuller: number, out: Vector3) {
  const ease = easing(foot, point)
  if (ease === 0) {
    out.copy(point)
    return
  }
  toFoot(foot, point, coordinates)
  onFoot(foot.shoe, coordinates[0]!, coordinates[1]!, coordinates[2]!, fuller, moved)
  fromFoot(foot, moved, target)
  out.copy(point).lerp(target, ease)
}

const feetCache = new WeakMap<BufferGeometry, Feet | null>()

/** A skinned body's feet (cached per geometry, which a body's clones share), or null when it has no shoes. */
function feetOf(mesh: SkinnedMesh): Feet | null {
  const geometry = originalGeometry(mesh)
  let found = feetCache.get(geometry)
  if (found === undefined) {
    found = findFeet(mesh, geometry)
    feetCache.set(geometry, found)
  }
  return found
}

function findFeet(mesh: SkinnedMesh, geometry: BufferGeometry): Feet | null {
  const position = geometry.getAttribute('position')
  const skinIndex = geometry.getAttribute('skinIndex')
  const skinWeight = geometry.getAttribute('skinWeight')
  if (!(position && skinIndex && skinWeight)) return null
  const bones = mesh.skeleton.bones
  const corners = cornersOf(geometry, position.count)
  const footOf = shoesOf(mesh, corners, skinIndex, skinWeight)
  if (!footOf.some((side) => side >= 0)) return null
  const points = Array.from({ length: position.count }, (_, index) =>
    new Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.bindMatrix),
  )
  // The shoe's top edge: its points at a spot another of the body's points
  // (the leg's, the trouser leg's) shares.
  const spots = new Map<string, number>()
  const keyOf = (point: Vector3) =>
    `${Math.round(point.x / WELD)},${Math.round(point.y / WELD)},${Math.round(point.z / WELD)}`
  points.forEach((point, index) => {
    const key = keyOf(point)
    const mask = footOf[index]! >= 0 ? 1 : 2
    spots.set(key, (spots.get(key) ?? 0) | mask)
  })
  const onEdge = points.map((point) => spots.get(keyOf(point)) === 3)

  const feet: Foot[] = []
  for (const side of [0, 1] as const) {
    const named = (part: RegExp) =>
      bones.findIndex((bone) => footBoneSide(bone.name) === side && part.test(bonePlain(bone.name)))
    const ankleBone = named(/foot$/)
    const toeBone = named(/toe0?$/)
    const kneeBone = bones.findIndex((bone) =>
      bonePlain(bone.name).endsWith(side === 0 ? 'lcalf' : 'rcalf'),
    )
    const indices: number[] = []
    footOf.forEach((each, index) => {
      if (each === side) indices.push(index)
    })
    if (ankleBone < 0 || toeBone < 0 || indices.length === 0) {
      footOf.forEach((each, index) => {
        if (each === side) footOf[index] = -1
      })
      continue
    }
    const ankle = bindPosition(mesh, ankleBone)
    const ball = bindPosition(mesh, toeBone)
    const up = new Vector3(0, 1, 0)
    const forward = ball.clone().sub(ankle).projectOnPlane(up)
    const length = forward.length()
    if (length < 1e-6) continue
    forward.divideScalar(length)
    const outward = new Vector3().crossVectors(forward, up)
    if (outward.x * ankle.x < 0) outward.negate()
    let ground = Number.POSITIVE_INFINITY
    for (const index of indices) ground = Math.min(ground, points[index]!.y)
    const origin = new Vector3(ankle.x, ground, ankle.z)
    const foot = { origin, forward, outward, up, length } as Foot

    const samples: [number, number, number][] = []
    const edge: number[] = []
    const local = [0, 0, 0]
    const sample = new Vector3()
    for (let i = 0; i < corners.length; i += 3) {
      const [a, b, c] = [corners[i]!, corners[i + 1]!, corners[i + 2]!]
      if (!(footOf[a] === side && footOf[b] === side && footOf[c] === side)) continue
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        if (onEdge[p] && onEdge[q]) edge.push(...points[p]!.toArray(), ...points[q]!.toArray())
      }
      for (let j = 0; j <= SAMPLE_STEPS; j++) {
        for (let k = 0; j + k <= SAMPLE_STEPS; k++) {
          sample
            .copy(points[a]!)
            .multiplyScalar((SAMPLE_STEPS - j - k) / SAMPLE_STEPS)
            .addScaledVector(points[b]!, j / SAMPLE_STEPS)
            .addScaledVector(points[c]!, k / SAMPLE_STEPS)
          toFoot(foot, sample, local)
          samples.push([local[0]!, local[1]!, local[2]!])
        }
      }
    }
    // An edge point no segment runs from (the leg joins the shoe at a lone point) still holds.
    for (const index of indices) {
      if (onEdge[index]) edge.push(...points[index]!.toArray(), ...points[index]!.toArray())
    }
    foot.edge = Float32Array.from(edge)
    const outline = outlineOf(samples)
    const rimSamples: [number, number, number][] = []
    for (let i = 0; i < edge.length; i += 6) {
      for (let step = 0; step <= SAMPLE_STEPS; step++) {
        const t = step / SAMPLE_STEPS
        sample.set(
          edge[i]! + (edge[i + 3]! - edge[i]!) * t,
          edge[i + 1]! + (edge[i + 4]! - edge[i + 1]!) * t,
          edge[i + 2]! + (edge[i + 5]! - edge[i + 2]!) * t,
        )
        toFoot(foot, sample, local)
        rimSamples.push([local[0]!, local[1]!, local[2]!])
      }
    }
    const rim = rimOf(rimSamples, outline)
    foot.shoe = { ...outline, rim: rim && rim.front - rim.back <= LEG_EDGE ? rim : null }
    const onGround = (along: number) => {
      const at = new Vector3()
      fromFoot(foot, [along, sampleColumn(foot.shoe.middle, foot.shoe, along), 0], at)
      return at
    }
    foot.frame = {
      side: side === 0 ? 'left' : 'right',
      ankle: ankle.toArray(),
      heel: onGround(Math.max(foot.shoe.back, HEEL_BACK)).toArray(),
      toe: onGround(Math.min(foot.shoe.front, TOE_TIP)).toArray(),
      forward: forward.toArray(),
      outward: outward.toArray(),
      up: up.toArray(),
      length,
      knee: kneeBone >= 0 ? (bindPosition(mesh, kneeBone).y - ground) / length : KNEE,
    }
    feet[side] = foot
  }
  return feet.some(Boolean) ? { feet, footOf } : null
}

/** Whether a mesh is the body's own, which has the shoes (see BODY_MESH). */
function isBody(mesh: Mesh): mesh is SkinnedMesh {
  const skinned = mesh as SkinnedMesh
  if (!skinned.isSkinnedMesh) return false
  const material = (mesh.userData.lookOriginal ?? mesh.material) as Material | Material[]
  return !Array.isArray(material) && BODY_MESH.test(material.name)
}

/**
 * Feet out of their shoes, as moves of the body mesh's bind-pose points:
 * each shoe taken in to a foot (see bare-foot.ts) — narrower and lower, its
 * heel down on the ground and rounded, its toes' box pulled in to a foot's
 * front — eased in from the shoe's top edge, where the leg or the trouser
 * leg carries on and nothing moves. Only the shoes' points move. Null for
 * shoes; a sock's foot is a little fuller than a bare one.
 */
export function feetShaper(feet: AvatarFeet): Shaper | null {
  if (feet.wear === 'shoes') return null
  const fuller = feet.wear === 'socks' ? SOCK : 0
  return (mesh): PointMove | null => {
    if (!isBody(mesh)) return null
    const found = feetOf(mesh)
    if (!found) return null
    const reshaped = new Vector3()
    return (point, index, move) => {
      const foot = found.feet[found.footOf[index]!]
      if (!foot) {
        move.set(0, 0, 0)
        return
      }
      reshapePoint(foot, point, fuller, reshaped)
      move.copy(reshaped).sub(point)
    }
  }
}

/**
 * How far out from the ankle (in the foot's lengths) a leg's triangles
 * count as the leg over the foot, up to its knee — which socks reach up
 * and a knee-high boot's shaft is painted on — or, below LEG_LOW, anywhere
 * over the foot (a pump's instep, down to the toes); and how high the knee
 * is taken to be where the skeleton has no calf bone to tell.
 */
const LEG_REACH = 0.9
const LEG_LOW = 1
const KNEE = 3.5

/**
 * A body's feet as their paint needs them (see feet-paint.ts): each shoe's
 * triangles, and the leg's just above it, with their texture coordinates
 * and where each corner ends up on the bare foot (the shoe taken in as
 * `feetShaper` takes it), in the foot's coordinates; and each foot's frame.
 * Empty for a body without shoes.
 */
export function footGeometry(bodyMesh: Mesh): FootGeometry {
  const found = isBody(bodyMesh) ? feetOf(bodyMesh) : null
  if (!found) return packFeet([], [])
  const geometry = originalGeometry(bodyMesh)
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  if (!uv) return packFeet([], [])
  const bind = (bodyMesh as SkinnedMesh).bindMatrix
  const corners = cornersOf(geometry, position.count)
  const point = new Vector3()
  const reshaped = new Vector3()
  const local = [0, 0, 0]
  const triangles: FootTriangle[] = []
  for (let i = 0; i < corners.length; i += 3) {
    const tri = [corners[i]!, corners[i + 1]!, corners[i + 2]!]
    const sides = tri.map((corner) => found.footOf[corner]!)
    const shoe = sides[0]! >= 0 && sides.every((side) => side === sides[0])
    let foot: Foot | undefined
    if (shoe) {
      foot = found.feet[sides[0]!]
    } else if (sides.every((side) => side < 0)) {
      // The leg over a foot: near its ankle, below its knee.
      const onLeg = (each: Foot | undefined) =>
        each !== undefined &&
        tri.every((corner) => {
          point.fromBufferAttribute(position, corner).applyMatrix4(bind)
          toFoot(each, point, local)
          const [along, across, up] = local as [number, number, number]
          const overFoot =
            up < LEG_LOW &&
            along > HEEL_BACK - LEG_REACH / 2 &&
            along < TOE_TIP + LEG_REACH / 2 &&
            Math.abs(across) < LEG_REACH
          return up < each.frame.knee && (overFoot || Math.hypot(along, across) < LEG_REACH)
        })
      foot = found.feet.find(onLeg)
    }
    if (!foot) continue
    const along: number[] = []
    const out: number[] = []
    const up: number[] = []
    for (const corner of tri) {
      point.fromBufferAttribute(position, corner).applyMatrix4(bind)
      toFoot(foot, point, local)
      const middle = sampleColumn(foot.shoe.middle, foot.shoe, local[0]!)
      if (shoe) reshapePoint(foot, point, 0, reshaped)
      else reshaped.copy(point)
      toFoot(foot, reshaped, local)
      along.push(local[0]!)
      out.push(local[1]! - middle)
      up.push(local[2]!)
    }
    triangles.push({
      side: foot.frame.side,
      part: shoe ? 'shoe' : 'leg',
      u: tri.map((corner) => uv.getX(corner)),
      v: tri.map((corner) => uv.getY(corner)),
      along,
      out,
      up,
    })
  }
  return packFeet(
    triangles,
    found.feet.filter(Boolean).map((foot) => foot.frame),
  )
}
