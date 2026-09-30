import { describe, expect, test } from 'bun:test'
import {
  cameraDepth,
  estimateFrameSize,
  estimatePose,
  faceLandmarks3d,
  fitMask,
  type MaskFit,
  makePose,
  maskOffset,
  maskPoint,
  maskWireframe,
  type Pose,
  poseRotation,
  projectPoint,
  type Vec3,
} from './face-mask3d'
import { FACE_PARTS, FACE_POINT_COUNT, type Point, packPoints } from './face-points'
import { projectFace } from './face-projection'
import { renderFront } from './front-render'
import type { HeadGeometry } from './head-geometry'
import type { HeadTriangle, Pixels } from './look-pixels'

/** The synthetic head's front view side (m): its z is in metres, as a real head's. */
const FRAME = 0.36

/** An ellipsoid face (front-view fractions) with a nose standing out of it. */
const [CX, CY, RX, RY, RZ] = [0.5, 0.55, 0.3, 0.38, 0.22]
const NOSE = { x: 0.5, y: 0.58, height: 0.08, width: 0.025 }

/** The face's depth (front-view fractions) over a front-view point, or null off it. */
function surfaceZ(x: number, y: number): number | null {
  const r2 = ((x - CX) / RX) ** 2 + ((y - CY) / RY) ** 2
  if (r2 >= 1) return null
  const nose =
    NOSE.height * Math.exp(-((x - NOSE.x) ** 2 + (y - NOSE.y) ** 2) / (2 * NOSE.width ** 2))
  return RZ * Math.sqrt(1 - r2) + nose
}

/** The face's outward normal at a point. */
function normalAt(x: number, y: number): Vec3 {
  const e = 1e-5
  const dx = (surfaceZ(x + e, y)! - surfaceZ(x - e, y)!) / (2 * e)
  const dy = (surfaceZ(x, y + e)! - surfaceZ(x, y - e)!) / (2 * e)
  const length = Math.hypot(dx, dy, 1)
  return [-dx / length, -dy / length, 1 / length]
}

/**
 * The face as a head's triangles: a grid over the front view, wound as a
 * Rocketbox mesh is (anticlockwise seen from outside with y up), its
 * texture laid flat across the front view.
 */
function faceMesh(step = 1 / 128): HeadGeometry {
  const triangles: HeadTriangle[] = []
  const inside = (x: number, y: number) => ((x - CX) / RX) ** 2 + ((y - CY) / RY) ** 2 < 0.97
  for (let y = CY - RY; y < CY + RY; y += step) {
    for (let x = CX - RX; x < CX + RX; x += step) {
      const corners: Point[] = [
        [x, y],
        [x, y + step],
        [x + step, y],
        [x + step, y + step],
      ]
      if (!corners.every(([cx, cy]) => inside(cx, cy))) continue
      for (const tri of [
        [0, 1, 2],
        [2, 1, 3],
      ]) {
        const pts = tri.map((k) => corners[k]!)
        triangles.push({
          x: pts.map(([px]) => px),
          y: pts.map(([, py]) => py),
          z: pts.map(([px, py]) => surfaceZ(px, py)! * FRAME),
          n: pts.map(([px, py]) => normalAt(px, py)[2]),
          u: pts.map(([px]) => px),
          v: pts.map(([, py]) => py),
        })
      }
    }
  }
  return { all: triangles, skin: triangles, eyes: [] }
}

/** MediaPipe's first ten nose points run down its ridge; the sixth (landmark 4) is its tip. */
const RIDGE = FACE_PARTS.nose.slice(0, 10)
const TIP = FACE_PARTS.nose[5]!

/**
 * Face points on the synthetic face (fractions of its front view): outline,
 * brows, eyes, nose (its ridge down the middle), lips and irises where a
 * face has them, the rest spread inside the face, all apart.
 */
