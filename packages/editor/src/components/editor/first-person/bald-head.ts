import { rasterise } from './front-render'
import { PointGrid, SKULL_CELL, type Skull, smoothstep, type Triples } from './head-skull'

/**
 * A character wearing any hair but its own is made bald first, cleanly:
 * its head's own hair — the triangles of its head mesh the hair's volume
 * is sculpted into, or painted onto over the cranium — is taken out, and
 * the hole closed with a real bald cranium on the skull every head shares
 * (see hair-styles.ts), fitted to its face and its own cranium (see
 * head-skull.ts's `craniumFit`) and bent to meet the skin it keeps. Its
 * face, ears and neck stay its own; the skin round the cut is painted to
 * the scalp's tone (see scalp-paint.ts), and another's hair goes on over
 * it all like a wig.
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

/**
 * Kept skin standing this far over the skull, no lower than RIM_BELOW under
 * the eyes and not an ear, is the rim of gear the head mesh models — a
 * cap's brim, a visor's edge — that the hair's cut left standing off the
 * bald head.
 */
const RIM_STANDING = 0.012
const RIM_BELOW = 0.02

/** How many rounds kept triangles wholly on the cut are taken in (see `withRimTaken`). */
const ISLAND_ROUNDS = 2

/**
 * A piece of what was taken apart from the rest (smaller than PIECE of the
 * largest), wholly under the top of the neck but reaching up within
 * NECK_TOP of it, and lying on the neck (standing less than LYING over the
 * skull), is the neck's own skin — painted with the hair's shadow, or a
 * fuller neck than the skull's — not hair hanging down it: it is kept
 * (painted over: see scalp-paint.ts). Closed with the bald surface, it
 * would be a patch of another shade, at the back of the neck across the
 * texture's seam.
 */
const NECK_TOP = 0.05
const LYING = 0.025

/**
 * `taken` with the rim of any gear modelled in the head (see RIM_STANDING)
 * taken too, the skin left between the hair taken (every corner on the
 * cut), and what that leaves of the head in small pieces beside it.
 * `height` is how far each point stands over the skull fitted to the head.
 */
