import {
  FACE_PARTS,
  FACE_POINT_COUNT,
  facePointOf,
  type Point,
  packPoints,
  unpackPoints,
} from './face-points'

/**
 * Fitting the mask — the face points laid over a player's photo — by hand.
 * The player grabs a handle and pulls, and the points round it follow, less
 * and less further out, the way Blender's proportional editing moves a
 * mesh; with symmetry on, the other side of the face takes the mirror image
 * of the move. MediaPipe lays the mask; this is how the player puts right
 * what it got wrong (a fringe over the brows, a beard over the jaw, a head
 * turned a little). Handles are named by MediaPipe landmark, as pins are
 * (face-pins.ts), so one grab means the same point in either.
 */

export const MASK_GROUPS = ['brows', 'eyes', 'nose', 'lips', 'outline', 'cheeks'] as const
export type MaskGroupId = (typeof MASK_GROUPS)[number]

/** A part of the face and its handles (MediaPipe landmarks). */
export type MaskGroup = { id: MaskGroupId; label: string; landmarks: readonly number[] }

const byLandmark = (landmarks: readonly number[]) => landmarks.map(facePointOf)

/**
 * The handles a mask shows, by part of the face: the corners, peaks and
 * middles that give each feature its shape, enough to fit any face and few
 * enough to pick out by finger. Everything between follows them.
 */
export const MASK_HANDLES: readonly MaskGroup[] = [
  // Each brow's tail, arch (top and bottom) and head (top and bottom).
  { id: 'brows', label: '눈썹', landmarks: [46, 105, 52, 107, 55, 276, 334, 282, 336, 285] },
  // Each eye's corners, three points along each lid, and its iris.
  {
    id: 'eyes',
    label: '눈',
    landmarks: [
      33, 160, 159, 158, 133, 153, 145, 144, 468, 263, 387, 386, 385, 362, 380, 374, 373, 473,
    ],
  },
  // The bridge from between the eyes to the tip, the base, the wings and the nostrils.
  { id: 'nose', label: '코', landmarks: [168, 6, 195, 4, 2, 64, 294, 98, 327] },
  // The corners, the upper lip's bow, the lower lip, and the line where they meet.
  { id: 'lips', label: '입술', landmarks: [61, 40, 37, 0, 267, 270, 291, 405, 17, 181, 13, 14] },
  // Every other point round the face, from the top of the forehead.
  {
    id: 'outline',
    label: '턱·윤곽',
    landmarks: [10, 297, 389, 454, 361, 397, 379, 400, 152, 176, 150, 172, 132, 234, 162, 67],
  },
  // The cheekbones and the cheeks under them.
  { id: 'cheeks', label: '볼', landmarks: [116, 345, 205, 425] },
]

const HANDLE_LANDMARKS: readonly number[] = MASK_HANDLES.flatMap((group) => group.landmarks)

/**
 * MediaPipe's landmarks in mirrored pairs (flattened), from its canonical
 * face model, which is symmetric across its middle; the irises (not in the
 * model) pair centre with centre and rim with rim. The face points not
 * listed lie on the middle and are their own mirror images.
 */
const MIRROR_PAIRS = [
  148, 377, 176, 400, 149, 378, 150, 379, 136, 365, 172, 397, 58, 288, 132, 361, 93, 323, 234, 454,
  127, 356, 162, 389, 21, 251, 54, 284, 103, 332, 67, 297, 109, 338, 46, 276, 53, 283, 52, 282, 65,
  295, 55, 285, 70, 300, 63, 293, 105, 334, 66, 296, 107, 336, 33, 263, 7, 249, 163, 390, 144, 373,
  145, 374, 153, 380, 154, 381, 155, 382, 133, 362, 246, 466, 161, 388, 160, 387, 159, 386, 158,
  385, 157, 384, 173, 398, 61, 291, 146, 375, 91, 321, 181, 405, 84, 314, 37, 267, 39, 269, 40, 270,
  185, 409, 78, 308, 95, 324, 88, 318, 178, 402, 87, 317, 82, 312, 81, 311, 80, 310, 191, 415, 98,
  327, 64, 294, 129, 358, 49, 279, 48, 278, 115, 344, 220, 440, 45, 275, 51, 281, 3, 248, 50, 280,
  205, 425, 187, 411, 123, 352, 116, 345, 117, 346, 118, 347, 101, 330, 36, 266, 142, 371, 203, 423,
  206, 426, 216, 436, 207, 427, 214, 434, 212, 432, 202, 422, 204, 424, 211, 431, 32, 262, 108, 337,
  69, 299, 104, 333, 43, 273, 57, 287, 186, 410, 92, 322, 165, 391, 468, 473, 469, 476, 470, 475,
  471, 474, 472, 477,
] as const

