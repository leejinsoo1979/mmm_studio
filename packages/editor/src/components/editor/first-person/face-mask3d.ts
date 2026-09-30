import { FACE_PARTS, facePointOf, marginRing, type Point, unpackPoints } from './face-points'
import { delaunay } from './face-warp'
import { renderFront } from './front-render'
import type { HeadGeometry } from './head-geometry'
import type { HeadTriangle } from './look-pixels'

/**
 * The face as a 3D mask laid over a photo (the way KeenTools FaceBuilder
 * works): the character's face landmarks lifted onto its head in 3D, turned
 * and scaled to sit on the photo's face — a weak-perspective camera fitted
 * to the photo's landmarks — then pushed and pulled until each landmark
 * lands exactly on the photo's. Any point of the character's face can then
 * be found in the photo: to draw the mask over it, or to take the photo's
 * face onto the head (face-projection.ts).
 *
 * Points are on the head's front view (head-geometry.ts frames it): x
 * across (right), y down and z towards the viewer, all three in fractions
 * of the front view, so distances in any direction compare.
 */
export type Vec3 = [number, number, number]

/**
 * A character's face landmarks (FACE_POINT_INDICES) in 3D, and the front
 * view's side in metres (`frameSize`): a HeadTriangle's depth over it is in
 * the same fractions as its x and y.
 */
export type FaceLandmarks3d = { points: Vec3[]; frameSize: number }

/**
 * Where a character's head sits in a photo, seen by a weak-perspective
 * (scaled orthographic) camera: a point `p` of the head lands at
 * `scale · (rotation · p) + shift` in the photo (fractions of it; only x
 * and y of the turned point count). `rotation` (row-major 3 × 3, proper)
 * turns the head from its front view (x right, y down, z towards the
 * viewer) to face the photo's camera (x right, y down, z towards the
 * camera); what it leaves in z is how near the camera a point is.
 *
 * The turn in degrees, as face-detect.ts reports a photo's: yaw > 0 the
 * subject turned to their left (the image's right), pitch > 0 chin up,
 * roll > 0 leaning to their right shoulder (anticlockwise in the photo).
 * The rotation is roll · pitch · yaw: the turn and nod about the head's own
 * axes, then its lean in the photo.
 */
export type Pose = {
  rotation: number[]
  scale: number
  shift: Point
  yaw: number
  pitch: number
  roll: number
}

/**
 * The mask fitted to a photo: its pose, and the push and pull that moves
 * each of the character's landmarks (`landmarks`, those at `pulled`) from
 * where the pose puts it onto the photo's, across the photo's image plane
 * (never nearer its camera or further) — all but the way out past the
 * face's silhouette, which a photo's landmarks there overshoot (see
 * fitMask). It comes in two parts: the pulls
 * spread smoothly over the face (`weights`, radial basis weights reaching
 * `reach` in 3D), and what that leaves at each landmark (`rest`) taken up
 * exactly, piece by piece between neighbouring landmarks as a photo warp
 * is (so lips pulled apart part along their line): `patches` are triangles
 * over the front view of the pulled landmarks and then `ring`, a ring just
 * past the face's outline that the touch-up leaves put. Plain data: it
 * crosses to a worker.
 */
export type MaskFit = {
  pose: Pose
  frameSize: number
  landmarks: Vec3[]
  pulled: number[]
  weights: Vec3[]
  reach: number
  rest: Vec3[]
  ring: Vec3[]
  patches: [number, number, number][]
  /** The face's middle (the front view's x), which a mirror image turns about. */
  midline: number
}

/** A front view's side (m) to fall back on for a head too broken to measure: a Rocketbox adult's. */
const DEFAULT_FRAME_SIZE = 0.36

/** The vertices whose normals measure the front view's side: turned from it by some, but not edge-on. */
const MEASURED_FACING = [0.2, 0.95] as const

/** How far (fractions) a point may lie outside a triangle and still be over it. */
const OVER_EDGE = 1e-6

/**
 * The points a pose is fitted on: the eyes, brows, nose, lips and inner
 * cheeks, which sit where they are on the skull. The outline moves with the
 * pose (a turned face's far jaw is its silhouette, wherever that falls) and
 * the irises with the gaze.
 */
const POSE_POINTS: readonly number[] = [
  ...FACE_PARTS.brows,
  ...FACE_PARTS.rightEye,
  ...FACE_PARTS.leftEye,
  ...FACE_PARTS.nose,
  ...FACE_PARTS.lips,
  ...[
    50, 280, 205, 425, 101, 330, 36, 266, 118, 347, 117, 346, 142, 371, 203, 423, 206, 426, 216,
    436, 212, 432, 202, 422, 204, 424, 211, 431, 199, 175, 151, 9, 8, 108, 337, 69, 299, 43, 273,
    57, 287, 186, 410, 92, 322, 165, 391,
  ].map(facePointOf),
]

/** Rounds of reweighting a pose fit, trusting less the points a face's expression moved furthest. */
const POSE_ROUNDS = 4
/** Past this many times the median miss, a point's say in the pose shrinks with its miss (Huber). */
const POSE_TRUST = 2
/** Gauss–Newton steps refining a pose, and the turn (radians) small enough to stop at. */
const POSE_STEPS = 20
const POSE_SETTLED = 1e-12

