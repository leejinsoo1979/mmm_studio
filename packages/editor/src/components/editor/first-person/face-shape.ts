import { FACE_PARTS, facePointOf, type Point, unpackPoints } from './face-points'

/**
 * A face's shape, as a displacement of the head's front view (head-geometry
 * frames it): the proportions of the player's photo, where it has one, and
 * the sliders on top. Each slider moves a part of the face — the region
 * round a feature, fading to nothing at its edge — the way a sculpting
 * brush would, so it works on any head whose landmarks are known.
 */

export const FACE_SLIDER_GROUPS = ['face', 'eyes', 'brows', 'nose', 'mouth', 'ears'] as const
export type FaceSliderGroup = (typeof FACE_SLIDER_GROUPS)[number]

export const FACE_SLIDERS = [
  { id: 'faceWidth', group: 'face' },
  { id: 'faceLength', group: 'face' },
  { id: 'jawWidth', group: 'face' },
  { id: 'chinWidth', group: 'face' },
  { id: 'chinLength', group: 'face' },
  { id: 'chinDepth', group: 'face' },
  { id: 'cheekbones', group: 'face' },
  { id: 'cheeks', group: 'face' },
  { id: 'forehead', group: 'face' },
  { id: 'jawAngle', group: 'face' },
  { id: 'eyeSize', group: 'eyes' },
  { id: 'eyeWidth', group: 'eyes' },
  { id: 'eyeOpen', group: 'eyes' },
  { id: 'eyeSpacing', group: 'eyes' },
  { id: 'eyeHeight', group: 'eyes' },
  { id: 'eyeTilt', group: 'eyes' },
  { id: 'eyeDepth', group: 'eyes' },
  { id: 'browHeight', group: 'brows' },
  { id: 'browTilt', group: 'brows' },
  { id: 'browSpacing', group: 'brows' },
  { id: 'browArch', group: 'brows' },
  { id: 'noseWidth', group: 'nose' },
  { id: 'noseBridge', group: 'nose' },
  { id: 'noseLength', group: 'nose' },
  { id: 'noseHeight', group: 'nose' },
  { id: 'noseTip', group: 'nose' },
  { id: 'mouthWidth', group: 'mouth' },
  { id: 'mouthHeight', group: 'mouth' },
  { id: 'lipFullness', group: 'mouth' },
  { id: 'upperLip', group: 'mouth' },
  { id: 'lowerLip', group: 'mouth' },
  { id: 'philtrum', group: 'mouth' },
  { id: 'mouthDepth', group: 'mouth' },
  { id: 'mouthCorners', group: 'mouth' },
  { id: 'earSize', group: 'ears' },
  { id: 'earAngle', group: 'ears' },
  { id: 'earHeight', group: 'ears' },
  { id: 'earPoint', group: 'ears' },
] as const satisfies readonly { id: string; group: FaceSliderGroup }[]

export type FaceSliderId = (typeof FACE_SLIDERS)[number]['id']

/**
 * The player's face shape: how much of their photo's proportions the head
 * takes on (`fit`, 0–1; it has none without a photo), and each slider's
 * setting (−1–1, 0 or missing leaving that part as it is).
 */
export type FaceShape = {
  fit: number
  sliders: Partial<Record<FaceSliderId, number>>
}

export const DEFAULT_FACE_SHAPE: FaceShape = { fit: 1, sliders: {} }

const SLIDER_IDS = new Set<string>(FACE_SLIDERS.map((slider) => slider.id))
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** A face shape as saved or received (anything unknown dropped, values kept in range). */
export function readFaceShape(value: unknown): FaceShape {
  const shape = value as Partial<FaceShape> | null
  if (!shape || typeof shape !== 'object') return DEFAULT_FACE_SHAPE
  const sliders: FaceShape['sliders'] = {}
  if (shape.sliders && typeof shape.sliders === 'object') {
    for (const [id, setting] of Object.entries(shape.sliders)) {
      if (SLIDER_IDS.has(id) && typeof setting === 'number' && Number.isFinite(setting)) {
        const kept = clamp(setting, -1, 1)
        if (kept !== 0) sliders[id as FaceSliderId] = kept
      }
    }
  }
  const fit =
    typeof shape.fit === 'number' && Number.isFinite(shape.fit)
      ? clamp(shape.fit, 0, 1)
      : DEFAULT_FACE_SHAPE.fit
  return { fit, sliders }
}

