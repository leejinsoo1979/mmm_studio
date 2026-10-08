import {
  cleanCut,
  cutRings,
  type HeadMarks,
  hairShadow,
  nearEar,
  type ScalpPaint,
  scalpPaint,
  TONE_RINGS,
  vertexNormals,
} from './bald-head'
import { rasterise } from './front-render'
import { unionHairline } from './hair-groom'
import { angles, hairlineAt, templateFrame, type V3 } from './hair-scalp'
import type { HairLibrary } from './hair-styles'
import {
  type AxisFit,
  craniumFit,
  faceFit,
  fitBald,
  fitSkull,
  PointGrid,
  SKULL_CELL,
  smoothstep,
  standingOver,
  standOn,
  type Triples,
} from './head-skull'

/**
 * The head under generated hair: the character's own head mesh with its
 * own hair laid flat onto the fitted cranium (same vertices, UVs and
 * skinning, so no seam), the root layer and undercut shells over it, and
 * how its skin is painted where its own hair was. Built in the hair
 * worker, once per avatar. Pure.
 */

/** A loaded avatar's head and what fits a skull to it, as arrays the worker can take (bind pose). */
export type BaseInput = {
  avatar: string
  /** The head's own material's name, which its hair flags are kept under. */
  material: string
  metresPerUnit: number
  head: {
    points: Float32Array
    normals: Float32Array
    uvs: Float32Array
    index: Uint32Array
    skinIndex: Uint16Array
    skinWeight: Float32Array
  }
  body: { points: Float32Array; uvs: Float32Array; index: Uint32Array }
  /** Points over the own hair cards (bind pose), whose shadow on the body is lit again; null for none. */
  cards: Float32Array | null
  /** The lash mesh's bounds, kept clear of a fringe. */
  lashes: { min: [number, number, number]; max: [number, number, number] } | null
  faceBones: Record<string, [number, number, number]>
  bones: Record<
    'head' | 'neck' | 'spine' | 'spine2' | 'clavicleL' | 'clavicleR' | 'upperArmL' | 'upperArmR',
    [number, number, number]
  >
  /** Where those bones are in the head's skeleton, for the hair's skin weights. */
  boneIndex: Record<'head' | 'neck' | 'spine2' | 'clavicleL' | 'clavicleR', number>
  marks: HeadMarks
  /** Which of the head's points are its ears' (1), or null when it has none of its own. */
  ears: Uint8Array | null
}

export type BaseResult = {
  /** Flattened: the head's own surface (`flat`), or the fitted bald skull where that fails. */
  kind: 'flat' | 'skull'
  /** The head flattened: as many points as it came with, an index without the triangles dropped. */
  head: { points: Float32Array; normals: Float32Array; index: Uint32Array }
  /**
   * The root layer, then the undercut's three shells from `shellStart` on
   * in the index. Each point copies its head point's (`srcVertex`) skinning
   * and stands `height` (bind units) off it along its normal. `scalpDir` is
   * its direction on the template, as long as roots grow there (0–1): they
   * fade out toward the ears and the layer's lower edge, point by point, so
   * no edge follows the head's triangles.
   */
  roots: {
    position: Float32Array
    normal: Float32Array
    scalpDir: Float32Array
    comb: Float32Array
    skinIndex: Uint16Array
    skinWeight: Float32Array
    index: Uint32Array
    srcVertex: Uint32Array
    height: Float32Array
    shellStart: number
  }
  /** How the look paints the skin where the head's own hair was (skin only, the same for any cut). */
  paint: ScalpPaint
  /**
   * The texels (BUMP_MASK², row by row from v = 0, as the painter reads
   * uvs) of every flattened and hole-closing triangle, 1 where the look
   * worker flattens the head's normal map: the old hair's strand bumps and
   * a closed tail's relief must not show on the bald surface.
   */
  bumpMask: Uint8Array | null
}

/** How far (mm) the own hair may still stand over the fitted cranium: the knee starts there. */
const KEEP = 4
/** The same inside the undercut band, where the buzz shows every lump (no knee). */
const KEEP_BAND = 1.5
/** How far past KEEP (mm) the soft knee lets the tallest hair stand. */
const KNEE = 2
/** Hair standing further than this (mm) over the cranium hangs: it is laid on the body, or dropped. */
const HANG = 30
/** How near the body (mm) a hanging point below the head bone is laid onto it, and how far over it. */
const ONTO_BODY = 30
const OVER_BODY = 0.5
/** A triangle facing the cranium less than this after flattening is the underside of a fold. */
const FOLDED = 0.2
/** A triangle flattened to less than this share of its area is squashed into a sliver. */
const SQUASHED = 0.15
/** The scalp chart's texels across, and the share of a triangle's texels another before it covers to drop it. */
const CHART = 256
const OVERLAP = 0.5
/** Kept triangles stand at most this (mm) over the cranium to count in the chart (an ear doesn't). */
const ON_CRANIUM = 6
/** A piece of hair left standing alone this much smaller than the head's largest goes too. */
const ISLAND = 0.1
/** The longest hole (cm round) closed over its rim: a longer one is not a hole flattening opened. */
const MOST_FILLED = 30
/** How near an ear's own points (mm) the head is the ear's; and the skull's ear zone (see bald-head.ts). */
const EAR_REACH = 10
const EAR_ZONE = 0.03
/** Steps a point is moved to its capped height in, measured again after each. */
const SETTLE_STEPS = 6

