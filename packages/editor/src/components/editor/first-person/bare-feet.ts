/**
 * Bare feet for a Rocketbox character: a barefoot character's own modelled
 * feet (the donor's: Sports_Male_01's or Sports_Female_01's, the only two
 * with toes) put on in place of the wearer's shoes. A shoe is part of the
 * body mesh with no foot inside it, and no reshaping turns its low-poly box
 * into a believable foot; so the shoe's triangles are hidden instead, and
 * the donor's foot and lower leg are carried into the wearer's foot frame
 * (scaled by the foot's length, so a child's fits too), skinned to the
 * wearer's own leg bones by name, and joined to what is left of the leg:
 *
 * - welded where a bare leg (or a narrow hem) carries on from the shoe: the
 *   donor's leg is cut along that open edge (the ring) and its top snapped
 *   onto it, taking the ring's own skin weights and normals there, so the
 *   two never part in any pose;
 * - tucked where cloth carries on (a trouser leg, a skirt's lining): the
 *   donor's leg is cut off flat well inside it.
 *
 * Everything here works on plain arrays in the bind pose (no three.js), so
 * it runs in the look worker and in tests. Lengths in a foot's frame are in
 * that foot's lengths (its ankle to its ball along the ground); see
 * FootFrame.
 */

import { colorDistance, luminance, type Pixels, type Rgb } from './look-pixels'

export type Vec3 = [number, number, number]

/**
 * A skinned body mesh in its bind pose, as flat arrays (so it crosses to
 * the look worker): per point its place, normal, texture coordinates and
 * four bones and weights; its triangles' corners; its skeleton's bone
 * names and each bone's place.
 */
export type BodyBind = {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  joints: Uint16Array
  weights: Float32Array
  index: Uint32Array
  bones: string[]
  bonePlaces: Float32Array
}

/** A bone's name plain: lower case, letters and digits only ("Bip01 L Foot" and "Bip01_L_Foot" alike). */
const plain = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** A foot's bones by the end of their plain names: which side, and whether a toe's. */
const FOOT_BONE = /([lr])(foot|toe\d*)$/

/** Which foot (0 left, 1 right) a bone is, or null. */
export function footSide(name: string): 0 | 1 | null {
  const match = FOOT_BONE.exec(plain(name))
  if (!match) return null
  return match[1] === 'l' ? 0 : 1
}

/** The bone of a side whose plain name ends `part` (e.g. "foot", "toe0", "calf"), or −1. */
function boneOf(bones: readonly string[], side: 0 | 1, part: string) {
  const end = `${side === 0 ? 'l' : 'r'}${part}`
  return bones.findIndex((name) => plain(name).endsWith(end))
}

/** Points closer than this (bind-pose units) are one: a texture seam splits a point into copies. */
const WELD = 1e-5

