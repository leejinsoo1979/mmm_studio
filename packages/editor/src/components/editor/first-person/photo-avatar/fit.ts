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
import { type HeadModel, landmarkPosition, shapePositions } from './head-model'
import { isEye, isLip, LANDMARK_WEIGHT, OVAL } from './landmark-sets'
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
  type ContourPoint,
  type EdgeList,
  edgeList,
  outerContour,
  sampleField,
  signedDistanceField,
} from './silhouette'

/**
 * Fitting the base head to photos of a face — one, or several from around
 * it — so that it is the person's shape seen from any side, not a mask that
 * matches only from the front.
 *
 * One shared face shape (MPFB's face targets, then a smooth field of bumps
 * along the skin's normals) and a camera per photo are solved together, by
 * Gauss–Newton, from:
 * - MediaPipe's landmarks as fixed points on the skin, in every photo that
 *   has them, each counting less the further the face is turned (MediaPipe
 *   draws a turned face's points towards its average face): they place the
 *   eyes, nose and mouth across the face, and triangulate between photos;
 * - the outline landmarks, which mark where the face's edge shows: they
 *   slide along the head's own outline in each view (the cheek, the jaw
 *   seen from the side), never pinned to one spot on the skin;
 * - the person's outline (a segmentation mask) against the head's: the
 *   profile in a side photo — forehead slope, nose bridge and tip, lips,
 *   chin — and the cheek and jaw in a ¾ one. Where skin makes the outline
 *   it must match both ways; where hair or a beard may lie over it, the
 *   head need only stay inside.
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
  iterations?: number
  /** How fast a turned view's landmarks lose weight (degrees for 1/e): MediaPipe's points lean to its average face. */
  landmarkTurn?: number
  /** How far (degrees) a side view's turn may stray from the one asked for. */
  sideYawSigma?: number
  /** Score this head (region positions) and these cameras instead of solving. */
  hold?: { positions: Float64Array; cameras: Camera[] }
  /** Told every outline point of the final scoring (where, and how it was held), for drawing. */
  trace?: (
    view: number,
    x: number,
    y: number,
    kind: 'skin' | 'covered' | 'landmark',
    residual: number,
  ) => void
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
/** How far below the chin the outline still counts (m): below is neck, collar and shoulders. */
const NECK_CUT = 0.03
/** The bumps: their spacing and width (m), and their priors (mm): size, and between neighbours. */
const FIELD_SPACING = 0.011
const FIELD_RADIUS = 0.011
const FIELD_SIZE_SIGMA = 3
const FIELD_SMOOTH_SIGMA = 1.2
/** How far (degrees) a side view's turn may stray from the one the capture asked for. */
const SIDE_YAW_DEGREES = 12
/** How fast (degrees for 1/e) a turned view's landmarks lose weight. */
const LANDMARK_TURN = 40
/** How far (radians) a side view's nod and lean may stray from the front view's. */
const SIDE_TILT_SIGMA = (4 * Math.PI) / 180
/** With one camera that stayed put, how much the head's distance may change between views. */
const SAME_CAMERA_DEPTH = 0.04
/** A view turned more than this (radians) shows the face's depth. */
const SIDE_VIEW = (25 * Math.PI) / 180
/**
 * How strongly the face's depth keeps to the base head's (per mm² of the face's mean squared
 * change in depth): as many as 60 measurements of it when only front photos are given, a few
 * when side ones measure it.
 */
const DEPTH_PRIOR_FRONT = 60
const DEPTH_PRIOR_SIDE = 3

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
/** The turns (radians, towards the camera first) a side view is tried at around the one asked for. */
const SIDE_YAW_TRIES = [0, -10, -20, 10].map((degrees) => (degrees * Math.PI) / 180)