function facePoints(): Point[] {
  const points: Point[] = Array.from({ length: FACE_POINT_COUNT }, (_, i) => {
    const angle = i * 2.399963
    const r = 0.02 + 0.2 * Math.sqrt(i / FACE_POINT_COUNT)
    return [CX + Math.cos(angle) * r, CY + 0.02 + Math.sin(angle) * r * 1.1]
  })
  const ring = (
    indices: readonly number[],
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    turn = 0,
  ) =>
    indices.forEach((i, k) => {
      const angle = ((k + turn) / indices.length) * Math.PI * 2 - Math.PI / 2
      points[i] = [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
    })
  ring(FACE_PARTS.oval, CX, CY, RX * 0.8, RY * 0.8)
  const half = FACE_PARTS.brows.length / 2
  ring(FACE_PARTS.brows.slice(0, half), 0.6, 0.43, 0.06, 0.012)
  ring(FACE_PARTS.brows.slice(half), 0.4, 0.43, 0.06, 0.012)
  ring(FACE_PARTS.leftEye, 0.6, 0.48, 0.045, 0.016)
  ring(FACE_PARTS.rightEye, 0.4, 0.48, 0.045, 0.016)
  ring(FACE_PARTS.nose.slice(RIDGE.length), NOSE.x, NOSE.y, 0.035, 0.06, 0.5)
  RIDGE.forEach((i, k) => {
    points[i] = [NOSE.x, NOSE.y + (k - 5) * 0.016]
  })
  ring(FACE_PARTS.lips, 0.5, 0.7, 0.07, 0.022)
  ring(FACE_PARTS.leftIris, 0.6, 0.48, 0.01, 0.01)
  ring(FACE_PARTS.rightIris, 0.4, 0.48, 0.01, 0.01)
  return points
}

/** The face points in 3D, on the face's own surface. */
const points3d = (): Vec3[] => facePoints().map(([x, y]) => [x, y, surfaceZ(x, y)!])

/** A pose that turns the face by the angles given and sets it, `scale` large, in the middle of the photo. */
function posed(yaw: number, pitch: number, roll: number, scale = 1.1, shift: Point = [0, 0]): Pose {
  const rotation = poseRotation(yaw, pitch, roll)
  const [x, y] = projectPoint(makePose(rotation, scale, [0, 0]), [CX, CY, 0])
  return makePose(rotation, scale, [0.5 - x + shift[0], 0.5 - y + shift[1]])
}

/** Where a pose puts the points, packed as a photo's face points are (unrounded: the tests want them exact). */
const photoOf = (pose: Pose, points: readonly Vec3[]) =>
  points.flatMap((p) => projectPoint(pose, p))

/** A deterministic pseudo-random sequence in [0, 1). */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

describe('face mask pose', () => {
  test('yaw, pitch and roll read back from the rotation they make', () => {
    for (const [yaw, pitch, roll] of [
      [30, -12, 8],
      [-35, 20, -15],
      [0, 0, 90],
    ]) {
      const pose = makePose(poseRotation(yaw!, pitch!, roll!), 1, [0, 0])
      expect(pose.yaw).toBeCloseTo(yaw!, 9)
      expect(pose.pitch).toBeCloseTo(pitch!, 9)
      expect(pose.roll).toBeCloseTo(roll!, 9)
    }
  })

  test('turning to the subject’s left moves the nose to the image’s right; chin up lifts it', () => {
    const tip: Vec3 = [CX, CY, RZ]
    const base: Vec3 = [CX, CY, 0]
    const across = (pose: Pose) => projectPoint(pose, tip)[0] - projectPoint(pose, base)[0]
    const down = (pose: Pose) => projectPoint(pose, tip)[1] - projectPoint(pose, base)[1]
    expect(across(posed(20, 0, 0))).toBeGreaterThan(0)
    expect(down(posed(0, 15, 0))).toBeLessThan(0)
  })

  test('recovers a known camera exactly from its own points', () => {
    const points = points3d()
    const next = random(7)
    for (const yaw of [-35, -20, 0, 20, 35]) {
      for (const pitch of [-20, 0, 20]) {
        for (const roll of [-15, 0, 15]) {
          const scale = 0.8 + next() * 0.6
          const truth = posed(yaw, pitch, roll, scale, [next() * 0.1 - 0.05, next() * 0.1 - 0.05])
          const pose = estimatePose(photoOf(truth, points), points)
          expect(pose.yaw).toBeCloseTo(yaw, 6)
          expect(pose.pitch).toBeCloseTo(pitch, 6)
          expect(pose.roll).toBeCloseTo(roll, 6)
          expect(pose.scale).toBeCloseTo(scale, 9)
          pose.rotation.forEach((value, i) => {
            expect(value).toBeCloseTo(truth.rotation[i]!, 9)
          })
          expect(pose.shift[0]).toBeCloseTo(truth.shift[0], 9)
          expect(pose.shift[1]).toBeCloseTo(truth.shift[1], 9)
        }
      }
    }
  })

  test('a photo on its side reads as a 90° roll', () => {
    const points = points3d()
    const pose = estimatePose(photoOf(posed(5, 0, -90), points), points)
    expect(pose.roll).toBeCloseTo(-90, 6)
    expect(pose.yaw).toBeCloseTo(5, 6)
  })

  test('a smile or a raised brow hardly moves the pose; the outline is not used', () => {
    const points = points3d()
    const truth = posed(25, -10, 5)
    const photo = photoOf(truth, points)
    // A wide smile: the mouth's corners up and out.
    for (const i of FACE_PARTS.lips) {
      const [x] = [photo[i * 2]!]
      photo[i * 2] = x + (x - 0.5) * 0.15
      photo[i * 2 + 1]! -= 0.012
    }
    // A jaw quite unlike the character's.
    for (const i of FACE_PARTS.oval) photo[i * 2]! += (photo[i * 2]! - 0.5) * 0.2
    const pose = estimatePose(photo, points)
    expect(Math.abs(pose.yaw - 25)).toBeLessThan(2)
    expect(Math.abs(pose.pitch + 10)).toBeLessThan(2)
    expect(Math.abs(pose.roll - 5)).toBeLessThan(1)
  })

  test('the camera is refined to the least-squares best, past the best affine one made true', () => {
    // Only features the pose is fitted on, each missed by the same small
    // distance in a direction of its own (so none is trusted less): the
    // best affine camera soaks some of that up as stretch and shear, which
    // a true camera cannot, and made a true one it is off the best.
    const points = points3d()
    const used = [
      ...FACE_PARTS.brows,
      ...FACE_PARTS.rightEye,
      ...FACE_PARTS.leftEye,
      ...FACE_PARTS.nose,
      ...FACE_PARTS.lips,
    ]
    const only: Vec3[] = []
    for (const i of used) only[i] = points[i]!
    const truth = posed(35, 15, -10, 1.1)
    const next = random(5)
    const photo = photoOf(truth, points)
    for (const i of used) {
      const angle = 2 * Math.PI * next()
      photo[i * 2]! += 0.004 * Math.cos(angle)
      photo[i * 2 + 1]! += 0.004 * Math.sin(angle)
    }
    const pose = estimatePose(photo, only)
    // The squared misses, the photo's points and the head's each centred
    // (the best shift for any turn and scale).
    const cost = (rotation: readonly number[], scale: number) => {
      const placed = used.map((i) => projectPoint(makePose(rotation, scale, [0, 0]), points[i]!))
      const mean = (c: 0 | 1) =>
        used.reduce((sum, i, k) => sum + photo[i * 2 + c]! - placed[k]![c], 0) / used.length
      const [mx, my] = [mean(0), mean(1)]
      return used.reduce(
        (sum, i, k) =>
          sum +
          (photo[i * 2]! - placed[k]![0] - mx) ** 2 +
          (photo[i * 2 + 1]! - placed[k]![1] - my) ** 2,
        0,
      )
    }
    // Every point trusted alike (none past twice the median miss).
    const misses = used.map((i) => {
      const [x, y] = projectPoint(pose, points[i]!)
      return Math.hypot(x - photo[i * 2]!, y - photo[i * 2 + 1]!)
    })
    const median = [...misses].sort((a, b) => a - b)[misses.length >> 1]!
    expect(Math.max(...misses)).toBeLessThan(2 * median)
    // Turned or scaled a little either way, it only fits worse.
    const best = cost(pose.rotation, pose.scale)
    const step = 0.005
    for (const turn of [
      [step, 0, 0],
      [-step, 0, 0],
      [0, step, 0],
      [0, -step, 0],
      [0, 0, step],
      [0, 0, -step],
    ]) {
      const rotation = turnBy(poseRotation(turn[0]!, turn[1]!, turn[2]!), pose.rotation)
      expect(cost(rotation, pose.scale)).toBeGreaterThan(best)
    }
    expect(cost(pose.rotation, pose.scale * (1 + 1e-4))).toBeGreaterThan(best)
    expect(cost(pose.rotation, pose.scale * (1 - 1e-4))).toBeGreaterThan(best)
    // And it is the pose the photo was taken in, all but the misses.
    expect(Math.abs(pose.yaw - 35)).toBeLessThan(0.5)
    expect(Math.abs(pose.pitch - 15)).toBeLessThan(0.5)
    expect(Math.abs(pose.roll + 10)).toBeLessThan(0.5)
  })
})

/** A rotation turned further by another (both row-major 3 × 3): `turn` · `rotation`. */
function turnBy(turn: readonly number[], rotation: readonly number[]): number[] {
  return [0, 1, 2].flatMap((r) =>
    [0, 1, 2].map(
      (c) =>
        turn[r * 3]! * rotation[c]! +
        turn[r * 3 + 1]! * rotation[3 + c]! +
        turn[r * 3 + 2]! * rotation[6 + c]!,
    ),
  )
}

describe('face mask fit', () => {
  const geometry = faceMesh()
  const landmarks = faceLandmarks3d(geometry, packPoints(facePoints()), FRAME)

  test('the front view’s side comes back from the head’s normals', () => {
    expect(estimateFrameSize(geometry.skin) / FRAME).toBeCloseTo(1, 1)
  })

  test('landmarks sit on the face’s surface', () => {
    // Within what the mesh's flat triangles cut off the nose's curve: at its
    // tip, an eighth of a cell's diagonal squared times the curve, 2e-3.
    for (const [x, y, z] of landmarks.points)
      expect(Math.abs(z - surfaceZ(x, y)!)).toBeLessThan(2e-3)
  })

  test('each landmark lands exactly on its photo point; the rest of the face moves smoothly', () => {
    const truth = posed(20, -8, 6, 1.05)
    const next = random(3)
    // The photo's face: the character's, a little wider at the jaw and
    // with a fuller mouth, plus some jitter.
    const photo = photoOf(truth, landmarks.points).map((v, i) => {
      const point = Math.floor(i / 2)
      const lips = (FACE_PARTS.lips as readonly number[]).includes(point) ? 0.01 : 0
      return v + (next() - 0.5) * 0.01 + (i % 2 ? lips : 0)
    })
    const fit = fitMask(photo, landmarks)
    for (const i of fit.pulled) {
      const [x, y] = maskPoint(fit, landmarks.points[i]!)
      expect(x).toBeCloseTo(photo[i * 2]!, 9)
      expect(y).toBeCloseTo(photo[i * 2 + 1]!, 9)
    }
    // Moved across the photo's image plane only: never nearer its camera.
    const offset = [0, 0, 0]
    for (let k = 0; k < 50; k++) {
      const x = CX + (next() - 0.5) * RX
      const y = CY + (next() - 0.5) * RY
      maskOffset(fit, [x, y, surfaceZ(x, y)!], offset)
      expect(cameraDepth(fit.pose, offset)).toBeCloseTo(0, 12)
    }
    // Between the landmarks the push and pull changes gradually.
    const at = (x: number) => {
      maskOffset(fit, [x, 0.6, surfaceZ(x, 0.6)!], offset)
      return [...offset]
    }
    for (let x = 0.35; x < 0.65; x += 0.005) {
      const [a, b] = [at(x), at(x + 0.005)]
      expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)).toBeLessThan(0.004)
    }
  })

  test('the face far from every landmark stays put, and so does the head behind it', () => {
    const photo = photoOf(posed(-15, 5, 0), landmarks.points).map((v, i) => v + (i % 7) * 0.002)
    const fit = fitMask(photo, landmarks)
    const offset = [1, 1, 1]
    maskOffset(fit, [CX + RX * 2, CY, 0], offset)
    expect(offset).toEqual([0, 0, 0])
    maskOffset(fit, [0.5, 0.5, -RZ], offset)
    expect(offset).toEqual([0, 0, 0])
  })

  test('with the photo’s points where the pose puts the character’s, nothing moves', () => {
    const truth = posed(30, 10, -10, 0.9)
    const fit = fitMask(photoOf(truth, landmarks.points), landmarks)
    const offset = [0, 0, 0]
    for (const [x, y] of [
      [0.45, 0.5],
      [0.55, 0.65],
      [0.4, 0.35],
    ] as Point[]) {
      maskOffset(fit, [x, y, surfaceZ(x, y)!], offset)
      expect(Math.hypot(offset[0]!, offset[1]!, offset[2]!)).toBeLessThan(1e-9)
    }
  })

  test('a landmark on a turned face’s silhouette is pulled along it, not out past it, unless pinned', () => {
    // Turned 60° to its left, the nose's tip stands out past the far cheek
    // (the image's right): it is the face's silhouette there.
    const truth = posed(60, 0, 0)
    const photo = photoOf(truth, landmarks.points)
    const [x, y] = [photo[TIP * 2]!, photo[TIP * 2 + 1]!]
    const pushed = [...photo]
    pushed[TIP * 2] = x + 0.01
    pushed[TIP * 2 + 1] = y + 0.01
    const [fx, fy] = maskPoint(fitMask(pushed, landmarks, truth), landmarks.points[TIP]!)
    expect(fx - x).toBeLessThan(0.001)
    expect(fy - y).toBeCloseTo(0.01, 3)
    // The player's own pins land where they put them.
    const pinned = fitMask(pushed, landmarks, truth, new Set([TIP]))
    const [px, py] = maskPoint(pinned, landmarks.points[TIP]!)
    expect(px).toBeCloseTo(x + 0.01, 9)
    expect(py).toBeCloseTo(y + 0.01, 9)
    // Turned less, the tip is well inside the face and pulled all the way.
    const slight = posed(20, 0, 0)
    const near = photoOf(slight, landmarks.points)
    near[TIP * 2]! += 0.01
    const [sx] = maskPoint(fitMask(near, landmarks, slight), landmarks.points[TIP]!)
    expect(sx).toBeCloseTo(near[TIP * 2]!, 9)
  })

  test('the wireframe lies over the photo, its near side facing the camera more than its far', () => {
    const truth = posed(30, 0, 0)
    const fit = fitMask(photoOf(truth, landmarks.points), landmarks)
    const edges = maskWireframe(geometry, fit)
    expect(edges.length).toBeGreaterThan(500)
    const near: number[] = []
    const far: number[] = []
    for (const { from, to, facing } of edges) {
      for (const [x, y] of [from, to]) {
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(1)
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(1)
      }
      // The subject turned to their left: the image's left is the near side.
      ;(from[0] + to[0] < 2 * projectPoint(truth, [CX, CY, RZ])[0] ? near : far).push(facing)
    }
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length
    expect(mean(near)).toBeGreaterThan(mean(far) + 0.2)
  })
})