/** The spot each point is at, named by the first point there. */
export function spotsOf(positions: ArrayLike<number>): Int32Array {
  const count = positions.length / 3
  const first = new Map<string, number>()
  const spots = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(positions[i * 3]! / WELD)},${Math.round(positions[i * 3 + 1]! / WELD)},${Math.round(positions[i * 3 + 2]! / WELD)}`
    const found = first.get(key)
    if (found === undefined) first.set(key, i)
    spots[i] = found ?? i
  }
  return spots
}

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

/** Each point's texture island (its triangles joined by their corners, so a texture seam parts them). */
function islandsOf(bind: BodyBind): Int32Array {
  const { find, join } = unions(bind.positions.length / 3)
  const { index } = bind
  for (let t = 0; t < index.length; t += 3) {
    join(index[t]!, index[t + 1]!)
    join(index[t]!, index[t + 2]!)
  }
  return Int32Array.from({ length: bind.positions.length / 3 }, (_, i) => find(i))
}

/**
 * A texture island is a shoe's (a foot's, on a barefoot body) when at least
 * this share of its points are skinned to one foot's bones at all: the
 * trouser leg's island, whose hem the foot carries too, is mostly the
 * calf's and the thigh's.
 */
const SHOE_ISLAND = 0.9

/** Which foot each point's shoe is (−1 for none): the islands nearly all skinned to one foot's bones. */
export function shoesOf(bind: BodyBind, islands = islandsOf(bind)): Int8Array {
  const sides = bind.bones.map(footSide)
  const count = bind.positions.length / 3
  const tally = new Map<number, [number, number, number]>()
  for (let i = 0; i < count; i++) {
    const entry = tally.get(islands[i]!) ?? [0, 0, 0]
    entry[0]++
    const on = [false, false]
    for (let k = 0; k < 4; k++) {
      const side = sides[bind.joints[i * 4 + k]!]
      if (side !== null && side !== undefined && bind.weights[i * 4 + k]! > 0) on[side] = true
    }
    if (on[0]) entry[1]++
    if (on[1]) entry[2]++
    tally.set(islands[i]!, entry)
  }
  const footOf = new Int8Array(count).fill(-1)
  for (let i = 0; i < count; i++) {
    const [all, left, right] = tally.get(islands[i]!)!
    if (left >= all * SHOE_ISLAND) footOf[i] = 0
    else if (right >= all * SHOE_ISLAND) footOf[i] = 1
  }
  return footOf
}

/**
 * Where a foot stands in the bind pose: `origin` on the ground straight
 * under its ankle (the foot bone), `forward` along the ground towards its
 * ball (the toe bone), `outward` across it away from the other foot, `up`;
 * and `length`, the ankle's distance to the ball along the ground. A point
 * in the foot's coordinates is [along, out, up] in those lengths — the same
 * on a child's foot as on a man's. `foot`, `toe` and `calf` are its bones
 * (`calf` −1 when the skeleton has none).
 */
export type FootFrame = {
  side: 0 | 1
  origin: Vec3
  forward: Vec3
  outward: Vec3
  up: Vec3
  length: number
  ankle: Vec3
  ball: Vec3
  foot: number
  toe: number
  calf: number
}

const bonePlace = (bind: BodyBind, bone: number): Vec3 => [
  bind.bonePlaces[bone * 3]!,
  bind.bonePlaces[bone * 3 + 1]!,
  bind.bonePlaces[bone * 3 + 2]!,
]

/** A foot's frame (see FootFrame), its ground the lowest of its shoe's points; null without its bones or a shoe. */
export function footFrame(bind: BodyBind, side: 0 | 1, footOf: Int8Array): FootFrame | null {
  const foot = boneOf(bind.bones, side, 'foot')
  let toe = boneOf(bind.bones, side, 'toe0')
  if (toe < 0) toe = boneOf(bind.bones, side, 'toe')
  if (foot < 0 || toe < 0) return null
  let ground = Number.POSITIVE_INFINITY
  for (let i = 0; i < footOf.length; i++) {
    if (footOf[i] === side) ground = Math.min(ground, bind.positions[i * 3 + 1]!)
  }
  if (!Number.isFinite(ground)) return null
  const ankle = bonePlace(bind, foot)
  const ball = bonePlace(bind, toe)
  const forward: Vec3 = [ball[0] - ankle[0], 0, ball[2] - ankle[2]]
  const length = Math.hypot(forward[0], forward[2])
  if (length < 1e-6) return null
  forward[0] /= length
  forward[2] /= length
  // forward × up, turned away from the body's middle.
  const outward: Vec3 = [-forward[2], 0, forward[0]]
  if (outward[0] * ankle[0] < 0) {
    outward[0] = -outward[0]
    outward[2] = -outward[2]
  }
  return {
    side,
    origin: [ankle[0], ground, ankle[2]],
    forward,
    outward,
    up: [0, 1, 0],
    length,
    ankle,
    ball,
    foot,
    toe,
    calf: boneOf(bind.bones, side, 'calf'),
  }
}

/** A bind-pose point's foot coordinates [along, out, up] (see FootFrame). */
export function toFoot(f: FootFrame, x: number, y: number, z: number, out: number[] = [0, 0, 0]) {
  const dx = x - f.origin[0]
  const dy = y - f.origin[1]
  const dz = z - f.origin[2]
  out[0] = (dx * f.forward[0] + dy * f.forward[1] + dz * f.forward[2]) / f.length
  out[1] = (dx * f.outward[0] + dy * f.outward[1] + dz * f.outward[2]) / f.length
  out[2] = (dx * f.up[0] + dy * f.up[1] + dz * f.up[2]) / f.length
  return out
}

/** The bind-pose point at some foot coordinates. */
export function fromFoot(f: FootFrame, a: number, o: number, u: number, out: number[] = [0, 0, 0]) {
  for (let k = 0; k < 3; k++) {
    out[k] = f.origin[k]! + (f.forward[k]! * a + f.outward[k]! * o + f.up[k]! * u) * f.length
  }
  return out
}

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

const lerp = (from: readonly number[], to: readonly number[], t: number) =>
  from.map((value, k) => value + (to[k]! - value) * t)

/**
 * Whether a colour has a skin's hue: warm (red over green over blue), not
 * near black, and its blue well under its red (tan leather and khaki are
 * warm, but greyer).
 */
export function skinHued([r, g, b]: Rgb) {
  return r >= g && g >= b && r > b && luminance(r, g, b) > 30 && r - b > r * 0.2
}

/** How unlike the character's own skin (see colorDistance) a colour may be and still be its skin. */
export const SKIN_NEAR = 0.2

/** How far a colour is from a reference (see colorDistance). */
export const colourDistance = (colour: Rgb, ref: Rgb) =>
  colorDistance(colour[0], colour[1], colour[2], ref, luminance(...ref))

/**
 * Whether a colour is the character's skin: a skin's hue, and near its own
 * skin somewhere (its hands', its face's) when it shows any — a tan boot's
 * canvas has the hue but not the colour.
 */
export function isSkin(colour: Rgb, skins: readonly Rgb[]) {
  return (
    skinHued(colour) &&
    (skins.length === 0 || skins.some((ref) => colourDistance(colour, ref) < SKIN_NEAR))
  )
}

/** A texture's colour at some texture coordinates (nearest texel). */
export function colourAt(texture: Pixels, u: number, v: number): Rgb {
  const x = Math.min(texture.width - 1, Math.max(0, Math.floor(u * texture.width)))
  const y = Math.min(texture.height - 1, Math.max(0, Math.floor(v * texture.height)))
  const p = (y * texture.width + x) * 4
  return [texture.data[p]!, texture.data[p + 1]!, texture.data[p + 2]!]
}

/** The middle colour of some, by lightness; null for none. */
export function middleColour(colours: Rgb[]): Rgb | null {
  if (colours.length === 0) return null
  colours.sort((a, b) => luminance(...a) - luminance(...b))
  return colours[Math.floor(colours.length / 2)]!
}

/**
 * The open edge where a side's hidden triangles meet the body's shown ones
 * — a shoe's seam with the leg, or the cut through a leg's own island —
 * as a loop round the leg, sorted by angle about its middle: each corner's
 * foot coordinates, its bind-pose place, and a shown point there (−1 for
 * none), whose skin and normal the weld takes; its middle (seen from
 * above), mean radius, and lowest and highest.
 */
export type Ring = {
  points: number[][]
  places: number[][]
  legPoint: number[]
  theta: number[]
  centre: [number, number]
  radius: number
  low: number
  high: number
}

/** A body's points' spots and islands, worked out once for a plan. */
type Layout = { spots: Int32Array; islands: Int32Array }

export function ringOf(
  bind: BodyBind,
  layout: Layout,
  hidden: Int8Array,
  side: 0 | 1,
  frame: FootFrame,
): Ring | null {
  const { spots } = layout
  const { index } = bind
  const count = bind.positions.length / 3
  const edgeKey = (a: number, b: number) => {
    const sa = spots[a]!
    const sb = spots[b]!
    return sa < sb ? sa * count + sb : sb * count + sa
  }
  const shownEdges = new Set<number>()
  const shownAt = new Map<number, number>()
  for (let t = 0; t < index.length / 3; t++) {
    if (hidden[t]! >= 0) continue
    for (let e = 0; e < 3; e++) {
      const a = index[t * 3 + e]!
      shownEdges.add(edgeKey(a, index[t * 3 + ((e + 1) % 3)]!))
      if (!shownAt.has(spots[a]!)) shownAt.set(spots[a]!, a)
    }
  }
  const ends = new Map<number, number>()
  for (let t = 0; t < index.length / 3; t++) {
    if (hidden[t] !== side) continue
    for (let e = 0; e < 3; e++) {
      const a = index[t * 3 + e]!
      const b = index[t * 3 + ((e + 1) % 3)]!
      if (!shownEdges.has(edgeKey(a, b))) continue
      for (const point of [a, b]) if (!ends.has(spots[point]!)) ends.set(spots[point]!, point)
    }
  }
  if (ends.size < 3) return null
  const list = [...ends].map(([spot, i]) => {
    const place = [bind.positions[i * 3]!, bind.positions[i * 3 + 1]!, bind.positions[i * 3 + 2]!]
    return {
      point: toFoot(frame, place[0]!, place[1]!, place[2]!),
      place,
      leg: shownAt.get(spot) ?? -1,
    }
  })
  const ca = list.reduce((sum, each) => sum + each.point[0]!, 0) / list.length
  const co = list.reduce((sum, each) => sum + each.point[1]!, 0) / list.length
  const angle = (each: { point: number[] }) => Math.atan2(each.point[1]! - co, each.point[0]! - ca)
  list.sort((x, y) => angle(x) - angle(y))
  return {
    points: list.map((each) => each.point),
    places: list.map((each) => each.place),
    legPoint: list.map((each) => each.leg),
    theta: list.map(angle),
    centre: [ca, co],
    radius:
      list.reduce((sum, each) => sum + Math.hypot(each.point[0]! - ca, each.point[1]! - co), 0) /
      list.length,
    low: Math.min(...list.map((each) => each.point[2]!)),
    high: Math.max(...list.map((each) => each.point[2]!)),
  }
}

/** Where `theta` falls among sorted angles round a loop: the two either side, and how far between. */
export function between(thetas: readonly number[], theta: number): [number, number, number] {
  const n = thetas.length
  for (let k = 0; k < n; k++) {
    const from = thetas[k]!
    const to = k === n - 1 ? thetas[0]! + 2 * Math.PI : thetas[k + 1]!
    const at = k === n - 1 && theta < from ? theta + 2 * Math.PI : theta
    if (at >= from && at <= to) return [k, (k + 1) % n, to > from ? (at - from) / (to - from) : 0]
  }
  // Before the first: between the last and the first.
  const from = thetas[n - 1]! - 2 * Math.PI
  const to = thetas[0]!
  return [n - 1, 0, to > from ? (theta - from) / (to - from) : 0]
}

/** A ring's height at an angle round its middle. */
export function ringHeight(ring: Ring, theta: number) {
  const [i, j, t] = between(ring.theta, theta)
  return ring.points[i]![2]! + (ring.points[j]![2]! - ring.points[i]![2]!) * t
}

/** A point's angle round a ring's middle, from its foot coordinates. */
export const ringAngle = (ring: Ring, point: readonly number[]) =>
  Math.atan2(point[1]! - ring.centre[1], point[0]! - ring.centre[0])

/**
 * A leg's island reaching on over the instep below this (in the foot's
 * lengths) is the foot's own skin (a pump's or a flat's open instep, a
 * sandal's foot under its straps), hidden with the shoe.
 */
const FOOT_CUT = 0.85

/** The sample a texture island's colour is taken from: its triangles' first corners. */
const islandColour = (bind: BodyBind, texture: Pixels, triangles: readonly number[]) =>
  middleColour(
    triangles.map((t) => {
      const i = bind.index[t * 3]!
      return colourAt(texture, bind.uvs[i * 2]!, bind.uvs[i * 2 + 1]!)
    }),
  )

/**
 * Hides the foot's own skin a leg's island carries (see FOOT_CUT): a bare
 * leg's island next to the shoe that reaches on over the instep is cut off
 * at the ankle. A trouser leg reaching down over a shoe is cloth, and stays.
 * Returns how many triangles it hid.
 */
function hideFootSkin(
  bind: BodyBind,
  layout: Layout,
  hidden: Int8Array,
  side: 0 | 1,
  frame: FootFrame,
  texture: Pixels,
) {
  const ring = ringOf(bind, layout, hidden, side, frame)
  if (!ring) return 0
  const { index } = bind
  const { spots, islands } = layout
  const ringSpots = new Set(
    ring.legPoint.filter((point) => point >= 0).map((point) => spots[point]),
  )
  const adjoining = new Set<number>()
  for (let t = 0; t < index.length / 3; t++) {
    if (hidden[t]! >= 0) continue
    for (let k = 0; k < 3; k++) {
      if (ringSpots.has(spots[index[t * 3 + k]!]!)) adjoining.add(islands[index[t * 3]!]!)
    }
  }
  let count = 0
  const local = [0, 0, 0]
  for (const island of adjoining) {
    let overInstep = false
    const low: number[] = []
    for (let t = 0; t < index.length / 3; t++) {
      if (hidden[t]! >= 0 || islands[index[t * 3]!] !== island) continue
      let below = true
      for (let k = 0; k < 3; k++) {
        const i = index[t * 3 + k]!
        toFoot(
          frame,
          bind.positions[i * 3]!,
          bind.positions[i * 3 + 1]!,
          bind.positions[i * 3 + 2]!,
          local,
        )
        if (local[0]! > 0.35 && local[2]! < 0.6 && Math.abs(local[1]!) < 0.5) overInstep = true
        if (local[2]! >= FOOT_CUT) below = false
      }
      if (below) low.push(t)
    }
    const colour = islandColour(bind, texture, low)
    if (!overInstep || !colour || !skinHued(colour)) continue
    for (const t of low) hidden[t] = side
    count += low.length
  }
  return count
}

/**
 * How a foot goes on: welded to its ring, or tucked into what carries on
 * from it (see the file's comment); `shaft` when a boot's shaft was hidden
 * with the shoe (the ring is then its top); `skin` when the leg at the ring
 * is the character's skin, whose colour (`colour`, its middle) the foot
 * takes; and the leg's points just above the ring (`adjoining`, the
 * islands carrying on from it).
 */
export type FootPlan = {
  side: 0 | 1
  ring: Ring
  mode: 'weld' | 'tuck'
  shaft: boolean
  skin: boolean
  colour: Rgb | null
  adjoining: number[]
}

/** A body's feet planned: each point's shoe (−1 none), each foot's frame, the triangles hidden (by side, −1 shown). */
export type FeetPlan = {
  footOf: Int8Array
  frames: (FootFrame | null)[]
  hidden: Int8Array
  feet: FootPlan[]
}

/**
 * A ring longer than this along the foot (in its lengths) is round more
 * than one leg, or a skirt's or robe's lining: tucked into.
 */
const AROUND_LEG = 0.9
/** A boot's shaft ends below this (in the foot's lengths): a trouser leg reaches far higher. */
const SHAFT_TOP = 4.2
/**
 * A boot's shaft is the colour of the boot below it (see colorDistance):
 * a trouser's hem piece over a shoe (a firefighter's banded cuff) is not,
 * and stays.
 */
const SHAFT_LIKE = 0.25
/** A boot's shaft flares wider at the ankle than a leg's ring (see AROUND_LEG), up to this. */
const AROUND_SHAFT = 1.1

/**
 * Hides what a boot's shaft hid (up to `top`, round the leg at `ring`): its
 * straps and buckles, and the ragged end of a trouser leg tucked into it,
 * any island of the side's leg that lies wholly inside it.
 */
function hideInShaft(
  bind: BodyBind,
  layout: Layout,
  members: ReadonlyMap<number, number[]>,
  hidden: Int8Array,
  side: 0 | 1,
  frame: FootFrame,
  ring: Ring,
  top: number,
) {
  const { index } = bind
  const local = [0, 0, 0]
  const inside = new Set<number>()
  for (const [island, points] of members) {
    let ours = 0
    let total = 0
    let within = true
    for (const i of points) {
      toFoot(
        frame,
        bind.positions[i * 3]!,
        bind.positions[i * 3 + 1]!,
        bind.positions[i * 3 + 2]!,
        local,
      )
      const off = Math.hypot(local[0]! - ring.centre[0], local[1]! - ring.centre[1])
      if (local[2]! < ring.low - 0.1 || local[2]! > top + 0.25 || off > ring.radius + 0.6) {
        within = false
        break
      }
      for (let k = 0; k < 4; k++) {
        const weight = bind.weights[i * 4 + k]!
        total += weight
        if (legSide(bind.bones[bind.joints[i * 4 + k]!]!) === side) ours += weight
      }
    }
    if (within && ours > total * 0.5) inside.add(island)
  }
  for (let t = 0; t < index.length / 3; t++) {
    if (hidden[t]! < 0 && inside.has(layout.islands[index[t * 3]!]!)) hidden[t] = side
  }
}

/**
 * What to hide on each side and how each foot goes on: the shoe always, and
 * the foot's own skin a leg's island carries (see hideFootSkin); a ring
 * round a single leg is welded to, unless what carries on above it is a
 * boot's shaft (not skin, the boot's colour, ending below the knee), hidden too and welded
 * above; anything else (a trouser leg, a skirt's or robe's lining) is
 * tucked into. `skins` are the character's own skin's colours (its
 * hands', its face's), which a leg's skin is told by. Null for a body
 * without shoes (or feet bones).
 */
export function planFeet(bind: BodyBind, texture: Pixels, skins: readonly Rgb[]): FeetPlan | null {
  const islands = islandsOf(bind)
  const footOf = shoesOf(bind, islands)
  const layout: Layout = { spots: spotsOf(bind.positions), islands }
  const frames = ([0, 1] as const).map((side) => footFrame(bind, side, footOf))
  const { index } = bind
  const triangles = index.length / 3
  const hidden = new Int8Array(triangles).fill(-1)
  for (let t = 0; t < triangles; t++) {
    const side = footOf[index[t * 3]!]!
    if (side < 0 || !frames[side]) continue
    if (footOf[index[t * 3 + 1]!] === side && footOf[index[t * 3 + 2]!] === side) hidden[t] = side
  }
  const members = new Map<number, number[]>()
  islands.forEach((island, i) => {
    const list = members.get(island)
    if (list) list.push(i)
    else members.set(island, [i])
  })
  const feet: FootPlan[] = []
  const local = [0, 0, 0]
  for (const side of [0, 1] as const) {
    const frame = frames[side]
    if (!frame || !hidden.includes(side)) continue
    hideFootSkin(bind, layout, hidden, side, frame, texture)
    const otherSide = side === 0 ? 1 : 0
    let shaft = false
    for (let round = 0; round < 3; round++) {
      const ring = ringOf(bind, layout, hidden, side, frame)
      if (!ring) break
      const ringSpots = new Set(ring.legPoint.filter((p) => p >= 0).map((p) => layout.spots[p]))
      const adjoining = new Set<number>()
      for (let t = 0; t < triangles; t++) {
        if (hidden[t]! >= 0) continue
        for (let k = 0; k < 3; k++) {
          if (ringSpots.has(layout.spots[index[t * 3 + k]!]!))
            adjoining.add(islands[index[t * 3]!]!)
        }
      }
      const alongs = ring.points.map((point) => point[0]!)
      const extent = Math.max(...alongs) - Math.min(...alongs)
      // A leg's island the other leg carries much of is a skirt's.
      let otherShare = 0
      let top = Number.NEGATIVE_INFINITY
      const near: Rgb[] = []
      for (const island of adjoining) {
        let total = 0
        let other = 0
        for (const i of members.get(island)!) {
          for (let k = 0; k < 4; k++) {
            const weight = bind.weights[i * 4 + k]!
            total += weight
            if (legSide(bind.bones[bind.joints[i * 4 + k]!]!) === otherSide) other += weight
          }
          toFoot(
            frame,
            bind.positions[i * 3]!,
            bind.positions[i * 3 + 1]!,
            bind.positions[i * 3 + 2]!,
            local,
          )
          if (Math.hypot(local[0]!, local[1]!) < 1.5) top = Math.max(top, local[2]!)
          if (
            local[2]! > ring.low - 0.02 &&
            local[2]! < ring.high + 0.5 &&
            Math.hypot(local[0]! - ring.centre[0], local[1]! - ring.centre[1]) < 1.2
          ) {
            near.push(colourAt(texture, bind.uvs[i * 2]!, bind.uvs[i * 2 + 1]!))
          }
        }
        otherShare = Math.max(otherShare, other / Math.max(total, 1e-6))
      }
      const colour = middleColour(near)
      const skin = colour !== null && isSkin(colour, skins)
      // What is hidden just below the ring (the shoe's top, or a shaft's
      // lower part), which a boot's shaft above it is the colour of.
      const belowRing: Rgb[] = []
      for (let t = 0; t < triangles; t++) {
        if (hidden[t] !== side) continue
        for (let k = 0; k < 3; k++) {
          const i = index[t * 3 + k]!
          toFoot(
            frame,
            bind.positions[i * 3]!,
            bind.positions[i * 3 + 1]!,
            bind.positions[i * 3 + 2]!,
            local,
          )
          if (local[2]! > ring.low - 0.3 && local[2]! < ring.high + 0.05) {
            belowRing.push(colourAt(texture, bind.uvs[i * 2]!, bind.uvs[i * 2 + 1]!))
            break
          }
        }
      }
      const below = middleColour(belowRing)
      const plan = (mode: FootPlan['mode']): FootPlan => ({
        side,
        ring,
        mode,
        shaft,
        skin,
        colour,
        adjoining: [...adjoining].flatMap((island) => members.get(island)!),
      })
      const shaftLike =
        adjoining.size === 1 &&
        colour !== null &&
        !skin &&
        top < SHAFT_TOP &&
        below !== null &&
        colourDistance(colour, below) < SHAFT_LIKE &&
        extent <= AROUND_SHAFT &&
        otherShare < 0.05
      if (shaftLike && round < 2) {
        const island = [...adjoining][0]!
        for (let t = 0; t < triangles; t++) if (islands[index[t * 3]!] === island) hidden[t] = side
        hideInShaft(bind, layout, members, hidden, side, frame, ring, top)
        shaft = true
        continue
      }
      if (!(extent <= AROUND_LEG && otherShare < 0.05)) {
        feet.push(plan('tuck'))
        break
      }
      feet.push(plan('weld'))
      break
    }
  }
  return { footOf, frames, hidden, feet }
}

/** Which side (0 left, 1 right) a bone is, by the letter standing alone in its name (Rocketbox's "Bip01 R Calf"), or null. */
function legSide(name: string): 0 | 1 | null {
  const match = /(?:^|[\s_])([LR])(?=[\s_]|$)/.exec(name)
  if (!match) return null
  return match[1] === 'L' ? 0 : 1
}

/**
 * A donor's foot and lower leg, as carried: per point its foot coordinates
 * and its normal in the foot's frame [along, out, up], its texture
 * coordinates, four bones (in the donor's skeleton) and weights; its
 * triangles. Frame-free, so it fits any wearer's foot frame.
 */
export type DonorFoot = {
  local: Float32Array
  normals: Float32Array
  uvs: Float32Array
  joints: Uint16Array
  weights: Float32Array
  index: Uint32Array
}

/** How far up the donor's leg (in its foot's lengths) is kept: past any boot's shaft (see SHAFT_TOP). */
const DONOR_UP = 6
/** How far out from the foot's middle line, and back and forward, the donor's foot and leg are kept. */
const DONOR_OUT = 0.9
const DONOR_BACK = -0.9
const DONOR_FRONT = 1.9

/** A barefoot body's foot and lower leg on one side, in its foot's coordinates (see DonorFoot). */
export function donorFootOf(bind: BodyBind, frame: FootFrame): DonorFoot {
  const count = bind.positions.length / 3
  const local = new Float32Array(count * 3)
  const at = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    toFoot(
      frame,
      bind.positions[i * 3]!,
      bind.positions[i * 3 + 1]!,
      bind.positions[i * 3 + 2]!,
      at,
    )
    local.set(at, i * 3)
  }
  const kept = (i: number) =>
    local[i * 3 + 2]! < DONOR_UP &&
    Math.abs(local[i * 3 + 1]!) < DONOR_OUT &&
    local[i * 3]! > DONOR_BACK &&
    local[i * 3]! < DONOR_FRONT
  const remap = new Map<number, number>()
  const index: number[] = []
  for (let t = 0; t < bind.index.length; t += 3) {
    const tri = [bind.index[t]!, bind.index[t + 1]!, bind.index[t + 2]!]
    if (!tri.every(kept)) continue
    for (const i of tri) {
      if (!remap.has(i)) remap.set(i, remap.size)
      index.push(remap.get(i)!)
    }
  }
  const foot: DonorFoot = {
    local: new Float32Array(remap.size * 3),
    normals: new Float32Array(remap.size * 3),
    uvs: new Float32Array(remap.size * 2),
    joints: new Uint16Array(remap.size * 4),
    weights: new Float32Array(remap.size * 4),
    index: Uint32Array.from(index),
  }
  for (const [i, j] of remap) {
    foot.local.set(local.subarray(i * 3, i * 3 + 3), j * 3)
    const n = bind.normals.subarray(i * 3, i * 3 + 3)
    const axes = [frame.forward, frame.outward, frame.up]
    for (let k = 0; k < 3; k++) {
      foot.normals[j * 3 + k] = n[0]! * axes[k]![0] + n[1]! * axes[k]![1] + n[2]! * axes[k]![2]
    }
    foot.uvs.set(bind.uvs.subarray(i * 2, i * 2 + 2), j * 2)
    foot.joints.set(bind.joints.subarray(i * 4, i * 4 + 4), j * 4)
    foot.weights.set(bind.weights.subarray(i * 4, i * 4 + 4), j * 4)
  }
  return foot
}

/** How many texels past the feet's texture coordinates their part of the donor's texture reaches. */
const ATLAS_PAD = 8

/** A part of a texture (texels) and where it goes along the atlas it is cut out to. */
export type AtlasRect = { x: number; y: number; width: number; height: number; at: number }

/** The part of a texture (in texels, ATLAS_PAD past them) some texture coordinates cover. */
function rectOf(uvs: Float32Array, width: number, height: number): Omit<AtlasRect, 'at'> {
  let [u0, v0, u1, v1] = [1, 1, 0, 0]
  for (let i = 0; i < uvs.length; i += 2) {
    u0 = Math.min(u0, uvs[i]!)
    u1 = Math.max(u1, uvs[i]!)
    v0 = Math.min(v0, uvs[i + 1]!)
    v1 = Math.max(v1, uvs[i + 1]!)
  }
  const x = Math.max(0, Math.floor(u0 * width) - ATLAS_PAD)
  const y = Math.max(0, Math.floor(v0 * height) - ATLAS_PAD)
  return {
    x,
    y,
    width: Math.min(width, Math.ceil(u1 * width) + ATLAS_PAD) - x,
    height: Math.min(height, Math.ceil(v1 * height) + ATLAS_PAD) - y,
  }
}

/**
 * A barefoot body's feet (left, right; see DonorFoot) on a `width` ×
 * `height` texture, their texture coordinates moved onto an atlas of just
 * their parts of it, side by side (`rects`, which the texture is cut out by;
 * the atlas `width` × `height` returned): the donor's whole texture needn't
 * be kept, or crossed to the look worker.
 */
export function donorFeet(bind: BodyBind, width: number, height: number) {
  const footOf = shoesOf(bind)
  const feet = ([0, 1] as const).map((side) => {
    const frame = footFrame(bind, side, footOf)
    return frame ? donorFootOf(bind, frame) : null
  })
  const rects: AtlasRect[] = []
  let atlasWidth = 0
  let atlasHeight = 0
  for (const foot of feet) {
    if (!foot) continue
    const rect = { ...rectOf(foot.uvs, width, height), at: atlasWidth }
    for (let i = 0; i < foot.uvs.length; i += 2) {
      foot.uvs[i] = foot.uvs[i]! * width - rect.x + rect.at
      foot.uvs[i + 1] = foot.uvs[i + 1]! * height - rect.y
    }
    rects.push(rect)
    atlasWidth += rect.width
    atlasHeight = Math.max(atlasHeight, rect.height)
  }
  for (const foot of feet) {
    if (!foot) continue
    for (let i = 0; i < foot.uvs.length; i += 2) {
      foot.uvs[i]! /= atlasWidth
      foot.uvs[i + 1]! /= atlasHeight
    }
  }
  return { feet, rects, width: atlasWidth, height: atlasHeight }
}

/**
 * A mesh being made of a carried foot, in the wearer's bind pose: per point
 * its place, normal, texture coordinates, four bones (the wearer's) and
 * weights, and whether it was made by a cut (the open top a weld snaps);
 * its triangles.
 */
export type Piece = {
  positions: number[]
  normals: number[]
  uvs: number[]
  joints: number[]
  weights: number[]
  index: number[]
  open: boolean[]
}

const emptyPiece = (): Piece => ({
  positions: [],
  normals: [],
  uvs: [],
  joints: [],
  weights: [],
  index: [],
  open: [],
})

/**
 * Bone indices from one skeleton's names into another's; −1 where the
 * other has no bone of that name (its weight is shared out among the
 * point's other bones).
 */
export function remapBones(from: readonly string[], to: readonly string[]) {
  const at = new Map(to.map((name, index) => [name, index]))
  return from.map((name) => at.get(name) ?? -1)
}

/**
 * A donor's foot (see DonorFoot) carried into a wearer's foot frame: below
 * `maxUp` (in the foot's lengths), its points and normals placed by the
 * wearer's frame and its skin moved onto the wearer's bones of the same
 * names. A point whose bones the wearer has none of goes on its foot bone.
 */
export function carryFoot(
  donor: DonorFoot,
  bones: readonly number[],
  frame: FootFrame,
  maxUp: number,
): Piece {
  const { local, index } = donor
  const piece = emptyPiece()
  const remap = new Map<number, number>()
  const at = [0, 0, 0]
  const axes = [frame.forward, frame.outward, frame.up]
  for (let t = 0; t < index.length; t += 3) {
    const tri = [index[t]!, index[t + 1]!, index[t + 2]!]
    if (!tri.every((i) => local[i * 3 + 2]! < maxUp)) continue
    for (const i of tri) {
      let j = remap.get(i)
      if (j === undefined) {
        j = remap.size
        remap.set(i, j)
        fromFoot(frame, local[i * 3]!, local[i * 3 + 1]!, local[i * 3 + 2]!, at)
        piece.positions.push(...at)
        for (let k = 0; k < 3; k++) {
          piece.normals.push(
            axes[0]![k]! * donor.normals[i * 3]! +
              axes[1]![k]! * donor.normals[i * 3 + 1]! +
              axes[2]![k]! * donor.normals[i * 3 + 2]!,
          )
        }
        piece.uvs.push(donor.uvs[i * 2]!, donor.uvs[i * 2 + 1]!)
        const joints: number[] = []
        const weights: number[] = []
        for (let k = 0; k < 4; k++) {
          const bone = bones[donor.joints[i * 4 + k]!] ?? -1
          const weight = donor.weights[i * 4 + k]!
          if (bone >= 0 && weight > 0) {
            joints.push(bone)
            weights.push(weight)
          }
        }
        const total = weights.reduce((sum, weight) => sum + weight, 0)
        for (let k = 0; k < 4; k++) {
          piece.joints.push(total > 0 ? (joints[k] ?? 0) : k === 0 ? frame.foot : 0)
          piece.weights.push(total > 0 ? (weights[k] ?? 0) / total : k === 0 ? 1 : 0)
        }
        piece.open.push(false)
      }
      piece.index.push(j)
    }
  }
  return piece
}

/**
 * Two points' skins mixed `t` of the way from a's to b's: their bones'
 * weights blended, the four heaviest kept.
 */
export function mixSkin(
  jointsA: readonly number[],
  weightsA: readonly number[],
  jointsB: readonly number[],
  weightsB: readonly number[],
  t: number,
) {
  const sum = new Map<number, number>()
  for (let k = 0; k < 4; k++) {
    if (weightsA[k]! > 0) sum.set(jointsA[k]!, (sum.get(jointsA[k]!) ?? 0) + weightsA[k]! * (1 - t))
    if (weightsB[k]! > 0) sum.set(jointsB[k]!, (sum.get(jointsB[k]!) ?? 0) + weightsB[k]! * t)
  }
  const top = [...sum]
    .filter(([, weight]) => weight > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 4)
  const total = top.reduce((s, [, weight]) => s + weight, 0) || 1
  const joints = [0, 0, 0, 0]
  const weights = [0, 0, 0, 0]
  top.forEach(([joint, weight], k) => {
    joints[k] = joint
    weights[k] = weight / total
  })
  return { joints, weights }
}

const skinOf = (piece: Piece, i: number) => ({
  joints: piece.joints.slice(i * 4, i * 4 + 4),
  weights: piece.weights.slice(i * 4, i * 4 + 4),
})

/** A new point `t` of the way along a piece's edge a–b: everything about it in between. */
function pointBetween(from: Piece, a: number, b: number, t: number, into: Piece) {
  for (let k = 0; k < 3; k++) {
    into.positions.push(
      from.positions[a * 3 + k]! + (from.positions[b * 3 + k]! - from.positions[a * 3 + k]!) * t,
    )
  }
  const n = [0, 1, 2].map(
    (k) => from.normals[a * 3 + k]! + (from.normals[b * 3 + k]! - from.normals[a * 3 + k]!) * t,
  )
  const length = Math.hypot(n[0]!, n[1]!, n[2]!) || 1
  into.normals.push(n[0]! / length, n[1]! / length, n[2]! / length)
  for (let k = 0; k < 2; k++) {
    into.uvs.push(from.uvs[a * 2 + k]! + (from.uvs[b * 2 + k]! - from.uvs[a * 2 + k]!) * t)
  }
  const skinA = skinOf(from, a)
  const skinB = skinOf(from, b)
  const skin = mixSkin(skinA.joints, skinA.weights, skinB.joints, skinB.weights, t)
  into.joints.push(...skin.joints)
  into.weights.push(...skin.weights)
  into.open.push(true)
  return into.open.length - 1
}

/**
 * The part of a piece where `side` is below zero: triangles across the cut
 * are cut along it, their new points (one per edge, shared) marked open.
 */
export function clip(piece: Piece, side: (i: number) => number): Piece {
  const values = Array.from({ length: piece.open.length }, (_, i) => side(i))
  const out = emptyPiece()
  const kept = new Map<number, number>()
  const keep = (i: number) => {
    let at = kept.get(i)
    if (at === undefined) {
      at = out.open.length
      kept.set(i, at)
      out.positions.push(...piece.positions.slice(i * 3, i * 3 + 3))
      out.normals.push(...piece.normals.slice(i * 3, i * 3 + 3))
      out.uvs.push(...piece.uvs.slice(i * 2, i * 2 + 2))
      out.joints.push(...piece.joints.slice(i * 4, i * 4 + 4))
      out.weights.push(...piece.weights.slice(i * 4, i * 4 + 4))
      out.open.push(piece.open[i]!)
    }
    return at
  }
  const cuts = new Map<string, number>()
  const cut = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`
    let at = cuts.get(key)
    if (at === undefined) {
      at = pointBetween(piece, a, b, values[a]! / (values[a]! - values[b]!), out)
      cuts.set(key, at)
    }
    return at
  }
  for (let t = 0; t < piece.index.length; t += 3) {
    const tri = [piece.index[t]!, piece.index[t + 1]!, piece.index[t + 2]!]
    const inside = tri.map((i) => values[i]! < 0)
    const count = inside.filter(Boolean).length
    if (count === 3) {
      out.index.push(...tri.map(keep))
    } else if (count === 1) {
      const r = inside.indexOf(true)
      const [a, b, c] = [tri[r]!, tri[(r + 1) % 3]!, tri[(r + 2) % 3]!]
      out.index.push(keep(a), cut(a, b), cut(a, c))
    } else if (count === 2) {
      const r = inside.indexOf(false)
      const [c, a, b] = [tri[r]!, tri[(r + 1) % 3]!, tri[(r + 2) % 3]!]
      const ka = keep(a)
      const kb = keep(b)
      const ac = cut(a, c)
      const bc = cut(b, c)
      out.index.push(ka, kb, bc, ka, bc, ac)
    }
  }
  return out
}

