import {
  type Camera,
  cameraCentre,
  cameraLookingAt,
  defaultFocal,
  headAngles,
  headRotation,
  nudgeCamera,
  projectionJacobian,
  turnJacobian,
} from './camera'
import { type HeadModel, landmarkPosition, shapePositions, vertexNormals } from './head-model'
import {
  isEye,
  isIris,
  isLip,
  isSliding,
  LANDMARK_WEIGHT,
  LIPS_INNER,
  LIPS_OUTER,
  OVAL,
} from './landmark-sets'
import {
  apply3,
  boxQuadratic,
  choleskySolve,
  cross3,
  dot3,
  mulMat3,
  rotationLog,
  transpose3,
  type Vec3,
} from './linalg'
import {
  fillTriangles,
  type SmoothContourPoint,
  sampleField,
  signedDistanceField,
  smoothContour,
} from './silhouette'

/**
 * Fitting the base head to photos of a face — one, or several from around
 * it — so that it is the person's shape seen from any side, not a mask that
 * matches only from the front.
 *
 * One shared face shape (MPFB's face targets, then smooth fields of bumps
 * along the skin's normals: one over the face, a finer one down the
 * profile) and a camera per photo are solved together, by damped
 * Gauss–Newton, from:
 * - MediaPipe's landmarks as fixed points on the skin, in every photo that
 *   has them, each counting less the further the face is turned (MediaPipe
 *   draws a turned face's points towards its average face); the points it
 *   spreads over the cheeks and forehead count for little, and those on the
 *   midline with nothing to mark their height only across the face;
 * - the outline landmarks of the front photo, which mark where the face's
 *   edge shows: they slide along the head's own outline;
 * - the person's outline (a segmentation mask) against the head's smooth
 *   occluding contour: the profile in a side photo — forehead, nose, lips,
 *   chin and under it — and the cheek and jaw in a ¾ one. Where skin makes
 *   the outline it must match both ways; where hair or a beard may lie over
 *   it, the head need only stay inside.
 * MediaPipe's own depth for each photo is never used: it is its average
 * face's, not the person's.
 */

export type FitView = {
  width: number
  height: number
  /** Pixels; when unknown the usual phone/webcam field of view is assumed. */
  focal?: number
  /** MediaPipe's 478 landmarks (x, y pixels), or null where it found no face (a side view). */
  landmarks: Float32Array | null
  /** The person against the background (coverage, 0–255 per pixel), or null. */
  mask: Uint8Array | null
  /** How skin-like each pixel is (0–255), or null. */
  skin?: Uint8Array | null
  /** How much each pixel shows strands of hair or beard (0–255), or null: what the outline may lie under. */
  covered?: Uint8Array | null
  /** The head's turn (radians, > 0 to the subject's left): as measured, or as the capture asked for. */
  yaw: number
  pitch?: number
  roll?: number
  /**
   * The turn's size is only what the capture asked for (no landmarks measured it). Its side is
   * the capture's — which way the nose points in the picture; with none (0), the side the
   * outline's bare skin shows, else both are tried.
   */
  guessedYaw?: boolean
  /** How open the mouth is (0–1): the lips count less. */
  mouthOpen?: number
  /** How closed the eyes are (0–1): the eyelids count less. */
  blink?: number
}

export type FitOptions = {
  /** RMS movement (mm) a face target's full weight costs as much as a millimetre of misfit. */
  shapeSigma?: number
  /** The photos came from one camera that stayed put while the head turned. */
  sameCamera?: boolean
  /** Solve the bumps along the normals after the targets (the profile's fine detail). */
  detail?: boolean
  /** The most rounds each stage of the solve takes (it stops sooner once nothing improves). */
  iterations?: number
  /** How fast a turned view's landmarks lose weight (degrees for 1/e): MediaPipe's points lean to its average face. */
  landmarkTurn?: number
  /** How far (degrees) a side view's turn may stray from the one asked for. */
  sideYawSigma?: number
  /**
   * The distance between the person's pupils (m) as people of their build have it on average: what
   * sets the head's size, which no photo can (a bigger head further away looks the same).
   */
  pupils?: number
}

export type FitViewReport = {
  /** RMS of the landmarks' misfit (mm), the frontal ones counting most. */
  landmarksMm: number
  /** Outline landmarks matched to the head's outline. */
  outlinePoints: number
  /** Points of the head's outline held both ways to the photo's (bare skin). */
  skinOutlinePoints: number
  /** Their RMS misfit (mm). */
  skinOutlineMm: number
  yaw: number
}

export type FitResult = {
  coefficients: Float64Array
  /** Per region vertex (xyz, metres): the bumps on top of the targets. */
  displacement: Float64Array
  positions: Float64Array
  cameras: Camera[]
  views: FitViewReport[]
  /** The data's cost (priors left out). */
  cost: number
}

const LANDMARK_SIGMA = 1.5
const CONTOUR_SIGMA = 1.5
const SKIN_SIGMA = 1
const COVERED_SIGMA = 2
/** Residuals past this (mm) count linearly: a hand, a collar or a missed landmark. */
const HUBER = 3
/** An outline landmark is matched to the head's outline only this close (mm). */
const CONTOUR_GATE = 8
/** How far below the chin the outline still counts (m): below is the collar and the shoulders. */
const OUTLINE_CUT = 0.05
/** The face's bumps: their spacing and width (m), and their priors (mm): size, and between neighbours. */
const FIELD_SPACING = 0.011
const FIELD_RADIUS = 0.011
const FIELD_SIZE_SIGMA = 3
const FIELD_SMOOTH_SIGMA = 1.2
/**
 * The profile's bumps, down the face's midline from the forehead under the chin: closer and
 * narrower along it (a lip, the nose's tip) than across it, which the side photos see sharply.
 */
const PROFILE_SPACING = 0.005
const PROFILE_ALONG = 0.004
const PROFILE_ACROSS = 0.009
const PROFILE_SIZE_SIGMA = 3
const PROFILE_SMOOTH_SIGMA = 0.8
/** How far (degrees) a side view's turn may stray from the one the capture asked for. */
const SIDE_YAW_DEGREES = 6
/** How fast (degrees for 1/e) a turned view's landmarks lose weight. */
const LANDMARK_TURN = 40
/** How fast (radians for 1/e) a turned view's outline landmarks lose weight. */
const OUTLINE_TURN = (15 * Math.PI) / 180
/** Past this turn (radians) the irises' centres are left out: the eyes may look elsewhere. */
const IRIS_TURN = (15 * Math.PI) / 180
/** How far (radians) a side view's nod and lean may stray from the front view's. */
const SIDE_TILT_SIGMA = (4 * Math.PI) / 180
/** With one camera that stayed put, how much the head's distance may change between views. */
const SAME_CAMERA_DEPTH = 0.04
/** A view's outline this far (mm, mean) from where its landmarks put the head: they were misread. */
const MISREAD_MM = 3
/** Adults' mean pupil distance (m) by sex (Dodgson 2004, n ≈ 4000): the head's size anchor. */
export const PUPIL_DISTANCE = { male: 0.0647, female: 0.0623 } as const
/**
 * How far (log) the head's pupil distance may stray from it. People's spread is about 5.5 %, but
 * no photo can measure a head's size (a bigger head further away looks the same), so whatever
 * pull the photos put on it is spurious — a wrong lens, a hallucinated landmark — and the anchor
 * is held stiffer than the people's spread.
 */
const PUPIL_SIGMA = 0.015
/** A view turned more than this (radians) shows the face's depth. */
const SIDE_VIEW = (25 * Math.PI) / 180
/**
 * How strongly the face's depth keeps to the base head's (per mm² of the face's mean squared
 * change in depth): as many as 60 measurements of it when only front photos are given, a few
 * when side ones measure it.
 */
const DEPTH_PRIOR_FRONT = 60
const DEPTH_PRIOR_SIDE = 3
/**
 * How far the nose's tip stands ahead of its base in depth, as a share of the pupils' distance:
 * adults' noses project 14–21 mm, about a quarter of it, the base heads' 10–11 mm. A front photo
 * can't see it, so with no view from the side the nose is held to people's.
 */