export function cleanCut(
  head: Pick<OwnHead, 'points' | 'index' | 'spots' | 'spotCount' | 'height'>,
  taken: ArrayLike<number>,
  marks: HeadMarks,
): Uint8Array {
  const { points, index, spots, height } = head
  const count = index.length / 3
  const out = Uint8Array.from(taken)
  {
    const pieces = piecesOf(index, spots, head.spotCount, (t) => out[t] === 1)
    const lying = new Map<number, boolean>()
    const reaches = new Set<number>()
    for (let t = 0; t < count; t++) {
      if (!out[t]) continue
      const piece = pieces.piece(t)
      const corners = [0, 1, 2].map((k) => index[t * 3 + k]!)
      const low = corners.every((i) => points[i * 3 + 1]! < marks.neck && height[i]! < LYING)
      lying.set(piece, (lying.get(piece) ?? true) && low)
      if (corners.some((i) => points[i * 3 + 1]! > marks.neck - NECK_TOP)) reaches.add(piece)
    }
    for (let t = 0; t < count; t++) {
      const piece = out[t] ? pieces.piece(t) : -1
      if (lying.get(piece) && reaches.has(piece) && pieces.size(t) < PIECE * pieces.largest) {
        out[t] = 0
      }
    }
  }
  const eyeLevel = marks.eyes.reduce((sum, eye) => sum + eye[1]!, 0) / marks.eyes.length
  const middle = marks.eyes.reduce((sum, eye) => sum + eye[0]!, 0) / marks.eyes.length
  const eyeFront = Math.max(...marks.eyes.map((eye) => eye[2]!))
  const rim = (i: number) =>
    height[i]! > RIM_STANDING &&
    points[i * 3 + 1]! > eyeLevel - RIM_BELOW &&
    !(Math.abs(points[i * 3]! - middle) > EAR_SIDE && points[i * 3 + 2]! < eyeFront - EAR_BACK)
  const added = new Uint8Array(head.spotCount)
  let any = false
  for (let t = 0; t < count; t++) {
    if (out[t] || ![0, 1, 2].some((k) => rim(index[t * 3 + k]!))) continue
    out[t] = 1
    any = true
    for (let k = 0; k < 3; k++) added[spots[index[t * 3 + k]!]!] = 1
  }
  // Skin the hair's flood left in between the hair it took — a sideburn
  // taken square by square — is taken too: kept, it would stand as islands
  // of the head's own skin in the scalp.
  for (let round = 0; round < ISLAND_ROUNDS; round++) {
    const onCut = new Uint8Array(head.spotCount)
    for (let t = 0; t < count; t++) {
      if (out[t]) for (let k = 0; k < 3; k++) onCut[spots[index[t * 3 + k]!]!] = 1
    }
    let grew = false
    for (let t = 0; t < count; t++) {
      if (out[t] || ![0, 1, 2].every((k) => onCut[spots[index[t * 3 + k]!]!])) continue
      out[t] = 1
      grew = any = true
      for (let k = 0; k < 3; k++) added[spots[index[t * 3 + k]!]!] = 1
    }
    if (!grew) break
  }
  if (!any) return out
  const kept = piecesOf(index, spots, head.spotCount, (t) => out[t] === 0)
  const beside = new Set<number>()
  for (let t = 0; t < count; t++) {
    if (!out[t] && [0, 1, 2].some((k) => added[spots[index[t * 3 + k]!]!]))
      beside.add(kept.piece(t))
  }
  for (let t = 0; t < count; t++) {
    if (!out[t] && beside.has(kept.piece(t)) && kept.size(t) < PIECE * kept.largest) out[t] = 1
  }
  return out
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
 * The bald surface's neck is fitted to a head's by its kept points from
 * NECK_UNDER under the top of the neck to NECK_READ over it, each matched
 * to the surface's points in the same slice (NECK_SLICE tall). Its axis is
 * the middle of the surface's neck from NECK_UNDER to NECK_AXIS under the
 * top. It is fitted fully from NECK_LOW under the top, fading out to the
 * surface's own shape NECK_RISE over it — up under the occiput, so the
 * skull's man's neck narrows to a woman's or a child's along a long, even
 * curve, not in a fold where they meet.
 */
const NECK_SLICE = 0.01
const NECK_UNDER = 0.05
const NECK_READ = 0.03
const NECK_AXIS = 0.02
const NECK_LOW = 0.03
const NECK_RISE = 0.06

/**
 * A kept point fits the neck at the surface's point round its slice
 * nearest it in angle, no further round than this (radians), and only where
 * the two are this alike (a collar, a chin are not the neck); the neck is
 * fitted by FEWEST_FITTING of them at least.
 */
const NECK_ANGLE = 0.4
const NECK_LIKE: readonly [number, number] = [0.6, 1.4]
const FEWEST_FITTING = 6

/**
 * Round the neck from its back to its sides the surface is fitted; in
 * front, turned from the neck's axis to the front by more than this (the
 * cosine of the angle off straight back, NECK_FRONT[0] to [1]), it fades
 * out: the jaw and the throat are the head's own skin.
 */
const NECK_FRONT: readonly [number, number] = [0.2, 0.7]

/**
 * The bald surface (`points`, the skull fitted to a head with the piece
 * hung below its neck) with its neck made as thick as the head's — its
 * kept points `anchors`, the top of its neck at height `neck` — scaled
 * towards the neck's axis by the middle ratio of the kept points' distance
 * from it to the surface's at their angle: a woman's or a child's neck is
 * thinner than the skull's man's, and under long hair there is none of its
 * own to bend the surface to. One ratio for all the neck: read slice by
 * slice, a few points each, it would ripple.
 */
export function neckFitted(points: Triples, anchors: Triples, neck: number): Float32Array {
  const count = points.length / 3
  const out = Float32Array.from(points)
  const low = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const high = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  const sliceOf = (y: number) => Math.round(y / NECK_SLICE)
  const slices = new Map<number, number[]>()
  for (let i = 0; i < count; i++) {
    const y = points[i * 3 + 1]!
    if (y < neck - NECK_UNDER || y > neck + NECK_READ) continue
    const slice = slices.get(sliceOf(y)) ?? []
    slice.push(i)
    slices.set(sliceOf(y), slice)
    if (y > neck - NECK_AXIS) continue
    for (const [k, axis] of [0, 2].entries()) {
      low[k] = Math.min(low[k]!, points[i * 3 + axis]!)
      high[k] = Math.max(high[k]!, points[i * 3 + axis]!)
    }
  }
  if (!(low[0]! < high[0]!)) return out
  const middle = [(low[0]! + high[0]!) / 2, (low[1]! + high[1]!) / 2]
  const round = (x: number, z: number) => Math.atan2(x - middle[0]!, z - middle[1]!)
  const ratios: number[] = []
  for (let j = 0; j < anchors.length / 3; j++) {
    const slice = slices.get(sliceOf(anchors[j * 3 + 1]!))
    if (!slice) continue
    const angle = round(anchors[j * 3]!, anchors[j * 3 + 2]!)
    let nearest = NECK_ANGLE
    let radius = 0
    for (const i of slice) {
      let apart = Math.abs(round(points[i * 3]!, points[i * 3 + 2]!) - angle)
      if (apart > Math.PI) apart = 2 * Math.PI - apart
      if (apart < nearest) {
        nearest = apart
        radius = Math.hypot(points[i * 3]! - middle[0]!, points[i * 3 + 2]! - middle[1]!)
      }
    }
    const ratio =
      radius > 0
        ? Math.hypot(anchors[j * 3]! - middle[0]!, anchors[j * 3 + 2]! - middle[1]!) / radius
        : 0
    if (ratio >= NECK_LIKE[0] && ratio <= NECK_LIKE[1]) ratios.push(ratio)
  }
  if (ratios.length < FEWEST_FITTING) return out
  const scale = ratios.sort((a, b) => a - b)[ratios.length >> 1]!
  for (let i = 0; i < count; i++) {
    const y = points[i * 3 + 1]!
    if (y >= neck + NECK_RISE) continue
    const x = points[i * 3]! - middle[0]!
    const z = points[i * 3 + 2]! - middle[1]!
    const back = 1 - smoothstep(NECK_FRONT[0], NECK_FRONT[1], z / (Math.hypot(x, z) || 1))
    const k = 1 + (scale - 1) * (1 - smoothstep(neck - NECK_LOW, neck + NECK_RISE, y)) * back
    out[i * 3] = middle[0]! + x * k
    out[i * 3 + 2] = middle[1]! + z * k
  }
  return out
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
 * man's shape fits a head worst), between the two zones — and under the
 * occiput, from BEND_NAPE over the top of the neck down: faded there, the
 * nape would stand off the kept neck under it in a ledge along the cut.
 */
const BEND_KEPT = 0.9
const BEND_FACE_ZONE = 0.03
const BEND_CRANIUM_ZONE = 0.15
const BEND_NAPE: readonly [number, number] = [0.02, 0.05]

/**
 * How far under the head's skin the bald surface lies where it meets it
 * (tucked under the cut's edge), and elsewhere.
 */
const UNDER_SKIN = 0.0008
const SINK = 0.0006

/**
 * The fitted skull (`skull`, its `triangles`) bent to meet a head's kept
 * skin (`anchors`, its points; the top of its neck at height `neck`): each
 * skull point beside the skin goes to it, and the rest as far as those
 * round them, the bend fading back to the skull over the cranium (see
 * BEND_*); all of it a little under the skin.
 */
export function bentSkull(
  skull: Skull,
  triangles: ArrayLike<number>,
  anchors: Triples,
  neck: number,
) {
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
  const keep = Float32Array.from({ length: count }, (_, i) => {
    const cranium =
      smoothstep(BEND_FACE_ZONE, BEND_CRANIUM_ZONE, skull.zone[i]!) *
      smoothstep(neck + BEND_NAPE[0], neck + BEND_NAPE[1], skull.points[i * 3 + 1]!)
    return 1 - (1 - BEND_KEPT) * cranium
  })
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
 * The band round the top of the neck (bind units over and under it) and
 * behind its middle where the bald surface is faired: the skull's head
 * mesh ends under the occiput in a lip, the piece hung below it meets it in
 * a ridge, and the neck narrowed to the head's and bent to its skin folds
 * there.
 */
const NAPE_BAND = 0.07
const NAPE_FRONT = 0.04
/**
 * Fairing takes out what bends unevenly — a fold, a ridge, a step — and
 * leaves an even curve be, the neck's round or the occiput's: each round
 * moves a point against the change in how its neighbours bend round it (its
 * Laplacian's), by FAIR_STEP of it (under a half, or it would not settle).
 */
const FAIR_ROUNDS = 80
const FAIR_STEP = 0.25

/**
 * Fairs the bald surface (`points`, in place; its `triangles`) round the
 * nape (see NAPE_BAND), but where it meets kept skin (`known`): the top of
 * the neck at height `neck`, its middle at depth `nape`.
 */
export function smoothNape(
  points: Float32Array,
  triangles: ArrayLike<number>,
  known: Uint8Array,
  neck: number,
  nape: number,
) {
  const count = points.length / 3
  const neighbours = neighboursOf(triangles, count)
  const weight = Float32Array.from({ length: count }, (_, i) =>
    known[i]
      ? 0
      : (1 - smoothstep(NAPE_BAND / 2, NAPE_BAND, Math.abs(points[i * 3 + 1]! - neck))) *
        (1 - smoothstep(nape, nape + NAPE_FRONT, points[i * 3 + 2]!)),
  )
  const laplacian = (of: Float32Array, out: Float32Array) => {
    for (let i = 0; i < count; i++) {
      const around = neighbours[i]!
      for (let axis = 0; axis < 3; axis++) {
        let mean = 0
        for (const j of around) mean += of[j * 3 + axis]!
        out[i * 3 + axis] = around.length > 0 ? mean / around.length - of[i * 3 + axis]! : 0
      }
    }
  }
  const bend = new Float32Array(points.length)
  const change = new Float32Array(points.length)
  for (let round = 0; round < FAIR_ROUNDS; round++) {
    laplacian(points, bend)
    laplacian(bend, change)
    for (let i = 0; i < count; i++) {
      for (let axis = 0; axis < 3; axis++) {
        points[i * 3 + axis]! -= FAIR_STEP * weight[i]! * change[i * 3 + axis]!
      }
    }
  }
}

/**
 * How far below its open bottom the skull's neck is hung at the back, and
 * how far in: the skull's head ends under the occiput, where a long-haired
 * head's neck was its hair.
 */
const NECK_PIECE = 0.08
const NECK_PIECE_IN = 0.004

/** The piece hung below the neck is this many rings tall, for the kept skin to bend it to (see `bentSkull`). */
const NECK_RINGS = 4

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
  const hung = new Map<string, number>()
  const hang = (i: number, ring: number) => {
    if (ring === 0) return i
    let low = hung.get(`${i},${ring}`)
    if (low === undefined) {
      low = points.length / 3
      const [ox, oz] = outward(i)
      points.push(
        surface.points[i * 3]! - ox * NECK_PIECE_IN,
        surface.points[i * 3 + 1]! - (NECK_PIECE * ring) / NECK_RINGS,
        surface.points[i * 3 + 2]! - oz * NECK_PIECE_IN,
      )
      normals.push(ox, 0, oz)
      zone.push(surface.zone[i]!)
      hung.set(`${i},${ring}`, low)
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
    for (let ring = 1; ring <= NECK_RINGS; ring++) {
      const [a, b] = [hang(from, ring - 1), hang(to, ring - 1)]
      const [c, d] = [hang(from, ring), hang(to, ring)]
      index.push(b, a, c, b, c, d)
    }
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

/** The eyeballs' middles (bind pose), each [x, y, z], and the top of the neck: its height and its middle's depth. */
export type HeadMarks = { eyes: number[][]; neck: number; nape: number }

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

/** Whether a place (bind pose) is where an ear is (see EAR_SIDE), on a head marked `marks`. */
export function nearEar(x: number, y: number, z: number, marks: HeadMarks) {
  const eyeLevel = marks.eyes.reduce((sum, eye) => sum + eye[1]!, 0) / marks.eyes.length
  const middle = marks.eyes.reduce((sum, eye) => sum + eye[0]!, 0) / marks.eyes.length
  const eyeFront = Math.max(...marks.eyes.map((eye) => eye[2]!))
  return (
    Math.abs(x - middle) > EAR_SIDE &&
    y > marks.neck - NECK_BAND &&
    y < eyeLevel + EAR_TOP &&
    z < eyeFront - EAR_BACK
  )
}

/** How far under the top of the neck (bind units) the bald surface keeps behind the neck's middle. */
const LOW_NECK = 0.04

/**
 * A patch of bald surface this much smaller than the largest is a stray,
 * but one of the neck's piece of NECK_PATCH triangles or more: under long
 * hair the nape may be closed apart from the cranium.
 */
const STRAY = 0.1
const NECK_PATCH = 12

/**
 * Which triangles of the bald surface close the head over what was taken
 * out: all not hidden by its kept skin (see COVER), its face, its throat
 * or an ear of its own — and a ring round those, tucked under the cut's
 * edge — but for strays. What of it lies under the kept skin shows as that
 * skin does (see `underKept`): a hole where the two part would show.
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
  const centreGrid = new PointGrid(centres, SKULL_CELL)
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
  // Low down the neck, in front of its middle: the body's neck and
  // shoulders, never hair.
  const lowFront = (t: number) =>
    [0, 1, 2].every((k) => {
      const i = triangles[t * 3 + k]!
      return points[i * 3 + 1]! < marks.neck - LOW_NECK && points[i * 3 + 2]! > marks.nape
    })
  const open = new Uint8Array(points.length / 3)
  for (let t = 0; t < count; t++) {
    const face = [0, 1, 2].every((k) => faceAt(triangles[t * 3 + k]!))
    if (face || throat(t) || skullEar(t) || covered(t)) continue
    for (let k = 0; k < 3; k++) open[triangles[t * 3 + k]!] = 1
  }
  // The ring tucked under the cut's edge, but not on the throat: down the
  // front of the neck it would stand out of the kept skin there.
  const chosen: number[] = []
  for (let t = 0; t < count; t++) {
    if ([0, 1, 2].some((k) => open[triangles[t * 3 + k]!]) && !throat(t) && !lowFront(t)) {
      chosen.push(t)
    }
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
      (sizes.get(find(triangles[t * 3]!))! >= NECK_PATCH &&
        [0, 1, 2].some((k) => triangles[t * 3 + k]! >= bald.neckFrom)),
  )
}

/**
 * How far round a point (bind units) its hollow is read, from at most this
 * many points, and how much darker the deepest hollow is: the bald surface
 * is painted plain skin, so the folds of an ear and the crease behind it
 * are shaded by their shape alone.
 */
const HOLLOW_REACH = 0.012
const HOLLOW_POINTS = 24
const HOLLOW_DARK = 0.55

/** Points nearer than this (bind units) are no hollow: the skin the bald surface is tucked under at the cut. */
const HOLLOW_SKIP = 0.004

/**
 * Per point of `points` (normals `normals`), how much light reaches it as
 * the shape round it hollows (1 open or rounded, less in a fold): the mean
 * rise of the `around` points near it out of its tangent plane.
 */
export function hollowShade(
  points: Triples,
  normals: Triples,
  around: { points: Triples; grid: PointGrid },
): Float32Array {
  const count = points.length / 3
  const shade = new Float32Array(count)
  const found: number[] = []
  const distances: number[] = []
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]
    const n = around.grid.nearest(x, y, z, HOLLOW_POINTS, found, distances, HOLLOW_REACH)
    let rise = 0
    let used = 0
    for (let k = 0; k < n; k++) {
      const distance = Math.sqrt(distances[k]!)
      if (distance <= HOLLOW_SKIP || distance > HOLLOW_REACH) continue
      const j = found[k]!
      const along =
        (around.points[j * 3]! - x) * normals[i * 3]! +
        (around.points[j * 3 + 1]! - y) * normals[i * 3 + 1]! +
        (around.points[j * 3 + 2]! - z) * normals[i * 3 + 2]!
      rise += Math.max(0, along / distance)
      used++
    }
    shade[i] = 1 - HOLLOW_DARK * (used > 0 ? rise / used : 0)
  }
  return shade
}

/** Where on triangle a, b, c (corner offsets ×3 into `points`) a point's nearest place is, as weights of its corners. */
function nearestOnTriangle(p: readonly number[], points: Triples, a: number, b: number, c: number) {
  const sub = (from: number, x: number, y: number, z: number) => [
    x - points[from]!,
    y - points[from + 1]!,
    z - points[from + 2]!,
  ]
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!
  const ab = sub(a, points[b]!, points[b + 1]!, points[b + 2]!)
  const ac = sub(a, points[c]!, points[c + 1]!, points[c + 2]!)
  const ap = sub(a, p[0]!, p[1]!, p[2]!)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0] as const
  const bp = sub(b, p[0]!, p[1]!, p[2]!)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0] as const
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return [1 - v, v, 0] as const
  }
  const cp = sub(c, p[0]!, p[1]!, p[2]!)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1] as const
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return [1 - w, 0, w] as const
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return [0, 1 - w, w] as const
  }
  const v = vb / (va + vb + vc)
  const w = vc / (va + vb + vc)
  return [1 - v - w, v, w] as const
}