/** The union undercut band on the template: every style's buzzed sides. */
export const UNDERCUT_SIDE = 0.95
export const UNDERCUT_LINE = 0.35
export const inUndercutBand = (a: number, e: number) =>
  Math.abs(a) > UNDERCUT_SIDE && e < UNDERCUT_LINE

/** How far below the union hairline (rad) the root layer reaches: the hairline's wobble and an 8 mm fade. */
const ROOTS_BELOW = 0.14
/** Over how much elevation (rad) the root layer fades in from its lower edge, and over what (mm) from the ears' own points. */
const ROOTS_EDGE = 0.06
const ROOTS_EAR: readonly [number, number] = [2, 8]
/** `scalpDir`'s least length, so a shader can still normalise it where nothing grows. */
const MIN_GROWS = 1e-3
/** The root layer's height over the head, and the undercut shells' (mm). */
const ROOT_LAYER = 0.8
const SHELLS = [1.5, 3, 4.5] as const

/** The bump mask's texels across. */
export const BUMP_MASK = 1024

/** Points of a mesh this near (bind units) are one spot (a texture seam splits them). */
const SPOT = 1e-4

/** Each point's spot (see SPOT), numbered as first met, and how many there are. */
export function spotsOf(points: Triples) {
  const count = points.length / 3
  const numbers = new Map<string, number>()
  const spots = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    const key = [0, 1, 2].map((axis) => Math.round(points[i * 3 + axis]! / SPOT)).join()
    let spot = numbers.get(key)
    if (spot === undefined) {
      spot = numbers.size
      numbers.set(key, spot)
    }
    spots[i] = spot
  }
  return { spots, count: numbers.size }
}

/** The fits that put the shared skull on a head: by its face bones, and that fit made to its cranium. */
export function headFits(input: BaseInput, library: HairLibrary) {
  const skull = library.skull
  const face = faceFit(skull, new Map(Object.entries(input.faceBones)))
  if (!face) throw new Error(`hair base: no face fit for ${input.avatar}`)
  const [left, right] = input.marks.eyes as [number[], number[]]
  const eyes: V3 = [
    (left[0]! + right[0]!) / 2,
    (left[1]! + right[1]!) / 2,
    Math.max(left[2]!, right[2]!),
  ]
  return { face, cranium: craniumFit(skull, face, input.head.points, eyes) }
}

/** A head point's place on the template (its fit undone) as the scalp's (a, e). */
export function templateAngles(
  fit: AxisFit,
  origin: V3,
  x: number,
  y: number,
  z: number,
): [number, number] {
  return angles(
    (x - fit.shift[0]) / fit.scale[0] - origin[0],
    (y - fit.shift[1]) / fit.scale[1] - origin[1],
    (z - fit.shift[2]) / fit.scale[2] - origin[2],
  )
}