function mirrorTable(): number[] {
  const mirrors = Array.from({ length: FACE_POINT_COUNT }, (_, i) => i)
  for (let k = 0; k < MIRROR_PAIRS.length; k += 2) {
    const a = facePointOf(MIRROR_PAIRS[k]!)
    const b = facePointOf(MIRROR_PAIRS[k + 1]!)
    mirrors[a] = b
    mirrors[b] = a
  }
  return mirrors
}

/** Each face point's mirror image across the face (by place; a point on the middle is its own). */
export const FACE_POINT_MIRRORS: readonly number[] = mirrorTable()

/** Blender's proportional-editing falloffs: how a move fades from the grab out to the radius. */
export const FALLOFFS = ['smooth', 'sphere', 'sharp', 'constant'] as const
export type Falloff = (typeof FALLOFFS)[number]

/**
 * How much of a move reaches a point `t` of the way out to the radius:
 * all of it at the grabbed point, none from the radius on. `smooth` eases
 * in and out, `sphere` stays full longest (a dome), `sharp` falls away
 * fast (a spike), `constant` moves everything inside as one.
 */
export function falloffWeight(falloff: Falloff, t: number): number {
  if (!(t < 1)) return 0
  if (t <= 0) return 1
  const r = 1 - t
  switch (falloff) {
    case 'smooth':
      return r * r * (3 - 2 * r)
    case 'sphere':
      return Math.sqrt(r * (2 - r))
    case 'sharp':
      return r * r
    case 'constant':
      return 1
  }
}

/**
 * How far a grab reaches (`radius`, in the points' own units; 0 moves the
 * grabbed point alone), how it fades, and whether the other side of the
 * face mirrors it.
 */
export type ProportionalOptions = { radius: number; falloff: Falloff; symmetric: boolean }

/**
 * What a grab gives one point: `weight` of the move, with the part of the
 * move across the face (along the line through the eyes) multiplied by
 * `across` — 1 as grabbed, −1 mirrored (nearer 0 on the far side of a
 * turned head, as a photo foreshortens it), 0 for a point a symmetric edit
 * keeps on the face's middle.
 */
export type Share = { weight: number; across: number }

/**
 * The move a share of a grab by `delta` gives, on a face whose line across
 * (a unit vector from the image's left eye to its right) is `axis`: on an
 * upright face mirroring flips dx, on a tilted one it flips the part of
 * the move along its own line across.
 */
export function sharedMove({ weight, across }: Share, [dx, dy]: Point, [ax, ay]: Point): Point {
  const flip = (across - 1) * (dx * ax + dy * ay)
  return [weight * (dx + flip * ax), weight * (dy + flip * ay)]
}

/**
 * The line across a face: the unit vector from its left side to its right
 * as the image shows them, from every mirrored pair of points (each turned
 * to agree with the eyes), so a head tilted in the photo mirrors about its
 * own middle.
 */
