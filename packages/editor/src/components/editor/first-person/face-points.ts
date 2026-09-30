/**
 * The face landmarks a face swap works from: a subset of MediaPipe Face
 * Landmarker's 478 points (the face's outline, brows, eyes, nose, lips, the
 * cheeks and forehead between them, and the irises). A photo and a
 * character's face are each described by these points, in this order, as
 * fractions of their image (x right, y down); the photo is then warped
 * triangle by triangle so every point lands on the character's.
 */

export type Point = [number, number]

/** The face's outline, clockwise from the top of the forehead (as MediaPipe orders it). */
const OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
  176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const

const BROWS = [
  276, 283, 282, 295, 285, 300, 293, 334, 296, 336, 46, 53, 52, 65, 55, 70, 63, 105, 66, 107,
] as const

const EYES = [
  263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398, 33, 7, 163, 144,
  145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173,
] as const

const LIPS = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 78, 95,
  88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
] as const

const NOSE = [
  168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327, 64, 294, 129, 358, 49, 279, 48, 278, 115, 344, 220,
  440, 45, 275, 51, 281, 3, 248,
] as const

const CHEEKS = [
  50, 280, 205, 425, 187, 411, 123, 352, 116, 345, 117, 346, 118, 347, 101, 330, 36, 266, 142, 371,
  203, 423, 206, 426, 216, 436, 207, 427, 214, 434, 212, 432, 202, 422, 204, 424, 211, 431, 32, 262,
  199, 175, 151, 9, 8, 108, 337, 69, 299, 104, 333, 43, 273, 57, 287, 186, 410, 92, 322, 165, 391,
] as const

/** Each iris: its centre, then four points on its rim (the subject's right, then left). */
const IRISES = [468, 469, 470, 471, 472, 473, 474, 475, 476, 477] as const

/** The MediaPipe landmark index of each face point, in order. */
export const FACE_POINT_INDICES: readonly number[] = [
  ...new Set<number>([...OVAL, ...BROWS, ...EYES, ...LIPS, ...NOSE, ...CHEEKS, ...IRISES]),
]

export const FACE_POINT_COUNT = FACE_POINT_INDICES.length

const at = new Map(FACE_POINT_INDICES.map((index, i) => [index, i]))
const positions = (indices: readonly number[]) => indices.map((index) => at.get(index)!)

/** Where the named parts sit among the face points. */
export const FACE_PARTS = {
  oval: positions(OVAL),
  brows: positions(BROWS),
  /** The subject's right eye (the image's left), then left. */
  rightEye: positions(EYES.slice(16)),
  leftEye: positions(EYES.slice(0, 16)),
  lips: positions(LIPS.slice(0, 20)),
  nose: positions(NOSE),
  /** Iris centre and rim, the subject's right then left. */
  rightIris: positions(IRISES.slice(0, 5)),
  leftIris: positions(IRISES.slice(5)),
  /** Cheek points well clear of the eyes, nose and mouth: where the skin's colour shows. */
  cheeks: positions([50, 280, 205, 425, 101, 330, 36, 266, 187, 411]),
  /** The warp's triangles leave the irises out (they move with the eyes). */
  warp: positions(FACE_POINT_INDICES.filter((index) => index < 468)),
} as const

/** Flattened `[x0, y0, x1, y1, …]` face points as pairs. */
export function unpackPoints(flat: readonly number[]): Point[] {
  const points: Point[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i]!, flat[i + 1]!])
  return points
}

/** Face points as flattened pairs, rounded to 1/10000 (they travel and are stored). */
export function packPoints(points: readonly Point[]): number[] {
  return points.flatMap(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4])
}

export const isFacePoints = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length === FACE_POINT_COUNT * 2 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n))

const centroid = (points: readonly Point[]): Point => {
  let x = 0
  let y = 0
  for (const point of points) {
    x += point[0]
    y += point[1]
  }
  return [x / points.length, y / points.length]
}

/**
 * The part of a face a swap replaces: its outline, with the forehead cut
 * down to a little above the brows (hairlines and fringes differ, and a
 * photo's hair must not land on the character's skin).
 */