/** How far down from the ring (in the foot's lengths) a weld's snap, skins and normals fade out, at least. */
export const FALLOFF = 0.4
/** How far above a tucked ring's top (in the foot's lengths) the foot's leg is cut off, inside what covers it. */
export const TUCK_ABOVE = 0.45

/**
 * A foot fitted to its ring: the piece, how it went on, and for a weld how
 * far below the ring each point is (`depth`, foot lengths; the knit and the
 * colour fade by it) and how far its top had to move to meet the ring
 * (`snap`, its furthest, in foot lengths).
 */
export type Fitted = {
  piece: Piece
  mode: 'weld' | 'tuck'
  depth: Float32Array | null
  snap: number
}

/** A piece's points in a foot's coordinates. */
const coordinatesOf = (piece: Piece, frame: FootFrame) =>
  Array.from({ length: piece.open.length }, (_, i) =>
    toFoot(
      frame,
      piece.positions[i * 3]!,
      piece.positions[i * 3 + 1]!,
      piece.positions[i * 3 + 2]!,
    ),
  )

/** A point's place as a key: the cut makes one per edge, but a texture seam's copies share it. */
const placeKey = (piece: Piece, i: number) =>
  `${Math.round(piece.positions[i * 3]! * 1e6)},${Math.round(piece.positions[i * 3 + 1]! * 1e6)},${Math.round(piece.positions[i * 3 + 2]! * 1e6)}`