/** A point's weights of triangle a, b, c's corners in its plane (any sign: outside it, some are negative). */
function weightsInPlane(p: readonly number[], points: Triples, a: number, b: number, c: number) {
  const e = [0, 1, 2].map((axis) => points[b + axis]! - points[a + axis]!)
  const f = [0, 1, 2].map((axis) => points[c + axis]! - points[a + axis]!)
  const g = [0, 1, 2].map((axis) => p[axis]! - points[a + axis]!)
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!
  const ee = dot(e, e)
  const ef = dot(e, f)
  const ff = dot(f, f)
  const ge = dot(g, e)
  const gf = dot(g, f)
  const denominator = ee * ff - ef * ef
  if (Math.abs(denominator) < 1e-18) return [1 / 3, 1 / 3, 1 / 3]
  const v = (ff * ge - ef * gf) / denominator
  const w = (ee * gf - ef * ge) / denominator
  return [1 - v - w, v, w]
}

/** How many of the head's triangles nearest (by their middles) a point of the bald surface are tried for its place on the texture. */
const UV_TRIED = 16

/**
 * A triangle of the bald surface whose corners lie on the texture further
 * apart than TEAR times as far as its triangles' do for their size spans
 * a seam of it; its corners are placed by one triangle, as far outside it
 * as EXTRAPOLATE of its corners' weights.
 */