/** Lays a head's own hair flat and builds what generated hair stands on (see BaseResult). */
export function flattenHead(input: BaseInput, library: HairLibrary): BaseResult {
  const own = library.bald.get(input.material)
  const { points, normals, uvs, index } = input.head
  const triangles = index.length / 3
  if (!own || own.length < triangles)
    throw new Error(`hair base: no hair flags for ${input.material}`)
  const mm = 0.001 / input.metresPerUnit
  const count = points.length / 3
  const { face, cranium } = headFits(input, library)
  const frame = templateFrame(library.skull)
  const marks = input.marks
  const { spots, count: spotCount } = spotsOf(points)
  const skullHeight = standingOver(points, fitSkull(library.skull, face))
  const taken = cleanCut(
    { points, index, spots, spotCount, height: skullHeight.height, zone: skullHeight.zone },
    own,
    marks,
    input.ears,
  )
  const fitted = fitBald(library.skull, cranium)

  // Which points the cut moves: those of taken triangles only. The rest
  // (every point of a kept triangle) stay as loaded.
  const usedKept = new Uint8Array(count)
  const usedTaken = new Uint8Array(count)
  for (let t = 0; t < triangles; t++) {
    const used = taken[t] ? usedTaken : usedKept
    for (let k = 0; k < 3; k++) used[index[t * 3 + k]!] = 1
  }
  const fixedSpot = new Uint8Array(spotCount)
  for (let i = 0; i < count; i++) if (usedKept[i]) fixedSpot[spots[i]!] = 1
  // By an ear the cranium's height is the skull's own ear's: hair painted
  // there stays where it is, and its triangles stay too.
  const byEar = earSide(input, skullHeight.zone)

  // Over the cranium: each taken point's height along its normal there.
  const height = new Float32Array(count)
  const baldNormal = new Float32Array(count * 3)
  const off = new Float32Array(count).fill(Number.POSITIVE_INFINITY)
  const stand = [0, 0, 0, 0, 0]
  for (let i = 0; i < count; i++) {
    if (!usedTaken[i]) continue
    if (!standOn(fitted, points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!, stand)) continue
    height[i] = stand[0]!
    baldNormal.set([stand[1]!, stand[2]!, stand[3]!], i * 3)
    off[i] = stand[4]!
  }

  // Rings from the kept skin over the taken spots, each carrying the height
  // of the kept spot it was reached from: points next to kept skin standing
  // proud ease down from it over two rings instead of dropping to the cap.
  const ring = new Int32Array(spotCount).fill(-1)
  const from = new Float32Array(spotCount)
  const spotHeight = new Float32Array(spotCount)
  const spotY = new Float32Array(spotCount)
  for (let i = 0; i < count; i++) {
    spotY[spots[i]!] = points[i * 3 + 1]!
    if (usedTaken[i]) spotHeight[spots[i]!] = height[i]!
  }
  {
    const neighbours = Array.from({ length: spotCount }, () => [] as number[])
    for (let t = 0; t < triangles; t++) {
      if (!taken[t]) continue
      for (let k = 0; k < 3; k++) {
        const a = spots[index[t * 3 + k]!]!
        const b = spots[index[t * 3 + ((k + 1) % 3)]!]!
        neighbours[a]!.push(b)
        neighbours[b]!.push(a)
      }
    }
    const queue: number[] = []
    for (let s = 0; s < spotCount; s++) {
      if (fixedSpot[s]) {
        ring[s] = 0
        // Below the head bone the cranium's height means nothing: nothing eases from there.
        from[s] = spotY[s]! >= marks.neck ? spotHeight[s]! : 0
        queue.push(s)
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const s = queue[q]!
      for (const n of neighbours[s]!) {
        if (ring[n]! >= 0) continue
        ring[n] = ring[s]! + 1
        from[n] = from[s]!
        queue.push(n)
      }
    }
  }

  // Flattened: each taken point not on the kept skin moved down its
  // normal to its capped height (see KEEP). Hair hanging further off than
  // HANG goes straight in toward the head's middle when it is over the
  // cranium, onto the body when it hangs by the neck, or drops its triangles.
  const flat = Float32Array.from(points)
  const hanging = new Uint8Array(count)
  const bodyGrid = new PointGrid(input.body.points, SKULL_CELL)
  const bodyNormals = vertexNormals(input.body.points, input.body.index)
  const middle = [0, 1, 2].map(
    (axis) => frame.origin[axis]! * cranium.scale[axis]! + cranium.shift[axis]!,
  )
  const found: number[] = []
  const distances: number[] = []
  for (let i = 0; i < count; i++) {
    if (!usedTaken[i] || usedKept[i] || byEar[i]) continue
    const x = points[i * 3]!
    const y = points[i * 3 + 1]!
    const z = points[i * 3 + 2]!
    const h = height[i]! / mm
    const hangs = h > HANG || off[i]! > HANG * mm + Math.max(0, height[i]!)
    if (hangs && y < marks.neck) {
      const near =
        bodyGrid.nearest(x, y, z, 1, found, distances, ONTO_BODY * mm) > 0 &&
        distances[0]! <= (ONTO_BODY * mm) ** 2
      if (!near) {
        hanging[i] = 1
        continue
      }
      const j = found[0]!
      const [nx, ny, nz] = [bodyNormals[j * 3]!, bodyNormals[j * 3 + 1]!, bodyNormals[j * 3 + 2]!]
      const over =
        (x - input.body.points[j * 3]!) * nx +
        (y - input.body.points[j * 3 + 1]!) * ny +
        (z - input.body.points[j * 3 + 2]!) * nz
      const move = OVER_BODY * mm - over
      flat[i * 3] = x + nx * move
      flat[i * 3 + 1] = y + ny * move
      flat[i * 3 + 2] = z + nz * move
      continue
    }
    const [a, e] = templateAngles(cranium, frame.origin, x, y, z)
    const band = inUndercutBand(a, e)
    const keep = band ? KEEP_BAND : KEEP
    let target = h
    if (h > keep)
      target = band ? keep : keep + KNEE * (1 - Math.exp(-(Math.min(h, HANG) - keep) / KNEE))
    const s = spots[i]!
    const boundary = from[s]! / mm
    if (!band && ring[s]! > 0 && boundary > target) {
      target = Math.min(
        h,
        Math.max(target, boundary + (target - boundary) * Math.min(1, ring[s]! / 2)),
      )
    }
    if (target >= h) continue
    // A few steps, the height measured again after each: it is read off
    // the cranium's nearest points, which change as the point moves.
    let [px, py, pz] = [x, y, z]
    let [nx, ny, nz] = [baldNormal[i * 3]!, baldNormal[i * 3 + 1]!, baldNormal[i * 3 + 2]!]
    let now = h
    for (let step = 0; step < SETTLE_STEPS; step++) {
      let [dx, dy, dz] = [nx, ny, nz]
      let along = 1
      if (hangs) {
        dx = px - middle[0]!
        dy = py - middle[1]!
        dz = pz - middle[2]!
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
        dx /= l
        dy /= l
        dz /= l
        along = Math.max(0.3, dx * nx + dy * ny + dz * nz)
      }
      const move = ((target - now) * mm) / along
      px += dx * move
      py += dy * move
      pz += dz * move
      if (!standOn(fitted, px, py, pz, stand)) break
      now = stand[0]! / mm
      nx = stand[1]!
      ny = stand[2]!
      nz = stand[3]!
      if (Math.abs(now - target) < 0.005) break
    }
    flat[i * 3] = px
    flat[i * 3 + 1] = py
    flat[i * 3 + 2] = pz
    baldNormal.set([nx, ny, nz], i * 3)
  }

  // Dropped: triangles hanging, folded under, squashed, or doubling a
  // triangle before them on the scalp's chart (kept skin first).
  const drop = new Uint8Array(triangles)
  const chart = new Uint8Array(CHART * CHART)
  const place = (i: number) => {
    const [a, e] = templateAngles(
      cranium,
      frame.origin,
      flat[i * 3]!,
      flat[i * 3 + 1]!,
      flat[i * 3 + 2]!,
    )
    return [((a + Math.PI) / (2 * Math.PI)) * CHART, ((e + Math.PI / 2) / Math.PI) * CHART]
  }
  const raster = (t: number, mark: boolean) => {
    const corners = [0, 1, 2].map((k) => place(index[t * 3 + k]!))
    // Across the seam behind the head: the negative side moved round.
    if (
      Math.max(...corners.map((c) => c[0]!)) - Math.min(...corners.map((c) => c[0]!)) >
      CHART / 2
    ) {
      for (const c of corners) if (c[0]! < CHART / 2) c[0]! += CHART
    }
    const [p, q, r] = corners as [number[], number[], number[]]
    const area = (q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!)
    if (Math.abs(area) < 1e-9) return 0
    let inside = 0
    let covered = 0
    const cells: number[] = []
    const x0 = Math.floor(Math.min(p[0]!, q[0]!, r[0]!))
    const x1 = Math.ceil(Math.max(p[0]!, q[0]!, r[0]!))
    const y0 = Math.max(0, Math.floor(Math.min(p[1]!, q[1]!, r[1]!)))
    const y1 = Math.min(CHART - 1, Math.ceil(Math.max(p[1]!, q[1]!, r[1]!)))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const w0 = ((q[0]! - px) * (r[1]! - py) - (q[1]! - py) * (r[0]! - px)) / area
        const w1 = ((r[0]! - px) * (p[1]! - py) - (r[1]! - py) * (p[0]! - px)) / area
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue
        const cell = y * CHART + (((x % CHART) + CHART) % CHART)
        inside++
        if (chart[cell]) covered++
        cells.push(cell)
      }
    }
    if (mark || covered <= OVERLAP * inside) for (const cell of cells) chart[cell] = 1
    return inside > 0 ? covered / inside : 0
  }
  for (let t = 0; t < triangles; t++) {
    if (taken[t]) continue
    const lying = [0, 1, 2].every((k) => {
      const i = index[t * 3 + k]!
      return Math.abs(skullHeight.height[i]!) < ON_CRANIUM * mm
    })
    if (lying) raster(t, true)
  }
  const corner = [0, 0, 0]
  const faceNormal = (p: Float32Array, t: number, out: number[]) => {
    const [a, b, c] = [index[t * 3]! * 3, index[t * 3 + 1]! * 3, index[t * 3 + 2]! * 3]
    const ux = p[b]! - p[a]!
    const uy = p[b + 1]! - p[a + 1]!
    const uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!
    const vy = p[c + 1]! - p[a + 1]!
    const vz = p[c + 2]! - p[a + 2]!
    out[0] = uy * vz - uz * vy
    out[1] = uz * vx - ux * vz
    out[2] = ux * vy - uy * vx
    return Math.sqrt(out[0]! ** 2 + out[1]! ** 2 + out[2]! ** 2)
  }
  for (let t = 0; t < triangles; t++) {
    if (!taken[t]) continue
    const ids = [0, 1, 2].map((k) => index[t * 3 + k]!)
    if (ids.some((i) => hanging[i])) {
      drop[t] = 1
      continue
    }
    if (ids.some((i) => byEar[i])) continue
    const before = faceNormal(points, t, corner)
    const after = faceNormal(flat, t, corner)
    let nx = 0
    let ny = 0
    let nz = 0
    for (const i of ids) {
      nx += baldNormal[i * 3]!
      ny += baldNormal[i * 3 + 1]!
      nz += baldNormal[i * 3 + 2]!
    }
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    const facing =
      after > 0 ? (corner[0]! * nx + corner[1]! * ny + corner[2]! * nz) / (after * nl) : -1
    if (facing < FOLDED || after < SQUASHED * before || raster(t, false) > OVERLAP) drop[t] = 1
  }
  dropIslands(index, taken, drop, spots, spotCount)
  const kept: number[] = []
  for (let t = 0; t < triangles; t++) {
    if (!drop[t]) kept.push(index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!)
  }
  // Where dropping opened the head (a tied tail's root, a strand standing
  // off the crown), the hole is closed over its own rim.
  const filled = closeHoles(flat, index, kept, spots, spotCount, MOST_FILLED / (10 * mm))
  const keptIndex = Uint32Array.from([...kept, ...filled])

  // Lit as flattened: the moved points' normals worked out again (alike at
  // every spot), the kept skin along the cut turned halfway to them.
  const fresh = vertexNormals(flat, keptIndex)
  const bySpot = new Float32Array(spotCount * 3)
  for (let i = 0; i < count; i++) {
    for (let axis = 0; axis < 3; axis++) bySpot[spots[i]! * 3 + axis]! += fresh[i * 3 + axis]!
  }
  const flatNormals = Float32Array.from(normals)
  for (let i = 0; i < count; i++) {
    if (!usedTaken[i]) continue
    const s = spots[i]!
    const share = usedKept[i] ? 0.5 : 1
    let length = 0
    const n = [0, 0, 0]
    const l =
      Math.sqrt(bySpot[s * 3]! ** 2 + bySpot[s * 3 + 1]! ** 2 + bySpot[s * 3 + 2]! ** 2) || 1
    for (let axis = 0; axis < 3; axis++) {
      n[axis] = normals[i * 3 + axis]! * (1 - share) + (bySpot[s * 3 + axis]! / l) * share
      length += n[axis]! ** 2
    }
    length = Math.sqrt(length) || 1
    for (let axis = 0; axis < 3; axis++) flatNormals[i * 3 + axis] = n[axis]! / length
  }

  const roots = rootLayer(input, flat, flatNormals, keptIndex, cranium, frame.origin, mm)

  // Painted skin only: the kept skin round the cut, and every flattened
  // triangle on its own texels.
  const scalpUvs: number[] = []
  const scalpPoints: number[] = []
  const painted = (i: number) => {
    scalpUvs.push(uvs[i * 2]!, uvs[i * 2 + 1]!)
    scalpPoints.push(flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!)
  }
  for (let t = 0; t < triangles; t++) {
    if (taken[t] && !drop[t]) for (let k = 0; k < 3; k++) painted(index[t * 3 + k]!)
  }
  for (const i of filled) painted(i)
  const bumpMask = new Uint8Array(BUMP_MASK * BUMP_MASK)
  for (let k = 0; k < scalpUvs.length; k += 6) {
    rasterise(
      scalpUvs[k]! * BUMP_MASK,
      scalpUvs[k + 1]! * BUMP_MASK,
      scalpUvs[k + 2]! * BUMP_MASK,
      scalpUvs[k + 3]! * BUMP_MASK,
      scalpUvs[k + 4]! * BUMP_MASK,
      scalpUvs[k + 5]! * BUMP_MASK,
      BUMP_MASK,
      BUMP_MASK,
      1,
      (texel) => {
        bumpMask[texel] = 1
      },
    )
  }
  const hairPoints: number[] = []
  for (let t = 0; t < triangles; t++) {
    if (!taken[t]) continue
    for (let k = 0; k < 3; k++) {
      const i = index[t * 3 + k]!
      hairPoints.push(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!)
    }
  }
  if (input.cards) hairPoints.push(...input.cards)
  const paint: ScalpPaint = {
    ...scalpPaint(
      { points: flat, normals: flatNormals, uvs, index, height: skullHeight.height },
      taken,
      cutRings(index, taken, spots, spotCount, TONE_RINGS),
      spots,
      standingOver(points, fitted).zone,
      marks,
      { uvs: Float32Array.from(scalpUvs), points: Float32Array.from(scalpPoints) },
    ),
    shadow: hairShadow(input.body, hairPoints, marks),
  }
  return {
    kind: 'flat',
    head: { points: flat, normals: flatNormals, index: keptIndex },
    roots,
    paint,
    bumpMask,
  }
}