type Prepared = {
  view: FitView
  sdf: Float32Array | null
  /** Pixels per mm at the face, and the head's pivot in camera space: refreshed with the camera. */
  scale: number
  pivot: Vec3
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

/** Which unknowns a solve has: each part's first index, −1 where that part is held. */
type Layout = { shape: number; pose: number[]; focal: number; field: number; size: number }

const held = (views: number): Layout => ({
  shape: -1,
  pose: new Array(views).fill(-1),
  focal: -1,
  field: -1,
  size: 1,
})

/** The bumps along the normals: smooth Gaussian blobs centred on a sparse set of skin vertices. */
type Field = {
  centres: number[]
  /** Each centre's mirror image across the face's midline (itself when on it). */
  mirror: Int32Array
  /** Neighbouring centres, held to similar bumps. */
  pairs: [number, number][]
  /** Per region vertex: CSR list of (centre, weight). */
  start: Uint32Array
  centre: Uint32Array
  weight: Float32Array
}

const edgesOf = new WeakMap<HeadModel, EdgeList>()
const fieldsOf = new WeakMap<HeadModel, Field>()
const flagsOf = new WeakMap<HeadModel, Flags>()

function edges(model: HeadModel): EdgeList {
  let found = edgesOf.get(model)
  if (!found) {
    found = edgeList(model.triangles)
    edgesOf.set(model, found)
  }
  return found
}

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

function fieldOf(model: HeadModel): Field {
  const cached = fieldsOf.get(model)
  if (cached) return cached
  const { rest, skin, frame } = model
  const n = model.vertices.length
  // The face and the front of the head: the subject's left half and the midline, mirrored after.
  const candidates: number[] = []
  for (let i = 0; i < n; i++) {
    if (!skin[i] || rest[i * 3]! < -0.0005) continue
    if (rest[i * 3 + 1]! < frame.chinY - NECK_CUT || rest[i * 3 + 2]! < frame.earZ - 0.02) continue
    candidates.push(i)
  }
  const chosen: number[] = []
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
    if (far < 0 || farDistance < FIELD_SPACING) break
    next = far
  }
  const centres: number[] = []
  const mirror: number[] = []
  for (const v of chosen) {
    const x = rest[v * 3]!
    if (x < 0.002) {
      centres.push(v)
      mirror.push(centres.length - 1)
      continue
    }
    centres.push(v, nearestSkinVertex(model, -x, rest[v * 3 + 1]!, rest[v * 3 + 2]!))
    mirror.push(centres.length - 1, centres.length - 2)
  }
  const pairs: [number, number][] = []
  for (let a = 0; a < centres.length; a++) {
    for (let b = a + 1; b < centres.length; b++) {
      if (distance3(rest, centres[a]!, centres[b]!) < FIELD_SPACING * 1.8) pairs.push([a, b])
    }
  }
  // Gaussian weights, normalised where blobs overlap so they never add past 1.
  const start = new Uint32Array(n + 1)
  const ids: number[] = []
  const weights: number[] = []
  const spread = 2 * FIELD_RADIUS * FIELD_RADIUS
  const found: [number, number][] = []
  for (let i = 0; i < n; i++) {
    found.length = 0
    let total = 0
    if (skin[i]) {
      for (let c = 0; c < centres.length; c++) {
        const v = centres[c]!
        const d2 =
          (rest[i * 3]! - rest[v * 3]!) ** 2 +
          (rest[i * 3 + 1]! - rest[v * 3 + 1]!) ** 2 +
          (rest[i * 3 + 2]! - rest[v * 3 + 2]!) ** 2
        const w = Math.exp(-d2 / spread)
        if (w < 1e-3) continue
        found.push([c, w])
        total += w
      }
    }
    const scale = model.reach[i]! / Math.max(1, total)
    for (const [c, w] of found) {
      ids.push(c)
      weights.push(w * scale)
    }
    start[i + 1] = ids.length
  }
  const made: Field = {
    centres,
    mirror: Int32Array.from(mirror),
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
  /** The face ahead of the ears, above the neck cut: the outline landmarks' outline. */
  face: Uint8Array
  /** Brow to chin ahead of the ears: an outline of bare skin, unless the photo shows otherwise. */
  bare: Uint8Array
  /** High enough to count in the outline at all. */
  outline: Uint8Array
  /**
   * The profile's middle band, brows to lower lip: nose, lips and brows make the outline there
   * whatever the photo's detail says (lashes, nostrils and the lips' line are busy, but no hair
   * stands off them).
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
  const lipY = height(17, frame.chinY + 0.025) - 0.005
  for (let i = 0; i < n; i++) {
    if (!model.skin[i]) continue
    const y = rest[i * 3 + 1]!
    const z = rest[i * 3 + 2]!
    if (y > frame.chinY - NECK_CUT) outline[i] = 1
    if (z > frame.earZ && y > frame.chinY - 0.02) face[i] = 1
    if (z > frame.earZ && y > frame.chinY - NECK_CUT && y < frame.eyes[1] + 0.03) bare[i] = 1
    if (z > frame.earZ && Math.abs(rest[i * 3]!) < 0.025 && y > lipY && y < browY) profile[i] = 1
  }
  const made = { face, bare, outline, profile }
  flagsOf.set(model, made)
  return made
}

/** The head's pivot (body space): behind the eyes, where a turning head turns about. */
const pivotOf = (model: HeadModel): Vec3 => [
  model.frame.eyes[0],
  model.frame.eyes[1] - 0.02,
  model.frame.eyes[2] - 0.07,
]

const cameraDepth = (camera: Camera, p: Vec3) =>
  apply3(camera.rotation, p)[2] + camera.translation[2]

/** A first camera for a view: from its irises when it has landmarks, else at the front view's distance. */
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
  return cameraLookingAt({
    width: view.width,
    height: view.height,
    focal,
    rotation,
    target: eyes,
    distance: front ? cameraDepth(front, eyes) : 0.5,
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

/** The face's occluding contour (outer or inner) from a camera: what MediaPipe's outline follows. */
function faceContour(
  positions: Float64Array,
  xy: Float64Array,
  model: HeadModel,
  edgeSet: EdgeList,
  centre: Vec3,
  face: Uint8Array,
): ContourPoint[] {
  const { triangles } = model
  const count = triangles.length / 3
  const facing = new Int8Array(count)
  for (let t = 0; t < count; t++) {
    const i = triangles[t * 3]! * 3
    const j = triangles[t * 3 + 1]! * 3
    const k = triangles[t * 3 + 2]! * 3
    const ux = positions[j]! - positions[i]!
    const uy = positions[j + 1]! - positions[i + 1]!
    const uz = positions[j + 2]! - positions[i + 2]!
    const vx = positions[k]! - positions[i]!
    const vy = positions[k + 1]! - positions[i + 1]!
    const vz = positions[k + 2]! - positions[i + 2]!
    const s =
      (uy * vz - uz * vy) * (centre[0] - positions[i]!) +
      (uz * vx - ux * vz) * (centre[1] - positions[i + 1]!) +
      (ux * vy - uy * vx) * (centre[2] - positions[i + 2]!)
    facing[t] = s > 0 ? 1 : -1
  }
  const out: ContourPoint[] = []
  for (let e = 0; e < edgeSet.a.length; e++) {
    const l = edgeSet.left[e]!
    const r = edgeSet.right[e]!
    if (r < 0 || facing[l] === facing[r]) continue
    const a = edgeSet.a[e]!
    const b = edgeSet.b[e]!
    if (!(face[a] && face[b])) continue
    const ax = xy[a * 2]!
    const ay = xy[a * 2 + 1]!
    const bx = xy[b * 2]!
    const by = xy[b * 2 + 1]!
    let nx = ay - by
    let ny = bx - ax
    const length = Math.hypot(nx, ny)
    if (length < 1e-9) continue
    nx /= length
    ny /= length
    const x = (ax + bx) / 2
    const y = (ay + by) / 2
    const front = facing[l]! > 0 ? l : r
    for (let k = 0; k < 3; k++) {
      const v = triangles[front * 3 + k]!
      if (v !== a && v !== b && (xy[v * 2]! - x) * nx + (xy[v * 2 + 1]! - y) * ny > 0) {
        nx = -nx
        ny = -ny
      }
    }
    out.push({ a, b, x, y, nx, ny })
  }
  return out
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
  const iterations = options.iterations ?? 14
  const flag = flags(model)
  const edgeSet = edges(model)
  const fieldModel = fieldOf(model)
  const pivotBody = pivotOf(model)
  const nT = model.targetNames.length
  const multi = views.length > 1
  const prepared: Prepared[] = views.map((view) => ({
    view,
    sdf: view.mask ? signedDistanceField(view.mask, view.width, view.height, 127) : null,
    scale: 1,
    pivot: [0, 0, 0],
  }))

  // The view facing the camera most squarely, among those with landmarks, sets the rest.
  let front = views.findIndex((view) => view.landmarks)
  if (front < 0) throw new Error('no view shows a face')
  views.forEach((view, k) => {
    if (view.landmarks && Math.abs(view.yaw) < Math.abs(views[front]!.yaw)) front = k
  })

  let coefficients = new Float64Array(nT)
  let bumps = new Float64Array(fieldModel.centres.length)
  const cameras: Camera[] = views.map((view) => startCamera(model, view, null))
  const focal0 = cameras[front]!.focal
  let positions = shapePositions(model, coefficients)

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

  /** Whether the outline points are told to `options.trace` (the final scoring only). */
  let tracing = false
  /** The views taking part so far (side views join once the face has a shape to place them by). */
  const active = new Uint8Array(views.length).fill(1)

  /** Every active view's residuals (or only view `only`'s) at the current state. */
  const accumulate = (normal: Normal, layout: Layout, only = -1): FitViewReport[] => {
    refresh()
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
    positions = shapePositions(model, coefficients, fieldDisplacement(model, bumps))
  }

  const poseOnly = (k: number, rounds = 10) => {
    for (let round = 0; round < rounds; round++) {
      const layout: Layout = { ...held(views.length), size: 6 }
      layout.pose[k] = 0
      const normal = new Normal(6)
      accumulate(normal, layout, k)
      step(normal, layout, 1e-3)
    }
  }

  /** The turn each side view (no landmarks) was asked for, on the side its outline says. */
  const sideYaw = views.map((view) => view.yaw)
  if (options.hold) {
    // Scoring a given head and cameras (what the truth would cost), nothing solved.
    positions = options.hold.positions
    cameras.splice(0, cameras.length, ...options.hold.cameras)
    const scored = new Normal(1)
    tracing = true
    const reports = accumulate(scored, held(views.length))
    return {
      coefficients,
      displacement: new Float64Array(positions.length),
      positions,
      cameras,
      views: reports,
      cost: scored.cost,
    }
  }
  poseOnly(front)
  const sides: number[] = []
  for (let k = 0; k < views.length; k++) {
    if (k === front) continue
    cameras[k] = startCamera(model, views[k]!, cameras[front]!)
    if (views[k]!.landmarks) poseOnly(k)
    else if (prepared[k]!.sdf) {
      sides.push(k)
      active[k] = 0
    } else active[k] = 0
  }

  const shapeLayout = (): Layout => {
    let size = nT
    const pose: number[] = []
    for (let k = 0; k < views.length; k++) {
      pose.push(active[k] ? size : -1)
      if (active[k]) size += 6
    }
    const focal =
      multi && sameCamera && views.every((view) => view.focal === undefined) ? size++ : -1
    return { shape: 0, pose, focal, field: -1, size }
  }

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
    // The focal length within about a quarter of the usual one.
    normal.prior(layout.focal, Math.log(cameras[front]!.focal / focal0), 0, 1 / 0.25 ** 2)
    for (let c = 0; c < bumps.length; c++) {
      normal.prior(at(layout.field, c), bumps[c]!, 0, 1 / FIELD_SIZE_SIGMA ** 2)
    }
    for (const [i, j] of fieldModel.pairs) {
      normal.tie(
        at(layout.field, i),
        at(layout.field, j),
        bumps[i]!,
        bumps[j]!,
        1 / FIELD_SMOOTH_SIGMA ** 2,
      )
    }
    for (let c = 0; c < bumps.length; c++) {
      const m = fieldModel.mirror[c]!
      if (m > c) normal.tie(at(layout.field, c), at(layout.field, m), bumps[c]!, bumps[m]!, 1)
    }
  }

  /** One damped Gauss–Newton step over `layout`, kept only if it lowers the cost. */
  let damping = 1e-3
  const iterate = (layout: Layout) => {
    const normal = new Normal(layout.size)
    accumulate(normal, layout)
    priors(normal, layout)
    const before = normal.cost
    const saved = {
      coefficients: Float64Array.from(coefficients),
      bumps: Float64Array.from(bumps),
      cameras: [...cameras],
      positions,
    }
    step(normal, layout, damping)
    const check = new Normal(1)
    accumulate(check, held(views.length))
    priors(check, held(views.length))
    if (check.cost > before * (1 + 1e-9)) {
      coefficients = saved.coefficients
      bumps = saved.bumps
      cameras.splice(0, cameras.length, ...saved.cameras)
      positions = saved.positions
      damping = Math.min(1e5, damping * 10)
      return false
    }
    damping = Math.max(1e-7, damping / 3)
    return true
  }

  const snapshot = () => ({
    coefficients: Float64Array.from(coefficients),
    bumps: Float64Array.from(bumps),
    cameras: [...cameras],
    positions,
    damping,
  })
  const restore = (saved: ReturnType<typeof snapshot>) => {
    coefficients = Float64Array.from(saved.coefficients)
    bumps = Float64Array.from(saved.bumps)
    cameras.splice(0, cameras.length, ...saved.cameras)
    positions = saved.positions
    damping = saved.damping
  }
  const totalCost = () => {
    const check = new Normal(1)
    accumulate(check, held(views.length))
    priors(check, held(views.length))
    return check.cost
  }

  // The face from the views with landmarks first.
  for (let iteration = 0; iteration < Math.ceil(iterations / 2); iteration++) iterate(shapeLayout())
  // Then each side view: its outline alone could trade the turn for the face's shape (a profile
  // seen at 70° looks much like a fuller one at 90°), so it is tried at a few turns around the
  // one asked for, the face adapting to each, and the turn that explains it best is kept.
  for (const k of sides) {
    active[k] = 1
    const start = snapshot()
    const tilt = headAngles(cameras[front]!.rotation)
    const view = views[k]!
    const placed = placeByOutline(model, flag, edgeSet, prepared[k]!, cameras[k]!, positions, tilt)
    // The way the face points: as the capture said, else as its bare-skin outline shows, else
    // both are tried. (The outline can't be trusted over the capture: a bald head is bare skin
    // all round, and a stubbled jaw or busy profile reads as covered.)
    const facing = Math.sign(view.yaw) || facingOf(view, placed, model)
    const sides = facing ? [facing] : [1, -1]
    let best: { cost: number; state: ReturnType<typeof snapshot>; wanted: number } | null = null
    for (const side of sides) {
      sideYaw[k] = side * Math.abs(view.yaw || Math.PI / 2)
      for (const offset of SIDE_YAW_TRIES) {
        restore(start)
        const yaw = sideYaw[k]! + side * offset
        cameras[k] = turnedAndSlid(
          model,
          flag,
          edgeSet,
          prepared[k]!,
          placed,
          yaw,
          positions,
          tilt,
        ).camera
        poseOnly(k, 4)
        for (let iteration = 0; iteration < 4; iteration++) iterate(shapeLayout())
        const cost = totalCost()
        if (!best || cost < best.cost) best = { cost, state: snapshot(), wanted: sideYaw[k]! }
      }
    }
    restore(best!.state)
    sideYaw[k] = best!.wanted
  }
  for (let iteration = 0; iteration < iterations; iteration++) iterate(shapeLayout())
  if (options.detail ?? multi) {
    damping = 1e-3
    for (let round = 0; round < 6; round++) {
      iterate({ ...held(views.length), shape: -1, field: 0, size: bumps.length })
    }
  }

  const scored = new Normal(1)
  tracing = true
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
      for (let m = 0; m < verts.length; m++) {
        const v = verts[m]!
        const w = weights[m]!
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
    if (lm) {
      const verts = new Int32Array(3)
      const weights = new Float32Array(3)
      for (let i = 0; i < 468; i++) {
        let w = LANDMARK_WEIGHT[i]!
        if (w === 0) continue
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
        w *= frontness * smooth(0.15, 0.45, facing)
        if (w < 0.01) continue
        const ru = (u - lm[i * 2]!) / s
        const rv = (v - lm[i * 2 + 1]!) / s
        row(ru, w / LANDMARK_SIGMA ** 2, verts, weights, 1, 0)
        row(rv, w / LANDMARK_SIGMA ** 2, verts, weights, 0, 1)
        landmarkSum += w * (ru * ru + rv * rv)
        landmarkWeight += w
      }
    }

    // Outline landmarks: each slides along the face's occluding contour.
    let outlinePoints = 0
    if (lm) {
      const contour = faceContour(positions, xy, model, edgeSet, centre, flag.face)
      const gate = CONTOUR_GATE * s
      for (const i of OVAL) {
        const lx = lm[i * 2]!
        const ly = lm[i * 2 + 1]!
        let best: ContourPoint | null = null
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
        if (tracing) options.trace?.(k, best.x, best.y, 'landmark', residual)
        row(residual, 0.6 / CONTOUR_SIGMA ** 2, [best.a, best.b], [0.5, 0.5], best.nx, best.ny)
        outlinePoints++
      }
    }

    // The person's outline.
    let skinOutlinePoints = 0
    let skinOutlineSum = 0
    // How deep inside it to look for skin and strands: 1.5 to 4 mm.
    const skinDepths = [1.5, 2.5, 4].map((mm) => Math.max(2, mm * s))
    if (p.sdf) {
      const { points } = outerContour(
        positions,
        xy,
        model.triangles,
        edgeSet,
        centre,
        view.width,
        view.height,
        (a, b) => flag.outline[a] === 1 && flag.outline[b] === 1,
      )
      for (const c of points) {
        const [d, gx, gy] = sampleField(p.sdf, view.width, view.height, c.x, c.y)
        // The profile from the brows to the lower lip makes the outline with bare skin, unless
        // the photo shows strands (a moustache, a fringe) just inside its outline there; the rest
        // of the face does where the photo shows skin there (hair falling past the cheeks makes
        // the outline instead). A mask's edge strays a pixel or two past the skin's, so a few
        // depths in are looked at.
        let bare = flag.bare[c.a] === 1 && flag.bare[c.b] === 1
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
          const always = flag.profile[c.a] === 1 && flag.profile[c.b] === 1
          const seen = skin > 127
          bare = always || (!strands && (view.skin ? seen && (bare || flag.face[c.a] === 1) : bare))
        }
        const residual = d / s
        if (tracing) options.trace?.(k, c.x, c.y, bare ? 'skin' : 'covered', residual)
        if (!bare && residual <= 0) continue
        row(residual, 1 / (bare ? SKIN_SIGMA : COVERED_SIGMA) ** 2, [c.a, c.b], [0.5, 0.5], gx, gy)
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
}

const emptyReport: FitViewReport = {
  landmarksMm: 0,
  outlinePoints: 0,
  skinOutlinePoints: 0,
  skinOutlineMm: 0,
  yaw: 0,
}

/**
 * Places a view with no landmarks (a side view) by its outline: the head
 * turned as asked (or the other way, whichever fits), then slid across the
 * image until its outline lies on the photo's.
 */
function placeByOutline(
  model: HeadModel,
  flag: Flags,
  edgeSet: EdgeList,
  p: Prepared,
  start: Camera,
  positions: Float64Array,
  tilt: { pitch: number; roll: number },
): Camera {
  const { view } = p
  const turn = view.yaw || facingOf(view, start, model) * (Math.PI / 2)
  const sides = turn ? [turn] : [Math.PI / 2, -Math.PI / 2]
  let best: { camera: Camera; cost: number } | null = null
  for (const yaw of sides) {
    for (const extra of [0, 0.12, -0.12]) {
      const found = turnedAndSlid(model, flag, edgeSet, p, start, yaw + extra, positions, tilt)
      if (!best || found.cost < best.cost) best = found
    }
  }
  return best!.camera
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

/** A side view's camera with the head turned by `yaw` (and tilted as in the front view), slid to where its outline fits. */
function turnedAndSlid(
  model: HeadModel,
  flag: Flags,
  edgeSet: EdgeList,
  p: Prepared,
  start: Camera,
  yaw: number,
  positions: Float64Array,
  tilt: { pitch: number; roll: number },
) {
  const { view } = p
  const camera = cameraLookingAt({
    width: view.width,
    height: view.height,
    focal: start.focal,
    rotation: headRotation(yaw, tilt.pitch, tilt.roll),
    target: model.frame.eyes,
    distance: cameraDepth(start, model.frame.eyes),
  })
  return slideToOutline(model, flag, edgeSet, p, camera, positions)
}

function slideToOutline(
  model: HeadModel,
  flag: Flags,
  edgeSet: EdgeList,
  p: Prepared,
  camera: Camera,
  positions: Float64Array,
): { camera: Camera; cost: number } {
  const { view } = p
  const sdf = p.sdf!
  const { xy } = projectRegion(positions, camera)
  const { points } = outerContour(
    positions,
    xy,
    model.triangles,
    edgeSet,
    cameraCentre(camera),
    view.width,
    view.height,
    (a, b) => flag.outline[a] === 1 && flag.outline[b] === 1,
  )
  const depth = cameraDepth(camera, model.frame.eyes)
  const scale = camera.focal / depth / 1000
  const clamp = 15 * scale
  const costAt = (dx: number, dy: number) => {
    let cost = 0
    for (const c of points) {
      const d = sampleField(sdf, view.width, view.height, c.x + dx, c.y + dy)[0]
      cost +=
        flag.bare[c.a] && flag.bare[c.b]
          ? Math.min(Math.abs(d), clamp)
          : 0.5 * Math.min(Math.max(d, 0), clamp)
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
