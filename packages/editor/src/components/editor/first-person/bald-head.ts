import { rasterise } from './front-render'
import { PointGrid, SKULL_CELL, type Skull, smoothstep, type Triples } from './head-skull'

/**
 * A character wearing any hair but its own is made bald first, cleanly:
 * its head's own hair — the triangles of its head mesh the hair's volume
 * is sculpted into, or painted onto over the cranium — is taken out, and
 * the hole closed with the bald skull every head shares (see head-skull.ts)
 * fitted to it and bent to meet the skin it keeps. Its face, ears and neck
 * stay its own; the skin round the cut is painted to the scalp's tone (see
 * scalp-paint.ts), and another's hair goes on over it all like a wig.
 *
 * Which triangles are the hair is worked out once per head, offline, from
 * its texture as well as its shape (`ownHair`, run by
 * scripts/characters/gen-hair-styles.ts); the rest, from the shape alone,
 * when a character first goes bald. Lengths are in the bind pose's own
 * units (see head-skull.ts).
 */

/** A head as `ownHair` reads it: its points against the skull fitted to it, and its texture. */
export type OwnHead = {
  /** Points in the bind pose, flat. */
  points: Triples
  index: ArrayLike<number>
  /** Each point's spot (points a texture seam splits share one), and how many there are. */
  spots: Int32Array
  spotCount: number
  /** Which points are the hair's sculpted shell (1), where it has one. */
  shell: ArrayLike<number> | null
  /** Per point: how far it stands over the skull, the skull's hair zone there, how far off its nearest point. */
  height: Float32Array
  zone: Float32Array
  off: Float32Array
  /** The head bone's height (the top of the neck), and how far forward the eyes reach. */
  neck: number
  eyeFront: number
  /**
   * Per triangle, how much of what its texture shows is the hair's colour,
   * and how much is neither hair nor skin (a garment); null where the head
   * shows no hair, or wasn't read.
   */
  hair: Float32Array | null
  notSkin: Float32Array | null
}

/**
 * Per triangle (`index`, its corners' texture coordinates `uvs`), the mean
 * of each of `masks` (0–1 per texel of a `width` × `height` texture) over
 * the texels it covers; 0 for one covering none.
 */
export function texelShares(
  index: ArrayLike<number>,
  uvs: Triples,
  width: number,
  height: number,
  masks: readonly Float32Array[],
): Float32Array[] {
  const count = index.length / 3
  const shares = masks.map(() => new Float32Array(count))
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [index[t * 3]! * 2, index[t * 3 + 1]! * 2, index[t * 3 + 2]! * 2]
    let texels = 0
    rasterise(
      uvs[a]! * width,
      uvs[a + 1]! * height,
      uvs[b]! * width,
      uvs[b + 1]! * height,
      uvs[c]! * width,
      uvs[c + 1]! * height,
      width,
      height,
      0,
      (texel) => {
        texels++
        masks.forEach((mask, m) => {
          shares[m]![t]! += mask[texel]!
        })
      },
    )
    if (texels > 0) for (const share of shares) share[t]! /= texels
  }
  return shares
}

/** Where every corner's skull zone is at least this, a triangle is over the cranium: the hair's. */
const CRANIUM_ZONE = 0.2

/**
 * A triangle with a corner standing more than STANDING off the skull where
 * some heads have hair (ZONE_SOME), and less than NEAR_SKULL off its
 * nearest point (not an ear, not a nose), is hair volume the shell missed.
 */
const ZONE_SOME = 0.05
const STANDING = 0.004
const NEAR_SKULL = 0.04

/**
 * Painted hair touching the hair taken out goes with it: triangles over
 * the skull's hair zone at all (HAIR_ZONE) whose texture is at least
 * HAIR_SHARE the hair's colour.
 */
const HAIR_ZONE = 0.01
const HAIR_SHARE = 0.5

/** A garment modelled in the head (a hijab, a hood) touching the hair goes too: at least this much of its texture neither skin nor hair. */
const GARMENT_SHARE = 0.7

/**
 * Below the top of the neck and behind it (HEM_BEHIND behind the eyes'
 * front), hair hangs at least HEM off the skull: a hem the shell missed. In
 * front of the neck the chest stands as far off it.
 */
const HEM = 0.012
const HEM_BEHIND = 0.1

/** What is left of the head in pieces smaller than this share of the largest goes (not an eyeball). */
const PIECE = 0.05

/**
 * The face, which nothing takes: low in the skull's zone, its front within
 * FACE_DEPTH of the eyes', above the top of the neck. An eyeball is a piece
 * of its own within EYEBALL_DEPTH of their front.
 */
const FACE_ZONE = 0.02
const FACE_DEPTH = 0.05
const EYEBALL_DEPTH = 0.03

/** At most this many rounds a flood of painted hair or a garment spreads, a ring of triangles each. */
const FLOOD_ROUNDS = 80

/**
 * Which of a head's triangles are its own hair (1), to take out for a bald
 * head: its sculpted shell, the cranium, volume standing off the skull, the
 * painted hair and any garment modelled in the head touching all that, a
 * hem hanging off the neck — and what that leaves in small pieces apart
 * from the rest. The face is never taken.
 */