export const hasSliders = (shape: FaceShape | null | undefined) =>
  Boolean(shape && Object.values(shape.sliders).some((setting) => setting !== 0))

const centroid = (points: readonly Point[]): Point => {
  let x = 0
  let y = 0
  for (const [px, py] of points) {
    x += px
    y += py
  }
  return [x / points.length, y / points.length]
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * One slider's reach and what it does at full setting (1; −1 does the
 * opposite, in between scales down): within the ellipse round `centre`
 * (full strength inside `inner` of the way to its edge, fading out beyond),
 * points move by `move`, are scaled about `pivot` by 1 + `scale`, and
 * turned about it by `turn` radians. `move[2]` is out of the face (towards
 * the viewer). The ellipse reaches `radius` across and down, and `above`
 * up: a brush can fade out gently over the forehead and still stop short
 * of the eye under it. Lengths are fractions of the front view.
 */
type Brush = {
  slider: FaceSliderId
  centre: Point
  radius: Point
  above: number
  inner: number
  pivot: Point
  move: [number, number, number]
  scale: Point
  turn: number
}

/** A brush and, if `mirror`, its mirror image across the face's middle for the other side. */
function brushes(
  slider: FaceSliderId,
  middle: number,
  options: Partial<Omit<Brush, 'slider'>> & { centre: Point; radius: Point },
  mirror = false,
): Brush[] {
  const brush: Brush = {
    slider,
    above: options.radius[1],
    inner: 0.35,
    pivot: options.centre,
    move: [0, 0, 0],
    scale: [0, 0],
    turn: 0,
    ...options,
  }
  if (!mirror) return [brush]
  const flip = ([x, y]: Point): Point => [2 * middle - x, y]
  return [
    brush,
    {
      ...brush,
      centre: flip(brush.centre),
      pivot: flip(brush.pivot),
      move: [-brush.move[0], brush.move[1], brush.move[2]],
      turn: -brush.turn,
    },
  ]
}

/**
 * The sliders' brushes on a face with these landmarks. A brush given for
 * the image's left side (the subject's right) is mirrored to the other.
 */