/** The root layer's and the shells' triangles: over the union hairline, off the ears. */
function rootLayer(
  input: BaseInput,
  flat: Float32Array,
  flatNormals: Float32Array,
  index: Uint32Array,
  cranium: AxisFit,
  origin: V3,
  mm: number,
): BaseResult['roots'] {
  const union = unionHairline()
  const { skinIndex, skinWeight } = input.head
  const ears = input.ears
  const marks = input.marks
  const count = flat.length / 3
  const earPoints: number[] = []
  for (let i = 0; ears && i < count; i++) {
    if (ears[i]) earPoints.push(flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!)
  }
  const earGrid = earPoints.length > 0 ? new PointGrid(earPoints, SKULL_CELL) : null
  const found: number[] = []
  const distances: number[] = []
  const growsAt = new Float32Array(count).fill(-1)
  const grows = (i: number) => {
    if (growsAt[i]! >= 0) return growsAt[i]!
    const [x, y, z] = [flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!]
    const [a, e] = templateAngles(cranium, origin, x, y, z)
    const low = hairlineAt(union, a) - ROOTS_BELOW
    let at = smoothstep(low, low + ROOTS_EDGE, e)
    if (earGrid) {
      const near = earGrid.nearest(x, y, z, 1, found, distances, ROOTS_EAR[1] * mm)
      if (near > 0) at *= smoothstep(ROOTS_EAR[0] * mm, ROOTS_EAR[1] * mm, Math.sqrt(distances[0]!))
    }
    growsAt[i] = at
    return at
  }
  const layer: number[] = []
  const band: number[] = []
  for (let t = 0; t < index.length / 3; t++) {
    const ids = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!]
    if (ids.every((i) => grows(i) <= 0)) continue
    let cx = 0
    let cy = 0
    let cz = 0
    let nx = 0
    let ny = 0
    let nz = 0
    for (const i of ids) {
      cx += flat[i * 3]! / 3
      cy += flat[i * 3 + 1]! / 3
      cz += flat[i * 3 + 2]! / 3
      nx += flatNormals[i * 3]!
      ny += flatNormals[i * 3 + 1]!
      nz += flatNormals[i * 3 + 2]!
    }
    if (!ears && nearEar(cx, cy, cz, marks)) continue
    const [a, e] = templateAngles(cranium, origin, cx, cy, cz)
    // Facing out of the head, not into a fold.
    const rx = cx - (origin[0] * cranium.scale[0] + cranium.shift[0])
    const ry = cy - (origin[1] * cranium.scale[1] + cranium.shift[1])
    const rz = cz - (origin[2] * cranium.scale[2] + cranium.shift[2])
    if (nx * rx + ny * ry + nz * rz <= 0) continue
    layer.push(t)
    if (inUndercutBand(a, e)) band.push(t)
  }
  const heights = [ROOT_LAYER, ...SHELLS]
  const sets = [layer, band, band, band]
  const position: number[] = []
  const normal: number[] = []
  const scalpDir: number[] = []
  const comb: number[] = []
  const skinI: number[] = []
  const skinW: number[] = []
  const src: number[] = []
  const height: number[] = []
  const corners: number[] = []
  let shellStart = 0
  sets.forEach((set, s) => {
    if (s === 1) shellStart = corners.length
    const lift = heights[s]! * mm
    const fresh = new Map<number, number>()
    for (const t of set) {
      for (let k = 0; k < 3; k++) {
        const i = index[t * 3 + k]!
        let v = fresh.get(i)
        if (v === undefined) {
          v = src.length
          fresh.set(i, v)
          const [nx, ny, nz] = [
            flatNormals[i * 3]!,
            flatNormals[i * 3 + 1]!,
            flatNormals[i * 3 + 2]!,
          ]
          const [x, y, z] = [flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!]
          position.push(x + nx * lift, y + ny * lift, z + nz * lift)
          normal.push(nx, ny, nz)
          const tx = (x - cranium.shift[0]) / cranium.scale[0] - origin[0]
          const ty = (y - cranium.shift[1]) / cranium.scale[1] - origin[1]
          const tz = (z - cranium.shift[2]) / cranium.scale[2] - origin[2]
          const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
          const length = Math.max(MIN_GROWS, grows(i)) / tl
          scalpDir.push(tx * length, ty * length, tz * length, heights[s]!)
          // Combed down and back over the head, along its surface.
          let gx = 0
          let gy = -1
          let gz = -0.5
          const along = gx * nx + gy * ny + gz * nz
          gx -= nx * along
          gy -= ny * along
          gz -= nz * along
          const gl = Math.sqrt(gx * gx + gy * gy + gz * gz)
          if (gl > 1e-6) comb.push(gx / gl, gy / gl, gz / gl)
          else comb.push(0, -1, 0)
          for (let c = 0; c < 4; c++) {
            skinI.push(skinIndex[i * 4 + c]!)
            skinW.push(skinWeight[i * 4 + c]!)
          }
          src.push(i)
          height.push(lift)
        }
        corners.push(v)
      }
    }
  })
  return {
    position: Float32Array.from(position),
    normal: Float32Array.from(normal),
    scalpDir: Float32Array.from(scalpDir),
    comb: Float32Array.from(comb),
    skinIndex: Uint16Array.from(skinI),
    skinWeight: Float32Array.from(skinW),
    index: Uint32Array.from(corners),
    srcVertex: Uint32Array.from(src),
    height: Float32Array.from(height),
    shellStart,
  }
}

