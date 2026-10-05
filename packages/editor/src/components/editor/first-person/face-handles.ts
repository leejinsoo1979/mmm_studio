import { type FacePin, sculpt } from './face-pins'
import { FACE_PARTS, FACE_POINT_INDICES, facePointOf, unpackPoints } from './face-points'
import { FACE_SLIDERS, type FaceShape, type FaceSliderGroup, type FaceSliderId } from './face-shape'

/**
 * The points a player grabs on their character's face to sculpt it (the
 * studio draws them on the head): each a MediaPipe landmark the drag pins
 * (face-pins.ts) along with the skin round it, or an ear, which has no
 * landmark and drives the ear sliders instead. `r` and `l` are the
 * subject's right and left: the subject's right is the image's left.
 */

/** A part of the face: the sliders' groups, which the handles and the pins are sorted by too. */
export type FaceRegion = FaceSliderGroup

export type FaceHandleId =
  | 'forehead'
  | 'brow-inner-r'
  | 'brow-inner-l'
  | 'brow-mid-r'
  | 'brow-mid-l'
  | 'brow-tail-r'
  | 'brow-tail-l'
  | 'eye-inner-r'
  | 'eye-inner-l'
  | 'eye-outer-r'
  | 'eye-outer-l'
  | 'eye-upper-r'
  | 'eye-upper-l'
  | 'eye-lower-r'
  | 'eye-lower-l'
  | 'nose-bridge'
  | 'nose-tip'
  | 'nose-wing-r'
  | 'nose-wing-l'
  | 'mouth-corner-r'
  | 'mouth-corner-l'
  | 'lip-upper'
  | 'lip-lower'
  | 'cheek-r'
  | 'cheek-l'
  | 'cheekbone-r'
  | 'cheekbone-l'
  | 'jaw-r'
  | 'jaw-l'
  | 'chin'
  | 'ear-r'
  | 'ear-l'

/**
 * A handle: on a landmark, with how far its drag spreads by default
 * (`radius`, fractions of the front view) and its mirror image across the
 * face (null on the middle); or on an ear, `side` −1 being the image's left.
 */
export type FaceHandle =
  | {
      id: FaceHandleId
      label: string
      region: Exclude<FaceRegion, 'ears'>
      kind: 'landmark'
      landmark: number
      radius: number
      mirror: FaceHandleId | null
    }
  | {
      id: 'ear-r' | 'ear-l'
      label: string
      region: 'ears'
      kind: 'ear'
      side: -1 | 1
      mirror: 'ear-r' | 'ear-l'
    }

type LandmarkHandle = Extract<FaceHandle, { kind: 'landmark' }>

const on = (
  id: FaceHandleId,
  label: string,
  region: LandmarkHandle['region'],
  landmark: number,
  radius: number,
  mirror: FaceHandleId | null = null,
): LandmarkHandle => ({ id, label, region, kind: 'landmark', landmark, radius, mirror })

