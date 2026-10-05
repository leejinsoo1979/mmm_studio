import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { faceShaper } from './avatar-shape'
import { FACE_HANDLE } from './face-handles'
import { MAX_PIN, pinsField, sculpt } from './face-pins'
import {
  FACE_PARTS,
  FACE_POINT_COUNT,
  facePointOf,
  type Point,
  packPoints,
  unpackPoints,
} from './face-points'
import {
  faceShapeField,
  hasFaceShape,
  hasSliders,
  photoResiduals,
  readFaceShape,
} from './face-shape'
import type { HeadFrame } from './head-geometry'

/**
 * A face's points, mirror-symmetric across x = 0.5: the outline, features
 * and irises where a face has them, the rest spread over it in mirrored
 * pairs (the middle ones on the middle).
 */
function facePoints(): Point[] {
  const points: Point[] = Array.from({ length: FACE_POINT_COUNT }, () => [0.5, 0.6] as Point)
  const ring = (indices: readonly number[], cx: number, cy: number, rx: number, ry: number) =>
    indices.forEach((i, k) => {
      const angle = (k / indices.length) * Math.PI * 2 - Math.PI / 2
      points[i] = [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
    })
  const placed = new Set<number>()
  const place = (indices: readonly number[], cx: number, cy: number, rx: number, ry: number) => {
    ring(indices, cx, cy, rx, ry)
    for (const i of indices) placed.add(i)
  }
  place(FACE_PARTS.oval, 0.5, 0.58, 0.34, 0.4)
  place(FACE_PARTS.rightIris, 0.38, 0.46, 0.012, 0.012)
  place(FACE_PARTS.leftIris, 0.62, 0.46, 0.012, 0.012)
  points[FACE_PARTS.rightIris[0]!] = [0.38, 0.46]
  points[FACE_PARTS.leftIris[0]!] = [0.62, 0.46]
  // Everything else: pairs mirrored across the middle, spread down the face.
  const rest = points.map((_, i) => i).filter((i) => !placed.has(i))
  rest.forEach((i, k) => {
    const row = Math.floor(k / 2)
    const x = 0.08 + ((row * 7) % 23) / 100
    const y = 0.32 + ((row * 11) % 50) / 100
    points[i] = [k % 2 ? 0.5 + x : 0.5 - x, y]
  })
  return points
}

const target = packPoints(facePoints())

/**
 * The image's left (the subject's right) landmarks the finer sliders work
 * from, where they sit on a face; each is mirrored to its partner.
 */
const FEATURES: [number, number, Point][] = [
  [33, 263, [0.33, 0.46]], // the eyes' outer corners
  [133, 362, [0.43, 0.462]], // inner corners
  [159, 386, [0.38, 0.445]], // upper lids
  [145, 374, [0.38, 0.475]], // lower lids
  [64, 294, [0.45, 0.61]], // the nostrils' wings
  [61, 291, [0.42, 0.69]], // the mouth's corners
]

/** Along the face's middle: the nose's bridge and base, the lips (top to bottom). */
const MIDDLE: [number, number][] = [
  [168, 0.45],
  [6, 0.48],
  [5, 0.56],
  [4, 0.59],
  [2, 0.62],
  [0, 0.67],
  [13, 0.69],
  [14, 0.69],
  [17, 0.72],
]

/**
 * The image's left brow as a face has it, in FACE_PARTS.brows' order (its
 * lower edge from the outer end in, then its upper edge): each point's
 * place across from the face's middle and up from the irises, in the eyes'
 * distances.
 */
const BROW: Point[] = [
  [-0.87, -0.13],
  [-0.78, -0.19],
  [-0.64, -0.22],
  [-0.46, -0.21],
  [-0.21, -0.13],
  [-0.94, -0.18],
  [-0.83, -0.26],
  [-0.68, -0.3],
  [-0.48, -0.29],
  [-0.24, -0.26],
]

/** The featured face's eyes' distance and the irises' height. */
const EYES = 0.24
const IRIS_HEIGHT = 0.46

/** The face's points with its features where a face has them. */
function featurePoints(): Point[] {
  const points = facePoints()
  for (const [right, left, [x, y]] of FEATURES) {
    points[facePointOf(right)] = [x, y]
    points[facePointOf(left)] = [1 - x, y]
  }
  for (const [landmark, y] of MIDDLE) points[facePointOf(landmark)] = [0.5, y]
  // The brows over the eyes: the subject's left first (the image's right).
  const half = FACE_PARTS.brows.length / 2
  FACE_PARTS.brows.forEach((i, k) => {
    const [across, up] = BROW[k % half]!
    const x = 0.5 + across * EYES
    points[i] = [k < half ? 1 - x : x, IRIS_HEIGHT + up * EYES]
  })
  return points
}

const featured = packPoints(featurePoints())
const at = (landmark: number) => featurePoints()[facePointOf(landmark)]!

/** A slider's move at a place on the featured face. */
function moveAt(slider: string, setting: number, [x, y]: Point) {
  const field = faceShapeField(
    featured,
    { fit: 1, sliders: { [slider]: setting }, pins: {} },
    null,
  )!
  const out = [0, 0, 0]
  field(x, y, out)
  return out
}

/** The points moved, turned and scaled as a whole (a photo of the same face, framed otherwise). */
function framed(points: Point[], scale: number, angle: number, shift: Point): Point[] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return points.map(([x, y]) => [
    0.5 + scale * ((x - 0.5) * cos - (y - 0.5) * sin) + shift[0],
    0.5 + scale * ((x - 0.5) * sin + (y - 0.5) * cos) + shift[1],
  ])
}