export function faceAcross(points: readonly Point[]): Point {
  const total = (part: readonly number[]) =>
    part.reduce<Point>((sum, i) => [sum[0] + points[i]![0], sum[1] + points[i]![1]], [0, 0])
  const [rx, ry] = total(FACE_PARTS.rightEye)
  const [lx, ly] = total(FACE_PARTS.leftEye)
  let x = 0
  let y = 0
  FACE_POINT_MIRRORS.forEach((partner, i) => {
    if (partner <= i) return
    const vx = points[partner]![0] - points[i]![0]
    const vy = points[partner]![1] - points[i]![1]
    const side = Math.sign(vx * (lx - rx) + vy * (ly - ry))
    x += side * vx
    y += side * vy
  })
  const length = Math.hypot(x, y)
  return length > 1e-12 ? [x / length, y / length] : [1, 0]
}

/**
 * How a grab at `landmark` moves each of the face points (Blender's
 * proportional editing; the shares come in the points' order). With
 * symmetry, of each mirrored pair the one nearer the grab moves with it and
 * its partner by the mirror image, at the same weight — so the two sides'
 * moves mirror exactly, however uneven the face — and points on the middle
 * move only along it (a grab on the middle, too).
 */
export function proportionalShares(
  points: readonly Point[],
  landmark: number,
  options: ProportionalOptions,
): Share[] {
  const { radius, falloff, symmetric } = options
  const handle = facePointOf(landmark)
  const [hx, hy] = points[handle]!
  const distances = points.map(([x, y]) => Math.hypot(x - hx, y - hy))
  const weightOf = (i: number) => {
    if (i === handle) return 1
    return radius > 0 ? falloffWeight(falloff, distances[i]! / radius) : 0
  }
  if (!symmetric) return points.map((_, i) => ({ weight: weightOf(i), across: 1 }))
  // Which of a pair moves with the grab: the grabbed point, else the nearer (a tie goes by order).
  const leads = (i: number, partner: number) =>
    i === handle ||
    (partner !== handle &&
      (distances[i]! < distances[partner]! || (distances[i] === distances[partner] && i < partner)))
  const sideways = FACE_POINT_MIRRORS[handle] === handle ? 0 : 1
  return points.map((_, i) => {
    const partner = FACE_POINT_MIRRORS[i]!
    if (partner === i) return { weight: weightOf(i), across: 0 }
    return leads(i, partner)
      ? { weight: weightOf(i), across: sideways }
      : { weight: weightOf(partner), across: -sideways }
  })
}

/**
 * Each iris (centre, then rim) and its eye (as FACE_PARTS has it: the
 * lower lid corner to corner, then the upper lid between, out to in).
 */
const IRISES = [
  { iris: FACE_PARTS.rightIris, eye: FACE_PARTS.rightEye },
  { iris: FACE_PARTS.leftIris, eye: FACE_PARTS.leftEye },
]

/** An eye's outline as a ring: the lower lid out to in, then the upper back. */
const eyeRing = (eye: readonly number[]) => [...eye.slice(0, 9), ...eye.slice(9).reverse()]

/**
 * How far in from its eye's corners, and from its lids, an iris that left
 * its eye is put back (shares of the eye's length and of its opening).
 */
const IRIS_INSET = 0.15

/**
 * Where a line (its points as [along it, across it], in order) is across
 * at `along`: between the points either side, or the nearest point's past
 * its ends.
 */
function lineAt(line: readonly Point[], along: number): number {
  let nearest = line[0]!
  for (let k = 1; k < line.length; k++) {
    const [u0, v0] = line[k - 1]!
    const [u1, v1] = line[k]!
    if (u0 !== u1 && (along - u0) * (along - u1) <= 0)
      return v0 + ((v1 - v0) * (along - u0)) / (u1 - u0)
    if (Math.abs(u1 - along) < Math.abs(nearest[0] - along)) nearest = line[k]!
  }
  return nearest[1]
}

/**
 * Puts an iris whose centre has left its eye back inside: worked out along
 * the eye (its outer corner to its inner, whatever the head's tilt) and
 * across it, the centre is brought within the corners and between the
 * lids, a little in from them.
 */