export function ownHair(head: OwnHead): Uint8Array {
  const { points, index, spots, shell, height, zone, off, neck } = head
  const count = index.length / 3
  const hair = new Uint8Array(count)
  const corner = (t: number, k: number) => index[t * 3 + k]!
  const face = (i: number) =>
    zone[i]! < FACE_ZONE &&
    points[i * 3 + 2]! > head.eyeFront - FACE_DEPTH &&
    points[i * 3 + 1]! > neck
  for (let t = 0; t < count; t++) {
    let onShell = false
    let cranium = true
    let standing = false
    for (let k = 0; k < 3; k++) {
      const i = corner(t, k)
      if (shell?.[i]) onShell = true
      if (zone[i]! < CRANIUM_ZONE) cranium = false
      if (zone[i]! >= ZONE_SOME && height[i]! > STANDING && off[i]! < NEAR_SKULL) standing = true
    }
    if (onShell || cranium || standing) hair[t] = 1
  }
  const taken = new Uint8Array(head.spotCount)
  const mark = () => {
    taken.fill(0)
    for (let t = 0; t < count; t++) {
      if (hair[t]) for (let k = 0; k < 3; k++) taken[spots[corner(t, k)]!] = 1
    }
  }
  const touching = (t: number) =>
    taken[spots[corner(t, 0)]!] || taken[spots[corner(t, 1)]!] || taken[spots[corner(t, 2)]!]
  const flood = (joins: (t: number) => boolean) => {
    for (let round = 0; round < FLOOD_ROUNDS; round++) {
      mark()
      let grew = false
      for (let t = 0; t < count; t++) {
        if (hair[t] || !touching(t) || !joins(t)) continue
        hair[t] = 1
        grew = true
      }
      if (!grew) break
    }
  }
  const painted = head.hair
  if (painted) {
    flood(
      (t) => painted[t]! >= HAIR_SHARE && [0, 1, 2].some((k) => zone[corner(t, k)]! > HAIR_ZONE),
    )
  }
  const garment = head.notSkin
  if (garment) {
    flood((t) => garment[t]! >= GARMENT_SHARE && ![0, 1, 2].some((k) => face(corner(t, k))))
  }
  for (let t = 0; t < count; t++) {
    if (hair[t]) continue
    const hem = [0, 1, 2].every((k) => {
      const i = corner(t, k)
      return (
        points[i * 3 + 1]! < neck &&
        points[i * 3 + 2]! < head.eyeFront - HEM_BEHIND &&
        height[i]! > HEM &&
        !face(i)
      )
    })
    if (hem) hair[t] = 1
  }
  // A stray lock lying flat on the skin, apart from the rest of the hair,
  // stays (painted over): closed with the skull, the hole it left would be
  // a patch of another shape and shade.
  const locks = piecesOf(index, spots, head.spotCount, (t) => hair[t] === 1)
  const standing = new Set<number>()
  for (let t = 0; t < count; t++) {
    if (hair[t] && [0, 1, 2].some((k) => height[corner(t, k)]! >= STANDING)) {
      standing.add(locks.piece(t))
    }
  }
  const stray = (t: number) =>
    locks.size(t) < PIECE * locks.largest && !standing.has(locks.piece(t))
  for (let t = 0; t < count; t++) if (hair[t] && stray(t)) hair[t] = 0
  // And what is left of the head in small pieces goes.
  const kept = piecesOf(index, spots, head.spotCount, (t) => hair[t] === 0)
  for (let t = 0; t < count; t++) {
    if (hair[t] || kept.size(t) >= PIECE * kept.largest) continue
    const eyeball = [0, 1, 2].every(
      (k) => points[corner(t, k) * 3 + 2]! > head.eyeFront - EYEBALL_DEPTH,
    )
    if (!eyeball) hair[t] = 1
  }
  return hair
}

/**
 * The pieces some of a mesh's triangles (`within`) make, joined at their
 * corners' spots: each triangle's piece, its size (in triangles), and the
 * largest's.
 */
function piecesOf(
  index: ArrayLike<number>,
  spots: Int32Array,
  spotCount: number,
  within: (t: number) => boolean,
) {
  const parent = Int32Array.from({ length: spotCount }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  const count = index.length / 3
  for (let t = 0; t < count; t++) {
    if (!within(t)) continue
    const a = find(spots[index[t * 3]!]!)
    parent[find(spots[index[t * 3 + 1]!]!)] = a
    parent[find(spots[index[t * 3 + 2]!]!)] = a
  }
  const sizes = new Map<number, number>()
  for (let t = 0; t < count; t++) {
    if (!within(t)) continue
    const piece = find(spots[index[t * 3]!]!)
    sizes.set(piece, (sizes.get(piece) ?? 0) + 1)
  }
  const piece = (t: number) => find(spots[index[t * 3]!]!)
  return {
    piece,
    size: (t: number) => sizes.get(piece(t)) ?? 0,
    largest: Math.max(0, ...sizes.values()),
  }
}

/** The triangles (corners, flat) of `index` not flagged in `taken`. */
export function keptTriangles(index: ArrayLike<number>, taken: ArrayLike<number>): Uint32Array {
  const kept: number[] = []
  for (let t = 0; t < index.length / 3; t++) {
    if (!taken[t]) kept.push(index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!)
  }
  return Uint32Array.from(kept)
}

/**
 * How many rings of kept triangles out from the cut each spot is: 0 on the
 * cut (a corner of a triangle taken), up to `rings`, and `rings + 1` for
 * any further (or on a head with nothing taken).
 */
export function cutRings(
  index: ArrayLike<number>,
  taken: ArrayLike<number>,
  spots: Int32Array,
  spotCount: number,
  rings: number,
): Uint8Array {
  const ring = new Uint8Array(spotCount).fill(rings + 1)
  const count = index.length / 3
  for (let t = 0; t < count; t++) {
    if (taken[t]) for (let k = 0; k < 3; k++) ring[spots[index[t * 3 + k]!]!] = 0
  }
  for (let r = 1; r <= rings; r++) {
    for (let t = 0; t < count; t++) {
      if (taken[t]) continue
      const corners = [0, 1, 2].map((k) => spots[index[t * 3 + k]!]!)
      if (!corners.some((spot) => ring[spot] === r - 1)) continue
      for (const spot of corners) if (ring[spot]! > r) ring[spot] = r
    }
  }
  return ring
}

/** Each point's neighbours along triangles (`triangles` of `count` points). */
function neighboursOf(triangles: ArrayLike<number>, count: number): number[][] {
  const sets = Array.from({ length: count }, () => new Set<number>())
  for (let t = 0; t < triangles.length; t += 3) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        if (a !== b) sets[triangles[t + a]!]!.add(triangles[t + b]!)
      }
    }
  }
  return sets.map((set) => [...set])
}