function faceBrushes(points: readonly Point[]): Brush[] {
  const p = (landmark: number) => points[facePointOf(landmark)]!
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const rightIris = p(468)
  const leftIris = p(473)
  const e = distance(rightIris, leftIris)
  const middle = (rightIris[0] + leftIris[0]) / 2
  const chin = p(152)
  const faceHalfWidth = Math.abs(p(454)[0] - p(234)[0]) / 2
  const faceCentre: Point = [middle, (rightIris[1] + chin[1]) / 2]
  const half = FACE_PARTS.brows.length / 2
  // FACE_PARTS.brows: the subject's left brow first; this is the image's left.
  const brow = centroid(FACE_PARTS.brows.slice(half).map((i) => points[i]!))
  // The brows' brushes reach up more than down, so the lids under them stay.
  const browCentre: Point = [brow[0], brow[1] - 0.05 * e]
  // The brow's inner half (its points nearest the nose), which a wider
  // gap between the brows moves.
  const browInner = centroid([65, 55, 66, 107].map(p))
  const eyeWidth = distance(p(33), p(133))
  const upperLid = p(159)
  const lowerLid = p(145)
  const mouth = mid(p(61), p(291))
  const mouthHalfWidth = distance(p(61), p(291)) / 2
  const lipLine = mid(p(13), p(14))
  const noseBase = p(2)
  const noseTip = p(4)
  const alae = mid(p(64), p(294))
  const bridge = mid(p(168), p(5))
  const lowerFace = mid(noseBase, chin)
  const jawLine = (p(172)[1] + p(397)[1]) / 2
  const outward = -1 // the image's left side moves out to the left

  return [
    ...brushes('faceWidth', middle, {
      centre: faceCentre,
      radius: [faceHalfWidth * 1.7, (chin[1] - p(10)[1]) * 0.75],
      inner: 0.3,
      scale: [0.13, 0],
    }),
    ...brushes('faceLength', middle, {
      centre: lowerFace,
      radius: [faceHalfWidth * 1.2, (chin[1] - noseBase[1]) * 1.05],
      inner: 0.5,
      pivot: noseBase,
      scale: [0, 0.24],
    }),
    // The jaw's width: the lower face scaled across as a whole (moving its
    // corners alone would dent the outline there).
    ...brushes('jawWidth', middle, {
      centre: [middle, jawLine],
      radius: [faceHalfWidth * 1.6, (chin[1] - noseBase[1]) * 1.2],
      inner: 0.3,
      pivot: [middle, jawLine],
      scale: [0.2, 0],
    }),
    ...brushes('chinWidth', middle, {
      centre: [chin[0], chin[1] - 0.1 * e],
      radius: [0.6 * e, 0.45 * e],
      pivot: chin,
      scale: [0.5, 0],
    }),
    ...brushes('chinLength', middle, {
      centre: chin,
      radius: [0.6 * e, 0.5 * e],
      move: [0, 0.18 * e, 0],
    }),
    ...brushes('chinDepth', middle, {
      centre: chin,
      radius: [0.55 * e, 0.5 * e],
      move: [0, 0, 0.22 * e],
    }),
    ...brushes(
      'cheekbones',
      middle,
      { centre: p(116), radius: [0.5 * e, 0.45 * e], move: [outward * 0.12 * e, 0, 0.1 * e] },
      true,
    ),
    ...brushes(
      'cheeks',
      middle,
      { centre: p(205), radius: [0.45 * e, 0.45 * e], move: [outward * 0.08 * e, 0, 0.14 * e] },
      true,
    ),
    ...brushes('forehead', middle, {
      centre: [middle, p(151)[1]],
      radius: [0.95 * e, 0.5 * e],
      move: [0, 0, 0.15 * e],
    }),
    // The jaw's corner down and out (squarer) or up and in (softer, a V
    // line). The ear's lobe hangs just over the corner, where the outline
    // (132) turns up to the ear: the brush fades out below it, so the lobe
    // stays as it is.
    ...brushes(
      'jawAngle',
      middle,
      {
        centre: p(172),
        radius: [0.55 * e, 0.6 * e],
        above: 0.4 * e,
        move: [outward * 0.07 * e, 0.1 * e, 0],
      },
      true,
    ),
    ...brushes(
      'eyeSize',
      middle,
      { centre: rightIris, radius: [eyeWidth, eyeWidth * 0.75], scale: [0.3, 0.3] },
      true,
    ),
    // A longer eye: its corners drawn apart over the eyeball, which stays
    // (see ROUND_THE_EYES). The outer corner slides round it — back as it
    // goes out, forward as it comes in, where the eyeball stands further
    // out — so the eyeball can't show through the skin beside it.
    ...brushes(
      'eyeWidth',
      middle,
      {
        centre: p(33),
        radius: [0.45 * eyeWidth, 0.45 * eyeWidth],
        move: [outward * 0.07 * e, 0, -0.07 * e],
      },
      true,
    ),
    ...brushes(
      'eyeWidth',
      middle,
      {
        centre: p(133),
        radius: [0.4 * eyeWidth, 0.4 * eyeWidth],
        move: [-outward * 0.04 * e, 0, 0],
      },
      true,
    ),
    // The upper lid up off the eyeball (a wider-open eye) or down over it
    // (a sleepy one), sliding round it: in as it goes up, out as it comes
    // down, so the eyeball stays under it. It fades out by the brow over
    // it and most of the way down to the lower lid, which goes barely the
    // other way. The eyeballs stay (see ROUND_THE_EYES).
    ...brushes(
      'eyeOpen',
      middle,
      {
        centre: upperLid,
        radius: [0.65 * eyeWidth, 0.7 * (lowerLid[1] - upperLid[1])],
        above: upperLid[1] - brow[1],
        move: [0, -0.045 * e, -0.015 * e],
      },
      true,
    ),
    ...brushes(
      'eyeOpen',
      middle,
      { centre: lowerLid, radius: [0.55 * eyeWidth, 0.1 * e], move: [0, 0.012 * e, 0] },
      true,
    ),
    ...brushes(
      'eyeSpacing',
      middle,
      { centre: rightIris, radius: [eyeWidth, eyeWidth * 0.8], move: [outward * 0.14 * e, 0, 0] },
      true,
    ),
    ...brushes(
      'eyeHeight',
      middle,
      { centre: rightIris, radius: [eyeWidth, eyeWidth * 0.8], move: [0, -0.12 * e, 0] },
      true,
    ),
    // The outer corner up: turning the image's left eye (outer corner leftmost) clockwise on the screen.
    ...brushes(
      'eyeTilt',
      middle,
      { centre: rightIris, radius: [eyeWidth, eyeWidth * 0.75], turn: 0.28 },
      true,
    ),
    ...brushes(
      'eyeDepth',
      middle,
      { centre: rightIris, radius: [eyeWidth, eyeWidth * 0.8], move: [0, 0, -0.12 * e] },
      true,
    ),
    ...brushes(
      'browHeight',
      middle,
      { centre: browCentre, radius: [0.55 * e, 0.2 * e], move: [0, -0.12 * e, 0] },
      true,
    ),
    ...brushes(
      'browTilt',
      middle,
      { centre: browCentre, radius: [0.55 * e, 0.2 * e], pivot: brow, turn: 0.28 },
      true,
    ),
    // The brows' inner halves apart, the gap between them widening; their
    // outer ends, on the side of the head, stay (moved across, the skin
    // there would stand out of it). Reaching far up the forehead, it fades
    // out gently there; down, it stops at the lids.
    ...brushes(
      'browSpacing',
      middle,
      {
        centre: browInner,
        radius: [0.42 * e, upperLid[1] - browInner[1]],
        above: 0.45 * e,
        move: [outward * 0.1 * e, 0, 0],
      },
      true,
    ),
    // The brow's middle up; its ends, past the brush, stay.
    ...brushes(
      'browArch',
      middle,
      { centre: browCentre, radius: [0.3 * e, 0.2 * e], inner: 0.15, move: [0, -0.08 * e, 0] },
      true,
    ),
    ...brushes('noseWidth', middle, {
      centre: alae,
      radius: [0.5 * e, 0.3 * e],
      scale: [0.4, 0],
    }),
    // The bridge, from between the eyes to above the tip, narrow enough
    // that the eyes' inner corners stay.
    ...brushes('noseBridge', middle, {
      centre: bridge,
      radius: [0.32 * e, Math.abs(p(5)[1] - p(168)[1]) * 0.6],
      inner: 0.25,
      pivot: [middle, bridge[1]],
      scale: [0.6, 0],
    }),
    ...brushes('noseLength', middle, {
      centre: mid(noseTip, noseBase),
      radius: [0.45 * e, 0.35 * e],
      move: [0, 0.13 * e, 0],
    }),
    ...brushes('noseHeight', middle, {
      centre: mid(p(6), noseTip),
      radius: [0.22 * e, Math.abs(noseTip[1] - p(6)[1]) * 0.85],
      move: [0, 0, 0.2 * e],
    }),
    ...brushes('noseTip', middle, {
      centre: noseTip,
      radius: [0.22 * e, 0.22 * e],
      move: [0, -0.09 * e, 0.04 * e],
    }),
    ...brushes('mouthWidth', middle, {
      centre: mouth,
      radius: [mouthHalfWidth * 1.6, 0.32 * e],
      scale: [0.3, 0],
    }),
    ...brushes('mouthHeight', middle, {
      centre: mouth,
      radius: [mouthHalfWidth * 1.6, 0.38 * e],
      move: [0, -0.11 * e, 0],
    }),
    ...brushes('lipFullness', middle, {
      centre: lipLine,
      radius: [mouthHalfWidth * 1.35, Math.abs(p(17)[1] - p(0)[1]) * 0.95],
      pivot: lipLine,
      scale: [0, 0.55],
      move: [0, 0, 0.04 * e],
    }),
    // Each lip on its own: its outer edge moved, the line where the lips
    // meet (the brush's edge) and the nose or chin (its far edge) left be.
    ...brushes('upperLip', middle, {
      centre: mid(noseBase, lipLine),
      radius: [mouthHalfWidth * 1.2, Math.abs(lipLine[1] - noseBase[1]) / 2],
      move: [0, -0.04 * e, 0.025 * e],
    }),
    ...brushes('lowerLip', middle, {
      centre: mid(lipLine, chin),
      radius: [mouthHalfWidth * 1.2, Math.abs(chin[1] - lipLine[1]) / 2],
      move: [0, 0.05 * e, 0.025 * e],
    }),
    // The mouth and chin down together, away from the nose, which stays.
    ...brushes('philtrum', middle, {
      centre: mid(mouth, chin),
      radius: [faceHalfWidth * 1.2, Math.abs(mid(mouth, chin)[1] - noseBase[1])],
      inner: 0.55,
      move: [0, 0.1 * e, 0],
    }),
    ...brushes('mouthDepth', middle, {
      centre: mouth,
      radius: [mouthHalfWidth * 1.8, 0.4 * e],
      move: [0, 0, 0.12 * e],
    }),
    ...brushes(
      'mouthCorners',
      middle,
      { centre: p(61), radius: [0.22 * e, 0.22 * e], move: [0, -0.08 * e, 0] },
      true,
    ),
  ]
}