/**
 * How far a landmark's pull reaches over the face (× the distance between
 * the irises) and how much the spread smooths the pulls rather than
 * meeting each exactly: landmarks close together pulled apart (a closed
 * mouth onto an open one) would otherwise swing the face around them.
 */
const PULL_REACH = 0.9
const PULL_SMOOTHING = 0.02

/**
 * How squarely the face round a landmark must face the photo's camera (at
 * worst over the patches it is a corner of) for its pull out past the
 * silhouette to count, from not at all to fully: a patch turned away (it
 * folds over in the photo) means the landmark is on a turned face's
 * silhouette, where a photo's landmarks land on the background as often
 * as on the face. Merely steep patches (a chin's underside, a frontal
 * photo's jaw) keep their pulls: the outline says how wide the face is.
 */
const FOLD_FROM = -0.1
const FOLD_TO = 0

/**
 * A patch facing the front view less squarely than this (its normal's part
 * towards it) is a step in depth, not a surface a photo sees: a closed
 * mouth's lips one over the other, a landmark in the mouth's opening at
 * the depth of the mouth behind it, a jaw's outline over the neck.
 */
const FOLD_STEP = 0.15

/** No face points placed by hand. */
const NONE: ReadonlySet<number> = new Set()

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const smoothstep = (from: number, to: number, x: number) => {
  const t = clamp((x - from) / (to - from), 0, 1)
  return t * t * (3 - 2 * t)
}
const degrees = 180 / Math.PI

/**
 * The front view's side (m), from the head's own triangles: their x and y
 * are fractions of it, their z metres, and each corner's normal (`n`, its
 * forward part) was measured in true proportions. At a vertex, the faces
 * around it lean forward as far as its normal does at only one side; the
 * median over the vertices turned partly aside is the front view's.
 */
export function estimateFrameSize(triangles: readonly HeadTriangle[]): number {
  const corners = new Map<string, { bx: number; by: number; a: number; n: number; count: number }>()
  for (const tri of triangles) {
    // The face's normal at a side s is (s·bx, s·by, s²·a), up the front view's y.
    const x1 = tri.x[1]! - tri.x[0]!
    const y1 = tri.y[0]! - tri.y[1]!
    const z1 = tri.z[1]! - tri.z[0]!
    const x2 = tri.x[2]! - tri.x[0]!
    const y2 = tri.y[0]! - tri.y[2]!
    const z2 = tri.z[2]! - tri.z[0]!
    const bx = y1 * z2 - z1 * y2
    const by = z1 * x2 - x1 * z2
    const a = x1 * y2 - y1 * x2
    for (let k = 0; k < 3; k++) {
      const key = `${Math.round(tri.x[k]! * 1e5)},${Math.round(tri.y[k]! * 1e5)},${Math.round(tri.z[k]! * 1e5)}`
      const corner = corners.get(key) ?? { bx: 0, by: 0, a: 0, n: 0, count: 0 }
      corner.bx += bx
      corner.by += by
      corner.a += a
      corner.n += tri.n[k]!
      corner.count++
      corners.set(key, corner)
    }
  }
  const sizes: number[] = []
  for (const { bx, by, a, n, count } of corners.values()) {
    const facing = n / count
    if (a <= 0 || facing < MEASURED_FACING[0] || facing > MEASURED_FACING[1]) continue
    const size = (facing * Math.hypot(bx, by)) / (a * Math.sqrt(1 - facing * facing))
    if (Number.isFinite(size) && size > 0) sizes.push(size)
  }
  if (sizes.length === 0) return DEFAULT_FRAME_SIZE
  sizes.sort((a, b) => a - b)
  return sizes[sizes.length >> 1]!
}

/** The depth (the triangles' own z) of the front-most of them over a front-view point, or null. */
function depthOver(triangles: readonly HeadTriangle[], x: number, y: number): number | null {
  let front: number | null = null
  for (const tri of triangles) {
    const [ax, bx, cx] = tri.x as [number, number, number]
    const [ay, by, cy] = tri.y as [number, number, number]
    if (x < Math.min(ax, bx, cx) - OVER_EDGE || x > Math.max(ax, bx, cx) + OVER_EDGE) continue
    if (y < Math.min(ay, by, cy) - OVER_EDGE || y > Math.max(ay, by, cy) + OVER_EDGE) continue
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (area === 0) continue
    const w1 = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / area
    const w2 = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / area
    const w0 = 1 - w1 - w2
    const slack = -OVER_EDGE / Math.sqrt(Math.abs(area))
    if (w0 < slack || w1 < slack || w2 < slack) continue
    const z = w0 * tri.z[0]! + w1 * tri.z[1]! + w2 * tri.z[2]!
    if (front === null || z > front) front = z
  }
  return front
}

/** The depth of the nearest corner (on the front view) of triangles facing the front. */
function nearestDepth(triangles: readonly HeadTriangle[], x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY
  let depth = 0
  for (const tri of triangles) {
    if (tri.n[0]! + tri.n[1]! + tri.n[2]! <= 0) continue
    for (let k = 0; k < 3; k++) {
      const d = (tri.x[k]! - x) ** 2 + (tri.y[k]! - y) ** 2
      if (d < best) {
        best = d
        depth = tri.z[k]!
      }
    }
  }
  return depth
}