/**
 * Which of a head's points are by its ears (1): its ears' own points, those
 * within EAR_REACH of them, and those where an ear is (see bald-head.ts's
 * `nearEar`) low in the skull's hair zone (`zone`, per point).
 */
export function earSide(input: BaseInput, zone: ArrayLike<number>): Uint8Array {
  const { points } = input.head
  const count = points.length / 3
  const mm = 0.001 / input.metresPerUnit
  const earPoints: number[] = []
  for (let i = 0; i < count; i++) {
    if (input.ears?.[i]) earPoints.push(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!)
  }
  const earGrid = earPoints.length > 0 ? new PointGrid(earPoints, SKULL_CELL) : null
  const found: number[] = []
  const distances: number[] = []
  const reach = EAR_REACH * mm
  return Uint8Array.from({ length: count }, (_, i) => {
    const [x, y, z] = [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]
    return input.ears?.[i] ||
      (nearEar(x, y, z, input.marks) && zone[i]! < EAR_ZONE) ||
      (earGrid &&
        earGrid.nearest(x, y, z, 1, found, distances, reach) > 0 &&
        distances[0]! <= reach * reach)
      ? 1
      : 0
  })
}

/**
 * Drops (in `drop`) what dropping left of the hair standing alone: pieces
 * of taken triangles joined to the rest by no edge (a tie's ring, a
 * strand's root), smaller than ISLAND of the largest piece.
 */