export function faceRegion(points: readonly Point[]): Point[] {
  const brows = FACE_PARTS.brows.map((i) => points[i]!)
  const browTop = Math.min(...brows.map(([, y]) => y))
  const eyes = centroid([...FACE_PARTS.leftEye, ...FACE_PARTS.rightEye].map((i) => points[i]!))
  const browHeight = Math.max(1e-6, eyes[1] - browTop)
  // Keep as much forehead above the brows as the brows sit above the eyes.
  const limit = browTop - browHeight * 0.9
  return FACE_PARTS.oval.map((i) => {
    const [x, y] = points[i]!
    return [x, y < limit ? limit - (limit - y) * 0.35 : y] as Point
  })
}

/**
 * A ring of extra points around the face (its outline pushed out from its
 * centre), so a warp reaches a little past the face and the blend has the
 * character's own skin to meet there. Add them to both sides of a warp.
 */
export function marginRing(points: readonly Point[], spread = 0.22): Point[] {
  const outline = FACE_PARTS.oval.map((i) => points[i]!)
  const [cx, cy] = centroid(outline)
  return outline.map(([x, y]) => [cx + (x - cx) * (1 + spread), cy + (y - cy) * (1 + spread)])
}

const cross = (o: Point, a: Point, b: Point) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** The convex hull of some points (monotone chain), counter-clockwise on a y-down image. */
function hull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const half = (list: Point[]) => {
    const chain: Point[] = []
    for (const point of list) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0
      ) {
        chain.pop()
      }
      chain.push(point)
    }
    chain.pop()
    return chain
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/**
 * The face's features — each brow and eye, the nose, the lips — as outlines
 * around their points, pushed out (by fractions of the distance between the
 * eyes) far enough to take in what goes with them: lashes and lid creases,
 * nostrils, the lips' shadows. Outside them, in the face, is where hair can
 * fall.
 */
export function featureRegions(points: readonly Point[]): Point[][] {
  const pick = (indices: readonly number[]) => indices.map((i) => points[i]!)
  const rightEye = centroid(pick(FACE_PARTS.rightEye))
  const leftEye = centroid(pick(FACE_PARTS.leftEye))
  const eyes = Math.hypot(leftEye[0] - rightEye[0], leftEye[1] - rightEye[1])
  const half = FACE_PARTS.brows.length / 2
  const parts: [readonly number[], number][] = [
    [FACE_PARTS.brows.slice(0, half), 0.06],
    [FACE_PARTS.brows.slice(half), 0.06],
    [FACE_PARTS.rightEye, 0.16],
    [FACE_PARTS.leftEye, 0.16],
    [FACE_PARTS.nose, 0.08],
    [FACE_PARTS.lips, 0.1],
  ]
  return parts.map(([part, margin]) => grown(hull(pick(part)), margin * eyes))
}

/**
 * A convex outline pushed out by `distance` all round: each corner moved
 * along the bisector of its two sides' outward normals, far enough that
 * both sides move `distance` (a sharp corner's reach capped at three times
 * that).
 */
function grown(outline: readonly Point[], distance: number): Point[] {
  if (outline.length < 3) {
    // Too few corners for sides (points in a line): the box round them, grown.
    const xs = outline.map(([x]) => x)
    const ys = outline.map(([, y]) => y)
    const left = Math.min(...xs) - distance
    const right = Math.max(...xs) + distance
    const top = Math.min(...ys) - distance
    const bottom = Math.max(...ys) + distance
    return [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ]
  }
  const [cx, cy] = centroid(outline)
  const normals = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length]!
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    let nx = (b[1] - a[1]) / length
    let ny = -(b[0] - a[0]) / length
    // Outward: away from the middle.
    if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) {
      nx = -nx
      ny = -ny
    }
    return [nx, ny] as Point
  })
  return outline.map(([x, y], i) => {
    const [ax, ay] = normals[(i + normals.length - 1) % normals.length]!
    const [bx, by] = normals[i]!
    const mx = ax + bx
    const my = ay + by
    const length = Math.hypot(mx, my)
    if (length < 1e-9) return [x + ax * distance, y + ay * distance] as Point
    const reach = Math.min(3, 1 / ((mx / length) * bx + (my / length) * by))
    return [x + (mx / length) * distance * reach, y + (my / length) * distance * reach] as Point
  })
}