/**
 * A character's face landmarks (`target`, packed fractions of its front
 * view) in 3D: each at the depth of the front-most skin under it (or, in an
 * eye's opening where the skin has none, of the eyeball), and a point off
 * both at the depth of the skin nearest it. The irises may land on the
 * socket behind the eyeball: they only measure how far apart the eyes are.
 */
export function faceLandmarks3d(
  geometry: HeadGeometry,
  target: readonly number[],
  frameSize = estimateFrameSize(geometry.skin),
): FaceLandmarks3d {
  const eyes = geometry.eyes.flat()
  const points = unpackPoints(target).map(([x, y]): Vec3 => {
    const z =
      depthOver(geometry.skin, x, y) ?? depthOver(eyes, x, y) ?? nearestDepth(geometry.skin, x, y)
    return [x, y, z / frameSize]
  })
  return { points, frameSize }
}

/** Row-major 3 × 3 products. */
function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!)
    }
  }
  return out
}

/** The rotation a pose's yaw, pitch and roll (degrees) make: see Pose. */
export function poseRotation(yaw: number, pitch: number, roll: number): number[] {
  const [cy, sy] = [Math.cos(yaw / degrees), Math.sin(yaw / degrees)]
  const [cp, sp] = [Math.cos(pitch / degrees), Math.sin(pitch / degrees)]
  const [cr, sr] = [Math.cos(roll / degrees), Math.sin(roll / degrees)]
  const turn = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const nod = [1, 0, 0, 0, cp, -sp, 0, sp, cp]
  const lean = [cr, sr, 0, -sr, cr, 0, 0, 0, 1]
  return multiply(lean, multiply(nod, turn))
}

/** A rotation's yaw, pitch and roll (degrees): see Pose. */
function poseAngles(rotation: readonly number[]) {
  return {
    yaw: Math.atan2(-rotation[6]!, rotation[8]!) * degrees,
    pitch: Math.asin(clamp(rotation[7]!, -1, 1)) * degrees,
    roll: Math.atan2(rotation[1]!, rotation[4]!) * degrees,
  }
}

/** A pose from its camera: the angles read off its rotation. */
export function makePose(rotation: readonly number[], scale: number, shift: Point): Pose {
  return { rotation: [...rotation], scale, shift, ...poseAngles(rotation) }
}

/** Where a point of the head lands in the photo (fractions), by a pose. */
export function projectPoint(pose: Pose, p: ArrayLike<number>): Point {
  const r = pose.rotation
  const [x, y, z] = [p[0]!, p[1]!, p[2]!]
  return [
    pose.scale * (r[0]! * x + r[1]! * y + r[2]! * z) + pose.shift[0],
    pose.scale * (r[3]! * x + r[4]! * y + r[5]! * z) + pose.shift[1],
  ]
}

/** How near the photo's camera a point of the head is, by a pose (fractions of the front view). */
export const cameraDepth = (pose: Pose, p: ArrayLike<number>) =>
  pose.rotation[6]! * p[0]! + pose.rotation[7]! * p[1]! + pose.rotation[8]! * p[2]!

/** A turn by `angle` (radians) about `axis` (unit), as a row-major rotation (Rodrigues). */
function axisRotation([x, y, z]: Vec3, angle: number): number[] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ]
}

/** Solves a small linear system (Gaussian elimination, partial pivots); null when it is singular. */
function solve(matrix: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = matrix.map((row, i) => [...row, b[i]!])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++)
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r
    if (!(Math.abs(m[pivot]![col]!) > 1e-300)) return null
    ;[m[col], m[pivot]] = [m[pivot]!, m[col]!]
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / m[col]![col]!
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r]![n]!
    for (let c = r + 1; c < n; c++) sum -= m[r]![c]! * x[c]!
    x[r] = sum / m[r]![r]!
  }
  return x
}

/**
 * The weak-perspective camera nearest an affine one (2 × 3, rows `m`): its
 * rows made orthonormal (the polar factor, through the 2 × 2 m·mᵀ) and
 * scale their mean length; the third row completes a proper rotation.
 */
function nearestCamera(m: number[]): { rotation: number[]; scale: number } | null {
  const a = m[0]! * m[0]! + m[1]! * m[1]! + m[2]! * m[2]!
  const b = m[0]! * m[3]! + m[1]! * m[4]! + m[2]! * m[5]!
  const c = m[3]! * m[3]! + m[4]! * m[4]! + m[5]! * m[5]!
  const half = Math.hypot((a - c) / 2, b)
  const high = (a + c) / 2 + half
  const low = (a + c) / 2 - half
  if (!(low > 1e-18)) return null
  // (m·mᵀ)^(-1/2) from its eigenvectors.
  const angle = Math.atan2(2 * b, a - c) / 2
  const [u, v] = [Math.cos(angle), Math.sin(angle)]
  const [ih, il] = [1 / Math.sqrt(high), 1 / Math.sqrt(low)]
  const p = u * u * ih + v * v * il
  const q = u * v * (ih - il)
  const r = v * v * ih + u * u * il
  const r0 = [p * m[0]! + q * m[3]!, p * m[1]! + q * m[4]!, p * m[2]! + q * m[5]!]
  const r1 = [q * m[0]! + r * m[3]!, q * m[1]! + r * m[4]!, q * m[2]! + r * m[5]!]
  const r2 = [
    r0[1]! * r1[2]! - r0[2]! * r1[1]!,
    r0[2]! * r1[0]! - r0[0]! * r1[2]!,
    r0[0]! * r1[1]! - r0[1]! * r1[0]!,
  ]
  return { rotation: [...r0, ...r1, ...r2], scale: (Math.sqrt(high) + Math.sqrt(low)) / 2 }
}