const NOSE_PROJECTION = 0.25
/** How far (mm) a nose's projection strays from people's. */
const NOSE_PROJECTION_SIGMA = 1.5
/** The nose's tip and its base (MediaPipe landmarks), each with the sign its depth counts with. */
const NOSE_ENDS = [
  [4, 1],
  [2, -1],
] as const
/** A stage of the solve stops once this many rounds in a row gained less than this share of the cost. */
const STALL_ROUNDS = 3
const STALL_SHARE = 2e-4
/** The turns (radians, from the one asked for) a side view's outline is tried at to tell its side. */
const SIDE_YAW_SEARCH = [-10, 0, 10].map((degrees) => (degrees * Math.PI) / 180)
/** The distances (from the front view's) a side view's outline is tried at when placing it. */
const SIDE_DEPTH_SEARCH = [0.94, 1, 1.06]

/** How far (m) behind the outer lips an inner lip landmark may lie: past it, it is inside the mouth. */
const INNER_LIP_DEPTH = 0.02

const insides = new WeakMap<HeadModel, Uint8Array>()
/**
 * The landmarks the base head has inside its mouth: some of the inner lips' were mapped there,
 * centimetres behind the lips, and a photo's would pull the face towards them.
 */
function insideMouth(model: HeadModel): Uint8Array {
  const cached = insides.get(model)
  if (cached) return cached
  const rest = Float64Array.from(model.rest)
  const depth = (l: number) => landmarkPosition(model, rest, l)?.[2] ?? Number.NaN
  const lips = LIPS_OUTER.reduce<number>((sum, l) => sum + depth(l), 0) / LIPS_OUTER.length
  const inside = new Uint8Array(478)
  for (const l of LIPS_INNER) if (depth(l) < lips - INNER_LIP_DEPTH) inside[l] = 1
  insides.set(model, inside)
  return inside
}

const depthGrams = new WeakMap<HeadModel, Float64Array>()
/**
 * The face targets' depth (z, mm) on the face's skin, as a Gram matrix: cᵀ G c is the mean
 * squared change in depth over the face that coefficients c make.
 */
function depthGram(model: HeadModel): Float64Array {
  const cached = depthGrams.get(model)
  if (cached) return cached
  const nT = model.targetNames.length
  const gram = new Float64Array(nT * nT)
  const face = flags(model).bare
  let count = 0
  for (let v = 0; v < model.vertices.length; v++) {
    if (!face[v]) continue
    count++
    const start = model.basisStart[v]!
    const end = model.basisStart[v + 1]!
    for (let a = start; a < end; a++) {
      const za = model.basisDelta[a * 3 + 2]! * 1000
      const ia = model.basisTarget[a]!
      for (let b = start; b < end; b++) {
        const at = ia * nT + model.basisTarget[b]!
        gram[at] = gram[at]! + za * model.basisDelta[b * 3 + 2]! * 1000
      }
    }
  }
  for (let i = 0; i < gram.length; i++) gram[i] = gram[i]! / Math.max(1, count)
  depthGrams.set(model, gram)
  return gram
}

type Prepared = {
  view: FitView
  sdf: Float32Array | null
  /** Pixels per mm at the face, and the head's pivot in camera space: refreshed with the camera. */
  scale: number
  pivot: Vec3
  /** How each region vertex on this view's outline was found to be held (0 not yet, 1 skin, 2 covered). */
  labels: Int8Array
}

/** The normal equations of a weighted least-squares problem, built one sparse row at a time. */
class Normal {
  readonly h: Float64Array
  readonly g: Float64Array
  private readonly row: Float64Array
  private readonly touched: Int32Array
  private readonly seen: Uint8Array
  private count = 0
  cost = 0

  constructor(readonly n: number) {
    this.h = new Float64Array(n * n)
    this.g = new Float64Array(n)
    this.row = new Float64Array(n)
    this.touched = new Int32Array(n)
    this.seen = new Uint8Array(n)
  }

  add(index: number, value: number) {
    if (!this.seen[index]) {
      this.seen[index] = 1
      this.touched[this.count++] = index
    }
    this.row[index] = this.row[index]! + value
  }

  /** Ends a row: residual `r`, weight `w`, Huber-robust past `huber`. */
  commit(r: number, w: number, huber: number) {
    const a = Math.abs(r)
    const weight = a <= huber ? w : (w * huber) / a
    this.cost += w * (a <= huber ? r * r : huber * (2 * a - huber))
    const { h, g, row, touched, n } = this
    for (let p = 0; p < this.count; p++) {
      const i = touched[p]!
      const ri = row[i]! * weight
      if (ri !== 0) {
        g[i] = g[i]! + ri * r
        for (let q = 0; q < this.count; q++) {
          const j = touched[q]!
          h[i * n + j] = h[i * n + j]! + ri * row[j]!
        }
      }
    }
    for (let p = 0; p < this.count; p++) {
      const i = touched[p]!
      row[i] = 0
      this.seen[i] = 0
    }
    this.count = 0
  }

  /** Cost w·(value − target)², the value moving one for one with parameter `index`. */
  prior(index: number, value: number, target: number, w: number) {
    const r = value - target
    this.cost += w * r * r
    if (index < 0) return
    this.h[index * this.n + index] = this.h[index * this.n + index]! + w
    this.g[index] = this.g[index]! + w * r
  }

  /** Cost w·(a − b)², a and b moving with parameters i and j. */
  tie(i: number, j: number, a: number, b: number, w: number) {
    const r = a - b
    this.cost += w * r * r
    if (i < 0) return
    const { h, g, n } = this
    h[i * n + i] = h[i * n + i]! + w
    h[j * n + j] = h[j * n + j]! + w
    h[i * n + j] = h[i * n + j]! - w
    h[j * n + i] = h[j * n + i]! - w
    g[i] = g[i]! + w * r
    g[j] = g[j]! - w * r
  }
}

/**
 * Which unknowns a solve has: each part's first index, −1 where that part is held. `grow` is the
 * head's size (log of its scale about its pivot).
 */
type Layout = {
  shape: number
  pose: number[]
  focal: number
  field: number
  grow: number
  size: number
}

const held = (views: number): Layout => ({
  shape: -1,
  pose: new Array(views).fill(-1),
  focal: -1,
  field: -1,
  grow: -1,
  size: 1,
})

/** The bumps along the normals: smooth Gaussian blobs centred on a sparse set of skin vertices. */
type Field = {
  centres: number[]
  /** Each centre's mirror image across the face's midline (itself when on it). */
  mirror: Int32Array
  /** How big (mm) each centre's bump may be. */
  sizeSigma: Float32Array
  /** Neighbouring centres, held to similar bumps (how much they may differ, mm). */
  pairs: [number, number, number][]
  /** Per region vertex: CSR list of (centre, weight). */
  start: Uint32Array
  centre: Uint32Array
  weight: Float32Array
}

const fieldsOf = new WeakMap<HeadModel, Field>()
const flagsOf = new WeakMap<HeadModel, Flags>()

const distance3 = (p: ArrayLike<number>, i: number, j: number) =>
  Math.hypot(p[i * 3]! - p[j * 3]!, p[i * 3 + 1]! - p[j * 3 + 1]!, p[i * 3 + 2]! - p[j * 3 + 2]!)