function keepInEye(points: Point[], iris: readonly number[], eye: readonly number[]) {
  const [ox, oy] = points[eye[0]!]!
  const [ix, iy] = points[eye[8]!]!
  const length = Math.hypot(ix - ox, iy - oy)
  if (length < 1e-9) return
  const ax = (ix - ox) / length
  const ay = (iy - oy) / length
  const frame = ([x, y]: Point): Point => [
    ((x - ox) * ax + (y - oy) * ay) / length,
    ((y - oy) * ax - (x - ox) * ay) / length,
  ]
  const lower = eye.slice(0, 9).map((i) => frame(points[i]!))
  const upper = [lower[0]!, ...eye.slice(9).map((i) => frame(points[i]!)), lower[8]!]
  const centre = points[iris[0]!]!
  const [u, v] = frame(centre)
  const within = (along: number) => {
    const a = lineAt(lower, along)
    const b = lineAt(upper, along)
    return [Math.min(a, b), Math.max(a, b)] as const
  }
  const [low, high] = within(u)
  if (u > 0 && u < 1 && v > low && v < high) return
  const along = Math.min(1 - IRIS_INSET, Math.max(IRIS_INSET, u))
  const [lo, hi] = within(along)
  const inset = (hi - lo) * IRIS_INSET
  const across = hi - lo > 0 ? Math.min(hi - inset, Math.max(lo + inset, v)) : lo
  shiftIris(
    points,
    iris,
    ox + (along * ax - across * ay) * length - centre[0],
    oy + (along * ay + across * ax) * length - centre[1],
  )
}

/** Moves an iris whole (so it stays round) by (dx, dy). */
function shiftIris(points: Point[], iris: readonly number[], dx: number, dy: number) {
  for (const i of iris) points[i] = [points[i]![0] + dx, points[i]![1] + dy]
}

/** The face points on its middle (each its own mirror image), by place. */
const MIDDLE = FACE_POINT_MIRRORS.flatMap((partner, i) => (partner === i ? [i] : []))

/**
 * How near the middle a grab counts as lying when the far side is
 * foreshortened (a share of the distance between the eyes): about on the
 * middle a grab has no side to compare, and the ratio of two tiny
 * distances would be noise.
 */
const MIDDLE_ZONE = 0.05

/**
 * How much of its way to the face's middle a symmetric drag moves a point
 * as asked. Past that its move towards the middle is eased so it never gets
 * there: the middle holds still across the face, and the two sides mustn't
 * pass through each other.
 */
const MIDDLE_FREE = 0.5

/**
 * The face's own frame on a photo: where a point is across the face (along
 * `axis`) and down it, and how far across it lies from the middle (signed;
 * positive on the image's right). The middle at a point's height is where
 * the line down the points on the middle passes, so on a turned head it
 * bends out with the nose, as the photo shows it.
 */
function faceFrame(points: readonly Point[], [ax, ay]: Point) {
  const across = ([x, y]: Point) => x * ax + y * ay
  const down = ([x, y]: Point) => y * ax - x * ay
  const middle = MIDDLE.map((i): Point => [down(points[i]!), across(points[i]!)]).sort(
    (a, b) => a[0] - b[0],
  )
  const offMiddle = (point: Point) => across(point) - lineAt(middle, down(point))
  return { across, down, offMiddle }
}

type FaceFrame = ReturnType<typeof faceFrame>

/**
 * A grab's shares as the photo shows the face. A turned head's far side is
 * foreshortened across the face, so each point that mirrors a symmetric
 * grab is weighed round the grab's mirror image with the distances across
 * its own side unforeshortened, and its move across is foreshortened to
 * match: by how far the mirror image lies from the middle against how far
 * the grab does (never enlarged, when the far side is grabbed). Moved as
 * far as the wide near side, the narrow far side would cross the chin and
 * nose and fold the mask over; seen square on, the two sides are alike and
 * this is the plain mirror image.
 */