/**
 * The camera fitting centred photo points `q` to centred head points `p`
 * best (least squares, each by its weight): the best affine camera first,
 * made a true one, then refined by Gauss–Newton on the turn and scale.
 */
function fitCamera(p: readonly Vec3[], q: readonly Point[], w: readonly number[]) {
  // The best affine camera, row by row: (Σ q·pᵀ)·(Σ p·pᵀ)⁻¹.
  const pp = new Array<number>(9).fill(0)
  const qp = [0, 0, 0, 0, 0, 0]
  p.forEach((point, i) => {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) pp[r * 3 + c]! += w[i]! * point[r]! * point[c]!
      qp[r]! += w[i]! * q[i]![0] * point[r]!
      qp[3 + r]! += w[i]! * q[i]![1] * point[r]!
    }
  })
  const rows = [0, 1, 2].map((r) => [pp[r * 3]!, pp[r * 3 + 1]!, pp[r * 3 + 2]!])
  const m0 = solve(rows, qp.slice(0, 3))
  const m1 = solve(rows, qp.slice(3))
  const start = m0 && m1 ? nearestCamera([...m0, ...m1]) : null
  if (!start) return null
  let { rotation, scale } = start
  for (let step = 0; step < POSE_STEPS; step++) {
    // Normal equations in the turn (ω, about the camera's axes) and the scale.
    const jtj = [0, 1, 2, 3].map(() => [0, 0, 0, 0])
    const jtr = [0, 0, 0, 0]
    p.forEach((point, i) => {
      const vx = rotation[0]! * point[0] + rotation[1]! * point[1] + rotation[2]! * point[2]
      const vy = rotation[3]! * point[0] + rotation[4]! * point[1] + rotation[5]! * point[2]
      const vz = rotation[6]! * point[0] + rotation[7]! * point[1] + rotation[8]! * point[2]
      const jx = [0, scale * vz, -scale * vy, vx]
      const jy = [-scale * vz, 0, scale * vx, vy]
      const rx = q[i]![0] - scale * vx
      const ry = q[i]![1] - scale * vy
      for (let a = 0; a < 4; a++) {
        jtr[a]! += w[i]! * (jx[a]! * rx + jy[a]! * ry)
        for (let b = 0; b < 4; b++) jtj[a]![b]! += w[i]! * (jx[a]! * jx[b]! + jy[a]! * jy[b]!)
      }
    })
    const delta = solve(jtj, jtr)
    if (!delta) break
    const angle = Math.hypot(delta[0]!, delta[1]!, delta[2]!)
    if (angle > 0) {
      const axis: Vec3 = [delta[0]! / angle, delta[1]! / angle, delta[2]! / angle]
      rotation = multiply(axisRotation(axis, angle), rotation)
    }
    scale += delta[3]!
    if (angle < POSE_SETTLED && Math.abs(delta[3]!) < POSE_SETTLED * scale) break
  }
  return { rotation, scale }
}

/**
 * The pose that sets a character's head (`landmarks`, its face points in
 * 3D) on a photo's face (`photoPoints`, packed fractions of the photo),
 * fitted on the points the pose alone places (POSE_POINTS). The points a
 * smile or a raised brow moved furthest count for less, round by round.
 */
export function estimatePose(photoPoints: readonly number[], landmarks: readonly Vec3[]): Pose {
  const photo = unpackPoints(photoPoints)
  const used = POSE_POINTS.filter((i) => landmarks[i] && photo[i])
  const weights = used.map(() => 1)
  let pose: Pose | null = null
  for (let round = 0; round < POSE_ROUNDS; round++) {
    let total = 0
    const pc: Vec3 = [0, 0, 0]
    const qc: Point = [0, 0]
    used.forEach((i, k) => {
      total += weights[k]!
      for (let c = 0; c < 3; c++) pc[c]! += weights[k]! * landmarks[i]![c]!
      qc[0] += weights[k]! * photo[i]![0]
      qc[1] += weights[k]! * photo[i]![1]
    })
    for (let c = 0; c < 3; c++) pc[c]! /= total
    qc[0] /= total
    qc[1] /= total
    const camera = fitCamera(
      used.map((i) => landmarks[i]!.map((v, c) => v - pc[c]!) as Vec3),
      used.map((i) => [photo[i]![0] - qc[0], photo[i]![1] - qc[1]] as Point),
      weights,
    )
    if (!camera) break
    const centre = projectPoint(makePose(camera.rotation, camera.scale, [0, 0]), pc)
    pose = makePose(camera.rotation, camera.scale, [qc[0] - centre[0], qc[1] - centre[1]])
    const misses = used.map((i) => {
      const [x, y] = projectPoint(pose!, landmarks[i]!)
      return Math.hypot(x - photo[i]![0], y - photo[i]![1])
    })
    const sorted = [...misses].sort((a, b) => a - b)
    const trusted = POSE_TRUST * sorted[sorted.length >> 1]!
    misses.forEach((miss, k) => {
      weights[k] = miss > trusted && miss > 0 ? trusted / miss : 1
    })
  }
  return pose ?? fallbackPose(photo, landmarks)
}