function nearestSkinVertex(model: HeadModel, x: number, y: number, z: number): number {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  const { rest } = model
  for (let i = 0; i < model.vertices.length; i++) {
    if (!model.skin[i]) continue
    const d = (rest[i * 3]! - x) ** 2 + (rest[i * 3 + 1]! - y) ** 2 + (rest[i * 3 + 2]! - z) ** 2
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}

/** Farthest-point sampling of `candidates` (region vertices) at `spacing` (m), from the frontmost. */
function spread(model: HeadModel, candidates: number[], spacing: number): number[] {
  const { rest } = model
  const chosen: number[] = []
  if (!candidates.length) return chosen
  const nearest = new Float64Array(candidates.length).fill(Number.POSITIVE_INFINITY)
  let next = 0
  for (let k = 1; k < candidates.length; k++) {
    if (rest[candidates[k]! * 3 + 2]! > rest[candidates[next]! * 3 + 2]!) next = k
  }
  for (;;) {
    const v = candidates[next]!
    chosen.push(v)
    let far = -1
    let farDistance = 0
    for (let k = 0; k < candidates.length; k++) {
      const d = distance3(rest, candidates[k]!, v)
      if (d < nearest[k]!) nearest[k] = d
      if (nearest[k]! > farDistance) {
        farDistance = nearest[k]!
        far = k
      }
    }
    if (far < 0 || farDistance < spacing) break
    next = far
  }
  return chosen
}

function fieldOf(model: HeadModel): Field {
  const cached = fieldsOf.get(model)
  if (cached) return cached
  const { rest, skin, frame } = model
  const n = model.vertices.length
  const mid = frame.eyes[0]
  // The face and the front of the head: the subject's left half and the midline, mirrored after.
  const faceCandidates: number[] = []
  // The profile: the midline from the forehead to under the chin.
  const profileCandidates: number[] = []
  for (let i = 0; i < n; i++) {
    if (!skin[i]) continue
    const x = rest[i * 3]! - mid
    const y = rest[i * 3 + 1]!
    const z = rest[i * 3 + 2]!
    if (y < frame.chinY - OUTLINE_CUT || z < frame.earZ - 0.02) continue
    if (x >= -0.0005) faceCandidates.push(i)
    if (Math.abs(x) < 0.0015 && z > frame.earZ && y < frame.eyes[1] + 0.07)
      profileCandidates.push(i)
  }
  const centres: number[] = []
  const mirror: number[] = []
  const sizeSigma: number[] = []
  for (const v of spread(model, faceCandidates, FIELD_SPACING)) {
    const x = rest[v * 3]! - mid
    if (x < 0.002) {
      centres.push(v)
      mirror.push(centres.length - 1)
      sizeSigma.push(FIELD_SIZE_SIGMA)
      continue
    }
    centres.push(v, nearestSkinVertex(model, mid - x, rest[v * 3 + 1]!, rest[v * 3 + 2]!))
    mirror.push(centres.length - 1, centres.length - 2)
    sizeSigma.push(FIELD_SIZE_SIGMA, FIELD_SIZE_SIGMA)
  }
  const faceCount = centres.length
  for (const v of spread(model, profileCandidates, PROFILE_SPACING)) {
    centres.push(v)
    mirror.push(centres.length - 1)
    sizeSigma.push(PROFILE_SIZE_SIGMA)
  }
  const pairs: [number, number, number][] = []
  for (let a = 0; a < centres.length; a++) {
    for (let b = a + 1; b < centres.length; b++) {
      const profile = a >= faceCount
      if (profile !== b >= faceCount) continue
      const d = distance3(rest, centres[a]!, centres[b]!)
      if (d >= (profile ? PROFILE_SPACING : FIELD_SPACING) * 1.8) continue
      pairs.push([
        a,
        b,
        profile ? (PROFILE_SMOOTH_SIGMA * d) / PROFILE_SPACING : FIELD_SMOOTH_SIGMA,
      ])
    }
  }
  // Gaussian weights, normalised where blobs overlap so that each field's never add past 1.
  const start = new Uint32Array(n + 1)
  const ids: number[] = []
  const weights: number[] = []
  const found: [number, number][] = []
  const add = (i: number, from: number, to: number, weight: (c: number) => number) => {
    found.length = 0
    let total = 0
    for (let c = from; c < to; c++) {
      const w = weight(c)
      if (w < 1e-3) continue
      found.push([c, w])
      total += w
    }
    const scale = model.reach[i]! / Math.max(1, total)
    for (const [c, w] of found) {
      ids.push(c)
      weights.push(w * scale)
    }
  }
  for (let i = 0; i < n; i++) {
    if (skin[i]) {
      add(i, 0, faceCount, (c) => {
        const v = centres[c]!
        const d2 =
          (rest[i * 3]! - rest[v * 3]!) ** 2 +
          (rest[i * 3 + 1]! - rest[v * 3 + 1]!) ** 2 +
          (rest[i * 3 + 2]! - rest[v * 3 + 2]!) ** 2
        return Math.exp(-d2 / (2 * FIELD_RADIUS * FIELD_RADIUS))
      })
      add(i, faceCount, centres.length, (c) => {
        const v = centres[c]!
        const across = (rest[i * 3]! - rest[v * 3]!) ** 2
        const along =
          (rest[i * 3 + 1]! - rest[v * 3 + 1]!) ** 2 + (rest[i * 3 + 2]! - rest[v * 3 + 2]!) ** 2
        return Math.exp(-across / (2 * PROFILE_ACROSS ** 2) - along / (2 * PROFILE_ALONG ** 2))
      })
    }
    start[i + 1] = ids.length
  }
  const made: Field = {
    centres,
    mirror: Int32Array.from(mirror),
    sizeSigma: Float32Array.from(sizeSigma),
    pairs,
    start,
    centre: Uint32Array.from(ids),
    weight: Float32Array.from(weights),
  }
  fieldsOf.set(model, made)
  return made
}

/** The bumps' displacement of every region vertex (xyz, metres) for bump heights `a` (mm along the normal). */
export function fieldDisplacement(model: HeadModel, a: ArrayLike<number>): Float64Array {
  const f = fieldOf(model)
  const n = model.vertices.length
  const out = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = f.start[i]!; k < f.start[i + 1]!; k++) s += a[f.centre[k]!]! * f.weight[k]!
    if (s === 0) continue
    for (let c = 0; c < 3; c++) out[i * 3 + c] = (s / 1000) * model.normals[i * 3 + c]!
  }
  return out
}

type Flags = {
  /** The face ahead of the ears, above the neck: the outline landmarks' outline. */
  face: Uint8Array
  /** Brow to under the chin ahead of the ears: an outline of bare skin, unless the photo shows otherwise. */
  bare: Uint8Array
  /** High enough to count in the outline at all. */
  outline: Uint8Array
  /**
   * The profile from the brows down under the chin: nose, lips, brows and chin make the outline
   * there whatever the photo's detail says (lashes, nostrils and the lips' line are busy, the
   * underside of the chin is in shadow, but no hair stands off them; a beard is let go).
   */
  profile: Uint8Array
}

function flags(model: HeadModel): Flags {
  const cached = flagsOf.get(model)
  if (cached) return cached
  const n = model.vertices.length
  const face = new Uint8Array(n)
  const bare = new Uint8Array(n)
  const outline = new Uint8Array(n)
  const profile = new Uint8Array(n)
  const { frame, rest } = model
  const restPositions = Float64Array.from(rest)
  const height = (landmark: number, fallback: number) =>
    landmarkPosition(model, restPositions, landmark)?.[1] ?? fallback
  const browY =
    Math.max(height(105, frame.eyes[1] + 0.02), height(334, frame.eyes[1] + 0.02)) + 0.005
  const noseY = height(2, frame.chinY + 0.045) - 0.002
  for (let i = 0; i < n; i++) {
    if (!model.skin[i]) continue
    const y = rest[i * 3 + 1]!
    const z = rest[i * 3 + 2]!
    if (y > frame.chinY - OUTLINE_CUT) outline[i] = 1
    if (z > frame.earZ && y > frame.chinY - 0.02) face[i] = 1
    if (z > frame.earZ && y > frame.chinY - OUTLINE_CUT && y < frame.eyes[1] + 0.03) bare[i] = 1
    const x = Math.abs(rest[i * 3]! - frame.eyes[0])
    if (z > frame.earZ && y < browY && (y > noseY ? x < 0.025 : x < 0.04 && y > frame.chinY - 0.02))
      profile[i] = 1
  }
  const made = { face, bare, outline, profile }
  flagsOf.set(model, made)
  return made
}

