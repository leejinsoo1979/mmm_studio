import { describe, expect, test } from 'bun:test'
import { FACE_PARTS, FACE_POINT_COUNT, facePointOf, type Point, packPoints } from './face-points'
import { faceShapeField, hasSliders, photoResiduals, readFaceShape } from './face-shape'

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

/** The face's points with its features where a face has them. */
function featurePoints(): Point[] {
  const points = facePoints()
  for (const [right, left, [x, y]] of FEATURES) {
    points[facePointOf(right)] = [x, y]
    points[facePointOf(left)] = [1 - x, y]
  }
  for (const [landmark, y] of MIDDLE) points[facePointOf(landmark)] = [0.5, y]
  // The brows, a row over the eyes: the subject's left first (the image's right).
  const half = FACE_PARTS.brows.length / 2
  FACE_PARTS.brows.forEach((i, k) => {
    const x = 0.3 + ((k % half) / (half - 1)) * 0.15
    points[i] = [k < half ? 1 - x : x, 0.4]
  })
  return points
}

const featured = packPoints(featurePoints())
const at = (landmark: number) => featurePoints()[facePointOf(landmark)]!

/** A slider's move at a place on the featured face. */
function moveAt(slider: string, setting: number, [x, y]: Point) {
  const field = faceShapeField(featured, { fit: 1, sliders: { [slider]: setting } }, null)!
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

describe('a face shape as saved', () => {
  test('keeps known sliders in range, drops the rest', () => {
    const shape = readFaceShape({
      fit: 3,
      sliders: { eyeSize: 2, noseWidth: -0.4, wings: 1, jawWidth: 'x' },
    })
    expect(shape).toEqual({ fit: 1, sliders: { eyeSize: 1, noseWidth: -0.4 } })
    expect(readFaceShape(null)).toEqual({ fit: 1, sliders: {} })
    expect(hasSliders(shape)).toBe(true)
    expect(hasSliders(readFaceShape({ sliders: { eyeSize: 0 } }))).toBe(false)
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
    expect(faceShapeField(target, { fit: 1, sliders: {} }, null)).toBeNull()
    expect(faceShapeField(target, { fit: 0, sliders: {} }, target)).toBeNull()
    expect(
      faceShapeField(target, { fit: 1, sliders: { jawAngle: 0, upperLip: 0 } }, null),
    ).toBeNull()
  })

  test('the ears are no brush’s: their sliders leave the face field be', () => {
    const sliders = { earSize: 1, earAngle: -1, earHeight: 1, earPoint: 1 }
    expect(faceShapeField(target, { fit: 1, sliders }, null)).toBeNull()
  })

  test('the eyes set wider apart move out, each its own way, and the chin stays', () => {
    const field = faceShapeField(target, { fit: 1, sliders: { eyeSpacing: 1 } }, null)!
    const out = [0, 0, 0]
    field(0.38, 0.46, out)
    expect(out[0]).toBeLessThan(0)
    field(0.62, 0.46, out)
    expect(out[0]).toBeGreaterThan(0)
    field(0.5, 0.97, out)
    expect(out).toEqual([0, 0, 0])
  })

  test('a higher nose comes out of the face; far from the face nothing moves', () => {
    const field = faceShapeField(target, { fit: 1, sliders: { noseHeight: 1 } }, null)!
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
    const field = faceShapeField(target, { fit: 1, sliders: {} }, packPoints(points))!
    const at = facePoints()[jaw]!
    const out = [0, 0, 0]
    field(at[0], at[1], out)
    // The image's left jaw, pulled towards the middle.
    expect(out[0]).toBeGreaterThan(0)
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

  test('brows set apart: each out its own way, the middle between them stays', () => {
    const brow = featurePoints()[FACE_PARTS.brows.at(-1)!]!
    expect(moveAt('browSpacing', 1, brow)[0]).toBeLessThan(0)
    expect(moveAt('browSpacing', 1, flip(brow))[0]).toBeGreaterThan(0)
    expect(moveAt('browSpacing', 1, [0.5, 0.4])[0]).toBeCloseTo(0, 9)
  })

  test('an arched brow: its middle up, its ends barely', () => {
    const brows = FACE_PARTS.brows
      .slice(FACE_PARTS.brows.length / 2)
      .map((i) => featurePoints()[i]!)
    const middle = moveAt('browArch', 1, [0.375, 0.4])[1]!
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