function dropIslands(
  index: ArrayLike<number>,
  taken: ArrayLike<number>,
  drop: Uint8Array,
  spots: Int32Array,
  spotCount: number,
) {
  const triangles = index.length / 3
  const byEdge = new Map<number, number[]>()
  for (let t = 0; t < triangles; t++) {
    if (drop[t]) continue
    for (let k = 0; k < 3; k++) {
      const a = spots[index[t * 3 + k]!]!
      const b = spots[index[t * 3 + ((k + 1) % 3)]!]!
      const key = Math.min(a, b) * spotCount + Math.max(a, b)
      const list = byEdge.get(key)
      if (list) list.push(t)
      else byEdge.set(key, [t])
    }
  }
  const piece = new Int32Array(triangles).fill(-1)
  const pieces: number[][] = []
  for (let t = 0; t < triangles; t++) {
    if (drop[t] || piece[t]! >= 0) continue
    const members = [t]
    piece[t] = pieces.length
    for (let m = 0; m < members.length; m++) {
      const u = members[m]!
      for (let k = 0; k < 3; k++) {
        const a = spots[index[u * 3 + k]!]!
        const b = spots[index[u * 3 + ((k + 1) % 3)]!]!
        for (const v of byEdge.get(Math.min(a, b) * spotCount + Math.max(a, b))!) {
          if (piece[v]! >= 0) continue
          piece[v] = pieces.length
          members.push(v)
        }
      }
    }
    pieces.push(members)
  }
  const largest = Math.max(0, ...pieces.map((members) => members.length))
  for (const members of pieces) {
    if (members.length < ISLAND * largest && members.every((t) => taken[t])) {
      for (const t of members) drop[t] = 1
    }
  }
}