/** Moves a brush makes at (x, y), at `setting`, added to `out` (dx, dy, dz). */
function addBrush(brush: Brush, setting: number, x: number, y: number, out: number[]) {
  const u = (x - brush.centre[0]) / brush.radius[0]
  const v = (y - brush.centre[1]) / (y < brush.centre[1] ? brush.above : brush.radius[1])
  const reach = Math.sqrt(u * u + v * v)
  if (reach >= 1) return
  let weight = 1
  if (reach > brush.inner) {
    const t = (reach - brush.inner) / (1 - brush.inner)
    weight = 1 - t * t * (3 - 2 * t)
  }
  const rx = x - brush.pivot[0]
  const ry = y - brush.pivot[1]
  let dx = brush.move[0] * setting + brush.scale[0] * setting * rx
  let dy = brush.move[1] * setting + brush.scale[1] * setting * ry
  if (brush.turn !== 0) {
    const angle = brush.turn * setting
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    dx += rx * cos - ry * sin - rx
    dy += rx * sin + ry * cos - ry
  }
  out[0]! += weight * dx
  out[1]! += weight * dy
  out[2]! += weight * brush.move[2] * setting
}

/** The points whose place in a photo says nothing reliable of the face's shape. */
function unreliable(target: readonly Point[]): Set<number> {
  const browTop = Math.min(...FACE_PARTS.brows.map((i) => target[i]![1]))
  const skipped = new Set<number>([...FACE_PARTS.rightIris, ...FACE_PARTS.leftIris])
  // The outline across the forehead follows the hairline, which hair hides.
  for (const i of FACE_PARTS.oval) if (target[i]![1] < browTop) skipped.add(i)
  return skipped
}