/** The open spots of a piece (its seam copies together), each with its angle round the ring. */
type OpenSpot = { members: number[]; theta: number; corner: number }

function openSpots(piece: Piece, angles: readonly number[]): OpenSpot[] {
  const spots = new Map<string, number[]>()
  for (let i = 0; i < piece.open.length; i++) {
    if (!piece.open[i]) continue
    const key = placeKey(piece, i)
    const list = spots.get(key)
    if (list) list.push(i)
    else spots.set(key, [i])
  }
  return [...spots.values()]
    .map((members) => ({ members, theta: angles[members[0]!]!, corner: -1 }))
    .sort((x, y) => x.theta - y.theta)
}

/**
 * Gives each of the ring's corners the nearest unclaimed open spot by angle,
 * within half the spots' mean spacing; returns the corners left unclaimed.
 */
function claimCorners(spots: OpenSpot[], ring: Ring): number[] {
  for (const spot of spots) spot.corner = -1
  const spacing = (2 * Math.PI) / Math.max(spots.length, 1)
  const unclaimed: number[] = []
  ring.theta.forEach((theta, corner) => {
    let best = -1
    let bestOff = Number.POSITIVE_INFINITY
    spots.forEach((spot, k) => {
      if (spot.corner >= 0) return
      let off = Math.abs(spot.theta - theta)
      off = Math.min(off, 2 * Math.PI - off)
      if (off < bestOff) {
        bestOff = off
        best = k
      }
    })
    if (best >= 0 && bestOff < spacing * 0.5) spots[best]!.corner = corner
    else unclaimed.push(corner)
  })
  return unclaimed
}