const TEAR = 3
const EXTRAPOLATE = 0.5

/**
 * The bald surface on the head's texture: each point at its nearest place
 * on the hair taken out (`source`, its points, texture coordinates and the
 * triangles taken), so the scalp shows the texels the hair did — painted
 * the scalp's (see scalp-paint.ts) — and meets the kept skin's texels at
 * the cut. A triangle that would span a seam of the texture gets corners
 * of its own (see TEAR). Returns which point of the surface each point is
 * (`from`), the points' texture coordinates and the triangles. Points
 * whose place is `fixed` (`has`) keep it: the bald surface under kept
 * skin shows that skin's texels.
 */
export function scalpUvs(
  points: Triples,
  triangles: ArrayLike<number>,
  source: { points: Triples; uvs: Triples; index: ArrayLike<number>; triangles: readonly number[] },
  fixed?: { uvs: Triples; has: ArrayLike<number> },
) {
  const count = points.length / 3
  const middles = new Float32Array(source.triangles.length * 3)
  source.triangles.forEach((t, j) => {
    for (let k = 0; k < 3; k++) {
      for (let axis = 0; axis < 3; axis++) {
        middles[j * 3 + axis]! += source.points[source.index[t * 3 + k]! * 3 + axis]! / 3
      }
    }
  })
  const grid = new PointGrid(middles, SKULL_CELL)
  const found: number[] = []
  const distances: number[] = []
  const corner = (t: number, k: number) => source.index[t * 3 + k]! * 3
  /** The source triangle nearest a place, and the weights of its corners there. */
  const nearestSource = (p: number[]) => {
    const tried = grid.nearest(p[0]!, p[1]!, p[2]!, UV_TRIED, found, distances)
    let best = -1
    let bestWeights: readonly number[] = [1, 0, 0]
    let bestDistance = Number.POSITIVE_INFINITY
    for (let j = 0; j < tried; j++) {
      const t = source.triangles[found[j]!]!
      const weights = nearestOnTriangle(p, source.points, corner(t, 0), corner(t, 1), corner(t, 2))
      let distance = 0
      for (let axis = 0; axis < 3; axis++) {
        let at = 0
        for (let k = 0; k < 3; k++) at += weights[k]! * source.points[corner(t, k) + axis]!
        distance += (at - p[axis]!) ** 2
      }
      if (distance < bestDistance) {
        bestDistance = distance
        best = t
        bestWeights = weights
      }
    }
    return { t: best, weights: bestWeights }
  }
  const uvAt = (t: number, weights: readonly number[], out: number[]) => {
    out[0] = 0
    out[1] = 0
    for (let k = 0; k < 3; k++) {
      const i = source.index[t * 3 + k]!
      out[0]! += weights[k]! * source.uvs[i * 2]!
      out[1]! += weights[k]! * source.uvs[i * 2 + 1]!
    }
  }
  const uvs: number[] = []
  const at = [0, 0]
  for (let i = 0; i < count; i++) {
    if (fixed?.has[i]) {
      uvs.push(fixed.uvs[i * 2]!, fixed.uvs[i * 2 + 1]!)
      continue
    }
    const { t, weights } = nearestSource([points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!])
    if (t < 0) uvs.push(0, 0)
    else {
      uvAt(t, weights, at)
      uvs.push(at[0]!, at[1]!)
    }
  }
  // The texture's span for a length on the head, over the hair taken out.
  const ratios = source.triangles.map((t) => {
    const [a, b] = [source.index[t * 3]!, source.index[t * 3 + 1]!]
    const length = Math.hypot(
      source.points[a * 3]! - source.points[b * 3]!,
      source.points[a * 3 + 1]! - source.points[b * 3 + 1]!,
      source.points[a * 3 + 2]! - source.points[b * 3 + 2]!,
    )
    const span = Math.hypot(
      source.uvs[a * 2]! - source.uvs[b * 2]!,
      source.uvs[a * 2 + 1]! - source.uvs[b * 2 + 1]!,
    )
    return length > 0 ? span / length : 0
  })
  ratios.sort((a, b) => a - b)
  const ratio = ratios[ratios.length >> 1] ?? 0
  const from = Array.from({ length: count }, (_, i) => i)
  const out = Array.from(triangles)
  for (let t = 0; t < out.length / 3; t++) {
    const ids = [out[t * 3]!, out[t * 3 + 1]!, out[t * 3 + 2]!]
    const torn = [0, 1, 2].some((k) => {
      const [a, b] = [ids[k]!, ids[(k + 1) % 3]!]
      const length = Math.hypot(
        points[a * 3]! - points[b * 3]!,
        points[a * 3 + 1]! - points[b * 3 + 1]!,
        points[a * 3 + 2]! - points[b * 3 + 2]!,
      )
      const span = Math.hypot(uvs[a * 2]! - uvs[b * 2]!, uvs[a * 2 + 1]! - uvs[b * 2 + 1]!)
      return span > TEAR * ratio * length
    })
    if (!torn) continue
    const middle = [0, 1, 2].map(
      (axis) =>
        (points[ids[0]! * 3 + axis]! + points[ids[1]! * 3 + axis]! + points[ids[2]! * 3 + axis]!) /
        3,
    )
    const { t: by } = nearestSource(middle)
    if (by < 0) continue
    for (let k = 0; k < 3; k++) {
      const i = ids[k]!
      const weights = weightsInPlane(
        [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!],
        source.points,
        corner(by, 0),
        corner(by, 1),
        corner(by, 2),
      ).map((w) => Math.max(w, -EXTRAPOLATE))
      const sum = weights[0]! + weights[1]! + weights[2]!
      uvAt(
        by,
        weights.map((w) => w / sum),
        at,
      )
      out[t * 3 + k] = from.length
      from.push(i)
      uvs.push(at[0]!, at[1]!)
    }
  }
  return {
    from: Int32Array.from(from),
    uvs: Float32Array.from(uvs),
    triangles: Uint32Array.from(out),
  }
}