/** A face too degenerate to fit a camera to (points in a line): the head facing the photo, centred on it. */
function fallbackPose(photo: readonly Point[], landmarks: readonly Vec3[]): Pose {
  const spread = (points: readonly number[][]) => {
    const [cx, cy] = [0, 1].map((c) => points.reduce((sum, p) => sum + p[c]!, 0) / points.length)
    const size = Math.sqrt(
      points.reduce((sum, p) => sum + (p[0]! - cx!) ** 2 + (p[1]! - cy!) ** 2, 0) / points.length,
    )
    return { cx: cx!, cy: cy!, size }
  }
  const from = spread(landmarks)
  const to = spread(photo)
  const scale = from.size > 0 ? to.size / from.size : 1
  return makePose([1, 0, 0, 0, 1, 0, 0, 0, 1], scale, [
    to.cx - scale * from.cx,
    to.cy - scale * from.cy,
  ])
}

/** The Wendland C² radial function (positive definite in 3D): 1 at 0, gone by 1. */
function pullShape(r: number) {
  if (r >= 1) return 0
  const t = 1 - r
  return t * t * t * t * (4 * r + 1)
}

/**
 * Solves `kernel`·x = `rhs` (symmetric positive definite, n × n, row-major)
 * by Cholesky, for the three columns of `rhs` at once.
 */
function solveKernel(kernel: Float64Array, n: number, rhs: readonly Vec3[]): Vec3[] {
  const l = new Float64Array(kernel)
  for (let j = 0; j < n; j++) {
    let d = l[j * n + j]!
    for (let k = 0; k < j; k++) d -= l[j * n + k]! ** 2
    const root = Math.sqrt(Math.max(d, 1e-12))
    l[j * n + j] = root
    for (let i = j + 1; i < n; i++) {
      let s = l[i * n + j]!
      for (let k = 0; k < j; k++) s -= l[i * n + k]! * l[j * n + k]!
      l[i * n + j] = s / root
    }
  }
  const out = rhs.map((): Vec3 => [0, 0, 0])
  const y = new Float64Array(n)
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) {
      let s = rhs[i]![c]!
      for (let k = 0; k < i; k++) s -= l[i * n + k]! * y[k]!
      y[i] = s / l[i * n + i]!
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i]!
      for (let k = i + 1; k < n; k++) s -= l[k * n + i]! * out[k]![c]!
      out[i]![c] = s / l[i * n + i]!
    }
  }
  return out
}

const distance3 = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

/** The smooth spread of a mask's pulls at a point (x, y, z), into `out`: see maskSpread. */
type Spreader = (x: number, y: number, z: number, out: number[]) => void

/** Each fit's spreader, made once: it runs for thousands of points of a face. */
const spreaders = new WeakMap<MaskFit, Spreader>()

/** The radial basis sum of `weights` at the `pulled` landmarks, reaching `reach`, over flat arrays. */
function makeSpreader(
  landmarks: readonly Vec3[],
  pulled: readonly number[],
  weights: readonly Vec3[],
  reach: number,
): Spreader {
  const count = pulled.length
  const centres = new Float64Array(count * 3)
  const flat = new Float64Array(count * 3)
  pulled.forEach((i, k) => {
    centres.set(landmarks[i]!, k * 3)
    flat.set(weights[k]!, k * 3)
  })
  const reach2 = reach * reach
  const perReach = 1 / reach
  return (x, y, z, out) => {
    let sx = 0
    let sy = 0
    let sz = 0
    for (let o = 0; o < count * 3; o += 3) {
      const dx = x - centres[o]!
      const dy = y - centres[o + 1]!
      const dz = z - centres[o + 2]!
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 >= reach2) continue
      const shape = pullShape(Math.sqrt(d2) * perReach)
      sx += shape * flat[o]!
      sy += shape * flat[o + 1]!
      sz += shape * flat[o + 2]!
    }
    out[0] = sx
    out[1] = sy
    out[2] = sz
  }
}

/** The smooth part of the mask's push and pull at a point of the head (into `out`): see MaskFit. */
export function maskSpread(fit: MaskFit, p: ArrayLike<number>, out: number[]) {
  let spreader = spreaders.get(fit)
  if (!spreader) {
    spreader = makeSpreader(fit.landmarks, fit.pulled, fit.weights, fit.reach)
    spreaders.set(fit, spreader)
  }
  spreader(p[0]!, p[1]!, p[2]!, out)
}

/** Numbers per patch when flattened: its corners' x, y, z, then what the spread left at each. */
const PATCH_STRIDE = 18

/** Each fit's patches, flattened once: they are looked up for every pixel of a face. */
const flatPatches = new WeakMap<MaskFit, Float64Array>()

/**
 * A fit's patches as flat numbers (PATCH_STRIDE each): a corner is a pulled
 * landmark, with what the spread left there, or a point of the ring, where
 * the touch-up is nothing.
 */
function patchesOf(fit: MaskFit): Float64Array {
  let flat = flatPatches.get(fit)
  if (flat) return flat
  flat = new Float64Array(fit.patches.length * PATCH_STRIDE)
  fit.patches.forEach((corners, patch) => {
    corners.forEach((k, c) => {
      const pulled = k < fit.pulled.length
      flat!.set(
        pulled ? fit.landmarks[fit.pulled[k]!]! : fit.ring[k - fit.pulled.length]!,
        patch * PATCH_STRIDE + c * 3,
      )
      if (pulled) flat!.set(fit.rest[k]!, patch * PATCH_STRIDE + 9 + c * 3)
    })
  })
  flatPatches.set(fit, flat)
  return flat
}