/**
 * The region with the head scaled by e^`grow` about `pivot`, the scaling fading down the neck as
 * the targets do (the body below keeps its size).
 */
function grown(model: HeadModel, shaped: Float64Array, pivot: Vec3, grow: number): Float64Array {
  if (grow === 0) return shaped
  const g = Math.exp(grow) - 1
  const out = new Float64Array(shaped.length)
  for (let i = 0; i < model.vertices.length; i++) {
    const f = model.reach[i]! * g
    for (let c = 0; c < 3; c++) {
      out[i * 3 + c] = shaped[i * 3 + c]! + f * (shaped[i * 3 + c]! - pivot[c]!)
    }
  }
  return out
}

const landmarkDistance = (model: HeadModel, positions: Float64Array, a: number, b: number) => {
  const p = landmarkPosition(model, positions, a)!
  const q = landmarkPosition(model, positions, b)!
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/** The head's pivot (body space): behind the eyes, where a turning head turns about. */
const pivotOf = (model: HeadModel): Vec3 => [
  model.frame.eyes[0],
  model.frame.eyes[1] - 0.02,
  model.frame.eyes[2] - 0.07,
]

const cameraDepth = (camera: Camera, p: Vec3) =>
  apply3(camera.rotation, p)[2] + camera.translation[2]

/**
 * A first camera for a view: from its irises when it has landmarks, else with the head turned
 * about its pivot at the front view's distance (a camera that stayed put).
 */
function startCamera(model: HeadModel, view: FitView, front: Camera | null): Camera {
  const focal = view.focal ?? front?.focal ?? defaultFocal(view.width, view.height)
  const rotation = headRotation(view.yaw, view.pitch ?? 0, view.roll ?? 0)
  const eyes = model.frame.eyes
  const lm = view.landmarks
  if (lm) {
    const rx = lm[468 * 2]!
    const ry = lm[468 * 2 + 1]!
    const lx = lm[473 * 2]!
    const ly = lm[473 * 2 + 1]!
    const pixels = Math.max(1, Math.hypot(lx - rx, ly - ry))
    // The irises are about 6 mm further apart than the eyeballs' centres; foreshortened by the turn.
    const seen = (model.frame.eyeDistance + 0.004) * Math.max(0.3, Math.cos(view.yaw))
    return cameraLookingAt({
      width: view.width,
      height: view.height,
      focal,
      rotation,
      target: eyes,
      at: [(lx + rx) / 2, (ly + ry) / 2],
      distance: (focal * seen) / pixels,
    })
  }
  const pivot = pivotOf(model)
  return cameraLookingAt({
    width: view.width,
    height: view.height,
    focal,
    rotation,
    target: pivot,
    distance: front ? cameraDepth(front, pivot) : 0.5,
  })
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function sampleByte(data: Uint8Array, width: number, height: number, x: number, y: number) {
  const px = Math.min(width - 1, Math.max(0, Math.floor(x)))
  const py = Math.min(height - 1, Math.max(0, Math.floor(y)))
  return data[py * width + px]!
}

/** Projects the region through a camera: camera-space points and image points. */
function projectRegion(positions: Float64Array, camera: Camera) {
  const n = positions.length / 3
  const q = new Float64Array(n * 3)
  const xy = new Float64Array(n * 2)
  const r = camera.rotation
  const t = camera.translation
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]!
    const y = positions[i * 3 + 1]!
    const z = positions[i * 3 + 2]!
    const qx = r[0] * x + r[1] * y + r[2] * z + t[0]
    const qy = r[3] * x + r[4] * y + r[5] * z + t[1]
    const qz = r[6] * x + r[7] * y + r[8] * z + t[2]
    q[i * 3] = qx
    q[i * 3 + 1] = qy
    q[i * 3 + 2] = qz
    xy[i * 2] = (camera.focal * qx) / qz + camera.cx
    xy[i * 2 + 1] = (camera.focal * qy) / qz + camera.cy
  }
  return { q, xy }
}

/** The head's outer outline in a view: its smooth occluding contour where the outline counts. */
function outlineOf(
  model: HeadModel,
  flag: Flags,
  positions: Float64Array,
  normals: Float32Array,
  xy: Float64Array,
  camera: Camera,
  width: number,
  height: number,
): SmoothContourPoint[] {
  const coverage = new Uint8Array(width * height)
  fillTriangles(xy, model.triangles, width, height, coverage)
  return smoothContour(
    positions,
    normals,
    xy,
    model.triangles,
    cameraCentre(camera),
    camera.rotation,
    (a, b, c) => flag.outline[a] === 1 && flag.outline[b] === 1 && flag.outline[c] === 1,
    { data: coverage, width, height },
  )
}

/** The contour point's vertex weighing most in it. */
const dominant = (c: SmoothContourPoint) =>
  c.wa >= c.wb && c.wa >= c.wc ? c.a : c.wb >= c.wc ? c.b : c.c

/**
 * Solves the face and a camera for each view. A single view is the
 * front-only fit (its depth is the base head's); side views are what give
 * the face its real depth.
 */