/** A texture (the synthetic face's u, v across its front view) of the colours `paint` gives each point. */
function textureOf(paint: (u: number, v: number) => number[], size = 256): Pixels {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data.set([...paint((x + 0.5) / size, (y + 0.5) / size), 255], (y * size + x) * 4)
    }
  }
  return { data, width: size, height: size }
}

/** A texture of smooth colour waves across the front view. */
const waves = () =>
  textureOf((u, v) => [
    128 + 100 * Math.sin(2 * Math.PI * 3 * u),
    128 + 100 * Math.sin(2 * Math.PI * 2.5 * v + 1),
    128 + 80 * Math.cos(2 * Math.PI * (2 * u + 1.5 * v)),
  ])

/** Colour waves the same either side of `midline` (a mirror image across it matches). */
const mirrorWaves = (midline: number) =>
  textureOf((u, v) => [
    128 + 100 * Math.cos(2 * Math.PI * 3 * (u - midline)),
    128 + 100 * Math.sin(2 * Math.PI * 2.5 * v + 1),
    128 + 80 * Math.cos(2 * Math.PI * (8 * (u - midline) ** 2 + 1.5 * v)),
  ])

/** A photo's background no colour of the waves comes near. */
const GREEN = [0, 255, 0] as const

/** Whether a pixel is more the photo's green background than face. */
const isGreen = (image: Pixels, pixel: number) =>
  image.data[pixel * 4]! < 14 && image.data[pixel * 4 + 2]! < 24 && image.data[pixel * 4 + 1]! > 140