/** Vertex normals of a mesh: its triangles' (area-weighted) round each point. */
export function vertexNormals(points: Triples, triangles: ArrayLike<number>): Float32Array {
  const normals = new Float32Array(points.length)
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]! * 3
    const b = triangles[t + 1]! * 3
    const c = triangles[t + 2]! * 3
    const ex = points[b]! - points[a]!
    const ey = points[b + 1]! - points[a + 1]!
    const ez = points[b + 2]! - points[a + 2]!
    const fx = points[c]! - points[a]!
    const fy = points[c + 1]! - points[a + 1]!
    const fz = points[c + 2]! - points[a + 2]!
    const nx = ey * fz - ez * fy
    const ny = ez * fx - ex * fz
    const nz = ex * fy - ey * fx
    for (const corner of [a, b, c]) {
      normals[corner]! += nx
      normals[corner + 1]! += ny
      normals[corner + 2]! += nz
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1
    normals[i]! /= length
    normals[i + 1]! /= length
    normals[i + 2]! /= length
  }
  return normals
}

/** The bald surface: the skull fitted to a head, bent to its skin, with its neck hung lower at the back. */
export type BaldSkull = {
  points: Float32Array
  normals: Float32Array
  zone: Float32Array
  triangles: Uint32Array
  /** The first point of the piece hung below the skull's neck (see `withNeckPiece`). */
  neckFrom: number
}

/**
 * The skull's neck is fitted to a head's in slices this tall, read up to
 * NECK_READ above the top of the neck, and fitted fully from NECK_FADE
 * under it, fading out to the top: the skull's occiput stays its own.
 */
const NECK_SLICE = 0.01
const NECK_READ = 0.03
const NECK_FADE = 0.04

/**
 * A kept point fits the skull's neck at the skull's point round its slice
 * nearest it in angle, no further round than this (radians), and only where
 * the two are this alike (a collar, a chin are not the neck); a slice is
 * fitted by FEWEST_FITTING of them at least, else as the nearest that is.
 */
const NECK_ANGLE = 0.4
const NECK_LIKE: readonly [number, number] = [0.6, 1.4]
const FEWEST_FITTING = 3

/**
 * The fitted skull with its neck made as thick as a head's (`anchors`, its
 * kept points; `neck`, the top of its neck), slice by slice round each
 * slice's middle: a woman's or a child's neck is thinner than the skull's
 * man's, and under long hair there is none of its own to bend the skull to.
 * Each slice is scaled by the middle ratio of its kept points' distance from
 * the middle to the skull's at their angle.
 */
export function neckFitted(skull: Skull, anchors: Triples, neck: number): Skull {
  const count = skull.points.length / 3
  const top = neck + NECK_READ
  const sliceOf = (y: number) => Math.round(y / NECK_SLICE)
  const slices = new Map<number, { x: number; z: number; points: number[] }>()
  for (let i = 0; i < count; i++) {
    const y = skull.points[i * 3 + 1]!
    if (y > top) continue
    const slice = slices.get(sliceOf(y)) ?? { x: 0, z: 0, points: [] }
    slice.x += skull.points[i * 3]!
    slice.z += skull.points[i * 3 + 2]!
    slice.points.push(i)
    slices.set(sliceOf(y), slice)
  }
  for (const slice of slices.values()) {
    slice.x /= slice.points.length
    slice.z /= slice.points.length
  }
  const ratios = new Map<number, number[]>()
  for (let j = 0; j < anchors.length / 3; j++) {
    const y = anchors[j * 3 + 1]!
    const slice = y <= top ? slices.get(sliceOf(y)) : undefined
    if (!slice) continue
    const ax = anchors[j * 3]! - slice.x
    const az = anchors[j * 3 + 2]! - slice.z
    const angle = Math.atan2(ax, az)
    let nearest = NECK_ANGLE
    let radius = 0
    for (const i of slice.points) {
      const sx = skull.points[i * 3]! - slice.x
      const sz = skull.points[i * 3 + 2]! - slice.z
      let apart = Math.abs(Math.atan2(sx, sz) - angle)
      if (apart > Math.PI) apart = 2 * Math.PI - apart
      if (apart < nearest) {
        nearest = apart
        radius = Math.hypot(sx, sz)
      }
    }
    const ratio = radius > 0 ? Math.hypot(ax, az) / radius : 0
    if (ratio < NECK_LIKE[0] || ratio > NECK_LIKE[1]) continue
    const list = ratios.get(sliceOf(y)) ?? []
    list.push(ratio)
    ratios.set(sliceOf(y), list)
  }
  const scales = new Map<number, number>()
  for (const [key, list] of ratios) {
    if (list.length >= FEWEST_FITTING)
      scales.set(key, list.sort((a, b) => a - b)[list.length >> 1]!)
  }
  if (scales.size === 0) return skull
  const fitted = [...scales.keys()]
  const points = new Float32Array(skull.points)
  for (const [key, slice] of slices) {
    const nearest = fitted.reduce((a, b) => (Math.abs(b - key) < Math.abs(a - key) ? b : a))
    const scale = scales.get(nearest)!
    for (const i of slice.points) {
      const k = 1 + (scale - 1) * (1 - smoothstep(neck - NECK_FADE, neck, skull.points[i * 3 + 1]!))
      points[i * 3] = slice.x + (skull.points[i * 3]! - slice.x) * k
      points[i * 3 + 2] = slice.z + (skull.points[i * 3 + 2]! - slice.z) * k
    }
  }
  return { ...skull, points, grid: new PointGrid(points, SKULL_CELL) }
}