/**
 * The touch-up (into `out`) at a point `z` deep over a patch (`patch`, its
 * index), at barycentric weights `w0`–`w2` of its corners on the front view:
 * what the spread left at the corners, blended, fading out with the point's
 * depth off the patch (the back of the head lies under the face's patches
 * on the front view, but far from them).
 */
export function patchTouch(
  fit: MaskFit,
  patch: number,
  w0: number,
  w1: number,
  w2: number,
  z: number,
  out: number[],
) {
  const flat = patchesOf(fit)
  const o = patch * PATCH_STRIDE
  const off = Math.abs(z - (flat[o + 2]! * w0 + flat[o + 5]! * w1 + flat[o + 8]! * w2))
  const fade = pullShape(off / fit.reach)
  for (let k = 0; k < 3; k++) {
    out[k] = (flat[o + 9 + k]! * w0 + flat[o + 12 + k]! * w1 + flat[o + 15 + k]! * w2) * fade
  }
}

/** The touch-up (into `out`) at a point of the head: see patchTouch; nothing off every patch. */
function maskTouch(fit: MaskFit, p: ArrayLike<number>, out: number[]) {
  out[0] = 0
  out[1] = 0
  out[2] = 0
  const [x, y, z] = [p[0]!, p[1]!, p[2]!]
  const flat = patchesOf(fit)
  for (let o = 0; o < flat.length; o += PATCH_STRIDE) {
    const ax = flat[o]!
    const ay = flat[o + 1]!
    const bx = flat[o + 3]!
    const by = flat[o + 4]!
    const cx = flat[o + 6]!
    const cy = flat[o + 7]!
    if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx)) continue
    if (y < Math.min(ay, by, cy) || y > Math.max(ay, by, cy)) continue
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (area === 0) continue
    const w1 = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / area
    const w2 = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / area
    const w0 = 1 - w1 - w2
    if (w0 < -OVER_EDGE || w1 < -OVER_EDGE || w2 < -OVER_EDGE) continue
    patchTouch(fit, o / PATCH_STRIDE, w0, w1, w2, z, out)
    return
  }
}

/**
 * How far (fractions of the front view, in the head's frame) the mask moves
 * a point of the head, into `out`: the smooth spread of the landmarks'
 * pulls, plus the touch-up that lands each exactly. Past the face, out of
 * every landmark's reach, nothing moves.
 */
export function maskOffset(fit: MaskFit, p: ArrayLike<number>, out: number[]) {
  const touch = [0, 0, 0]
  maskSpread(fit, p, out)
  maskTouch(fit, p, touch)
  out[0]! += touch[0]!
  out[1]! += touch[1]!
  out[2]! += touch[2]!
}

/** Where a point of the head lands in the photo (fractions) once the mask is fitted: moved, then posed. */
export function maskPoint(fit: MaskFit, p: ArrayLike<number>): Point {
  const offset = [0, 0, 0]
  maskOffset(fit, p, offset)
  return projectPoint(fit.pose, [p[0]! + offset[0]!, p[1]! + offset[1]!, p[2]! + offset[2]!])
}

/** The distance between a face's irises (its landmarks in 3D): the measure of how big the face is. */
export const eyeDistance = (points: readonly Vec3[]) =>
  Math.max(1e-3, distance3(points[FACE_PARTS.rightIris[0]!]!, points[FACE_PARTS.leftIris[0]!]!))

/**
 * Where the face turns away from the photo's camera round each of the
 * first `count` corners of `patches` (the pulled landmarks, at `corners`):
 * how far the patches it is a corner of fold over in the photo (`folded`,
 * 0–1: see FOLD_FROM), and which way across the photo those patches face
 * between them (`away`, x and y per corner, unit; nothing where none
 * folds). Past the silhouette, where the face's surface turns edge-on to
 * the camera and then away, its outward normal lies in the image plane.
 * Steps in depth (see FOLD_STEP) are left out.
 */
function folds(
  corners: readonly Vec3[],
  count: number,
  patches: readonly (readonly [number, number, number])[],
  rotation: readonly number[],
) {
  const folded = new Float64Array(count)
  const away = new Float64Array(count * 2)
  for (const patch of patches) {
    if (patch.some((k) => k >= count)) continue
    const [a, b, c] = patch.map((k) => corners[k]!) as [Vec3, Vec3, Vec3]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const length = Math.hypot(n[0]!, n[1]!, n[2]!)
    if (!(Math.abs(n[2]!) > FOLD_STEP * length)) continue
    // The normal made to face the front view (whichever way the
    // triangulation wound the patch), then turned to face the camera.
    const toward = Math.sign(n[2]!) / length
    const [x, y, z] = [0, 3, 6].map(
      (row) =>
        (rotation[row]! * n[0]! + rotation[row + 1]! * n[1]! + rotation[row + 2]! * n[2]!) * toward,
    ) as Vec3
    const fold = 1 - smoothstep(FOLD_FROM, FOLD_TO, z)
    const across = Math.hypot(x, y)
    if (fold <= 0 || across === 0) continue
    for (const k of patch) {
      folded[k] = Math.max(folded[k]!, fold)
      away[k * 2]! += (fold * x) / across
      away[k * 2 + 1]! += (fold * y) / across
    }
  }
  for (let k = 0; k < count; k++) {
    const length = Math.hypot(away[k * 2]!, away[k * 2 + 1]!)
    if (length === 0) continue
    away[k * 2]! /= length
    away[k * 2 + 1]! /= length
  }
  return { folded, away }
}