/**
 * A photo of the synthetic face in a pose, `size` pixels a side, drawn by
 * renderFront (`background` where there is no face), with its depth (m,
 * nearer the camera higher).
 */
function photograph(
  geometry: HeadGeometry,
  texture: Pixels,
  pose: Pose,
  size: number,
  background: readonly number[] = [120, 120, 120],
) {
  const r = pose.rotation
  const turned = geometry.all.map((tri): HeadTriangle => {
    const corners = [0, 1, 2].map((k): Vec3 => [tri.x[k]!, tri.y[k]!, tri.z[k]! / FRAME])
    const normals = corners.map(([x, y]) => normalAt(x, y))
    return {
      ...tri,
      x: corners.map((p) => projectPoint(pose, p)[0]),
      y: corners.map((p) => projectPoint(pose, p)[1]),
      z: corners.map((p) => cameraDepth(pose, p) * FRAME),
      n: normals.map((n) => r[6]! * n[0] + r[7]! * n[1] + r[8]! * n[2]),
    }
  })
  const { image, depth } = renderFront(texture, turned, size)
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] === Number.NEGATIVE_INFINITY) image.data.set([...background, 255], i * 4)
  }
  return { photo: image, depth }
}

describe('face projection', () => {
  const geometry = faceMesh()
  const landmarks = faceLandmarks3d(geometry, packPoints(facePoints()), FRAME)
  const texture = waves()
  const SIZE = 256
  const PHOTO = 320
  const truth = renderFront(texture, geometry.all, SIZE)

  const difference = (a: Pixels, b: Pixels, pixel: number) =>
    (Math.abs(a.data[pixel * 4]! - b.data[pixel * 4]!) +
      Math.abs(a.data[pixel * 4 + 1]! - b.data[pixel * 4 + 1]!) +
      Math.abs(a.data[pixel * 4 + 2]! - b.data[pixel * 4 + 2]!)) /
    3

  /** The front-view pixels well inside the face. */
  const inner: number[] = []
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const [x, y] = [(px + 0.5) / SIZE, (py + 0.5) / SIZE]
      if (((x - CX) / RX) ** 2 + ((y - CY) / RY) ** 2 < 0.6) inner.push(py * SIZE + px)
    }
  }

  test('a face photographed in a known pose comes back as its own front view', () => {
    for (const pose of [posed(0, 0, 0, 1.2), posed(15, -10, 10, 1.1, [0.03, -0.02])]) {
      const { photo } = photograph(geometry, texture, pose, PHOTO)
      const fit = fitMask(photoOf(pose, landmarks.points), landmarks)
      const { warped, seen } = projectFace(photo, fit, geometry, SIZE)
      expect(warped.width).toBe(SIZE)
      expect(warped.height).toBe(SIZE)
      const shown = inner.filter((pixel) => seen[pixel]! > 0.9)
      expect(shown.length).toBeGreaterThan(inner.length * 0.9)
      const error = shown.reduce((sum, pixel) => sum + difference(warped, truth.image, pixel), 0)
      expect(error / shown.length).toBeLessThan(3)
    }
  })

  test('what the nose hides from a turned photo is seen as hidden, and taken from the other side', () => {
    const pose = posed(40, 0, 0, 1.1)
    const { photo, depth } = photograph(geometry, texture, pose, PHOTO)
    const fit = fitMask(photoOf(pose, landmarks.points), landmarks)
    const { warped, seen, mirrored } = projectFace(photo, fit, geometry, SIZE)
    // What the photo shows at each front-view point, by its own depth
    // buffer: hidden where something is well nearer its camera all round.
    const hidden: number[] = []
    const shown: number[] = []
    for (const pixel of inner) {
      const [px, py] = [pixel % SIZE, Math.floor(pixel / SIZE)]
      const p: Vec3 = [(px + 0.5) / SIZE, (py + 0.5) / SIZE, truth.depth[pixel]! / FRAME]
      const [x, y] = projectPoint(pose, p)
      const near = cameraDepth(pose, p) * FRAME
      const gaps: number[] = []
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [qx, qy] = [Math.floor(x * PHOTO) + dx, Math.floor(y * PHOTO) + dy]
          gaps.push(depth[qy * PHOTO + qx]! - near)
        }
      }
      const n = normalAt(p[0], p[1])
      const facing = pose.rotation[6]! * n[0] + pose.rotation[7]! * n[1] + pose.rotation[8]! * n[2]
      if (gaps.every((gap) => gap > 0.008)) hidden.push(pixel)
      else if (gaps.every((gap) => Math.abs(gap) < 0.002) && facing > 0.6) shown.push(pixel)
    }
    expect(hidden.length).toBeGreaterThan(50)
    const mean = (pixels: number[], values: Float32Array) =>
      pixels.reduce((sum, pixel) => sum + values[pixel]!, 0) / pixels.length
    expect(mean(hidden, seen)).toBeLessThan(0.6)
    expect(mean(hidden, mirrored)).toBeGreaterThan(0.6)
    expect(mean(shown, seen)).toBeGreaterThan(0.9)
    // Where it shows, it is the face's own colour.
    const clear = shown.filter((pixel) => mirrored[pixel]! < 0.01 && seen[pixel]! > 0.95)
    expect(clear.length).toBeGreaterThan(shown.length / 2)
    const error = clear.reduce((sum, pixel) => sum + difference(warped, truth.image, pixel), 0)
    expect(error / clear.length).toBeLessThan(4)
  })

  test('what the photo shows worse is taken whole from the face’s other side, in its colour', () => {
    const pose = posed(40, 0, 0, 1.1)
    // The far side's landmarks (the image's right) a few pixels off, as one
    // side's often are: its own colours land a little out of place.
    const points = photoOf(pose, landmarks.points)
    landmarks.points.forEach(([x], i) => {
      if (x < CX + 0.02) return
      points[i * 2]! += 2.5 / PHOTO
      points[i * 2 + 1]! -= 1.5 / PHOTO
    })
    const fit = fitMask(points, landmarks, pose)
    const even = mirrorWaves(fit.midline)
    const { photo } = photograph(geometry, even, pose, PHOTO)
    const { warped, mirrored } = projectFace(photo, fit, geometry, SIZE)
    const own = renderFront(even, geometry.all, SIZE).image
    const taken = inner.filter((pixel) => mirrored[pixel]! > 0.05)
    expect(taken.length).toBeGreaterThan(inner.length * 0.15)
    // Taken whole, not a mix of two images each a little out of place.
    const whole = taken.filter((pixel) => mirrored[pixel]! > 0.95)
    expect(whole.length).toBeGreaterThan(taken.length * 0.7)
    // In the colour of the mirror image (the face is the same either side).
    const error = taken.reduce((sum, pixel) => sum + difference(warped, own, pixel), 0)
    expect(error / taken.length).toBeLessThan(3)
  })

  test('the background past a turned face’s silhouette is never counted as seen', () => {
    // Turned 60°, the nose's tip stands out past the far cheek, against the
    // background. A photo's landmarks along a silhouette land a few pixels
    // past it, out on the background.
    const pose = posed(60, 0, 0, 1.1)
    const { photo, depth } = photograph(geometry, texture, pose, PHOTO, GREEN)
    const bare = (x: number, y: number) => {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const [px, py] = [Math.floor(x * PHOTO) + dx, Math.floor(y * PHOTO) + dy]
          if (depth[py * PHOTO + px] === Number.NEGATIVE_INFINITY) return true
        }
      }
      return false
    }
    const points = photoOf(pose, landmarks.points)
    let pushed = 0
    landmarks.points.forEach(([x, y], i) => {
      if (!bare(points[i * 2]!, points[i * 2 + 1]!)) return
      const n = normalAt(x, y)
      const r = pose.rotation
      const out = [
        r[0]! * n[0] + r[1]! * n[1] + r[2]! * n[2],
        r[3]! * n[0] + r[4]! * n[1] + r[5]! * n[2],
      ]
      const length = Math.hypot(out[0]!, out[1]!)
      points[i * 2]! += (3 / PHOTO) * (out[0]! / length)
      points[i * 2 + 1]! += (3 / PHOTO) * (out[1]! / length)
      pushed++
    })
    expect(pushed).toBeGreaterThan(3)
    // Wherever the colour is the background's, it is not seen: as fitted,
    // and in a pose 4° out, where the mask's profile overhangs the photo's.
    const backgroundOf = (fit: MaskFit) => {
      const { warped, seen } = projectFace(photo, fit, geometry, SIZE)
      const background: number[] = []
      for (let pixel = 0; pixel < SIZE * SIZE; pixel++) {
        if (warped.data[pixel * 4 + 3] === 255 && isGreen(warped, pixel)) background.push(pixel)
      }
      expect(background.filter((pixel) => seen[pixel]! > 0.05)).toEqual([])
      return background
    }
    backgroundOf(fitMask(points, landmarks))
    const overhang = backgroundOf(fitMask(points, landmarks, posed(64, 0, 0, 1.1)))
    expect(overhang.length).toBeGreaterThan(10)
  })

  test('nothing far past the face is drawn', () => {
    const pose = posed(0, 0, 0)
    const { photo } = photograph(geometry, texture, pose, PHOTO)
    const fit = fitMask(photoOf(pose, landmarks.points), landmarks)
    const { warped } = projectFace(photo, fit, geometry, SIZE)
    expect(warped.data[(2 * SIZE + 2) * 4 + 3]).toBe(0)
    expect(warped.data[(Math.round(0.56 * SIZE) * SIZE + SIZE / 2) * 4 + 3]).toBe(255)
  })
})