/**
 * How near a skull point the head's kept skin must be to bend it there:
 * this far to one side of its normal at most, and this far along it.
 */
const BESIDE = 0.01
const ALONG = 0.03

/** How many rounds a bend is carried on from where the skin is to where it isn't. */
const BEND_ROUNDS = 200

/**
 * How much of a bend each round carries on over the cranium: it fades back
 * to the skull there, where nothing the head kept says how it lies, but is
 * carried on whole round the face and down the neck (where the skull's
 * man's shape fits a head worst), between the two zones.
 */
const BEND_KEPT = 0.9
const BEND_FACE_ZONE = 0.03
const BEND_CRANIUM_ZONE = 0.15

/**
 * How far under the head's skin the bald surface lies where it meets it
 * (tucked under the cut's edge), and elsewhere.
 */
const UNDER_SKIN = 0.0015
const SINK = 0.0006

/**
 * The fitted skull (`skull`, its `triangles`) bent to meet a head's kept
 * skin (`anchors`, its points): each skull point beside the skin goes to
 * it, and the rest as far as those round them, the bend fading back to the
 * skull over the cranium (see BEND_*); all of it a little under the skin.
 */
export function bentSkull(skull: Skull, triangles: ArrayLike<number>, anchors: Triples) {
  const count = skull.points.length / 3
  const neighbours = neighboursOf(triangles, count)
  const grid = new PointGrid(anchors, SKULL_CELL)
  const found: number[] = []
  const distances: number[] = []
  const known = new Uint8Array(count)
  let offset = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const x = skull.points[i * 3]!
    const y = skull.points[i * 3 + 1]!
    const z = skull.points[i * 3 + 2]!
    if (grid.nearest(x, y, z, 1, found, distances, ALONG + BESIDE) === 0) continue
    const j = found[0]!
    const along =
      (anchors[j * 3]! - x) * skull.normals[i * 3]! +
      (anchors[j * 3 + 1]! - y) * skull.normals[i * 3 + 1]! +
      (anchors[j * 3 + 2]! - z) * skull.normals[i * 3 + 2]!
    const aside = Math.sqrt(Math.max(0, distances[0]! - along * along))
    if (aside <= BESIDE && Math.abs(along) <= ALONG) {
      known[i] = 1
      offset[i] = along
    }
  }
  const keep = Float32Array.from(
    { length: count },
    (_, i) =>
      BEND_KEPT +
      (1 - BEND_KEPT) * (1 - smoothstep(BEND_FACE_ZONE, BEND_CRANIUM_ZONE, skull.zone[i]!)),
  )
  for (let round = 0; round < BEND_ROUNDS; round++) {
    const next = new Float32Array(offset)
    for (let i = 0; i < count; i++) {
      const around = neighbours[i]!
      if (known[i] || around.length === 0) continue
      let sum = 0
      for (const j of around) sum += offset[j]!
      next[i] = (keep[i]! * sum) / around.length
    }
    offset = next
  }
  const points = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const move = offset[i]! - (known[i] ? UNDER_SKIN : SINK)
    for (let axis = 0; axis < 3; axis++) {
      points[i * 3 + axis] = skull.points[i * 3 + axis]! + skull.normals[i * 3 + axis]! * move
    }
  }
  return { points, normals: vertexNormals(points, triangles), known }
}

/**
 * How far below its open bottom the skull's neck is hung at the back, and
 * how far in: the skull's head ends under the occiput, where a long-haired
 * head's neck was its hair.
 */
const NECK_PIECE = 0.08
const NECK_PIECE_IN = 0.004

/** An edge of the skull's open bottom runs round the neck where it climbs less than this for each unit round. */
const ROUND_NECK = 1.5

/**
 * The bald surface (`points`, `normals`, its `triangles`) with a piece
 * hung down from the back of its open bottom below the top of the neck
 * (`neck`), straight down, facing out from the neck's middle.
 */