/** Real characters' landmarks, as the app downloads them. */
const REAL: Record<string, number[]> = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../../apps/editor/public/characters/rocketbox/face-points.json',
      import.meta.url,
    ),
    'utf8',
  ),
).avatars

describe('a face shape as saved', () => {
  test('keeps known sliders in range, drops the rest', () => {
    const shape = readFaceShape({
      fit: 3,
      sliders: { eyeSize: 2, noseWidth: -0.4, wings: 1, jawWidth: 'x' },
    })
    expect(shape).toEqual({ fit: 1, sliders: { eyeSize: 1, noseWidth: -0.4 }, pins: {} })
    expect(readFaceShape(null)).toEqual({ fit: 1, sliders: {}, pins: {} })
    expect(hasSliders(shape)).toBe(true)
    expect(hasSliders(readFaceShape({ sliders: { eyeSize: 0 } }))).toBe(false)
  })

  test('reads the pins: irises and unknown landmarks dropped, the rest kept in range', () => {
    const shape = readFaceShape({
      fit: 1,
      sliders: {},
      pins: { 4: [0.01, -0.02, 0.005], 468: [0.01, 0, 0], 999: [0.01, 0, 0], 152: [0.3, 0.4, 0] },
    })
    expect(shape.pins).toEqual({ 4: [0.01, -0.02, 0.005], 152: [0.6 * MAX_PIN, 0.8 * MAX_PIN, 0] })
    expect(readFaceShape(JSON.parse(JSON.stringify(shape)))).toEqual(shape)
    for (const junk of [undefined, null, 'pins', [[0, 0, 0.01]]]) {
      expect(readFaceShape({ fit: 0.5, sliders: { eyeSize: 0.2 }, pins: junk }).pins).toEqual({})
    }
  })

  test('an older save, from before pins, loads as it was with none', () => {
    const old = { fit: 0.6, sliders: { eyeSize: 0.4, jawWidth: -0.25 } }
    expect(readFaceShape(old)).toEqual({ ...old, pins: {} })
  })

  test('pins alone shape the face; the sliders alone are still the sliders', () => {
    const pinned = { fit: 1, sliders: {}, pins: { 4: [0, 0, 0.01] as [number, number, number] } }
    expect(hasFaceShape(pinned)).toBe(true)
    expect(hasSliders(pinned)).toBe(false)
    expect(hasFaceShape({ ...pinned, pins: { 4: [0, 0, 0] } })).toBe(false)
    expect(hasFaceShape({ fit: 1, sliders: { eyeSize: 0.2 }, pins: {} })).toBe(true)
    expect(hasFaceShape(null)).toBe(false)
  })
})