/**
 * Splits the piece's open edges where a ring corner no open spot claimed
 * falls between their two ends (by angle), so the corner gets a spot of its
 * own to snap onto. Returns how many triangles it split.
 */
function splitAtCorners(
  piece: Piece,
  angles: number[],
  corners: readonly number[],
  ring: Ring,
  frame: FootFrame,
) {
  let split = 0
  for (const corner of corners) {
    const theta = ring.theta[corner]!
    const spans = (a: number, b: number) => {
      let ta = angles[a]!
      let tb = angles[b]!
      if (Math.abs(tb - ta) > Math.PI) {
        if (ta < tb) ta += 2 * Math.PI
        else tb += 2 * Math.PI
      }
      const low = Math.min(ta, tb)
      const high = Math.max(ta, tb)
      let x = theta
      if (x < low) x += 2 * Math.PI
      if (x > high && x - 2 * Math.PI >= low) x -= 2 * Math.PI
      return x > low && x < high ? (x - ta) / (tb - ta) : null
    }
    const made = new Map<string, number>()
    const triangles = piece.index.length / 3
    for (let t = 0; t < triangles; t++) {
      for (let e = 0; e < 3; e++) {
        const a = piece.index[t * 3 + e]!
        const b = piece.index[t * 3 + ((e + 1) % 3)]!
        const o = piece.index[t * 3 + ((e + 2) % 3)]!
        if (!(piece.open[a] && piece.open[b])) continue
        const along = spans(a, b)
        if (along === null) continue
        const key = `${Math.min(a, b)},${Math.max(a, b)}`
        let v = made.get(key)
        if (v === undefined) {
          v = pointBetween(piece, a, b, along, piece)
          made.set(key, v)
          const c = toFoot(
            frame,
            piece.positions[v * 3]!,
            piece.positions[v * 3 + 1]!,
            piece.positions[v * 3 + 2]!,
          )
          angles.push(ringAngle(ring, c))
        }
        piece.index[t * 3 + ((e + 1) % 3)] = v
        piece.index.push(v, b, o)
        split++
        break
      }
    }
  }
  return split
}