export function fitHead(model: HeadModel, views: FitView[], options: FitOptions = {}): FitResult {
  const shapeSigma = options.shapeSigma ?? 3
  const landmarkTurn = ((options.landmarkTurn ?? LANDMARK_TURN) * Math.PI) / 180
  const sideYawSigma = ((options.sideYawSigma ?? SIDE_YAW_DEGREES) * Math.PI) / 180
  const sameCamera = options.sameCamera ?? true
  const rounds = options.iterations ?? 24
  const flag = flags(model)
  const fieldModel = fieldOf(model)
  const pivotBody = pivotOf(model)
  const nT = model.targetNames.length
  const nV = model.vertices.length
  const multi = views.length > 1
  const prepared: Prepared[] = views.map((view) => ({
    view,
    sdf: view.mask ? signedDistanceField(view.mask, view.width, view.height, 127) : null,
    scale: 1,
    pivot: [0, 0, 0],
    labels: new Int8Array(nV),
  }))

  // The view facing the camera most squarely, among those with landmarks, sets the rest.
  let front = views.findIndex((view) => view.landmarks)
  if (front < 0) throw new Error('no view shows a face')
  views.forEach((view, k) => {
    if (view.landmarks && Math.abs(view.yaw) < Math.abs(views[front]!.yaw)) front = k
  })

  let coefficients = new Float64Array(nT)
  let bumps = new Float64Array(fieldModel.centres.length)
  let grow = 0
  const cameras: Camera[] = views.map((view) => startCamera(model, view, null))
  const focal0 = cameras[front]!.focal
  /** The region as the targets and bumps shape it, before the head's size: then as solved. */
  let shaped = shapePositions(model, coefficients)
  let positions = grown(model, shaped, pivotBody, grow)
  const restPupils = landmarkDistance(model, Float64Array.from(model.rest), 468, 473)
  /** Whether every photo faces the camera: none will ever show the face's depth. */
  const frontOnly = views.every((view) => view.landmarks && Math.abs(view.yaw) <= SIDE_VIEW)
  const size0 = options.pupils ? Math.log(options.pupils / restPupils) : 0

  const refresh = () => {
    const nasion = landmarkPosition(model, positions, 168) ?? model.frame.eyes
    prepared.forEach((p, k) => {
      const camera = cameras[k]!
      p.scale = camera.focal / cameraDepth(camera, nasion) / 1000
      const pivot = apply3(camera.rotation, pivotBody)
      p.pivot = [
        pivot[0] + camera.translation[0],
        pivot[1] + camera.translation[1],
        pivot[2] + camera.translation[2],
      ]
    })
  }

  /** The views taking part so far (side views join once the face has a shape to place them by). */
  const active = new Uint8Array(views.length).fill(1)
  /** The region's vertex normals as now shaped (for the smooth outline), and for which positions. */
  let normalsAt: Float64Array | null = null
  let normalsNow: ReturnType<typeof vertexNormals> = new Float32Array(0)

  /** Every active view's residuals (or only view `only`'s) at the current state. */
  const accumulate = (normal: Normal, layout: Layout, only = -1): FitViewReport[] => {
    refresh()
    if (normalsAt !== positions) {
      normalsNow = vertexNormals(positions, model.triangles, nV)
      normalsAt = positions
    }
    return prepared.map((p, k) =>
      (only >= 0 && k !== only) || !active[k] ? emptyReport : addView(normal, layout, p, k),
    )
  }

  /** Solves the damped system (targets kept within 0–1) and applies the step. */
  const step = (normal: Normal, layout: Layout, damping: number) => {
    const { n, h, g } = normal
    for (let i = 0; i < n; i++) h[i * n + i] = h[i * n + i]! * (1 + damping) + 1e-9
    const lower = new Float64Array(n).fill(Number.NEGATIVE_INFINITY)
    const upper = new Float64Array(n).fill(Number.POSITIVE_INFINITY)
    if (layout.shape >= 0) {
      for (let j = 0; j < nT; j++) {
        lower[layout.shape + j] = -coefficients[j]!
        upper[layout.shape + j] = 1 - coefficients[j]!
      }
    }
    const rhs = g.map((value) => -value)
    const delta = Float64Array.from(rhs)
    const solved = choleskySolve(Float64Array.from(h), delta, n)
    let inside = solved
    for (let i = 0; inside && i < n; i++) inside = delta[i]! >= lower[i]! && delta[i]! <= upper[i]!
    if (!inside) {
      if (!solved) delta.fill(0)
      for (let i = 0; i < n; i++) delta[i] = Math.min(upper[i]!, Math.max(lower[i]!, delta[i]!))
      boxQuadratic(h, rhs, delta, lower, upper, n, 300)
    }
    if (layout.shape >= 0) {
      for (let j = 0; j < nT; j++) {
        coefficients[j] = Math.min(1, Math.max(0, coefficients[j]! + delta[layout.shape + j]!))
      }
    }
    if (layout.field >= 0) {
      for (let c = 0; c < bumps.length; c++) bumps[c] = bumps[c]! + delta[layout.field + c]!
    }
    if (layout.grow >= 0) grow += delta[layout.grow]!
    const dLogFocal = layout.focal >= 0 ? delta[layout.focal]! : 0
    for (let k = 0; k < cameras.length; k++) {
      const at = layout.pose[k]!
      if (at < 0) {
        if (dLogFocal)
          cameras[k] = { ...cameras[k]!, focal: cameras[k]!.focal * Math.exp(dLogFocal) }
        continue
      }
      cameras[k] = nudgeCamera(
        cameras[k]!,
        [delta[at]!, delta[at + 1]!, delta[at + 2]!],
        [delta[at + 3]!, delta[at + 4]!, delta[at + 5]!],
        prepared[k]!.pivot,
        dLogFocal,
      )
    }
    if (layout.shape >= 0 || layout.field >= 0)
      shaped = shapePositions(model, coefficients, fieldDisplacement(model, bumps))
    positions = grown(model, shaped, pivotBody, grow)
  }

  /** The turn each side view (no landmarks) was asked for, on the side its outline says. */
  const sideYaw = views.map((view) => view.yaw)

  /** Whether any active view sees the face from well to the side (its depth, then, is measured). */
  const seesDepth = () =>
    prepared.some((p, k) => active[k] && Math.abs(headAngles(cameras[k]!.rotation).yaw) > SIDE_VIEW)

  /** Every prior's cost; and, for the parameters `layout` solves, its terms in the system. */
  const priors = (normal: Normal, layout: Layout) => {
    const at = (base: number, offset: number) => (base < 0 ? -1 : base + offset)
    for (let j = 0; j < nT; j++) {
      const w = ((model.targetScale[j]! * 1000) / shapeSigma) ** 2
      normal.prior(at(layout.shape, j), coefficients[j]!, 0, w)
    }
    for (const [a, b] of model.mirrored) {
      const w = (((model.targetScale[a]! + model.targetScale[b]!) * 500) / 0.7) ** 2
      normal.tie(at(layout.shape, a), at(layout.shape, b), coefficients[a]!, coefficients[b]!, w)
    }
    // The face's depth, as much as no photo sees it from the side, stays the base head's: the
    // targets that move the face across also move it in depth, which a front photo can't check.
    const depthWeight = seesDepth() ? DEPTH_PRIOR_SIDE : DEPTH_PRIOR_FRONT
    const gram = depthGram(model)
    const gc = new Float64Array(nT)
    let cost = 0
    for (let i = 0; i < nT; i++) {
      let s = 0
      for (let j = 0; j < nT; j++) s += gram[i * nT + j]! * coefficients[j]!
      gc[i] = s
      cost += coefficients[i]! * s
    }
    normal.cost += depthWeight * cost
    if (layout.shape >= 0) {
      const { h, g, n } = normal
      for (let i = 0; i < nT; i++) {
        g[layout.shape + i] = g[layout.shape + i]! + depthWeight * gc[i]!
        for (let j = 0; j < nT; j++) {
          h[(layout.shape + i) * n + layout.shape + j] =
            h[(layout.shape + i) * n + layout.shape + j]! + depthWeight * gram[i * nT + j]!
        }
      }
    }
    // With no photo from the side, the nose stands as far out as people's: its tip (MediaPipe 4)
    // ahead of its base (2).
    if (
      options.pupils &&
      frontOnly &&
      NOSE_ENDS.every(([l]) => model.landmarkVertices[l * 3]! >= 0)
    ) {
      const target = NOSE_PROJECTION * restPupils
      let projection = -target
      for (const [landmark, sign] of NOSE_ENDS) {
        for (let m = 0; m < 3; m++) {
          const v = model.landmarkVertices[landmark * 3 + m]!
          const w = sign * model.landmarkWeights[landmark * 3 + m]!
          projection += w * shaped[v * 3 + 2]!
          if (layout.shape < 0) continue
          for (let b = model.basisStart[v]!; b < model.basisStart[v + 1]!; b++) {
            normal.add(
              layout.shape + model.basisTarget[b]!,
              w * model.basisDelta[b * 3 + 2]! * 1000,
            )
          }
        }
      }
      normal.commit(projection * 1000, 1 / NOSE_PROJECTION_SIGMA ** 2, Number.POSITIVE_INFINITY)
    }
    // One camera that stayed put: the turned head about as far away as in the front view.
    const depth = prepared[front]!.pivot[2]
    const facing = headAngles(cameras[front]!.rotation)
    prepared.forEach((p, k) => {
      if (k === front || !active[k]) return
      const sigma = depth * (sameCamera ? SAME_CAMERA_DEPTH : 0.3)
      normal.prior(at(layout.pose[k]!, 5), p.pivot[2], depth, 1 / (sigma * sigma))
      if (p.view.landmarks) return
      // A side view has only its outline, which could trade the head's turn, nod and lean
      // against the face's shape (a profile seen at 70° looks like a fuller one at 90°; a nod
      // like a jutting chin): the turn the capture asked for, with the front view's nod and
      // lean (the head turned, not tipped), holds them. The rotation still needed to reach that
      // pose (camera space) is split into its part about the head's up axis — the turn — and
      // the rest.
      const camera = cameras[k]!
      const wanted = headRotation(sideYaw[k]!, facing.pitch, facing.roll)
      const off = rotationLog(mulMat3(camera.rotation, transpose3(wanted)))
      const m = camera.rotation
      const up: Vec3 = [m[1], m[4], m[7]]
      const side: Vec3 = [m[0], m[3], m[6]]
      const third = cross3(up, side)
      const base = layout.pose[k]!
      for (const [axis, sigma] of [
        [up, sideYawSigma],
        [side, SIDE_TILT_SIGMA],
        [third, SIDE_TILT_SIGMA],
      ] as const) {
        const r = dot3(axis, off)
        const w = 1 / sigma ** 2
        if (base < 0) {
          normal.cost += w * r * r
          continue
        }
        normal.add(base, axis[0])
        normal.add(base + 1, axis[1])
        normal.add(base + 2, axis[2])
        normal.commit(r, w, Number.POSITIVE_INFINITY)
      }
    })
    // The head's size: the base head's, scaled so its pupils are as far apart as people's mostly
    // are. (Held on the size itself, not the shaped pupils: the eyes' own targets would let the
    // photos shrink the head and spread the eyes.)
    normal.prior(layout.grow, grow, size0, 1 / PUPIL_SIGMA ** 2)
    // The focal length within about a quarter of the usual one.
    normal.prior(layout.focal, Math.log(cameras[front]!.focal / focal0), 0, 1 / 0.25 ** 2)
    for (let c = 0; c < bumps.length; c++) {
      normal.prior(at(layout.field, c), bumps[c]!, 0, 1 / fieldModel.sizeSigma[c]! ** 2)
    }
    for (const [i, j, sigma] of fieldModel.pairs) {
      normal.tie(at(layout.field, i), at(layout.field, j), bumps[i]!, bumps[j]!, 1 / sigma ** 2)
    }
    for (let c = 0; c < bumps.length; c++) {
      const m = fieldModel.mirror[c]!
      if (m > c) normal.tie(at(layout.field, c), at(layout.field, m), bumps[c]!, bumps[m]!, 1)
    }
  }

  /** One damped Gauss–Newton step over `layout` (view `only`'s data alone, if given), kept only if it lowers the cost. */
  let damping = 1e-3
  const iterate = (layout: Layout, only = -1) => {
    for (const p of prepared) p.labels.fill(0)
    const normal = new Normal(layout.size)
    accumulate(normal, layout, only)
    priors(normal, layout)
    const before = normal.cost
    const saved = {
      coefficients: Float64Array.from(coefficients),
      bumps: Float64Array.from(bumps),
      grow,
      cameras: [...cameras],
      shaped,
      positions,
    }
    step(normal, layout, damping)
    const check = new Normal(1)
    accumulate(check, held(views.length), only)
    priors(check, held(views.length))
    if (check.cost > before * (1 + 1e-9)) {
      coefficients = saved.coefficients
      bumps = saved.bumps
      grow = saved.grow
      cameras.splice(0, cameras.length, ...saved.cameras)
      shaped = saved.shaped
      positions = saved.positions
      damping = Math.min(1e5, damping * 10)
      return { accepted: false, before, after: before }
    }
    damping = Math.max(1e-7, damping / 3)
    return { accepted: true, before, after: check.cost }
  }

  /** Steps over `layout` until they stop gaining (or `most` of them). */
  const converge = (layout: () => Layout, most: number, only = -1) => {
    damping = 1e-3
    let stalled = 0
    for (let round = 0; round < most && stalled < STALL_ROUNDS; round++) {
      const { accepted, before, after } = iterate(layout(), only)
      stalled = accepted && before - after > STALL_SHARE * before ? 0 : stalled + 1
    }
  }

  /** Solves view `k`'s camera alone, the face held (with its priors: a side view's turn). */
  const poseOnly = (k: number, most = 12) =>
    converge(
      () => {
        const layout: Layout = { ...held(views.length), size: 6 }
        layout.pose[k] = 0
        return layout
      },
      most,
      k,
    )

  const shapeLayout = (): Layout => {
    let size = nT
    const pose: number[] = []
    for (let k = 0; k < views.length; k++) {
      pose.push(active[k] ? size : -1)
      if (active[k]) size += 6
    }
    const focal =
      multi && sameCamera && views.every((view) => view.focal === undefined) ? size++ : -1
    return { shape: 0, pose, focal, field: -1, grow: size++, size }
  }

  const detailLayout = (): Layout => {
    const layout = shapeLayout()
    const field = layout.size
    return { ...layout, shape: -1, field, size: field + bumps.length }
  }

  // The front view's camera, then the face from it alone (its depth held to the base head's).
  for (let k = 0; k < views.length; k++) if (k !== front) active[k] = 0
  poseOnly(front)
  converge(shapeLayout, Math.ceil(rounds / 3))
  // The other views with landmarks: each placed by them, then the face from all of them.
  const sides: number[] = []
  for (let k = 0; k < views.length; k++) {
    if (k === front) continue
    cameras[k] = startCamera(model, views[k]!, cameras[front]!)
    if (views[k]!.landmarks) {
      active[k] = 1
      poseOnly(k)
    } else if (prepared[k]!.sdf) sides.push(k)
  }
  // A view whose landmarks put the head where its outline is not (MediaPipe finding a face in a
  // side view, turned the wrong way) is placed by its outline alone, as a side view.
  const misread = new Set<number>()
  refresh()
  for (let k = 0; k < views.length; k++) {
    const p = prepared[k]!
    if (k === front || !p.view.landmarks || !p.sdf) continue
    const camera = cameras[k]!
    const slid = slideToOutline(p, camera)
    if (slid.cost / (camera.focal / cameraDepth(camera, model.frame.eyes) / 1000) < MISREAD_MM)
      continue
    p.view = { ...p.view, landmarks: null, guessedYaw: true, yaw: 0 }
    cameras[k] = startCamera(model, p.view, cameras[front]!)
    sides.push(k)
    active[k] = 0
    misread.add(k)
  }
  if (views.some((view, k) => k !== front && active[k] && view.landmarks))
    converge(shapeLayout, Math.ceil(rounds / 3))
  // Then each side view. Its outline alone can trade the head's turn for the face's shape (a
  // cheek and nose seen at 55° can be shaped into the profile seen at 90°, and a head modelled
  // longer than the person's fits its outline best turned less), so the turn is held to the one
  // asked for (people asked for a full side view turn within about 10° of it) and only placed by
  // the outline. Which way the face points is the capture's, unless both the photo's bare skin
  // and the outline say it is the other way (a photo filed under the wrong side).
  for (const k of sides) {
    const tilt = headAngles(cameras[front]!.rotation)
    const p = prepared[k]!
    const view = p.view
    const asked = Math.abs(view.yaw) || Math.PI / 2
    const start = cameras[k]!
    const placedCost = (side: number) =>
      Math.min(
        ...SIDE_YAW_SEARCH.map(
          (offset) => turnedAndSlid(p, start, side * (asked + offset), tilt).cost,
        ),
      )
    const image = facingOf(view, start, model)
    let side = Math.sign(view.yaw) || image
    if (misread.has(k)) {
      // A misread view's side has only the photo to go by: unless its skin and its outline agree,
      // it is left out (placed on the wrong side, it would turn the whole fit inside out).
      if (!image || placedCost(-image) <= placedCost(image)) continue
    } else if (!side) side = placedCost(1) <= placedCost(-1) ? 1 : -1
    else if (image === -side && placedCost(-side) < placedCost(side)) side = -side
    sideYaw[k] = side * asked
    cameras[k] = turnedAndSlid(p, start, sideYaw[k]!, tilt).camera
    active[k] = 1
    poseOnly(k)
  }
  converge(shapeLayout, rounds)
  if (options.detail ?? multi) converge(detailLayout, rounds)

  const scored = new Normal(1)
  for (const p of prepared) p.labels.fill(0)
  const reports = accumulate(scored, held(views.length))
  return {
    coefficients,
    displacement: fieldDisplacement(model, bumps),
    positions,
    cameras,
    views: reports,
    cost: scored.cost,
  }

  /** Adds one view's residuals (mm); its report. */
  function addView(normal: Normal, layout: Layout, p: Prepared, k: number): FitViewReport {
    const { view } = p
    const camera = cameras[k]!
    const { q, xy } = projectRegion(positions, camera)
    const r = camera.rotation
    const centre = cameraCentre(camera)
    const yaw = headAngles(r).yaw
    const s = p.scale
    const poseAt = layout.pose[k]!

    /** One scalar residual whose image-space gradient is (du, dv) at a point mixing `verts` by `weights`. */
    const row = (
      residual: number,
      weight: number,
      verts: ArrayLike<number>,
      weights: ArrayLike<number>,
      du: number,
      dv: number,
    ) => {
      const pc: Vec3 = [0, 0, 0]
      for (let m = 0; m < verts.length; m++) {
        const v = verts[m]!
        const w = weights[m]!
        pc[0] += w * q[v * 3]!
        pc[1] += w * q[v * 3 + 1]!
        pc[2] += w * q[v * 3 + 2]!
      }
      const [ju, jv] = projectionJacobian(camera, pc)
      // d residual / d camera-space point (mm per m), then / d body-space point.
      const dq: Vec3 = [
        (du * ju[0] + dv * jv[0]) / s,
        (du * ju[1] + dv * jv[1]) / s,
        (du * ju[2] + dv * jv[2]) / s,
      ]
      const dx: Vec3 = [
        dq[0] * r[0] + dq[1] * r[3] + dq[2] * r[6],
        dq[0] * r[1] + dq[1] * r[4] + dq[2] * r[7],
        dq[0] * r[2] + dq[1] * r[5] + dq[2] * r[8],
      ]
      const g = Math.exp(grow) - 1
      for (let m = 0; m < verts.length; m++) {
        const v = verts[m]!
        // How much of a change to the shape the head's size passes on here.
        const w = weights[m]! * (1 + model.reach[v]! * g)
        if (layout.grow >= 0) {
          const e = weights[m]! * model.reach[v]! * (g + 1)
          normal.add(
            layout.grow,
            e *
              (dx[0] * (shaped[v * 3]! - pivotBody[0]) +
                dx[1] * (shaped[v * 3 + 1]! - pivotBody[1]) +
                dx[2] * (shaped[v * 3 + 2]! - pivotBody[2])),
          )
        }
        if (layout.shape >= 0) {
          const d = model.basisDelta
          for (let b = model.basisStart[v]!; b < model.basisStart[v + 1]!; b++) {
            normal.add(
              layout.shape + model.basisTarget[b]!,
              w * (dx[0] * d[b * 3]! + dx[1] * d[b * 3 + 1]! + dx[2] * d[b * 3 + 2]!),
            )
          }
        }
        if (layout.field >= 0) {
          // Bump heights are mm: a millimetre along the normal.
          const along =
            (w *
              (dx[0] * model.normals[v * 3]! +
                dx[1] * model.normals[v * 3 + 1]! +
                dx[2] * model.normals[v * 3 + 2]!)) /
            1000
          for (let c = fieldModel.start[v]!; c < fieldModel.start[v + 1]!; c++) {
            normal.add(layout.field + fieldModel.centre[c]!, along * fieldModel.weight[c]!)
          }
        }
      }
      if (poseAt >= 0) {
        const turn = turnJacobian(pc, p.pivot)
        for (let j = 0; j < 3; j++) {
          normal.add(poseAt + j, dq[0] * turn[j]! + dq[1] * turn[3 + j]! + dq[2] * turn[6 + j]!)
          normal.add(poseAt + 3 + j, dq[j]!)
        }
      }
      if (layout.focal >= 0) {
        const u = (camera.focal * pc[0]) / pc[2]
        const v = (camera.focal * pc[1]) / pc[2]
        normal.add(layout.focal, (du * u + dv * v) / s)
      }
      normal.commit(residual, weight, HUBER)
    }

    let landmarkSum = 0
    let landmarkWeight = 0
    const lm = view.landmarks
    // MediaPipe's points on a turned face lean towards its average face: they count less.
    const frontness = Math.exp(-((yaw / landmarkTurn) ** 2))
    // The image direction across the head (perpendicular to its up axis): what a sliding point says.
    const acrossLength = Math.hypot(r[1], r[4]) || 1
    const across: [number, number] = [r[4] / acrossLength, -r[1] / acrossLength]
    if (lm) {
      const verts = new Int32Array(3)
      const weights = new Float32Array(3)
      const inside = insideMouth(model)
      for (let i = 0; i < 478; i++) {
        let w = LANDMARK_WEIGHT[i]!
        if (w === 0 || inside[i] || model.landmarkVertices[i * 3]! < 0) continue
        // The irises follow the gaze, which only a front photo has on the camera.
        if (isIris(i) && Math.abs(yaw) > IRIS_TURN) continue
        if (isEye(i) && (view.blink ?? 0) > 0.4) w *= 0.2
        if (isLip(i) && (view.mouthOpen ?? 0) > 0.25) w *= 0.3
        let u = 0
        let v = 0
        let nx = 0
        let ny = 0
        let nz = 0
        let px = 0
        let py = 0
        let pz = 0
        for (let m = 0; m < 3; m++) {
          const vert = model.landmarkVertices[i * 3 + m]!
          const weight = model.landmarkWeights[i * 3 + m]!
          verts[m] = vert
          weights[m] = weight
          u += weight * xy[vert * 2]!
          v += weight * xy[vert * 2 + 1]!
          nx += weight * model.normals[vert * 3]!
          ny += weight * model.normals[vert * 3 + 1]!
          nz += weight * model.normals[vert * 3 + 2]!
          px += weight * positions[vert * 3]!
          py += weight * positions[vert * 3 + 1]!
          pz += weight * positions[vert * 3 + 2]!
        }
        const ex = centre[0] - px
        const ey = centre[1] - py
        const ez = centre[2] - pz
        const facing =
          (nx * ex + ny * ey + nz * ez) / (Math.hypot(nx, ny, nz) * Math.hypot(ex, ey, ez) || 1)
        if (!isIris(i)) w *= frontness * smooth(0.15, 0.45, facing)
        if (w < 0.01) continue
        const ru = (u - lm[i * 2]!) / s
        const rv = (v - lm[i * 2 + 1]!) / s
        if (isSliding(i)) {
          const rx = ru * across[0] + rv * across[1]
          row(rx, w / LANDMARK_SIGMA ** 2, verts, weights, across[0], across[1])
          landmarkSum += w * rx * rx * 2
        } else {
          row(ru, w / LANDMARK_SIGMA ** 2, verts, weights, 1, 0)
          row(rv, w / LANDMARK_SIGMA ** 2, verts, weights, 0, 1)
          landmarkSum += w * (ru * ru + rv * rv)
        }
        landmarkWeight += w
      }
    }

    const verts3 = new Int32Array(3)
    const weights3 = new Float32Array(3)
    const pointOf = (c: SmoothContourPoint) => {
      verts3[0] = c.a
      verts3[1] = c.b
      verts3[2] = c.c
      weights3[0] = c.wa
      weights3[1] = c.wb
      weights3[2] = c.wc
    }

    // Outline landmarks: each slides along the face's occluding contour. MediaPipe draws them where
    // its average face's edge would be, which on a turned face is the far cheek's guess and under
    // hair is the hair's edge: they count in the front view, and only where the photo shows skin.
    let outlinePoints = 0
    const outlineWeight = Math.exp(-((yaw / OUTLINE_TURN) ** 2))
    if (lm && outlineWeight > 0.01) {
      const contour = smoothContour(
        positions,
        normalsNow,
        xy,
        model.triangles,
        centre,
        r,
        (a, b, c) => flag.face[a] === 1 && flag.face[b] === 1 && flag.face[c] === 1,
        null,
      )
      const gate = CONTOUR_GATE * s
      for (const i of OVAL) {
        const lx = lm[i * 2]!
        const ly = lm[i * 2 + 1]!
        if (view.covered && sampleByte(view.covered, view.width, view.height, lx, ly) > 127)
          continue
        let best: SmoothContourPoint | null = null
        let bestDistance = gate
        for (const c of contour) {
          const d = Math.hypot(c.x - lx, c.y - ly)
          if (d < bestDistance) {
            bestDistance = d
            best = c
          }
        }
        if (!best) continue
        const residual = (best.nx * (best.x - lx) + best.ny * (best.y - ly)) / s
        pointOf(best)
        row(
          residual,
          (0.6 * outlineWeight) / CONTOUR_SIGMA ** 2,
          verts3,
          weights3,
          best.nx,
          best.ny,
        )
        outlinePoints++
      }
    }

    // The person's outline.
    let skinOutlinePoints = 0
    let skinOutlineSum = 0
    // How deep inside it to look for skin and strands: 1.5 to 4 mm.
    const skinDepths = [1.5, 2.5, 4].map((mm) => Math.max(2, mm * s))
    if (p.sdf) {
      const points = outlineOf(
        model,
        flag,
        positions,
        normalsNow,
        xy,
        camera,
        view.width,
        view.height,
      )
      for (const c of points) {
        const [d, gx, gy] = sampleField(p.sdf, view.width, view.height, c.x, c.y)
        // The profile from the brows to under the chin makes the outline with bare skin, unless
        // the photo shows strands (a moustache, a fringe) just inside its outline there; the rest
        // of the face does where the photo shows skin there (hair falling past the cheeks makes
        // the outline instead). A mask's edge strays a pixel or two past the skin's, so a few
        // depths in are looked at. Each vertex is judged once a round, so that a step's check
        // weighs the outline as the step did.
        const v0 = dominant(c)
        let label = p.labels[v0]!
        if (!label) {
          let bare = flag.bare[v0] === 1
          if (view.skin || view.covered) {
            const length = Math.hypot(gx, gy) || 1
            let skin = 0
            let covered = view.covered ? 255 : 0
            for (const depth of skinDepths) {
              const x = c.x - ((d + depth) * gx) / length
              const y = c.y - ((d + depth) * gy) / length
              if (view.skin)
                skin = Math.max(skin, sampleByte(view.skin, view.width, view.height, x, y))
              // Strands only if they go on inwards: an outline's edge is busy too.
              if (view.covered)
                covered = Math.min(covered, sampleByte(view.covered, view.width, view.height, x, y))
            }
            const strands = covered > 127
            // Facing the camera, the profile's sides are the jaw's edge, which hair can hang past.
            const always =
              flag.profile[v0] === 1 &&
              (Math.abs(yaw) > SIDE_VIEW ||
                Math.abs(model.rest[v0 * 3]! - model.frame.eyes[0]) < 0.025)
            const seen = skin > 127
            bare =
              always || (!strands && (view.skin ? seen && (bare || flag.face[v0] === 1) : bare))
          }
          label = bare ? 1 : 2
          p.labels[v0] = label
        }
        const bare = label === 1
        const residual = d / s
        if (!bare && residual <= 0) continue
        pointOf(c)
        row(residual, 1 / (bare ? SKIN_SIGMA : COVERED_SIGMA) ** 2, verts3, weights3, gx, gy)
        if (bare) {
          skinOutlinePoints++
          skinOutlineSum += residual * residual
        }
      }
    }
    return {
      landmarksMm: landmarkWeight ? Math.sqrt(landmarkSum / landmarkWeight / 2) : 0,
      outlinePoints,
      skinOutlinePoints,
      skinOutlineMm: skinOutlinePoints ? Math.sqrt(skinOutlineSum / skinOutlinePoints) : 0,
      yaw,
    }
  }

  /** A side view's camera with the head turned by `yaw` (and tilted as in the front view), slid to where its outline fits. */
  function turnedAndSlid(
    p: Prepared,
    start: Camera,
    yaw: number,
    tilt: { pitch: number; roll: number },
  ) {
    const { view } = p
    let best: { camera: Camera; cost: number } | null = null
    for (const factor of SIDE_DEPTH_SEARCH) {
      const camera = cameraLookingAt({
        width: view.width,
        height: view.height,
        focal: start.focal,
        rotation: headRotation(yaw, tilt.pitch, tilt.roll),
        target: pivotBody,
        distance: cameraDepth(start, pivotBody) * factor,
      })
      const found = slideToOutline(p, camera)
      if (!best || found.cost < best.cost) best = found
    }
    return best!
  }

  /** The camera slid across the image to where the head's outline lies best on the photo's. */
  function slideToOutline(p: Prepared, camera: Camera): { camera: Camera; cost: number } {
    const { view } = p
    const sdf = p.sdf!
    const { xy } = projectRegion(positions, camera)
    const normals = vertexNormals(positions, model.triangles, nV)
    const points = outlineOf(model, flag, positions, normals, xy, camera, view.width, view.height)
    const depth = cameraDepth(camera, model.frame.eyes)
    const scale = camera.focal / depth / 1000
    const clamp = 15 * scale
    const costAt = (dx: number, dy: number) => {
      let cost = 0
      for (const c of points) {
        const d = sampleField(sdf, view.width, view.height, c.x + dx, c.y + dy)[0]
        const v = dominant(c)
        cost += flag.bare[v] ? Math.min(Math.abs(d), clamp) : 0.5 * Math.min(Math.max(d, 0), clamp)
      }
      return cost / Math.max(1, points.length)
    }
    let bx = 0
    let by = 0
    let bestCost = costAt(0, 0)
    for (const [reach, stepMm] of [
      [120, 8],
      [16, 2],
      [3, 0.5],
    ] as const) {
      const ox = bx
      const oy = by
      const range = reach * scale
      const stride = stepMm * scale
      for (let dy = -range; dy <= range; dy += stride) {
        for (let dx = -range; dx <= range; dx += stride) {
          const cost = costAt(ox + dx, oy + dy)
          if (cost < bestCost) {
            bestCost = cost
            bx = ox + dx
            by = oy + dy
          }
        }
      }
    }
    return {
      camera: {
        ...camera,
        translation: [
          camera.translation[0] + (bx / camera.focal) * depth,
          camera.translation[1] + (by / camera.focal) * depth,
          camera.translation[2],
        ],
      },
      cost: bestCost,
    }
  }
}