/** Each point's mirror image across the face (itself on the middle), where the two agree they pair. */
function mirrors(target: readonly Point[], middle: number): number[] {
  const nearest = target.map(([x, y]) => {
    let best = 0
    let bestDistance = Number.POSITIVE_INFINITY
    target.forEach(([ox, oy], j) => {
      const d = Math.hypot(2 * middle - x - ox, y - oy)
      if (d < bestDistance) {
        bestDistance = d
        best = j
      }
    })
    return best
  })
  return nearest.map((j, i) => (nearest[j] === i ? j : i))
}

/** How far a photo's point may lie from the character's, after lining the faces up (× the eyes' distance). */
const MAX_RESIDUAL = 0.25

/**
 * How the photo's face differs in shape from the character's: each point's
 * offset (in the character's front view) once the photo's points are lined
 * up with the character's — moved, turned and scaled as a whole to fit
 * best. What is left is the face's own proportions. The two sides are
 * averaged (mirrored), so a head turned a little in the photo doesn't make
 * a lopsided face; points hair hides, and the irises (which follow the
 * gaze), are left out (null).
 */
export function photoResiduals(photoFlat: readonly number[], targetFlat: readonly number[]) {
  const photo = unpackPoints(photoFlat)
  const target = unpackPoints(targetFlat)
  const skipped = unreliable(target)
  const used = target.map((_, i) => i).filter((i) => !skipped.has(i))
  const photoCentre = centroid(used.map((i) => photo[i]!))
  const targetCentre = centroid(used.map((i) => target[i]!))
  let dot = 0
  let crossing = 0
  let spread = 0
  for (const i of used) {
    const px = photo[i]![0] - photoCentre[0]
    const py = photo[i]![1] - photoCentre[1]
    const tx = target[i]![0] - targetCentre[0]
    const ty = target[i]![1] - targetCentre[1]
    dot += px * tx + py * ty
    crossing += px * ty - py * tx
    spread += px * px + py * py
  }
  const a = dot / Math.max(spread, 1e-12)
  const b = crossing / Math.max(spread, 1e-12)
  const raw = target.map(([tx, ty], i): Point | null => {
    if (skipped.has(i)) return null
    const px = photo[i]![0] - photoCentre[0]
    const py = photo[i]![1] - photoCentre[1]
    return [targetCentre[0] + a * px - b * py - tx, targetCentre[1] + b * px + a * py - ty]
  })
  const rightIris = target[FACE_PARTS.rightIris[0]!]!
  const leftIris = target[FACE_PARTS.leftIris[0]!]!
  const e = distance(rightIris, leftIris)
  const pairs = mirrors(target, (rightIris[0] + leftIris[0]) / 2)
  return raw.map((offset, i): Point | null => {
    const other = raw[pairs[i]!]
    if (!(offset && other)) return null
    const x = (offset[0] - other[0]) / 2
    const y = (offset[1] + other[1]) / 2
    const length = Math.hypot(x, y)
    const cap = MAX_RESIDUAL * e
    return length > cap ? [(x * cap) / length, (y * cap) / length] : [x, y]
  })
}