export function withNeckPiece(
  surface: { points: Float32Array; normals: Float32Array; zone: Float32Array },
  triangles: ArrayLike<number>,
  neck: number,
): BaldSkull {
  const count = surface.points.length / 3
  const edges = new Map<string, { from: number; to: number; uses: number }>()
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const from = triangles[t + k]!
      const to = triangles[t + ((k + 1) % 3)]!
      const key = from < to ? `${from},${to}` : `${to},${from}`
      const edge = edges.get(key)
      if (edge) edge.uses++
      else edges.set(key, { from, to, uses: 1 })
    }
  }
  let middleX = 0
  let middleZ = 0
  let below = 0
  for (let i = 0; i < count; i++) {
    if (surface.points[i * 3 + 1]! >= neck) continue
    middleX += surface.points[i * 3]!
    middleZ += surface.points[i * 3 + 2]!
    below++
  }
  middleX /= below || 1
  middleZ /= below || 1
  const points = Array.from(surface.points)
  const normals = Array.from(surface.normals)
  const zone = Array.from(surface.zone)
  const index = Array.from(triangles)
  const outward = (i: number) => {
    const x = surface.points[i * 3]! - middleX
    const z = surface.points[i * 3 + 2]! - middleZ
    const length = Math.hypot(x, z) || 1
    return [x / length, z / length] as const
  }
  const hung = new Map<number, number>()
  const hang = (i: number) => {
    let low = hung.get(i)
    if (low === undefined) {
      low = points.length / 3
      const [ox, oz] = outward(i)
      points.push(
        surface.points[i * 3]! - ox * NECK_PIECE_IN,
        surface.points[i * 3 + 1]! - NECK_PIECE,
        surface.points[i * 3 + 2]! - oz * NECK_PIECE_IN,
      )
      normals.push(ox, 0, oz)
      zone.push(surface.zone[i]!)
      hung.set(i, low)
    }
    return low
  }
  for (const { from, to, uses } of edges.values()) {
    if (uses !== 1) continue
    const [fy, ty] = [surface.points[from * 3 + 1]!, surface.points[to * 3 + 1]!]
    if (fy > neck || ty > neck) continue
    const climb = Math.abs(fy - ty)
    const round = Math.hypot(
      surface.points[from * 3]! - surface.points[to * 3]!,
      surface.points[from * 3 + 2]! - surface.points[to * 3 + 2]!,
    )
    if (climb > ROUND_NECK * round) continue
    if (surface.points[from * 3 + 2]! > middleZ || surface.points[to * 3 + 2]! > middleZ) continue
    // The rim's own normals curl in under the skull: it faces out, as the piece does.
    for (const i of [from, to]) {
      const [ox, oz] = outward(i)
      normals[i * 3] = ox
      normals[i * 3 + 1] = 0
      normals[i * 3 + 2] = oz
    }
    // Wound as the edge's own triangle is, so the piece faces out with it.
    index.push(to, from, hang(from), to, hang(from), hang(to))
  }
  return {
    points: Float32Array.from(points),
    normals: Float32Array.from(normals),
    zone: Float32Array.from(zone),
    triangles: Uint32Array.from(index),
    neckFrom: count,
  }
}