/**
 * The piece's normals: as carried away from the weld; from its moved
 * surface (its seam copies together) where it moved; the ring's own right
 * at it, so the light runs on across the seam.
 */
function weldNormals(
  piece: Piece,
  depth: Float32Array,
  falloff: number,
  ringNormal: (i: number) => number[] | null,
) {
  const sums = new Map<string, number[]>()
  for (let t = 0; t < piece.index.length; t += 3) {
    const [a, b, c] = [piece.index[t]!, piece.index[t + 1]!, piece.index[t + 2]!]
    const e1 = [0, 1, 2].map((k) => piece.positions[b * 3 + k]! - piece.positions[a * 3 + k]!)
    const e2 = [0, 1, 2].map((k) => piece.positions[c * 3 + k]! - piece.positions[a * 3 + k]!)
    const face = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ]
    for (const v of [a, b, c]) {
      const key = placeKey(piece, v)
      const sum = sums.get(key) ?? [0, 0, 0]
      for (let k = 0; k < 3; k++) sum[k]! += face[k]!
      sums.set(key, sum)
    }
  }
  for (let i = 0; i < piece.open.length; i++) {
    const moved = 1 - smoothstep(0, falloff, depth[i]!)
    if (moved <= 0) continue
    const sum = sums.get(placeKey(piece, i))!
    const length = Math.hypot(sum[0]!, sum[1]!, sum[2]!) || 1
    const own = piece.normals.slice(i * 3, i * 3 + 3)
    let n = lerp(
      own,
      sum.map((value) => value / length),
      moved,
    )
    const ring = ringNormal(i)
    const atRing = 1 - smoothstep(0, 0.12, depth[i]!)
    if (ring && atRing > 0) n = lerp(n, ring, atRing)
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1
    for (let k = 0; k < 3; k++) piece.normals[i * 3 + k] = n[k]! / l
  }
}