/**
 * A point of the bald surface lies under the skin the head keeps where it
 * is within UNDER_REACH (bind units) of one of its triangles along its
 * normal, its place in that triangle's plane inside it (no further out of
 * it than WITHIN of its corners' weights: a point under the edge between
 * two lies in both), the two turned alike (SAME_WAY). The UNDER_TRIED
 * kept triangles nearest it (by their middles) are tried.
 */
const UNDER_REACH = 0.02
const WITHIN = 0.02
const UNDER_TRIED = 12

/**
 * Which points of the bald surface (`points`, `normals`) lie under the
 * skin the head keeps (`kept`, its triangles `index`) — round the cut, the
 * ring tucked under its edge; down the neck, the piece hung below the
 * skull — and where: per point the kept triangle over it (−1 for none),
 * the weights of its corners there, and the point's height over it along
 * its normal (negative under it) and that normal. Where the bald surface
 * shows through the skin there, it shows as that skin does (see
 * avatar-hair.ts's `makeBald`).
 */
export function underKept(points: Triples, normals: Triples, kept: KeptHead) {
  const count = points.length / 3
  const keptCount = kept.index.length / 3
  const middles = new Float32Array(keptCount * 3)
  const faces = new Float32Array(keptCount * 3)
  for (let t = 0; t < keptCount; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => kept.index[t * 3 + k]! * 3)
    const e = [0, 1, 2].map((axis) => kept.points[b! + axis]! - kept.points[a! + axis]!)
    const f = [0, 1, 2].map((axis) => kept.points[c! + axis]! - kept.points[a! + axis]!)
    const n = [
      e[1]! * f[2]! - e[2]! * f[1]!,
      e[2]! * f[0]! - e[0]! * f[2]!,
      e[0]! * f[1]! - e[1]! * f[0]!,
    ]
    let own = 0
    for (let axis = 0; axis < 3; axis++) {
      middles[t * 3 + axis] =
        (kept.points[a! + axis]! + kept.points[b! + axis]! + kept.points[c! + axis]!) / 3
      own +=
        n[axis]! * (kept.normals[a! + axis]! + kept.normals[b! + axis]! + kept.normals[c! + axis]!)
    }
    const length = (own < 0 ? -1 : 1) * (Math.hypot(n[0]!, n[1]!, n[2]!) || 1)
    for (let axis = 0; axis < 3; axis++) faces[t * 3 + axis] = n[axis]! / length
  }
  const grid = new PointGrid(middles, SKULL_CELL)
  const found: number[] = []
  const distances: number[] = []
  const triangle = new Int32Array(count).fill(-1)
  const weights = new Float32Array(count * 3)
  const height = new Float32Array(count)
  const normal = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const p = [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]
    const near = grid.nearest(p[0]!, p[1]!, p[2]!, UNDER_TRIED, found, distances, 2 * UNDER_REACH)
    let best = Number.POSITIVE_INFINITY
    for (let j = 0; j < near; j++) {
      const t = found[j]!
      const facing =
        faces[t * 3]! * normals[i * 3]! +
        faces[t * 3 + 1]! * normals[i * 3 + 1]! +
        faces[t * 3 + 2]! * normals[i * 3 + 2]!
      if (facing < SAME_WAY) continue
      const [a, b, c] = [0, 1, 2].map((k) => kept.index[t * 3 + k]! * 3)
      const w = weightsInPlane(p, kept.points, a!, b!, c!)
      if (Math.min(w[0]!, w[1]!, w[2]!) < -WITHIN) continue
      const over =
        (p[0]! - kept.points[a!]!) * faces[t * 3]! +
        (p[1]! - kept.points[a! + 1]!) * faces[t * 3 + 1]! +
        (p[2]! - kept.points[a! + 2]!) * faces[t * 3 + 2]!
      if (Math.abs(over) > UNDER_REACH || Math.abs(over) >= best) continue
      best = Math.abs(over)
      triangle[i] = t
      const clamped = w.map((value) => Math.max(0, value))
      const sum = clamped[0]! + clamped[1]! + clamped[2]! || 1
      for (let k = 0; k < 3; k++) weights[i * 3 + k] = clamped[k]! / sum
      height[i] = over
      normal.set(faces.subarray(t * 3, t * 3 + 3), i * 3)
    }
  }
  return { triangle, weights, height, normal }
}