function photoShares(
  points: readonly Point[],
  landmark: number,
  options: ProportionalOptions,
  frame: FaceFrame,
): Share[] {
  const shares = proportionalShares(points, landmark, options)
  const handle = facePointOf(landmark)
  const mirror = FACE_POINT_MIRRORS[handle]!
  if (!options.symmetric || mirror === handle) return shares
  const { across, down, offMiddle } = frame
  const [rx, ry] = points[FACE_PARTS.rightIris[0]!]!
  const [lx, ly] = points[FACE_PARTS.leftIris[0]!]!
  const zone = MIDDLE_ZONE * Math.hypot(lx - rx, ly - ry)
  const [far, near] = [mirror, handle].map((i) => Math.abs(offMiddle(points[i]!)) + zone)
  const scale = Math.min(1, far! / near!)
  const centre = points[mirror]!
  const weightOf = (i: number) => {
    if (i === mirror) return 1
    if (!(options.radius > 0)) return 0
    const du = (across(points[i]!) - across(centre)) / scale
    const dv = down(points[i]!) - down(centre)
    return falloffWeight(options.falloff, Math.hypot(du, dv) / options.radius)
  }
  return shares.map((share, i) =>
    share.across < 0 ? { weight: weightOf(i), across: -scale } : share,
  )
}

/** A move `toward` the face's middle by a point `offset` from it, eased past MIDDLE_FREE of the way. */
function eased(toward: number, offset: number): number {
  const free = MIDDLE_FREE * offset
  const room = offset - free
  if (toward <= free || !(room > 0)) return toward
  return free + room * (1 - Math.exp(-(toward - free) / room))
}

/**
 * Keeps a symmetric drag's points on their sides of the face's middle,
 * which holds still across the face: each move towards it is eased past
 * MIDDLE_FREE of the way there, so no point arrives, and none overtakes a
 * point nearer the middle that was asked to move as far.
 */
function keepSides(points: readonly Point[], moved: Point[], [ax, ay]: Point, frame: FaceFrame) {
  points.forEach((point, i) => {
    if (FACE_POINT_MIRRORS[i] === i) return
    const offset = frame.offMiddle(point)
    const side = Math.sign(offset)
    const [x, y] = moved[i]!
    const toward = -side * ((x - point[0]) * ax + (y - point[1]) * ay)
    const back = side * (toward - eased(toward, Math.abs(offset)))
    if (back !== 0) moved[i] = [x + back * ax, y + back * ay]
  })
}

/**
 * The mask after a drag: packed face points (fractions of the photo) with
 * the handle (`landmark`) moved by `delta` and those round it by less
 * (proportionalShares). With symmetry the other side takes the mirror
 * image about the face's own middle, foreshortened as the photo turns the
 * head (photoShares), and neither side crosses the middle (keepSides). The
 * irises stay where the photo has them — MediaPipe finds them best of all,
 * and a lid put right mustn't drag the gaze off — unless a lid closes over
 * one, which is then put back inside its eye. A grabbed iris moves whole,
 * on its own and unmirrored: where it sits is the gaze, not the face's
 * shape.
 *
 * The points come back rounded as stored, and the shares are measured
 * where the points are, so a drag is applied from the points as they were
 * when grabbed, with the whole way moved so far — every frame of it.
 */
export function dragPoints(
  flat: readonly number[],
  landmark: number,
  delta: Point,
  options: ProportionalOptions,
): number[] {
  const points = unpackPoints(flat)
  const handle = facePointOf(landmark)
  const grabbed = IRISES.find(({ iris }) => iris.includes(handle))
  if (grabbed) {
    shiftIris(points, grabbed.iris, delta[0], delta[1])
    keepInEye(points, grabbed.iris, grabbed.eye)
    return packPoints(points)
  }
  const axis = faceAcross(points)
  const frame = faceFrame(points, axis)
  const shares = photoShares(points, landmark, options, frame)
  const moved = points.map(([x, y], i): Point => {
    const [mx, my] = sharedMove(shares[i]!, delta, axis)
    return [x + mx, y + my]
  })
  if (options.symmetric) keepSides(points, moved, axis, frame)
  for (const { iris, eye } of IRISES) {
    for (const i of iris) moved[i] = points[i]!
    if (eye.some((i) => shares[i]!.weight > 0)) keepInEye(moved, iris, eye)
  }
  return packPoints(moved)
}