/** Where along a ray (from `o`, unit `d`) it meets triangle a, b, c of `points` (corner offsets ×3), or NaN. */
function rayHit(o: number[], d: number[], points: Triples, a: number, b: number, c: number) {
  const e1 = [
    points[b]! - points[a]!,
    points[b + 1]! - points[a + 1]!,
    points[b + 2]! - points[a + 2]!,
  ]
  const e2 = [
    points[c]! - points[a]!,
    points[c + 1]! - points[a + 1]!,
    points[c + 2]! - points[a + 2]!,
  ]
  const p = [
    d[1]! * e2[2]! - d[2]! * e2[1]!,
    d[2]! * e2[0]! - d[0]! * e2[2]!,
    d[0]! * e2[1]! - d[1]! * e2[0]!,
  ]
  const det = e1[0]! * p[0]! + e1[1]! * p[1]! + e1[2]! * p[2]!
  if (Math.abs(det) < 1e-14) return Number.NaN
  const s = [o[0]! - points[a]!, o[1]! - points[a + 1]!, o[2]! - points[a + 2]!]
  const u = (s[0]! * p[0]! + s[1]! * p[1]! + s[2]! * p[2]!) / det
  if (u < 0 || u > 1) return Number.NaN
  const q = [
    s[1]! * e1[2]! - s[2]! * e1[1]!,
    s[2]! * e1[0]! - s[0]! * e1[2]!,
    s[0]! * e1[1]! - s[1]! * e1[0]!,
  ]
  const v = (d[0]! * q[0]! + d[1]! * q[1]! + d[2]! * q[2]!) / det
  if (v < 0 || u + v > 1) return Number.NaN
  return (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det
}

/** The head as it is kept: its points and normals (bind pose) and its kept triangles. */
export type KeptHead = { points: Triples; normals: Triples; index: ArrayLike<number> }

/** The eyeballs' middles (bind pose), each [x, y, z], and the top of the neck. */
export type HeadMarks = { eyes: number[][]; neck: number }

/**
 * The kept skin hides a stretch of the bald surface when it lies within
 * this of it along its normal, and turned the same way (at least
 * SAME_WAY): above the neck, and down the neck (fuller than the skull's).
 */
const COVER = 0.025
const NECK_COVER = 0.04
const SAME_WAY = 0.3

/** How many of the kept skin's triangles nearest a stretch of the bald surface are tried, and how far off. */
const COVER_TRIED = 24
const COVER_REACH = 0.04

/** Down the neck, the bald surface is the head's own neck where the kept skin is this near all round. */
const OWN_NECK = 0.02

/**
 * The skull's ear: low in its zone, this far to the side of the eyes'
 * middle, between NECK_BAND under the top of the neck and EAR_TOP over
 * the eyes, at least EAR_BACK behind their front. Where a head kept an ear
 * of its own (EAR_POINTS of its points there), the skull's goes.
 */
const EAR_ZONE = 0.03
const EAR_SIDE = 0.055
const NECK_BAND = 0.02
const EAR_TOP = 0.035
const EAR_BACK = 0.05
const EAR_POINTS = 8

/** A patch of bald surface this much smaller than the largest is a stray (but the neck's piece). */
const STRAY = 0.1

/**
 * Which triangles of the bald surface close the head over what was taken
 * out: all not hidden by its kept skin (see COVER), its face, its throat,
 * an ear of its own or its own neck — and a ring round those, tucked under
 * the cut's edge — but for strays.
 */
export function scalpTriangles(bald: BaldSkull, kept: KeptHead, marks: HeadMarks): number[] {
  const { points, normals, zone, triangles } = bald
  const count = triangles.length / 3
  const keptCount = kept.index.length / 3
  const centres = new Float32Array(keptCount * 3)
  const used = new Uint8Array(kept.points.length / 3)
  for (let t = 0; t < keptCount; t++) {
    for (let k = 0; k < 3; k++) {
      const i = kept.index[t * 3 + k]!
      used[i] = 1
      for (let axis = 0; axis < 3; axis++) centres[t * 3 + axis]! += kept.points[i * 3 + axis]! / 3
    }
  }
  const keptPoints: number[] = []
  for (let i = 0; i < used.length; i++) {
    if (used[i])
      keptPoints.push(kept.points[i * 3]!, kept.points[i * 3 + 1]!, kept.points[i * 3 + 2]!)
  }
  const centreGrid = new PointGrid(centres, SKULL_CELL)
  const pointGrid = new PointGrid(keptPoints, SKULL_CELL)
  const found: number[] = []
  const distances: number[] = []
  const covered = (t: number) => {
    const o = [0, 0, 0]
    const d = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const i = triangles[t * 3 + k]!
      for (let axis = 0; axis < 3; axis++) {
        o[axis]! += points[i * 3 + axis]! / 3
        d[axis]! += normals[i * 3 + axis]!
      }
    }
    const length = Math.hypot(d[0]!, d[1]!, d[2]!) || 1
    for (let axis = 0; axis < 3; axis++) d[axis]! /= length
    const near = centreGrid.nearest(o[0]!, o[1]!, o[2]!, COVER_TRIED, found, distances, COVER_REACH)
    const reach = o[1]! < marks.neck ? NECK_COVER : COVER
    for (let j = 0; j < near; j++) {
      const k = found[j]! * 3
      const [a, b, c] = [kept.index[k]! * 3, kept.index[k + 1]! * 3, kept.index[k + 2]! * 3]
      const along = rayHit(o, d, kept.points, a, b, c)
      if (!(Math.abs(along) <= reach)) continue
      // Turned as the bald surface is: not the far side of the neck.
      const e = [0, 1, 2].map((axis) => kept.points[b + axis]! - kept.points[a + axis]!)
      const f = [0, 1, 2].map((axis) => kept.points[c + axis]! - kept.points[a + axis]!)
      const n = [
        e[1]! * f[2]! - e[2]! * f[1]!,
        e[2]! * f[0]! - e[0]! * f[2]!,
        e[0]! * f[1]! - e[1]! * f[0]!,
      ]
      const own = [0, 1, 2].map(
        (axis) => kept.normals[a + axis]! + kept.normals[b + axis]! + kept.normals[c + axis]!,
      )
      const side = n[0]! * own[0]! + n[1]! * own[1]! + n[2]! * own[2]! > 0 ? 1 : -1
      const facing =
        (side * (n[0]! * d[0]! + n[1]! * d[1]! + n[2]! * d[2]!)) /
        (Math.hypot(n[0]!, n[1]!, n[2]!) || 1)
      if (facing > SAME_WAY) return true
    }
    return false
  }
  const eyeFront = Math.max(...marks.eyes.map((eye) => eye[2]!))
  const eyeLevel = marks.eyes.reduce((sum, eye) => sum + eye[1]!, 0) / marks.eyes.length
  const middle = marks.eyes.reduce((sum, eye) => sum + eye[0]!, 0) / marks.eyes.length
  const faceAt = (i: number) =>
    zone[i]! < FACE_ZONE &&
    points[i * 3 + 2]! > eyeFront - FACE_DEPTH &&
    points[i * 3 + 1]! > marks.neck
  const earAt = (x: number, y: number, z: number, at: number) =>
    at < EAR_ZONE &&
    Math.abs(x - middle) > EAR_SIDE &&
    y > marks.neck - NECK_BAND &&
    y < eyeLevel + EAR_TOP &&
    z < eyeFront - EAR_BACK
  const ownEars = [0, 0]
  {
    const zones = new Float32Array(kept.points.length / 3)
    // The kept points' zone: the bald surface's nearest point's.
    const surfaceGrid = new PointGrid(points, SKULL_CELL)
    for (let i = 0; i < used.length; i++) {
      if (!used[i]) continue
      const x = kept.points[i * 3]!
      const y = kept.points[i * 3 + 1]!
      const z = kept.points[i * 3 + 2]!
      if (surfaceGrid.nearest(x, y, z, 1, found, distances) === 0) continue
      zones[i] = zone[found[0]!]!
      if (earAt(x, y, z, zones[i]!)) ownEars[x > middle ? 1 : 0]!++
    }
  }
  const skullEar = (t: number) =>
    [0, 1, 2].every((k) => {
      const i = triangles[t * 3 + k]!
      const x = points[i * 3]!
      return (
        earAt(x, points[i * 3 + 1]!, points[i * 3 + 2]!, zone[i]!) &&
        ownEars[x > middle ? 1 : 0]! >= EAR_POINTS
      )
    })
  const ownNeck = (t: number) =>
    [0, 1, 2].every((k) => {
      const i = triangles[t * 3 + k]!
      if (points[i * 3 + 1]! >= marks.neck) return false
      return (
        pointGrid.nearest(
          points[i * 3]!,
          points[i * 3 + 1]!,
          points[i * 3 + 2]!,
          1,
          found,
          distances,
          OWN_NECK,
        ) > 0 && distances[0]! <= OWN_NECK ** 2
      )
    })
  // The throat: the front half of the neck, which hair never covers.
  let throatZ = 0
  let below = 0
  for (let i = 0; i < bald.neckFrom; i++) {
    if (points[i * 3 + 1]! >= marks.neck) continue
    throatZ += points[i * 3 + 2]!
    below++
  }
  throatZ /= below || 1
  const throat = (t: number) =>
    [0, 1, 2].every((k) => {
      const i = triangles[t * 3 + k]!
      return points[i * 3 + 1]! < marks.neck && points[i * 3 + 2]! > throatZ
    })
  const open = new Uint8Array(points.length / 3)
  for (let t = 0; t < count; t++) {
    const face = [0, 1, 2].every((k) => faceAt(triangles[t * 3 + k]!))
    if (face || throat(t) || skullEar(t) || ownNeck(t) || covered(t)) continue
    for (let k = 0; k < 3; k++) open[triangles[t * 3 + k]!] = 1
  }
  const chosen: number[] = []
  for (let t = 0; t < count; t++) {
    if ([0, 1, 2].some((k) => open[triangles[t * 3 + k]!])) chosen.push(t)
  }
  const parent = Int32Array.from({ length: points.length / 3 }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  for (const t of chosen) {
    const a = find(triangles[t * 3]!)
    parent[find(triangles[t * 3 + 1]!)] = a
    parent[find(triangles[t * 3 + 2]!)] = a
  }
  const sizes = new Map<number, number>()
  for (const t of chosen) {
    const patch = find(triangles[t * 3]!)
    sizes.set(patch, (sizes.get(patch) ?? 0) + 1)
  }
  const largest = Math.max(0, ...sizes.values())
  return chosen.filter(
    (t) =>
      sizes.get(find(triangles[t * 3]!))! >= STRAY * largest ||
      [0, 1, 2].some((k) => triangles[t * 3 + k]! >= bald.neckFrom),
  )
}

/** How far (bind units) from the top of the neck a body's open neckline is closed. */
const NECKLINE_REACH = 0.2

/** Points of a body this near (bind units) are at one spot (a texture seam splits them). */
const BODY_SPOT = 1e-4

/**
 * The back of a body's neckline closed: under long hair a body may be cut
 * away behind the neck, a notch its hair hid. Fan triangles from inside
 * the neck (`neck`, the top of it, [x, y, z]) to every open edge of the
 * body (`points` in the bind pose, `index`) behind it and below it, within
 * NECKLINE_REACH: in the neck they are hidden, past it they close the
 * notch. Returns the fan's points (its middle first), the body point each
 * of the rest is (its skinning's), and its triangles, facing back.
 */
export function necklineFan(points: Triples, index: ArrayLike<number>, neck: ArrayLike<number>) {
  const spotOf = new Map<string, number>()
  const first: number[] = []
  const spots = Int32Array.from({ length: points.length / 3 }, (_, i) => {
    const key = [0, 1, 2].map((axis) => Math.round(points[i * 3 + axis]! / BODY_SPOT)).join()
    let spot = spotOf.get(key)
    if (spot === undefined) {
      spot = first.length
      spotOf.set(key, spot)
      first.push(i)
    }
    return spot
  })
  const edges = new Map<string, { from: number; to: number; uses: number }>()
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const from = spots[index[t + k]!]!
      const to = spots[index[t + ((k + 1) % 3)]!]!
      const key = from < to ? `${from},${to}` : `${to},${from}`
      const edge = edges.get(key)
      if (edge) edge.uses++
      else edges.set(key, { from, to, uses: 1 })
    }
  }
  const at = (spot: number, axis: number) => points[first[spot]! * 3 + axis]!
  const near = (spot: number) =>
    at(spot, 2) < neck[2]! &&
    at(spot, 1) < neck[1]! &&
    Math.hypot(at(spot, 0) - neck[0]!, at(spot, 1) - neck[1]!, at(spot, 2) - neck[2]!) <=
      NECKLINE_REACH
  const open = [...edges.values()].filter(
    ({ from, to, uses }) => uses === 1 && near(from) && near(to),
  )
  const used = new Map<number, number>()
  const fan: number[] = []
  let low = 0
  for (const { from, to } of open) {
    for (const spot of [from, to]) {
      if (used.has(spot)) continue
      used.set(spot, used.size + 1)
      low += at(spot, 1)
    }
  }
  if (open.length === 0) {
    return { points: new Float32Array(), body: new Int32Array(), triangles: [] as number[] }
  }
  const middle = [neck[0]!, low / used.size, neck[2]!]
  const fanPoints = new Float32Array((used.size + 1) * 3)
  fanPoints.set(middle)
  const body = new Int32Array(used.size + 1).fill(-1)
  for (const [spot, k] of used) {
    for (let axis = 0; axis < 3; axis++) fanPoints[k * 3 + axis] = at(spot, axis)
    body[k] = first[spot]!
  }
  for (const { from, to } of open) {
    const [a, b] = [used.get(from)!, used.get(to)!]
    // Facing back (−z): the winding's normal, (a − m) × (b − m), points that way.
    const ex = fanPoints[a * 3]! - middle[0]!
    const ey = fanPoints[a * 3 + 1]! - middle[1]!
    const fx = fanPoints[b * 3]! - middle[0]!
    const fy = fanPoints[b * 3 + 1]! - middle[1]!
    fan.push(0, ...(ex * fy - ey * fx < 0 ? [a, b] : [b, a]))
  }
  return { points: fanPoints, body, triangles: fan }
}