/** How many rounds at most skin weights are spread over the bald surface from where they are known, and the change a round under which they have settled. */
const SPREAD_ROUNDS = 120
const SETTLED = 1e-3

/**
 * Skin weights for a surface of `count` points (`triangles`): where they
 * are `known` (per point, bone and weight pairs, or null), those; the rest
 * spread from them along the surface, each point the mean of its
 * neighbours, so nothing is bound otherwise than what is round it.
 * Points nothing known reaches are `fallback`'s alone. Returns the
 * `influences` heaviest bones per point, their weights summing to one.
 */
export function spreadWeights(
  count: number,
  triangles: ArrayLike<number>,
  known: readonly (readonly (readonly [number, number])[] | null)[],
  fallback: number,
  influences = 4,
) {
  const bones = new Map<number, number>([[fallback, 0]])
  for (const pairs of known)
    for (const [bone] of pairs ?? []) if (!bones.has(bone)) bones.set(bone, bones.size)
  const size = bones.size
  const values = new Float32Array(count * size)
  const fixed = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const pairs = known[i]
    if (!pairs || pairs.length === 0) {
      values[i * size] = 1
      continue
    }
    fixed[i] = 1
    for (const [bone, weight] of pairs) values[i * size + bones.get(bone)!]! += weight
  }
  // Neighbours flat, and each point averaged in place over them (its
  // neighbours' new weights already, where they come first): it settles in
  // a few dozen rounds.
  const neighbours = neighboursOf(triangles, count)
  const start = new Int32Array(count + 1)
  for (let i = 0; i < count; i++) start[i + 1] = start[i]! + neighbours[i]!.length
  const around = Int32Array.from(neighbours.flat())
  const free = Int32Array.from(
    Array.from({ length: count }, (_, i) => i).filter(
      (i) => !fixed[i] && start[i + 1]! > start[i]!,
    ),
  )
  for (let round = 0; fixed.includes(1) && round < SPREAD_ROUNDS; round++) {
    let most = 0
    for (const i of free) {
      const n = start[i + 1]! - start[i]!
      for (let b = 0; b < size; b++) {
        let sum = 0
        for (let k = start[i]!; k < start[i + 1]!; k++) sum += values[around[k]! * size + b]!
        const value = sum / n
        most = Math.max(most, Math.abs(value - values[i * size + b]!))
        values[i * size + b] = value
      }
    }
    if (most < SETTLED) break
  }
  const names = [...bones.keys()]
  const index = new Uint16Array(count * influences)
  const weight = new Float32Array(count * influences)
  const order = Array.from({ length: size }, (_, b) => b)
  for (let i = 0; i < count; i++) {
    order.sort((a, b) => values[i * size + b]! - values[i * size + a]!)
    let total = 0
    for (let k = 0; k < Math.min(influences, size); k++) total += values[i * size + order[k]!]!
    for (let k = 0; k < Math.min(influences, size); k++) {
      index[i * influences + k] = names[order[k]!]!
      weight[i * influences + k] =
        total > 0 ? values[i * size + order[k]!]! / total : k === 0 ? 1 : 0
    }
  }
  return { index, weight }
}

/** How far (bind units) from the top of the neck a body's open neckline is closed. */
const NECKLINE_REACH = 0.2

/** Points of a body this near (bind units) are at one spot (a texture seam splits them). */
const BODY_SPOT = 1e-4

/** A neckline's open back this uneven (bind units, top to bottom) is a neckline still; this, a notch long hair hid. */
const NECKLINE_EVEN = 0.02
const NOTCH = 0.05

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
  let back = 0
  let top = Number.NEGATIVE_INFINITY
  let bottom = Number.POSITIVE_INFINITY
  for (const { from, to } of open) {
    for (const spot of [from, to]) {
      if (used.has(spot)) continue
      used.set(spot, used.size + 1)
      low += at(spot, 1)
      back += at(spot, 2)
      top = Math.max(top, at(spot, 1))
      bottom = Math.min(bottom, at(spot, 1))
    }
  }
  if (open.length === 0) {
    return { points: new Float32Array(), body: new Int32Array(), triangles: [] as number[] }
  }
  // A notch is closed level with the back round it, so what hangs down the
  // neck goes in under it; a neckline only a little uneven, from inside the
  // neck, where it is hidden.
  const notch = smoothstep(NECKLINE_EVEN, NOTCH, top - bottom)
  const middle = [neck[0]!, low / used.size, neck[2]! + (back / used.size - neck[2]!) * notch]
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