export const FACE_HANDLES: readonly FaceHandle[] = [
  on('forehead', '이마', 'face', 151, 0.12),
  on('brow-inner-r', '눈썹 안쪽', 'brows', 107, 0.045, 'brow-inner-l'),
  on('brow-inner-l', '눈썹 안쪽', 'brows', 336, 0.045, 'brow-inner-r'),
  on('brow-mid-r', '눈썹 중간', 'brows', 105, 0.045, 'brow-mid-l'),
  on('brow-mid-l', '눈썹 중간', 'brows', 334, 0.045, 'brow-mid-r'),
  on('brow-tail-r', '눈썹 꼬리', 'brows', 70, 0.045, 'brow-tail-l'),
  on('brow-tail-l', '눈썹 꼬리', 'brows', 300, 0.045, 'brow-tail-r'),
  on('eye-inner-r', '앞트임', 'eyes', 133, 0.03, 'eye-inner-l'),
  on('eye-inner-l', '앞트임', 'eyes', 362, 0.03, 'eye-inner-r'),
  on('eye-outer-r', '뒤트임', 'eyes', 33, 0.03, 'eye-outer-l'),
  on('eye-outer-l', '뒤트임', 'eyes', 263, 0.03, 'eye-outer-r'),
  on('eye-upper-r', '눈 위', 'eyes', 159, 0.035, 'eye-upper-l'),
  on('eye-upper-l', '눈 위', 'eyes', 386, 0.035, 'eye-upper-r'),
  on('eye-lower-r', '눈 아래', 'eyes', 145, 0.03, 'eye-lower-l'),
  on('eye-lower-l', '눈 아래', 'eyes', 374, 0.03, 'eye-lower-r'),
  on('nose-bridge', '콧대', 'nose', 6, 0.06),
  on('nose-tip', '코끝', 'nose', 4, 0.04),
  on('nose-wing-r', '콧볼', 'nose', 64, 0.03, 'nose-wing-l'),
  on('nose-wing-l', '콧볼', 'nose', 294, 0.03, 'nose-wing-r'),
  on('mouth-corner-r', '입꼬리', 'mouth', 61, 0.04, 'mouth-corner-l'),
  on('mouth-corner-l', '입꼬리', 'mouth', 291, 0.04, 'mouth-corner-r'),
  on('lip-upper', '윗입술', 'mouth', 0, 0.035),
  on('lip-lower', '아랫입술', 'mouth', 17, 0.035),
  on('cheek-r', '볼', 'face', 205, 0.09, 'cheek-l'),
  on('cheek-l', '볼', 'face', 425, 0.09, 'cheek-r'),
  on('cheekbone-r', '광대', 'face', 116, 0.08, 'cheekbone-l'),
  on('cheekbone-l', '광대', 'face', 345, 0.08, 'cheekbone-r'),
  on('jaw-r', '턱선', 'face', 172, 0.1, 'jaw-l'),
  on('jaw-l', '턱선', 'face', 397, 0.1, 'jaw-r'),
  on('chin', '턱끝', 'face', 152, 0.08),
  { id: 'ear-r', label: '귀', region: 'ears', kind: 'ear', side: -1, mirror: 'ear-l' },
  { id: 'ear-l', label: '귀', region: 'ears', kind: 'ear', side: 1, mirror: 'ear-r' },
]

export const FACE_HANDLE = Object.fromEntries(
  FACE_HANDLES.map((handle) => [handle.id, handle]),
) as Readonly<Record<FaceHandleId, FaceHandle>>

const LANDMARK_HANDLES = FACE_HANDLES.filter(
  (handle): handle is LandmarkHandle => handle.kind === 'landmark',
)

/** How far an ear's handle is dragged (fractions of the front view) for one full slider's worth. */
export const EAR_DRAG_UNIT = 0.05

/**
 * A drag on a handle: `delta` is the whole way since it was grabbed (front
 * view fractions: dx right, dy down, dz towards the viewer), `radiusScale`
 * scales the handle's own radius.
 */