/** How many rings of skin out from the cut are painted to the scalp's tone, and how much each (from the cut out). */
export const PAINT_RINGS = [0.9, 0.7, 0.45, 0.25, 0.1]

/** Over the skull's hair zone from here, or this near the cut, the hair's colour left on the skin is painted over too. */
const PAINT_ZONE = 0.02
const PAINT_NEAR = 2

/** Skin facing the front this squarely is the forehead the scalp's tone is read from. */
const FOREHEAD_FACING = 0.4

/** Numbers per triangle when packed for painting: u, v and how much to paint, per corner. */
export const PAINTED = 9

/** Numbers per triangle when packed for reading the tone from: u, v per corner. */
export const READ = 6

/** How a head's skin is painted round the cut (see scalp-paint.ts). */
export type ScalpPaint = {
  /** Kept triangles to paint (PAINTED per triangle). */
  paint: Float32Array
  /** Triangles to read the scalp's tone from, the forehead under the cut first (READ per triangle). */
  tone: Float32Array[]
  /** The texel (u, v) the bald surface takes its colour from: painted wholly the scalp's. */
  swatch: [number, number]
}

/**
 * How a bald head's skin is painted round the cut (see ScalpPaint): the
 * kept triangles near it, or over the hair zone, each corner by its ring
 * (see PAINT_RINGS); the tone read from the forehead's skin just under the
 * cut, or from all of the forehead; and the swatch, on the forehead by the
 * cut, nearest the face's middle.
 */