/**
 * The mask fitted to a photo (`photoPoints`, packed fractions of it): the
 * character's head (`landmarks`) set in the pose (estimated unless given),
 * then each landmark pushed or pulled onto the photo's point — across the
 * photo's image plane, so the pose's depth stays — and the whole face with
 * them (see MaskFit). The irises are left out: they follow the gaze.
 *
 * On the face's silhouette in the photo (a strongly turned face's nose,
 * lips and chin, its far side) a photo's landmarks guess at a surface seen
 * edge-on and often land just past it, on the background; pulled there,
 * the mask would take the background into the face. So a landmark whose
 * patches fold over in the photo (see folds) is pulled along the
 * silhouette and in from it, but not out past it — unless it is one of
 * `pinned` (face points the player placed by hand, by their places among
 * the face points: facePointOf a MediaPipe landmark), which land exactly
 * where they are put.
 */
export function fitMask(
  photoPoints: readonly number[],
  landmarks: FaceLandmarks3d,
  pose: Pose = estimatePose(photoPoints, landmarks.points),
  pinned: ReadonlySet<number> = NONE,
): MaskFit {
  const photo = unpackPoints(photoPoints)
  const points = landmarks.points
  const irises = new Set<number>([...FACE_PARTS.rightIris, ...FACE_PARTS.leftIris])
  const pulled = points.map((_, i) => i).filter((i) => !irises.has(i) && photo[i])
  // The ring past the outline, each point as deep as the outline's point it
  // was pushed out from.
  const flat = points.map(([x, y]): Point => [x, y])
  const ring = marginRing(flat).map(([x, y], k): Vec3 => [x, y, points[FACE_PARTS.oval[k]!]![2]])
  const patches = delaunay([...pulled.map((i) => flat[i]!), ...ring.map(([x, y]): Point => [x, y])])
  const r = pose.rotation
  const { folded, away } = folds(
    pulled.map((i) => points[i]!),
    pulled.length,
    patches,
    r,
  )
  // Each landmark's miss in the photo, less any of it out past the
  // silhouette, back in the head's frame (the transposed rotation turns the
  // image plane back).
  const pulls = pulled.map((i, k): Vec3 => {
    const [x, y] = projectPoint(pose, points[i]!)
    let dx = (photo[i]![0] - x) / pose.scale
    let dy = (photo[i]![1] - y) / pose.scale
    const [ax, ay] = [away[k * 2]!, away[k * 2 + 1]!]
    const out = dx * ax + dy * ay
    if (out > 0 && !pinned.has(i)) {
      dx -= out * folded[k]! * ax
      dy -= out * folded[k]! * ay
    }
    return [r[0]! * dx + r[3]! * dy, r[1]! * dx + r[4]! * dy, r[2]! * dx + r[5]! * dy]
  })
  const reach = PULL_REACH * eyeDistance(points)
  const n = pulled.length
  const kernel = new Float64Array(n * n)
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const shape = pullShape(distance3(points[pulled[a]!]!, points[pulled[b]!]!) / reach)
      kernel[a * n + b] = shape + (a === b ? PULL_SMOOTHING : 0)
    }
  }
  const weights = solveKernel(kernel, n, pulls)
  // What the spread leaves at each landmark, for the touch-up to take up.
  const spread = makeSpreader(points, pulled, weights, reach)
  const smooth = [0, 0, 0]
  const rest = pulled.map((i, k): Vec3 => {
    spread(points[i]![0], points[i]![1], points[i]![2], smooth)
    return [pulls[k]![0] - smooth[0]!, pulls[k]![1] - smooth[1]!, pulls[k]![2] - smooth[2]!]
  })
  return {
    pose,
    frameSize: landmarks.frameSize,
    landmarks: points,
    pulled,
    weights,
    reach,
    rest,
    ring,
    patches,
    // The face points pair off either side of the face's middle.
    midline: points.reduce((sum, [x]) => sum + x, 0) / points.length,
  }
}

/**
 * Triangles of the head as one surface in the mask's space: each corner
 * once (texture seams split vertices the surface still joins) at
 * `positions` (x, y, z), with its smooth normal (`normals`, unit, facing
 * out), and each triangle's corners (`triangles`) and whether the front
 * view shows it (`front`, facing it at all).
 */
export type FaceSurface = {
  positions: Float64Array
  normals: Float64Array
  triangles: Uint32Array
  front: Uint8Array
}