describe('a photo’s face against the character’s', () => {
  test('the same face, framed otherwise, differs in nothing', () => {
    const photo = packPoints(framed(facePoints(), 1.7, 0.12, [0.03, -0.05]))
    for (const offset of photoResiduals(photo, target)) {
      if (!offset) continue
      expect(Math.abs(offset[0])).toBeLessThan(1e-3)
      expect(Math.abs(offset[1])).toBeLessThan(1e-3)
    }
  })

  test('a narrower jaw comes through, the same on both sides', () => {
    const points = facePoints()
    const jaw = [172, 397].map(facePointOf)
    for (const i of jaw) points[i] = [0.5 + (points[i]![0] - 0.5) * 0.8, points[i]![1]]
    const offsets = photoResiduals(packPoints(points), target)
    const [right, left] = jaw.map((i) => offsets[i]!)
    // The image's left jaw moves right, the other left, by as much.
    expect(right![0]).toBeGreaterThan(0.01)
    expect(left![0]).toBeCloseTo(-right![0], 6)
    expect(right![1]).toBeCloseTo(left![1], 6)
  })

  test('the irises (they follow the gaze) and the hairline say nothing', () => {
    const offsets = photoResiduals(target, target)
    expect(offsets[FACE_PARTS.rightIris[0]!]).toBeNull()
    expect(offsets[facePointOf(10)]).toBeNull()
  })
})

describe('the shape’s field', () => {
  test('nothing to do: no field', () => {
    expect(faceShapeField(target, { fit: 1, sliders: {}, pins: {} }, null)).toBeNull()
    expect(faceShapeField(target, { fit: 0, sliders: {}, pins: {} }, target)).toBeNull()
    expect(
      faceShapeField(target, { fit: 1, sliders: { jawAngle: 0, upperLip: 0 }, pins: {} }, null),
    ).toBeNull()
  })

  test('the ears are no brush’s: their sliders leave the face field be', () => {
    const sliders = { earSize: 1, earAngle: -1, earHeight: 1, earPoint: 1 }
    expect(faceShapeField(target, { fit: 1, sliders, pins: {} }, null)).toBeNull()
  })

  test('the eyes set wider apart move out, each its own way, and the chin stays', () => {
    const field = faceShapeField(target, { fit: 1, sliders: { eyeSpacing: 1 }, pins: {} }, null)!
    const out = [0, 0, 0]
    field(0.38, 0.46, out)
    expect(out[0]).toBeLessThan(0)
    field(0.62, 0.46, out)
    expect(out[0]).toBeGreaterThan(0)
    field(0.5, 0.97, out)
    expect(out).toEqual([0, 0, 0])
  })

  test('a higher nose comes out of the face; far from the face nothing moves', () => {
    const field = faceShapeField(target, { fit: 1, sliders: { noseHeight: 1 }, pins: {} }, null)!
    // Down the bridge, from its top to the tip.
    const [top, tip] = [6, 4].map((landmark) => facePoints()[facePointOf(landmark)]!)
    const out = [0, 0, 0]
    field((top![0] + tip![0]) / 2, (top![1] + tip![1]) / 2, out)
    expect(out[2]).toBeGreaterThan(0)
    field(0.02, 0.02, out)
    expect(out).toEqual([0, 0, 0])
  })

  test('a photo’s narrower jaw pulls the character’s in', () => {
    const points = facePoints()
    const jaw = facePointOf(172)
    points[jaw] = [0.5 + (points[jaw]![0] - 0.5) * 0.8, points[jaw]![1]]
    const field = faceShapeField(target, { fit: 1, sliders: {}, pins: {} }, packPoints(points))!
    const at = facePoints()[jaw]!
    const out = [0, 0, 0]
    field(at[0], at[1], out)
    // The image's left jaw, pulled towards the middle.
    expect(out[0]).toBeGreaterThan(0)
  })
})