/**
 * Fits a carried piece to the wearer's open edge (its ring). Tucked: cut
 * flat TUCK_ABOVE over the ring's top, inside what covers it. Welded: cut
 * along the ring, every open spot snapped onto the ring's nearest corner
 * (by angle round it; a corner none is near gets a spot of its own), the
 * move fading out down the leg; each snapped point takes its corner's leg
 * point's skin (so the two go wherever the leg goes) and the points below
 * blend towards it as the move fades; and the normals are matched across
 * the seam.
 */
export function fitToRing(
  carried: Piece,
  ring: Ring,
  bind: BodyBind,
  frame: FootFrame,
  mode: 'weld' | 'tuck',
): Fitted {
  if (mode === 'tuck') {
    const top = ring.high + TUCK_ABOVE
    const c = coordinatesOf(carried, frame)
    return { piece: clip(carried, (i) => c[i]![2]! - top), mode, depth: null, snap: 0 }
  }
  const before = coordinatesOf(carried, frame)
  const piece = clip(carried, (i) => before[i]![2]! - ringHeight(ring, ringAngle(ring, before[i]!)))
  let c = coordinatesOf(piece, frame)
  const angles = c.map((point) => ringAngle(ring, point))
  let spots = openSpots(piece, angles)
  const unclaimed = claimCorners(spots, ring)
  if (unclaimed.length > 0 && splitAtCorners(piece, angles, unclaimed, ring, frame) > 0) {
    c = coordinatesOf(piece, frame)
    spots = openSpots(piece, angles)
    claimCorners(spots, ring)
  }
  // Between two corners a skinned point would drift off the ring's skinned
  // segment (their skins blend, not their places): collapsed onto the nearer
  // corner, the open top is the ring itself, posed or not.
  for (const spot of spots) {
    if (spot.corner >= 0) continue
    const [i, j, t] = between(ring.theta, spot.theta)
    spot.corner = t < 0.5 ? i : j
  }
  const spotOf = new Map<number, OpenSpot>()
  for (const spot of spots) for (const member of spot.members) spotOf.set(member, spot)
  const moves = spots.map((spot) => ({
    theta: spot.theta,
    move: [0, 1, 2].map((k) => ring.points[spot.corner]![k]! - c[spot.members[0]!]![k]!),
  }))
  const moveThetas = moves.map((each) => each.theta)
  const moveAt = (theta: number) => {
    const [i, j, t] = between(moveThetas, theta)
    return lerp(moves[i]!.move, moves[j]!.move, t)
  }
  const snap = Math.max(
    0,
    ...moves.map((each) => Math.hypot(each.move[0]!, each.move[1]!, each.move[2]!)),
  )
  const falloff = Math.min(1.2, Math.max(FALLOFF, 3 * snap))
  const legSkin = ring.legPoint.map((point) =>
    point >= 0
      ? {
          joints: Array.from(bind.joints.subarray(point * 4, point * 4 + 4)),
          weights: Array.from(bind.weights.subarray(point * 4, point * 4 + 4)),
        }
      : null,
  )
  const legNormal = ring.legPoint.map((point) =>
    point >= 0 ? Array.from(bind.normals.subarray(point * 3, point * 3 + 3)) : null,
  )
  const depth = new Float32Array(piece.open.length)
  const place = [0, 0, 0]
  for (let i = 0; i < piece.open.length; i++) {
    const theta = angles[i]!
    const spot = spotOf.get(i)
    depth[i] = spot ? 0 : Math.max(0, ringHeight(ring, theta) - c[i]![2]!)
    const fade = 1 - smoothstep(0, falloff, depth[i]!)
    if (spot) {
      for (let k = 0; k < 3; k++) piece.positions[i * 3 + k] = ring.places[spot.corner]![k]!
    } else {
      const move = moveAt(theta)
      fromFoot(
        frame,
        c[i]![0]! + move[0]! * fade,
        c[i]![1]! + move[1]! * fade,
        c[i]![2]! + move[2]! * fade,
        place,
      )
      for (let k = 0; k < 3; k++) piece.positions[i * 3 + k] = place[k]!
    }
    // The skin: the corner's own at the ring, blending into the donor's below.
    const [a, b, t] = between(ring.theta, theta)
    const own = spot ? legSkin[spot.corner] : null
    const ringSkin =
      own ??
      (legSkin[a] && legSkin[b]
        ? mixSkin(
            legSkin[a]!.joints,
            legSkin[a]!.weights,
            legSkin[b]!.joints,
            legSkin[b]!.weights,
            t,
          )
        : null)
    if (ringSkin && fade > 0) {
      const skin = skinOf(piece, i)
      const mixed = mixSkin(skin.joints, skin.weights, ringSkin.joints, ringSkin.weights, fade)
      for (let k = 0; k < 4; k++) {
        piece.joints[i * 4 + k] = mixed.joints[k]!
        piece.weights[i * 4 + k] = mixed.weights[k]!
      }
    }
  }
  weldNormals(piece, depth, falloff, (i) => {
    const spot = spotOf.get(i)
    if (spot) return legNormal[spot.corner] ?? null
    const [a, b, t] = between(ring.theta, angles[i]!)
    const na = legNormal[a]
    const nb = legNormal[b]
    return na && nb ? lerp(na, nb, t) : null
  })
  return { piece, mode, depth, snap }
}