export type FaceDrag = {
  handle: FaceHandleId
  delta: FacePin
  symmetric: boolean
  radiusScale: number
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/**
 * An ear slider moved by `change`, kept within −1–1, rounded as pins are,
 * and left out when it comes to 0 (as a saved shape leaves it).
 */
function nudged(
  sliders: FaceShape['sliders'],
  id: FaceSliderId,
  change: number,
): FaceShape['sliders'] {
  if (change === 0) return sliders
  const value = Math.round(clamp((sliders[id] ?? 0) + change, -1, 1) * 1e4) / 1e4
  const rest = Object.fromEntries(Object.entries(sliders).filter(([other]) => other !== id))
  return value === 0 ? rest : { ...rest, [id]: value }
}

/**
 * The face shape after a drag, from the shape when the handle was grabbed
 * (`start`) and the drag's whole way so far: a landmark's drag pins it and
 * the skin round it (sculpt, at the handle's radius × radiusScale, mirrored
 * with `symmetric`); an ear's raises both ears (up the screen) and turns
 * them out (away from the face's middle). `target` is the character's
 * packed front-view points. Pure: `start` is left as it was, and a drag
 * that moves nothing gives it back.
 */
export function applyFaceDrag(
  start: FaceShape,
  drag: FaceDrag,
  target: readonly number[],
): FaceShape {
  const [dx, dy, dz] = drag.delta
  const handle = FACE_HANDLE[drag.handle]
  if (handle.kind === 'ear') {
    let sliders = nudged(start.sliders, 'earHeight', -dy / EAR_DRAG_UNIT)
    sliders = nudged(sliders, 'earAngle', (handle.side * dx) / EAR_DRAG_UNIT)
    return sliders === start.sliders ? start : { ...start, sliders }
  }
  if (dx === 0 && dy === 0 && dz === 0) return start
  const pins = sculpt(
    start.pins,
    handle.landmark,
    drag.delta,
    { radius: handle.radius * drag.radiusScale, falloff: 'smooth', symmetric: drag.symmetric },
    target,
  )
  return pins === start.pins ? start : { ...start, pins }
}

/** The lips' inner outline, where they meet (FACE_PARTS.lips is their outer one). */
const INNER_LIPS = [
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
]

/** The landmarks a feature's own: the brows, the eyes and irises, the nose and the lips. */
const FEATURE_REGIONS = new Map<number, FaceRegion>()
for (const [region, parts] of [
  ['brows', [FACE_PARTS.brows]],
  ['eyes', [FACE_PARTS.rightEye, FACE_PARTS.leftEye, FACE_PARTS.rightIris, FACE_PARTS.leftIris]],
  ['nose', [FACE_PARTS.nose]],
  ['mouth', [FACE_PARTS.lips, INNER_LIPS.map(facePointOf)]],
] as const) {
  for (const part of parts) {
    for (const i of part) {
      const landmark = FACE_POINT_INDICES[i]!
      if (!FEATURE_REGIONS.has(landmark)) FEATURE_REGIONS.set(landmark, region)
    }
  }
}

const regionsByTarget = new WeakMap<readonly number[], Map<number, FaceRegion>>()

/** Every face point's region on a character (by landmark), worked out once per character. */
function regionsOn(target: readonly number[]): Map<number, FaceRegion> {
  const known = regionsByTarget.get(target)
  if (known) return known
  const points = unpackPoints(target)
  const regions = new Map<number, FaceRegion>()
  for (const landmark of FACE_POINT_INDICES) {
    const feature = FEATURE_REGIONS.get(landmark)
    if (feature) {
      regions.set(landmark, feature)
      continue
    }
    // The rest (the outline, the cheeks, the forehead) go with the handle
    // nearest them on this face; a tie goes to the face's own.
    const [x, y] = points[facePointOf(landmark)]!
    let nearest = Number.POSITIVE_INFINITY
    let region: FaceRegion = 'face'
    for (const handle of LANDMARK_HANDLES) {
      const [hx, hy] = points[facePointOf(handle.landmark)]!
      const d = Math.hypot(hx - x, hy - y)
      if (d < nearest - 1e-12) {
        nearest = d
        region = handle.region
      } else if (d <= nearest + 1e-12 && handle.region === 'face') {
        region = 'face'
      }
    }
    regions.set(landmark, region)
  }
  regionsByTarget.set(target, regions)
  return regions
}

/**
 * The region a landmark belongs to on a character (`target`, its packed
 * front-view points): a feature's points are its own; any other goes with
 * the nearest handle's region. Never 'ears', which have no landmarks.
 */
export function faceRegionOf(landmark: number, target: readonly number[]): FaceRegion {
  return regionsOn(target).get(landmark) ?? 'face'
}

const slidersOf = (region: FaceRegion) =>
  new Set<string>(FACE_SLIDERS.filter(({ group }) => group === region).map(({ id }) => id))

/** The shape with a region put back as the character has it: its sliders and its landmarks' pins gone. */
export function resetFaceRegion(
  shape: FaceShape,
  region: FaceRegion,
  target: readonly number[],
): FaceShape {
  const ids = slidersOf(region)
  const sliders = Object.fromEntries(
    Object.entries(shape.sliders).filter(([id]) => !ids.has(id)),
  ) as FaceShape['sliders']
  const regions = regionsOn(target)
  const pins = Object.fromEntries(
    Object.entries(shape.pins).filter(([landmark]) => regions.get(Number(landmark)) !== region),
  )
  return { ...shape, sliders, pins }
}

/** Whether a shape changes a region: one of its sliders set, or one of its landmarks pinned. */
export function regionChanged(
  shape: FaceShape,
  region: FaceRegion,
  target: readonly number[],
): boolean {
  const ids = slidersOf(region)
  if (Object.entries(shape.sliders).some(([id, setting]) => ids.has(id) && setting !== 0)) {
    return true
  }
  const regions = regionsOn(target)
  return Object.entries(shape.pins).some(
    ([landmark, pin]) =>
      regions.get(Number(landmark)) === region && pin.some((value) => value !== 0),
  )
}