/**
 * The handle (a landmark) nearest `at` (fractions, as the points), if one
 * is within `maxDistance`: what a click or touch grabs. `among` narrows or
 * widens what can be grabbed (landmarks; the mask's handles unless given).
 */
export function nearestHandle(
  flat: readonly number[],
  at: Point,
  maxDistance: number,
  among: readonly number[] = HANDLE_LANDMARKS,
): number | null {
  let best: number | null = null
  let bestDistance = maxDistance
  for (const landmark of among) {
    const i = facePointOf(landmark)
    const d = Math.hypot(flat[i * 2]! - at[0], flat[i * 2 + 1]! - at[1])
    if (d <= bestDistance) {
      bestDistance = d
      best = landmark
    }
  }
  return best
}

/** A line to draw over the photo: a feature's points in order, back to the first if `closed`. */
export type MaskOutline = { group: MaskGroupId; closed: boolean; points: Point[] }

/** The lips' inner outline (where they meet), from the image's left corner, under then over. */
const INNER_LIPS = byLandmark([
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
])
/** The nose's bridge, from between the eyes to its tip. */
const NOSE_BRIDGE = byLandmark([168, 6, 197, 195, 5, 4, 1])
/** The nose's base: round one wing, under it to the middle and round the other. */
const NOSE_BASE = byLandmark([49, 129, 64, 98, 2, 327, 294, 358, 279])

/** How many corners an iris's circle is drawn with. */
const IRIS_SIDES = 16

/** Each brow's outline: its lower edge out to in, then its upper edge back. */
function browRings(): number[][] {
  const half = FACE_PARTS.brows.length / 2
  return [FACE_PARTS.brows.slice(half), FACE_PARTS.brows.slice(0, half)].map((brow) => [
    ...brow.slice(0, half / 2),
    ...brow.slice(half / 2).reverse(),
  ])
}

const BROW_RINGS = browRings()

/** An iris as the circle through its rim (the rim's mean distance from its centre). */
function irisCircle(points: readonly Point[], iris: readonly number[]): Point[] {
  const [cx, cy] = points[iris[0]!]!
  const rim = iris.slice(1)
  const radius =
    rim.reduce((sum, i) => sum + Math.hypot(points[i]![0] - cx, points[i]![1] - cy), 0) / rim.length
  return Array.from({ length: IRIS_SIDES }, (_, k) => {
    const angle = (k / IRIS_SIDES) * Math.PI * 2
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as Point
  })
}

/**
 * The mask's lines, to draw over the photo so the player sees how it sits:
 * the brows, eyes and irises, the nose's bridge and base, the lips (outer
 * and inner) and the face's outline.
 */
export function landmarkGroups(flat: readonly number[]): MaskOutline[] {
  const points = unpackPoints(flat)
  const pick = (indices: readonly number[]) => indices.map((i) => points[i]!)
  return [
    ...BROW_RINGS.map((ring) => ({ group: 'brows' as const, closed: true, points: pick(ring) })),
    ...IRISES.flatMap(({ iris, eye }) => [
      { group: 'eyes' as const, closed: true, points: pick(eyeRing(eye)) },
      { group: 'eyes' as const, closed: true, points: irisCircle(points, iris) },
    ]),
    { group: 'nose', closed: false, points: pick(NOSE_BRIDGE) },
    { group: 'nose', closed: false, points: pick(NOSE_BASE) },
    { group: 'lips', closed: true, points: pick(FACE_PARTS.lips) },
    { group: 'lips', closed: true, points: pick(INNER_LIPS) },
    { group: 'outline', closed: true, points: pick(FACE_PARTS.oval) },
  ]
}