/** Triangles of the head (with the front view's side, `frameSize`, in m) as one FaceSurface. */
export function faceSurface(triangles: readonly HeadTriangle[], frameSize: number): FaceSurface {
  const index = new Map<string, number>()
  const positions: number[] = []
  const corners = new Uint32Array(triangles.length * 3)
  const front = new Uint8Array(triangles.length)
  triangles.forEach((tri, t) => {
    front[t] = tri.n[0]! + tri.n[1]! + tri.n[2]! > 0 ? 1 : 0
    for (let k = 0; k < 3; k++) {
      const key = `${Math.round(tri.x[k]! * 1e6)},${Math.round(tri.y[k]! * 1e6)},${Math.round(tri.z[k]! * 1e6)}`
      let vertex = index.get(key)
      if (vertex === undefined) {
        vertex = positions.length / 3
        index.set(key, vertex)
        positions.push(tri.x[k]!, tri.y[k]!, tri.z[k]! / frameSize)
      }
      corners[t * 3 + k] = vertex
    }
  })
  // Each face's normal, weighted by its area, summed at its corners. The
  // mesh winds anticlockwise seen from outside with y up; the front view's
  // y runs down.
  const normals = new Float64Array(positions.length)
  for (let t = 0; t < triangles.length; t++) {
    const [a, b, c] = [corners[t * 3]!, corners[t * 3 + 1]!, corners[t * 3 + 2]!]
    const x1 = positions[b * 3]! - positions[a * 3]!
    const y1 = positions[a * 3 + 1]! - positions[b * 3 + 1]!
    const z1 = positions[b * 3 + 2]! - positions[a * 3 + 2]!
    const x2 = positions[c * 3]! - positions[a * 3]!
    const y2 = positions[a * 3 + 1]! - positions[c * 3 + 1]!
    const z2 = positions[c * 3 + 2]! - positions[a * 3 + 2]!
    const nx = y1 * z2 - z1 * y2
    const ny = -(z1 * x2 - x1 * z2)
    const nz = x1 * y2 - y1 * x2
    for (const v of [a, b, c]) {
      normals[v * 3]! += nx
      normals[v * 3 + 1]! += ny
      normals[v * 3 + 2]! += nz
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v]!, normals[v + 1]!, normals[v + 2]!) || 1
    normals[v]! /= length
    normals[v + 1]! /= length
    normals[v + 2]! /= length
  }
  return { positions: new Float64Array(positions), normals, triangles: corners, front }
}

/** Whether a point is inside a polygon (even–odd). */
function inside(polygon: readonly Point[], x: number, y: number) {
  let within = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i]!
    const [bx, by] = polygon[j]!
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) within = !within
  }
  return within
}

/**
 * One edge of the mask as drawn over the photo: its ends (fractions of the
 * photo) and how squarely the surface there faces the photo's camera (1
 * head-on, 0 edge-on, below 0 turned away), to draw the near side bright
 * and the far side faint.
 */
export type MaskEdge = { from: Point; to: Point; facing: number }

/** How finely (pixels a side) the front view is drawn to tell which of the skin shows there. */
const WIRE_VIEW = 256

/**
 * How far (fractions of the front view) behind the front view's skin a
 * triangle may lie and still show there: past it, it is inside the head
 * (the neck under the chin, the inside of the lips, hair behind the jaw).
 */
const WIRE_HIDDEN = 0.01

/**
 * The mask over the photo: the edges of the character's skin triangles
 * across its face — those the front view shows inside the face's outline
 * — moved by the fit and set in its pose.
 */
export function maskWireframe(geometry: HeadGeometry, fit: MaskFit): MaskEdge[] {
  const { positions, normals, triangles, front } = faceSurface(geometry.skin, fit.frameSize)
  const outline = FACE_PARTS.oval.map((i): Point => [fit.landmarks[i]![0], fit.landmarks[i]![1]])
  const shown = renderFront(
    { data: new Uint8ClampedArray(4), width: 1, height: 1 },
    geometry.skin,
    WIRE_VIEW,
  ).depth
  const vertices = positions.length / 3
  const edges = new Map<number, [number, number]>()
  for (let t = 0; t < front.length; t++) {
    if (!front[t]) continue
    const corners = [triangles[t * 3]!, triangles[t * 3 + 1]!, triangles[t * 3 + 2]!]
    const [cx, cy, cz] = [0, 1, 2].map(
      (c) => corners.reduce((sum, v) => sum + positions[v * 3 + c]!, 0) / 3,
    ) as Vec3
    if (!inside(outline, cx, cy)) continue
    const px = Math.min(WIRE_VIEW - 1, Math.max(0, Math.floor(cx * WIRE_VIEW)))
    const py = Math.min(WIRE_VIEW - 1, Math.max(0, Math.floor(cy * WIRE_VIEW)))
    if (shown[py * WIRE_VIEW + px]! / fit.frameSize - cz > WIRE_HIDDEN) continue
    for (let k = 0; k < 3; k++) {
      const a = Math.min(corners[k]!, corners[(k + 1) % 3]!)
      const b = Math.max(corners[k]!, corners[(k + 1) % 3]!)
      edges.set(a * vertices + b, [a, b])
    }
  }
  const placed = new Map<number, { at: Point; facing: number }>()
  const place = (v: number) => {
    let found = placed.get(v)
    if (!found) {
      const p = positions.subarray(v * 3, v * 3 + 3)
      const n = normals.subarray(v * 3, v * 3 + 3)
      found = { at: maskPoint(fit, p), facing: cameraDepth(fit.pose, n) }
      placed.set(v, found)
    }
    return found
  }
  return [...edges.values()].map(([a, b]) => {
    const from = place(a)
    const to = place(b)
    return { from: from.at, to: to.at, facing: (from.facing + to.facing) / 2 }
  })
}