describe('the shape’s field with pins', () => {
  const CHARACTER = REAL.Male_Adult_02!
  const points = unpackPoints(CHARACTER)
  const at = (landmark: number) => points[facePointOf(landmark)]!
  const sampled: Point[] = [
    at(4),
    at(152),
    at(61),
    at(116),
    at(159),
    [0.5, 0.5],
    [0.35, 0.62],
    [0.6, 0.35],
    [0.1, 0.1],
  ]

  test('pins alone make a field, which puts a lone pin’s landmark where it is pinned', () => {
    const pins = { 4: [0.004, -0.006, 0.012] as [number, number, number] }
    const field = faceShapeField(CHARACTER, { fit: 1, sliders: {}, pins }, null)!
    expect(field).not.toBeNull()
    const out = [0, 0, 0]
    field(...at(4), out)
    for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(pins[4][k]!, 9)
  })

  test('with sliders: the pins pull the landmarks where the sliders left them', () => {
    const pins = sculpt(
      {},
      4,
      [0.004, -0.006, 0.012],
      { radius: 0.05, falloff: 'smooth', symmetric: true },
      CHARACTER,
    )
    const sliders = { noseLength: 0.6, faceWidth: -0.4, mouthWidth: 0.5 }
    const both = faceShapeField(CHARACTER, { fit: 1, sliders, pins }, null)!
    const slid = faceShapeField(CHARACTER, { fit: 1, sliders, pins: {} }, null)!
    const shaped = points.flatMap(([x, y]) => {
      const out = [0, 0, 0]
      slid(x, y, out)
      return [x + out[0]!, y + out[1]!]
    })
    const pinned = pinsField(pins, shaped)!
    const [out, first, then] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    for (const [x, y] of sampled) {
      both(x, y, out)
      slid(x, y, first)
      pinned(x + first[0]!, y + first[1]!, then)
      for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(first[k]! + then[k]!, 12)
    }
    // A lone pin's landmark lands where it is pinned, however the sliders are set.
    const lone = { 4: [0.004, -0.006, 0.012] as [number, number, number] }
    const field = faceShapeField(CHARACTER, { fit: 1, sliders, pins: lone }, null)!
    field(...at(4), out)
    slid(...at(4), first)
    for (let k = 0; k < 3; k++) expect(out[k]! - first[k]!).toBeCloseTo(lone[4][k]!, 6)
  })

  test('with a photo too: it is the photo’s and the sliders’ field, then the pins', () => {
    const photo = REAL.Female_Adult_03!
    const pins = { 152: [0, 0.01, 0.005] as [number, number, number] }
    const field = faceShapeField(CHARACTER, { fit: 0.8, sliders: {}, pins }, photo)!
    const photoOnly = faceShapeField(CHARACTER, { fit: 0.8, sliders: {}, pins: {} }, photo)!
    const out = [0, 0, 0]
    const first = [0, 0, 0]
    field(...at(152), out)
    photoOnly(...at(152), first)
    for (let k = 0; k < 3; k++) expect(out[k]! - first[k]!).toBeCloseTo(pins[152][k]!, 6)
  })

  test('pulling the upper lid up barely moves the eyeball under it', () => {
    const lid = FACE_HANDLE['eye-upper-r']
    if (lid.kind !== 'landmark') throw new Error('a landmark handle')
    for (const id of ['Male_Adult_02', 'Female_Adult_03', 'Female_Child_01']) {
      const target = REAL[id]!
      const pins = sculpt(
        {},
        lid.landmark,
        [0, -0.03, 0],
        { radius: lid.radius, falloff: 'smooth', symmetric: true },
        target,
      )
      const field = faceShapeField(target, { fit: 1, sliders: {}, pins }, null)!
      const [x, y] = unpackPoints(target)[FACE_PARTS.rightIris[0]!]!
      const [skin, eyeball] = [
        [0, 0, 0],
        [0, 0, 0],
      ]
      field(...unpackPoints(target)[facePointOf(lid.landmark)]!, skin)
      field.eyeballs(x, y, eyeball)
      expect(skin[1]).toBeLessThan(-0.025)
      expect(Math.hypot(eyeball[0]!, eyeball[1]!, eyeball[2]!)).toBeLessThan(0.2 * 0.03)
    }
  })
})