/** How many rings of skin out from the cut the forehead's tone is read within. */
export const TONE_RINGS = 5

/**
 * Kept skin within FULL (bind units) of the cut is painted wholly to the
 * scalp's colour, fading out to none at FEATHER: by how far it is, not how
 * many triangles, so the paint's edge follows no triangle's.
 */
const FULL = 0.012
const FEATHER = 0.045

/**
 * On the face, the paint fades out by FACE_FEATHER instead, takes none of
 * the hair's colour left on the skin (brows, a beard, lashes), and none of
 * it reaches below BROWS over the eyes.
 */
const FACE_FEATHER = 0.025
const BROWS = 0.035

/**
 * The scalp's colour is the skin's round it — the cheek's by a cheek, the
 * neck's down the nape — read off the head before it is painted, at least
 * SKIN_OFF_CUT (bind units) from the cut (clear of a hairline's stubble):
 * wholly within LOCAL_NEAR of that skin, fading to the scalp's one tone
 * (read off the forehead) at LOCAL_FAR, over the crown.
 */
const SKIN_OFF_CUT = 0.012
const LOCAL_NEAR = 0.02
const LOCAL_FAR = 0.08

/** Over the skull's hair zone from here, the hair's colour left on the skin is painted over too. */
const PAINT_ZONE = 0.02

/** Skin facing the front this squarely is the forehead the scalp's tone is read from. */
const FOREHEAD_FACING = 0.4

/**
 * Numbers per triangle when packed for painting, per corner: u, v, how
 * much to paint, which skin round it its colour is (see `ScalpPaint.skin`;
 * −1 for none) and how much, and whether the hair's colour left there is
 * painted over (1) or not (0, the face).
 */
export const PAINTED = 18

/** Numbers per triangle of the bald surface packed for painting, per corner: u, v, which skin round it its colour is and how much, and where it is (x, y, z in the bind pose). */
export const SCALP = 21

/** Numbers per triangle when packed for reading the tone from: u, v per corner. */
export const READ = 6

/** Numbers per place of skin read for the paint's colour (see `ScalpPaint.skin`). */
export const SKIN_REF = 5

/** How a head's skin is painted round the cut, and the bald surface (see scalp-paint.ts). */
export type ScalpPaint = {
  /** The body's triangles the hair taken out shaded (SHADED per triangle), to light again (see `hairShadow`). */
  shadow: Float32Array
  /** Kept triangles to paint (PAINTED per triangle). */
  paint: Float32Array
  /** The bald surface's triangles on the texture (SCALP per triangle): wholly painted, but where kept skin shows the texels. */
  scalp: Float32Array
  /** Every kept triangle on the texture (READ per triangle). */
  kept: Float32Array
  /** Every triangle taken on the texture (READ per triangle): painted wholly the scalp's tone, where no kept skin shows the texels. */
  taken: Float32Array
  /** Triangles to read the scalp's tone from, the forehead under the cut first (READ per triangle). */
  tone: Float32Array[]
  /** Where the unpainted skin the paint takes its colour from near the cut is read (SKIN_REF per place: u, v, and x, y, z in the bind pose). */
  skin: Float32Array
}

/**
 * How a bald head's skin is painted round the cut (see ScalpPaint): the
 * kept triangles near it (see FEATHER), over the hair zone, round the back
 * of the neck or on the ears — wherever hair may be left on the skin — and
 * the bald surface (`scalp`, its texture coordinates and bind-pose points
 * per corner); each corner's colour by the unpainted skin nearest it (see
 * LOCAL_NEAR); and the tone read from the forehead's skin just under the
 * cut, or from all of the forehead.
 */