export function scalpPaint(
  head: { points: Triples; normals: Triples; uvs: Triples; index: ArrayLike<number> },
  taken: ArrayLike<number>,
  rings: Uint8Array,
  spots: Int32Array,
  zone: Float32Array,
  marks: HeadMarks,
): ScalpPaint {
  const { points, normals, uvs, index } = head
  const eyeLevel = marks.eyes.reduce((sum, eye) => sum + eye[1]!, 0) / marks.eyes.length
  const middle = marks.eyes.reduce((sum, eye) => sum + eye[0]!, 0) / marks.eyes.length
  const paint: number[] = []
  const nearCut: number[] = []
  const forehead: number[] = []
  let swatch: [number, number] | null = null
  let swatchAside = Number.POSITIVE_INFINITY
  const ringOf = (i: number) => rings[spots[i]!]!
  for (let t = 0; t < index.length / 3; t++) {
    if (taken[t]) continue
    const corners = [0, 1, 2].map((k) => index[t * 3 + k]!)
    if (corners.some((i) => zone[i]! >= PAINT_ZONE || ringOf(i) <= PAINT_NEAR)) {
      for (const i of corners) paint.push(uvs[i * 2]!, uvs[i * 2 + 1]!, PAINT_RINGS[ringOf(i)] ?? 0)
    }
    const front = corners.every(
      (i) => normals[i * 3 + 2]! >= FOREHEAD_FACING && points[i * 3 + 1]! >= eyeLevel,
    )
    if (!front) continue
    const read = corners.flatMap((i) => [uvs[i * 2]!, uvs[i * 2 + 1]!])
    if (corners.every((i) => ringOf(i) >= 1 && ringOf(i) <= PAINT_RINGS.length)) {
      nearCut.push(...read)
      if (corners.every((i) => ringOf(i) <= PAINT_NEAR)) {
        const x = corners.reduce((sum, i) => sum + points[i * 3]!, 0) / 3
        if (Math.abs(x - middle) < swatchAside) {
          swatchAside = Math.abs(x - middle)
          swatch = [
            read[0]! / 3 + read[2]! / 3 + read[4]! / 3,
            read[1]! / 3 + read[3]! / 3 + read[5]! / 3,
          ]
        }
      }
    } else if (corners.every((i) => zone[i]! < FACE_ZONE)) {
      forehead.push(...read)
    }
  }
  if (!swatch) {
    const list = nearCut.length > 0 ? nearCut : forehead
    swatch =
      list.length > 0
        ? [(list[0]! + list[2]! + list[4]!) / 3, (list[1]! + list[3]! + list[5]!) / 3]
        : [0, 0]
  }
  return {
    paint: Float32Array.from(paint),
    tone: [Float32Array.from(nearCut), Float32Array.from(forehead)],
    swatch,
  }
}