describe('the finer sliders', () => {
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const flip = ([x, y]: Point): Point => [1 - x, y]

  test('a squarer jaw: its corners down and out, the chin barely', () => {
    const corner = mid(at(58), at(172))
    const [dx, dy] = moveAt('jawAngle', 1, corner)
    expect(dx).toBeLessThan(0)
    expect(dy).toBeGreaterThan(0)
    expect(moveAt('jawAngle', 1, flip(corner))[0]).toBeCloseTo(-dx!, 9)
    expect(moveAt('jawAngle', -1, corner)[1]).toBeLessThan(0)
    expect(Math.abs(moveAt('jawAngle', 1, at(152))[1]!)).toBeLessThan(dy! / 4)
  })

  test('a squarer jaw leaves the ear’s lobe, over the outline where it turns up (132), be', () => {
    expect(moveAt('jawAngle', 1, at(132))).toEqual([0, 0, 0])
  })

  test('a longer eye: its corners drawn apart, the iris left round', () => {
    expect(moveAt('eyeWidth', 1, at(33))[0]).toBeLessThan(0)
    expect(moveAt('eyeWidth', 1, at(133))[0]).toBeGreaterThan(0)
    expect(moveAt('eyeWidth', 1, flip(at(33)))[0]).toBeGreaterThan(0)
    expect(moveAt('eyeWidth', 1, [0.38, 0.46])).toEqual([0, 0, 0])
    expect(moveAt('eyeWidth', -1, at(33))[0]).toBeGreaterThan(0)
  })

  test('a wider-open eye: the upper lid up, the lower barely down', () => {
    const upper = moveAt('eyeOpen', 1, at(159))[1]!
    const lower = moveAt('eyeOpen', 1, at(145))[1]!
    expect(upper).toBeLessThan(0)
    expect(lower).toBeGreaterThan(0)
    expect(Math.abs(upper)).toBeGreaterThan(2 * lower)
    expect(moveAt('eyeOpen', -1, at(159))[1]).toBeGreaterThan(0)
  })

  test('the lid slides round the eyeball: in as it opens, out as it closes; the eyeball stays', () => {
    expect(moveAt('eyeOpen', 1, at(159))[2]).toBeLessThan(0)
    expect(moveAt('eyeOpen', -1, at(159))[2]).toBeGreaterThan(0)
    const field = faceShapeField(
      featured,
      { fit: 1, sliders: { eyeOpen: 1, eyeSize: 1 }, pins: {} },
      null,
    )!
    const [lids, eyeballs] = [
      [0, 0, 0],
      [0, 0, 0],
    ]
    field(...at(159), lids)
    field.eyeballs(...at(159), eyeballs)
    const eyeSizeOnly = moveAt('eyeSize', 1, at(159))
    expect(eyeballs).toEqual(eyeSizeOnly)
    expect(lids[1]).toBeLessThan(eyeSizeOnly[1]!)
  })

  test('brows set apart: each out its own way, the middle between them stays', () => {
    const brow = featurePoints()[FACE_PARTS.brows.at(-1)!]!
    expect(moveAt('browSpacing', 1, brow)[0]).toBeLessThan(0)
    expect(moveAt('browSpacing', 1, flip(brow))[0]).toBeGreaterThan(0)
    expect(moveAt('browSpacing', 1, [0.5, 0.4])[0]).toBeCloseTo(0, 9)
  })

  test('brows set apart: their outer ends stay; the forehead goes along, fading gently; the lids stay', () => {
    // The image's left brow's outer ends (46, 70), and its inner (107).
    const inner = moveAt('browSpacing', 1, at(107))[0]!
    for (const end of [46, 70]) expect(moveAt('browSpacing', 1, at(end))).toEqual([0, 0, 0])
    const [x, y] = at(107)
    const forehead = moveAt('browSpacing', 1, [x, y - 0.2 * EYES])[0]!
    expect(Math.abs(forehead)).toBeGreaterThan(Math.abs(inner) / 2)
    expect(moveAt('browSpacing', 1, at(159))).toEqual([0, 0, 0])
  })

  test('an arched brow: its middle up, its ends barely', () => {
    const brows = FACE_PARTS.brows
      .slice(FACE_PARTS.brows.length / 2)
      .map((i) => featurePoints()[i]!)
    const centre: Point = [
      brows.reduce((sum, [x]) => sum + x, 0) / brows.length,
      brows.reduce((sum, [, y]) => sum + y, 0) / brows.length,
    ]
    const middle = moveAt('browArch', 1, centre)[1]!
    expect(middle).toBeLessThan(0)
    for (const end of [brows[0]!, brows.at(-1)!]) {
      expect(Math.abs(moveAt('browArch', 1, end)[1]!)).toBeLessThan(Math.abs(middle) / 3)
    }
  })

  test('a wider bridge: its sides out, the eyes’ inner corners stay', () => {
    const side: Point = [0.47, 0.5]
    expect(moveAt('noseBridge', 1, side)[0]).toBeLessThan(0)
    expect(moveAt('noseBridge', 1, flip(side))[0]).toBeGreaterThan(0)
    expect(moveAt('noseBridge', -1, side)[0]).toBeGreaterThan(0)
    expect(moveAt('noseBridge', 1, at(133))).toEqual([0, 0, 0])
  })

  test('each lip thicker on its own: its outer edge moves, where they meet does not', () => {
    const upper = moveAt('upperLip', 1, at(0))
    expect(upper[1]).toBeLessThan(0)
    expect(upper[2]).toBeGreaterThan(0)
    expect(moveAt('upperLip', 1, at(13))).toEqual([0, 0, 0])
    expect(moveAt('upperLip', 1, at(17))).toEqual([0, 0, 0])
    expect(moveAt('upperLip', 1, at(2))).toEqual([0, 0, 0])
    expect(moveAt('lowerLip', 1, at(17))[1]).toBeGreaterThan(0)
    expect(moveAt('lowerLip', 1, at(14))).toEqual([0, 0, 0])
    expect(moveAt('lowerLip', 1, at(0))).toEqual([0, 0, 0])
    expect(moveAt('lowerLip', -1, at(17))[1]).toBeLessThan(0)
  })

  test('a longer philtrum: the mouth and chin down together, the nose stays', () => {
    const mouth = moveAt('philtrum', 1, at(13))[1]!
    const chin = moveAt('philtrum', 1, at(152))[1]!
    expect(mouth).toBeGreaterThan(0)
    expect(chin).toBeCloseTo(mouth, 9)
    expect(moveAt('philtrum', 1, at(2))).toEqual([0, 0, 0])
  })

  test('a mouth set forward comes out of the face; the eyes stay', () => {
    expect(moveAt('mouthDepth', 1, at(13))[2]).toBeGreaterThan(0)
    expect(moveAt('mouthDepth', -1, at(13))[2]).toBeLessThan(0)
    expect(moveAt('mouthDepth', 1, [0.38, 0.46])).toEqual([0, 0, 0])
  })
})