/** How far each point's pull reaches (× the eyes' distance), and how strongly the face stays put away from them. */
const PULL_REACH = 0.2
const STAY = 0.15

/**
 * How much more than the photo's own difference a full fit gives: a
 * likeness reads better a little exaggerated (a caricature's trick), and
 * the character's own shape still shows through the smoothing.
 */
const PHOTO_GAIN = 1.5

/**
 * The shape's displacement of the head's front view: at a point there
 * (fractions), how far it moves across (dx, right), down (dy) and out of
 * the face (dz), in fractions of the front view.
 */
export type ShapeField = (x: number, y: number, out: number[]) => void

/**
 * A face shape's field and, for the eyeballs (faceShaper tells them by
 * their bones, and moves each whole), the same without the sliders that
 * shape only the skin round them.
 */
export type FaceField = ShapeField & { eyeballs: ShapeField }

/**
 * The sliders that shape the skin round the eyes — the lids and their
 * corners, the brows, the cheekbones under them — and not the eyeballs,
 * which stay where they are under it.
 */
const ROUND_THE_EYES = new Set<FaceSliderId>([
  'eyeOpen',
  'eyeWidth',
  'browHeight',
  'browTilt',
  'browSpacing',
  'browArch',
  'cheekbones',
])

/** The shape's field, or null when it changes nothing. */
export function faceShapeField(
  targetFlat: readonly number[],
  shape: FaceShape,
  photo: readonly number[] | null,
): FaceField | null {
  const target = unpackPoints(targetFlat)
  const settings = Object.entries(shape.sliders).filter(([, setting]) => setting)
  const active = new Map(settings as [FaceSliderId, number][])
  const brushList = active.size
    ? faceBrushes(target).filter((brush) => active.has(brush.slider))
    : []
  const pulls: { at: Point; offset: Point }[] = []
  if (photo && shape.fit > 0) {
    const gain = shape.fit * PHOTO_GAIN
    photoResiduals(photo, targetFlat).forEach((offset, i) => {
      if (offset) pulls.push({ at: target[i]!, offset: [offset[0] * gain, offset[1] * gain] })
    })
  }
  if (brushList.length === 0 && pulls.length === 0) return null
  const e = distance(target[FACE_PARTS.rightIris[0]!]!, target[FACE_PARTS.leftIris[0]!]!)
  const reach = 1 / (PULL_REACH * e) ** 2
  const cutoff = (3 * PULL_REACH * e) ** 2

  const fieldOf =
    (used: readonly Brush[]): ShapeField =>
    (x, y, out) => {
      out[0] = 0
      out[1] = 0
      out[2] = 0
      for (const brush of used) addBrush(brush, active.get(brush.slider)!, x, y, out)
      if (pulls.length === 0) return
      // The photo's offsets, spread smoothly between its points (a weighted
      // average), dying away past the face where none are near.
      let total = STAY
      let dx = 0
      let dy = 0
      for (const { at, offset } of pulls) {
        const d2 = (x - at[0]) ** 2 + (y - at[1]) ** 2
        if (d2 > cutoff) continue
        const weight = Math.exp(-d2 * reach)
        total += weight
        dx += weight * offset[0]
        dy += weight * offset[1]
      }
      out[0]! += dx / total
      out[1]! += dy / total
    }
  return Object.assign(fieldOf(brushList), {
    eyeballs: fieldOf(brushList.filter((brush) => !ROUND_THE_EYES.has(brush.slider))),
  })
}