/**
 * Triangles closing the holes dropping opened in a mesh (`before` its
 * triangles, `after` those kept), each loop of new open edges no longer
 * than `most` (bind units) round: ear-clipped over the loop's own plane,
 * wound as the triangles round it.
 */
function closeHoles(
  points: Triples,
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  spots: Int32Array,
  spotCount: number,
  most: number,
): number[] {
  const edgeKey = (a: number, b: number) => Math.min(a, b) * spotCount + Math.max(a, b)
  const uses = (index: ArrayLike<number>) => {
    const count = new Map<number, number>()
    for (let t = 0; t < index.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const key = edgeKey(spots[index[t + k]!]!, spots[index[t + ((k + 1) % 3)]!]!)
        count.set(key, (count.get(key) ?? 0) + 1)
      }
    }
    return count
  }
  const was = uses(before)
  const now = uses(after)
  // The rim, each edge turned against its triangle's winding, by its first
  // spot, with that triangle's corner off the rim.
  const rim = new Map<number, [number, number, number][]>()
  for (let t = 0; t < after.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = after[t + k]!
      const b = after[t + ((k + 1) % 3)]!
      const c = after[t + ((k + 2) % 3)]!
      const key = edgeKey(spots[a]!, spots[b]!)
      if (spots[a] === spots[b] || now.get(key) !== 1 || was.get(key) === 1) continue
      const list = rim.get(spots[b]!)
      if (list) list.push([b, a, c])
      else rim.set(spots[b]!, [[b, a, c]])
    }
  }
  const out: number[] = []
  const at = (i: number) => [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]
  for (const start of [...rim.keys()]) {
    for (;;) {
      const first = rim.get(start)?.pop()
      if (!first) break
      const loop = [first[0]]
      // The triangles round the rim, as they face.
      const facing = [0, 0, 0]
      const face = (edge: [number, number, number]) => {
        const [p, q, r] = [at(edge[1]), at(edge[0]), at(edge[2])]
        const u = [0, 1, 2].map((axis) => q[axis]! - p[axis]!)
        const v = [0, 1, 2].map((axis) => r[axis]! - p[axis]!)
        facing[0]! += u[1]! * v[2]! - u[2]! * v[1]!
        facing[1]! += u[2]! * v[0]! - u[0]! * v[2]!
        facing[2]! += u[0]! * v[1]! - u[1]! * v[0]!
      }
      face(first)
      let end = first[1]
      let length = 0
      let closed = false
      for (let guard = 0; guard < 4096; guard++) {
        const [p, q] = [at(loop[loop.length - 1]!), at(end)]
        length += Math.sqrt((p[0]! - q[0]!) ** 2 + (p[1]! - q[1]!) ** 2 + (p[2]! - q[2]!) ** 2)
        if (spots[end] === start) {
          closed = true
          break
        }
        const next = rim.get(spots[end]!)?.pop()
        if (!next) break
        face(next)
        loop.push(next[0])
        end = next[1]
      }
      if (!closed || loop.length < 3 || length > most) continue
      out.push(...earClip(loop.map(at), loop, facing))
    }
  }
  return out
}

/**
 * A closed loop of points (with their ids) cut into triangles, wound as
 * the loop runs (Newell's normal); none where that faces against the
 * triangles round it (`facing`): the rim of an island left standing, not
 * of a hole.
 */