const emptyReport: FitViewReport = {
  landmarksMm: 0,
  outlinePoints: 0,
  skinOutlinePoints: 0,
  skinOutlineMm: 0,
  yaw: 0,
}

/**
 * Which way a side view's face points (+1 the image's right, −1 its left, 0 unsure): the side of
 * the head's outline that is bare skin — the profile — rather than hair. Read over the rows from
 * the eyes to the chin, just inside the outline.
 */
export function facingOf(view: FitView, camera: Camera, model: HeadModel): -1 | 0 | 1 {
  const { mask, skin, covered, width, height } = view
  if (!(mask && (skin || covered))) return 0
  // Bare skin counts for a side, strands against it.
  const bareAt = (i: number) => ((skin?.[i] ?? 128) - (covered?.[i] ?? 0)) / 255
  let top = -1
  for (let y = 0; y < height && top < 0; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]! > 127) {
        top = y
        break
      }
    }
  }
  if (top < 0) return 0
  // The head's height in pixels, at the distance the camera has it.
  const head =
    (camera.focal * (model.frame.topY - model.frame.chinY)) / cameraDepth(camera, model.frame.eyes)
  // Its middle: the mean column of the outline's top fifth.
  let sum = 0
  let count = 0
  for (let y = top; y < Math.min(height, top + head * 0.2); y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]! > 127) {
        sum += x
        count++
      }
    }
  }
  if (!count) return 0
  const middle = sum / count
  const reach = head * 0.75
  const inset = Math.max(2, Math.round(head * 0.02))
  let left = 0
  let right = 0
  let rows = 0
  for (let y = Math.round(top + head * 0.4); y < Math.min(height, top + head * 0.95); y++) {
    let l = -1
    let r = -1
    for (
      let x = Math.max(0, Math.round(middle - reach));
      x < Math.min(width, middle + reach);
      x++
    ) {
      if (mask[y * width + x]! <= 127) continue
      if (l < 0) l = x
      r = x
    }
    if (l < 0 || r - l < 4 * inset) continue
    rows++
    left += bareAt(y * width + l + inset)
    right += bareAt(y * width + r - inset)
  }
  if (rows < 5) return 0
  const lean = (right - left) / rows
  return lean > 0.2 ? 1 : lean < -0.2 ? -1 : 0
}