/**
 * How far (in the foot's lengths, about 15 mm on an adult) a weld onto
 * cloth may snap the donor's leg: further, and the hem is too wide for the
 * leg (a trouser's, a boot's opening) and the foot is tucked into it
 * instead. A bare leg is always welded to: there is nothing to tuck into.
 */
export const CLOTH_SNAP = 0.12

/** Fits a carried foot to its plan (see fitToRing), tucking it into cloth a weld would stretch too far to reach. */
export function fitFoot(carried: Piece, plan: FootPlan, bind: BodyBind, frame: FootFrame): Fitted {
  const fitted = fitToRing(carried, plan.ring, bind, frame, plan.mode)
  if (fitted.mode === 'weld' && !plan.skin && fitted.snap > CLOTH_SNAP) {
    return fitToRing(carried, plan.ring, bind, frame, 'tuck')
  }
  return fitted
}

/** How high up the leg (foot lengths) a carried foot reaches: well past its ring, inside whatever is over it. */
export const carryHeight = (plan: FootPlan) => Math.max(2.4, plan.ring.high + 1.3)

/**
 * A sock's fullness over the foot (in its lengths), how much its toes swell
 * into one another, and how many rounds they are smoothed together for: a
 * sock's front is one rounded toe box, not five toes.
 */
const SOCK_FULL = 0.018
const TOE_SWELL = 0.04
const TOE_ROUNDS = 12

/**
 * A fitted foot taken in to a sock: a little fuller, its toes swollen into
 * one another and smoothed together, their soles kept on the ground; all
 * fading out towards a weld (`depth` from fitToRing), where the leg's own
 * surface carries on. Normals follow the smoothed toes.
 */
export function sockify(piece: Piece, frame: FootFrame, depth: Float32Array | null) {
  const n = piece.open.length
  const ids = new Map<string, number>()
  const spotOf = Array.from({ length: n }, (_, i) => {
    const key = placeKey(piece, i)
    if (!ids.has(key)) ids.set(key, ids.size)
    return ids.get(key)!
  })
  const m = ids.size
  const neighbours: Set<number>[] = Array.from({ length: m }, () => new Set())
  for (let t = 0; t < piece.index.length; t += 3) {
    const s = [0, 1, 2].map((k) => spotOf[piece.index[t + k]!]!)
    for (let k = 0; k < 3; k++) {
      neighbours[s[k]!]!.add(s[(k + 1) % 3]!)
      neighbours[s[k]!]!.add(s[(k + 2) % 3]!)
    }
  }
  const at = new Float32Array(m * 3)
  const normal = new Float32Array(m * 3)
  const toes = new Float32Array(m)
  const kept = new Float32Array(m)
  const sole = new Float32Array(m)
  const ground = new Float32Array(m)
  const local = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    const s = spotOf[i]!
    for (let k = 0; k < 3; k++) {
      at[s * 3 + k] = piece.positions[i * 3 + k]!
      normal[s * 3 + k]! += piece.normals[i * 3 + k]!
    }
    toFoot(
      frame,
      piece.positions[i * 3]!,
      piece.positions[i * 3 + 1]!,
      piece.positions[i * 3 + 2]!,
      local,
    )
    toes[s] = smoothstep(0.85, 1.1, local[0]!)
    const down = -(
      piece.normals[i * 3]! * frame.up[0] +
      piece.normals[i * 3 + 1]! * frame.up[1] +
      piece.normals[i * 3 + 2]! * frame.up[2]
    )
    sole[s] = Math.max(
      sole[s]!,
      smoothstep(0.3, 0.7, down) * (1 - smoothstep(0.05, 0.12, local[2]!)),
    )
    ground[s] = piece.positions[i * 3 + 1]!
    kept[s] = depth ? smoothstep(0, 0.2, depth[i]!) : 1
  }
  const unit = (s: number) => {
    const l = Math.hypot(normal[s * 3]!, normal[s * 3 + 1]!, normal[s * 3 + 2]!) || 1
    return [normal[s * 3]! / l, normal[s * 3 + 1]! / l, normal[s * 3 + 2]! / l]
  }
  const swell = TOE_SWELL * frame.length
  for (let s = 0; s < m; s++) {
    const u = unit(s)
    for (let k = 0; k < 3; k++)
      at[s * 3 + k]! += u[k]! * swell * toes[s]! * kept[s]! * (1 - sole[s]!)
  }
  for (let round = 0; round < TOE_ROUNDS; round++) {
    const next = at.slice()
    for (let s = 0; s < m; s++) {
      if (toes[s]! <= 0 || neighbours[s]!.size === 0) continue
      const mean = [0, 0, 0]
      for (const o of neighbours[s]!) for (let k = 0; k < 3; k++) mean[k]! += at[o * 3 + k]!
      for (let k = 0; k < 3; k++) {
        next[s * 3 + k] =
          at[s * 3 + k]! +
          (mean[k]! / neighbours[s]!.size - at[s * 3 + k]!) * 0.5 * toes[s]! * kept[s]!
      }
      next[s * 3 + 1] = next[s * 3 + 1]! + (ground[s]! - next[s * 3 + 1]!) * sole[s]!
    }
    at.set(next)
  }
  for (let i = 0; i < n; i++) {
    const s = spotOf[i]!
    const u = unit(s)
    for (let k = 0; k < 3; k++) {
      piece.positions[i * 3 + k] = at[s * 3 + k]! + u[k]! * SOCK_FULL * frame.length * kept[s]!
    }
  }
  const sums = new Float32Array(m * 3)
  for (let t = 0; t < piece.index.length; t += 3) {
    const [a, b, c] = [piece.index[t]!, piece.index[t + 1]!, piece.index[t + 2]!]
    const e1 = [0, 1, 2].map((k) => piece.positions[b * 3 + k]! - piece.positions[a * 3 + k]!)
    const e2 = [0, 1, 2].map((k) => piece.positions[c * 3 + k]! - piece.positions[a * 3 + k]!)
    const face = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ]
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) sums[spotOf[v]! * 3 + k]! += face[k]!
  }
  for (let i = 0; i < n; i++) {
    const s = spotOf[i]!
    const w = toes[s]! * kept[s]!
    if (w <= 0) continue
    const l = Math.hypot(sums[s * 3]!, sums[s * 3 + 1]!, sums[s * 3 + 2]!) || 1
    const blended = [0, 1, 2].map(
      (k) => piece.normals[i * 3 + k]! + (sums[s * 3 + k]! / l - piece.normals[i * 3 + k]!) * w,
    )
    const bl = Math.hypot(blended[0]!, blended[1]!, blended[2]!) || 1
    for (let k = 0; k < 3; k++) piece.normals[i * 3 + k] = blended[k]! / bl
  }
}