export function scalpPaint(
  head: { points: Triples; normals: Triples; uvs: Triples; index: ArrayLike<number> },
  taken: ArrayLike<number>,
  rings: Uint8Array,
  spots: Int32Array,
  zone: Float32Array,
  marks: HeadMarks,
  scalp: { uvs: Triples; points: Triples },
): Omit<ScalpPaint, 'shadow'> {
  const { points, normals, uvs, index } = head
  const count = points.length / 3
  const eyeLevel = marks.eyes.reduce((sum, eye) => sum + eye[1]!, 0) / marks.eyes.length
  const middle = marks.eyes.reduce((sum, eye) => sum + eye[0]!, 0) / marks.eyes.length
  const eyeFront = Math.max(...marks.eyes.map((eye) => eye[2]!))
  const ringOf = (i: number) => rings[spots[i]!]!
  const used = new Uint8Array(count)
  for (let t = 0; t < index.length / 3; t++) {
    if (!taken[t]) for (let k = 0; k < 3; k++) used[index[t * 3 + k]!] = 1
  }
  const found: number[] = []
  const distances: number[] = []
  const gridOf = (keep: (i: number) => boolean) => {
    const ids: number[] = []
    const at: number[] = []
    for (let i = 0; i < count; i++) {
      if (!keep(i)) continue
      ids.push(i)
      at.push(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!)
    }
    return { ids, grid: new PointGrid(at, SKULL_CELL) }
  }
  const cut = gridOf((i) => used[i] === 1 && ringOf(i) === 0)
  const fromCut = Float32Array.from({ length: count }, (_, i) =>
    used[i] &&
    cut.grid.nearest(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!, 1, found, distances) >
      0
      ? Math.sqrt(distances[0]!)
      : Number.POSITIVE_INFINITY,
  )
  const face = (i: number) =>
    zone[i]! < FACE_ZONE &&
    points[i * 3 + 2]! > eyeFront - FACE_DEPTH &&
    points[i * 3 + 1]! > marks.neck
  const amountOf = (i: number) =>
    !face(i)
      ? 1 - smoothstep(FULL, FEATHER, fromCut[i]!)
      : points[i * 3 + 1]! < eyeLevel + BROWS
        ? 0
        : 1 - smoothstep(FULL, FACE_FEATHER, fromCut[i]!)
  const ear = (i: number) => nearEar(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!, marks)
  // Skin of the head itself (not an eyeball, the teeth), but the ears —
  // redder than skin — and the forehead and the brows: the scalp's tone is
  // the forehead's own.
  const spotCount = spots.reduce((most, spot) => Math.max(most, spot + 1), 0)
  const pieces = piecesOf(index, spots, spotCount, (t) => !taken[t])
  const onHead = new Uint8Array(count)
  for (let t = 0; t < index.length / 3; t++) {
    if (!taken[t] && pieces.size(t) === pieces.largest) {
      for (let k = 0; k < 3; k++) onHead[index[t * 3 + k]!] = 1
    }
  }
  const bare = gridOf(
    (i) =>
      onHead[i] === 1 &&
      fromCut[i]! >= SKIN_OFF_CUT &&
      !ear(i) &&
      !(
        zone[i]! < FACE_ZONE &&
        points[i * 3 + 2]! > eyeFront - FACE_DEPTH &&
        points[i * 3 + 1]! > eyeLevel - RIM_BELOW
      ),
  )
  const refs = new Map<number, number>()
  const skin: number[] = []
  /** The unpainted skin nearest a place (as `ScalpPaint.skin` numbers it), and how much its colour it takes. */
  const local = (x: number, y: number, z: number): [number, number] => {
    if (bare.grid.nearest(x, y, z, 1, found, distances, LOCAL_FAR) === 0) return [-1, 0]
    const share = 1 - smoothstep(LOCAL_NEAR, LOCAL_FAR, Math.sqrt(distances[0]!))
    if (share <= 0) return [-1, 0]
    const i = bare.ids[found[0]!]!
    let ref = refs.get(i)
    if (ref === undefined) {
      ref = refs.size
      refs.set(i, ref)
      skin.push(
        uvs[i * 2]!,
        uvs[i * 2 + 1]!,
        points[i * 3]!,
        points[i * 3 + 1]!,
        points[i * 3 + 2]!,
      )
    }
    return [ref, share]
  }
  const behindNeck = (i: number) =>
    points[i * 3 + 1]! < marks.neck && points[i * 3 + 2]! < marks.nape
  const paint: number[] = []
  const kept: number[] = []
  const takenUvs: number[] = []
  const nearCut: number[] = []
  const forehead: number[] = []
  for (let t = 0; t < index.length / 3; t++) {
    const corners = [0, 1, 2].map((k) => index[t * 3 + k]!)
    const read = corners.flatMap((i) => [uvs[i * 2]!, uvs[i * 2 + 1]!])
    if (taken[t]) {
      takenUvs.push(...read)
      continue
    }
    kept.push(...read)
    if (corners.some((i) => amountOf(i) > 0 || zone[i]! >= PAINT_ZONE || behindNeck(i) || ear(i))) {
      for (const i of corners) {
        const [ref, share] = local(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!)
        paint.push(uvs[i * 2]!, uvs[i * 2 + 1]!, amountOf(i), ref, share, face(i) ? 0 : 1)
      }
    }
    const front = corners.every(
      (i) => normals[i * 3 + 2]! >= FOREHEAD_FACING && points[i * 3 + 1]! >= eyeLevel,
    )
    if (!front) continue
    if (corners.every((i) => ringOf(i) >= 1 && ringOf(i) <= TONE_RINGS)) nearCut.push(...read)
    else if (corners.every((i) => zone[i]! < FACE_ZONE)) forehead.push(...read)
  }
  const packed: number[] = []
  for (let k = 0; k < scalp.points.length / 3; k++) {
    const [ref, share] = local(
      scalp.points[k * 3]!,
      scalp.points[k * 3 + 1]!,
      scalp.points[k * 3 + 2]!,
    )
    packed.push(
      scalp.uvs[k * 2]!,
      scalp.uvs[k * 2 + 1]!,
      ref,
      share,
      scalp.points[k * 3]!,
      scalp.points[k * 3 + 1]!,
      scalp.points[k * 3 + 2]!,
    )
  }
  return {
    paint: Float32Array.from(paint),
    scalp: Float32Array.from(packed),
    kept: Float32Array.from(kept),
    taken: Float32Array.from(takenUvs),
    tone: [Float32Array.from(nearCut), Float32Array.from(forehead)],
    skin: Float32Array.from(skin),
  }
}

/**
 * Body skin and clothes this near (bind units) the head's own hair, behind
 * the neck's middle and under its top, lay in the hair's shadow, which the
 * body's texture has painted on: wholly within SHADOW_FULL, none from
 * SHADOW_REACH.
 */
const SHADOW_FULL = 0.04
const SHADOW_REACH = 0.12

/** Numbers per triangle of the body packed for lighting again, per corner: u, v and how much it lay in the shadow. */
export const SHADED = 9

/**
 * The body's triangles the head's own hair (`hair`, its points: what was
 * taken out of the head and its cards) shaded, packed (see SHADED): with
 * the hair gone, the shadow painted on the body's texture under it — a
 * dark hood down the back — is lit again as the body round it is.
 */
export function hairShadow(
  body: { points: Triples; uvs: Triples; index: ArrayLike<number> },
  hair: Triples,
  marks: Pick<HeadMarks, 'neck' | 'nape'>,
): Float32Array {
  const { points, uvs, index } = body
  const count = points.length / 3
  if (hair.length === 0) return new Float32Array()
  const hairGrid = new PointGrid(hair, SKULL_CELL)
  const found: number[] = []
  const distances: number[] = []
  const shade = Float32Array.from({ length: count }, (_, i) => {
    const [x, y, z] = [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]
    if (y > marks.neck || z > marks.nape) return 0
    if (hairGrid.nearest(x, y, z, 1, found, distances, SHADOW_REACH) === 0) return 0
    return 1 - smoothstep(SHADOW_FULL, SHADOW_REACH, Math.sqrt(distances[0]!))
  })
  const packed: number[] = []
  for (let t = 0; t < index.length / 3; t++) {
    const corners = [0, 1, 2].map((k) => index[t * 3 + k]!)
    if (!corners.some((i) => shade[i]! > 0)) continue
    for (const i of corners) packed.push(uvs[i * 2]!, uvs[i * 2 + 1]!, shade[i]!)
  }
  return Float32Array.from(packed)
}