function earClip(loop: number[][], ids: number[], facing: readonly number[]): number[] {
  const normal = [0, 0, 0]
  const centre = [0, 0, 0]
  loop.forEach((p, k) => {
    const q = loop[(k + 1) % loop.length]!
    normal[0]! += (p[1]! - q[1]!) * (p[2]! + q[2]!)
    normal[1]! += (p[2]! - q[2]!) * (p[0]! + q[0]!)
    normal[2]! += (p[0]! - q[0]!) * (p[1]! + q[1]!)
    for (let axis = 0; axis < 3; axis++) centre[axis]! += p[axis]! / loop.length
  })
  const nl = Math.sqrt(normal[0]! ** 2 + normal[1]! ** 2 + normal[2]! ** 2) || 1
  const n = normal.map((v) => v / nl)
  if (n[0]! * facing[0]! + n[1]! * facing[1]! + n[2]! * facing[2]! <= 0) return []
  const helper = Math.abs(n[0]!) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = [
    n[1]! * helper[2]! - n[2]! * helper[1]!,
    n[2]! * helper[0]! - n[0]! * helper[2]!,
    n[0]! * helper[1]! - n[1]! * helper[0]!,
  ]
  const ul = Math.sqrt(u[0]! ** 2 + u[1]! ** 2 + u[2]! ** 2) || 1
  for (let axis = 0; axis < 3; axis++) u[axis]! /= ul
  const v = [
    n[1]! * u[2]! - n[2]! * u[1]!,
    n[2]! * u[0]! - n[0]! * u[2]!,
    n[0]! * u[1]! - n[1]! * u[0]!,
  ]
  const flat = loop.map((p) => {
    const d = [0, 1, 2].map((axis) => p[axis]! - centre[axis]!)
    return [
      d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!,
      d[0]! * v[0]! + d[1]! * v[1]! + d[2]! * v[2]!,
    ]
  })
  const cross = (a: number[], b: number[], c: number[]) =>
    (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!)
  const left = flat.map((_, k) => k)
  const out: number[] = []
  let guard = left.length * left.length
  while (left.length > 3 && guard-- > 0) {
    let cut = -1
    for (let k = 0; k < left.length && cut < 0; k++) {
      const [ia, ib, ic] = [
        left[(k + left.length - 1) % left.length]!,
        left[k]!,
        left[(k + 1) % left.length]!,
      ]
      const [a, b, c] = [flat[ia]!, flat[ib]!, flat[ic]!]
      if (cross(a, b, c) <= 0) continue
      const inside = left.some((j) => {
        if (j === ia || j === ib || j === ic) return false
        const p = flat[j]!
        return cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0
      })
      if (!inside) cut = k
    }
    // No ear (a loop folded over itself in its plane): the flattest corner goes.
    if (cut < 0) cut = 0
    const k = cut
    out.push(
      ids[left[(k + left.length - 1) % left.length]!]!,
      ids[left[k]!]!,
      ids[left[(k + 1) % left.length]!]!,
    )
    left.splice(k, 1)
  }
  if (left.length === 3) out.push(ids[left[0]!]!, ids[left[1]!]!, ids[left[2]!]!)
  return out
}

/**
 * The holes flattening opened: the loops of open edges (between spots) the
 * kept index has and the loaded one hasn't, each loop's length (bind
 * units). Seams and the neck's rim, open before, don't count.
 */
export function newHoles(points: Triples, before: ArrayLike<number>, after: ArrayLike<number>) {
  const { spots, count } = spotsOf(points)
  const open = (index: ArrayLike<number>) => {
    const uses = new Map<number, number>()
    for (let t = 0; t < index.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = spots[index[t + k]!]!
        const b = spots[index[t + ((k + 1) % 3)]!]!
        if (a === b) continue
        const key = Math.min(a, b) * count + Math.max(a, b)
        uses.set(key, (uses.get(key) ?? 0) + 1)
      }
    }
    return new Set([...uses].filter(([, n]) => n === 1).map(([key]) => key))
  }
  const was = open(before)
  const edges = [...open(after)].filter((key) => !was.has(key))
  const where = new Float32Array(count * 3)
  for (let i = 0; i < points.length / 3; i++) {
    for (let axis = 0; axis < 3; axis++) where[spots[i]! * 3 + axis] = points[i * 3 + axis]!
  }
  // Loops: open edges joined at their spots.
  const parent = new Map<number, number>()
  const root = (s: number): number => {
    let r = s
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    parent.set(s, r)
    return r
  }
  for (const key of edges) {
    const a = Math.floor(key / count)
    const b = key % count
    if (!parent.has(a)) parent.set(a, a)
    if (!parent.has(b)) parent.set(b, b)
    parent.set(root(a), root(b))
  }
  const lengths = new Map<number, number>()
  for (const key of edges) {
    const a = Math.floor(key / count)
    const b = key % count
    const d = Math.sqrt(
      (where[a * 3]! - where[b * 3]!) ** 2 +
        (where[a * 3 + 1]! - where[b * 3 + 1]!) ** 2 +
        (where[a * 3 + 2]! - where[b * 3 + 2]!) ** 2,
    )
    const loop = root(a)
    lengths.set(loop, (lengths.get(loop) ?? 0) + d)
  }
  return [...lengths.values()]
}