describe('the eyeballs, under the field', () => {
  /** The featured face's front view as the bind pose: x across, y up, the face's front at z = 0. */
  const FRAME: HeadFrame = { left: 0, top: 1, size: 1, neck: new Vector3(0.5, 0.2, -0.2), front: 0 }
  const IRIS = at(468)
  /** The image's left eyeball, and how far it reaches. */
  const EYEBALL = new Vector3(IRIS[0], 1 - IRIS[1], -0.02)
  const EYE_RADIUS = 0.02

  /**
   * A head of an eyeball (skinned to its own bone, as Rocketbox's are) and
   * a point of skin on its upper lid (skinned to the head bone).
   */
  function head() {
    const eyeball = new SphereGeometry(EYE_RADIUS, 8, 6).translate(EYEBALL.x, EYEBALL.y, EYEBALL.z)
    const [lidX, lidY] = at(159)
    const positions = [...eyeball.getAttribute('position').array, lidX, 1 - lidY, 0]
    const count = positions.length / 3
    const eyeCount = eyeball.getAttribute('position').count
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute(
      'skinIndex',
      new Uint16BufferAttribute(
        Array.from({ length: count }, (_, i) => [i < eyeCount ? 1 : 0, 0, 0, 0]).flat(),
        4,
      ),
    )
    geometry.setAttribute(
      'skinWeight',
      new Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4),
    )
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
    const bones = [new Bone(), new Bone()]
    bones[0]!.name = 'Bip01_Head'
    bones[1]!.name = 'Bip01_REye'
    mesh.bind(new Skeleton(bones))
    return { mesh, eyeCount }
  }

  /** Every point's move under a slider, with where it was. */
  function moved(slider: string, setting: number) {
    const { mesh, eyeCount } = head()
    const field = faceShapeField(
      featured,
      { fit: 1, sliders: { [slider]: setting }, pins: {} },
      null,
    )!
    const move = faceShaper(field, FRAME)(mesh)!
    const position = mesh.geometry.getAttribute('position')
    const points = Array.from({ length: position.count }, (_, i) => {
      const at = new Vector3().fromBufferAttribute(position, i)
      const by = new Vector3()
      move(at, i, by)
      return { at, by }
    })
    return { eyeball: points.slice(0, eyeCount), lid: points[eyeCount]! }
  }

  test('opening the lids leaves the eyeball where it is', () => {
    for (const setting of [1, -1]) {
      const { eyeball, lid } = moved('eyeOpen', setting)
      for (const { by } of eyeball) expect(by.length()).toBe(0)
      expect(Math.sign(lid.by.y)).toBe(setting)
    }
  })

  test('the skin round the eye moves over the eyeball, which stays: its corners, the brows', () => {
    for (const slider of ['eyeWidth', 'browHeight', 'browSpacing']) {
      for (const { by } of moved(slider, 1).eyeball) expect(by.length()).toBe(0)
    }
  })

  test('the eyeball moves whole: turned and scaled evenly, so the iris stays round', () => {
    for (const [slider, growth] of [
      ['eyeSize', 1.3],
      ['faceWidth', 1],
      ['eyeTilt', 1],
      ['eyeSpacing', 1],
    ] as const) {
      const { eyeball } = moved(slider, 1)
      const [first, ...rest] = eyeball.map(({ at, by }) => ({ at, after: at.clone().add(by) }))
      // Across the face, every point's distance from any other grows alike.
      const grown = rest
        .map(({ at, after }) => ({
          before: at.clone().sub(first!.at).setZ(0).length(),
          after: after.clone().sub(first!.after).setZ(0).length(),
        }))
        .filter(({ before }) => before > EYE_RADIUS / 10)
        .map(({ before, after }) => after / before)
      for (const each of grown) expect(each).toBeCloseTo(grown[0]!, 9)
      expect(grown[0]).toBeCloseTo(growth, 1)
      for (const { by } of eyeball) expect(by.z).toBeCloseTo(eyeball[0]!.by.z, 9)
    }
  })
})
