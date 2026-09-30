import { describe, expect, test } from 'bun:test'
import { FACE_POINT_MIRRORS, type ProportionalOptions } from './face-edit'
import { type FacePins, hasPins, MAX_PIN, pinsField, readFacePins, sculpt } from './face-pins'
import {
  FACE_PARTS,
  FACE_POINT_COUNT,
  FACE_POINT_INDICES,
  facePointOf,
  type Point,
  packPoints,
  unpackPoints,
} from './face-points'
import type { ShapeField } from './face-shape'

/**
 * A character's front-view points, exactly mirror-symmetric across x = 0.5:
 * every pair spread (repeatably) over the face, the middle ones on the
 * middle, the irises 0.2 apart.
 */
function frontPoints(): Point[] {
  const points: Point[] = Array.from({ length: FACE_POINT_COUNT }, () => [0.5, 0.5] as Point)
  const place = (i: number, [x, y]: Point) => {
    points[i] = [x, y]
    points[FACE_POINT_MIRRORS[i]!] = [1 - x, y]
  }
  let seed = 5
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  FACE_POINT_MIRRORS.forEach((partner, i) => {
    if (partner < i) return
    const y = 0.25 + random() * 0.6
    place(i, partner === i ? [0.5, y] : [0.22 + random() * 0.26, y])
  })
  const [centre, ...rim] = FACE_PARTS.rightIris
  place(centre!, [0.4, 0.45])
  rim.forEach((i, k) => {
    const angle = (k * Math.PI) / 2
    place(i, [0.4 + 0.012 * Math.cos(angle), 0.45 + 0.012 * Math.sin(angle)])
  })
  return points
}

const target = packPoints(frontPoints())

/** A real character's front-view points (Male_Adult_10's, from face-points.json). */
const CHARACTER = [
  0.5048, 0.2716, 0.5647, 0.2724, 0.6166, 0.2799, 0.665, 0.2954, 0.6981, 0.3203, 0.7195, 0.3534,
  0.7309, 0.3906, 0.7356, 0.438, 0.7345, 0.484, 0.7305, 0.5323, 0.7229, 0.584, 0.7099, 0.6386, 0.69,
  0.6824, 0.6658, 0.7138, 0.635, 0.7408, 0.6083, 0.7587, 0.5804, 0.7735, 0.5487, 0.7842, 0.5083,
  0.7872, 0.4679, 0.7849, 0.4359, 0.7746, 0.4074, 0.7603, 0.3802, 0.7431, 0.3487, 0.7167, 0.3239,
  0.6856, 0.3031, 0.6424, 0.2896, 0.5873, 0.2814, 0.5353, 0.2773, 0.4871, 0.2754, 0.4409, 0.2804,
  0.3932, 0.292, 0.3554, 0.3134, 0.3219, 0.3463, 0.2965, 0.3939, 0.2805, 0.4452, 0.2729, 0.6774,
  0.4014, 0.658, 0.3898, 0.6307, 0.3845, 0.5933, 0.3883, 0.5438, 0.404, 0.6897, 0.3914, 0.6691,
  0.3768, 0.6382, 0.3684, 0.5974, 0.3714, 0.5504, 0.3785, 0.3351, 0.4047, 0.3537, 0.3929, 0.3802,
  0.3874, 0.4169, 0.3898, 0.4661, 0.4046, 0.3225, 0.3949, 0.3426, 0.3801, 0.3726, 0.3712, 0.4129,
  0.3732, 0.4591, 0.3792, 0.6415, 0.4318, 0.6351, 0.4375, 0.6282, 0.4411, 0.6186, 0.444, 0.6039,
  0.4455, 0.5879, 0.4445, 0.5732, 0.443, 0.563, 0.4428, 0.5578, 0.4423, 0.6375, 0.4289, 0.6324,
  0.4256, 0.6231, 0.4214, 0.6087, 0.4191, 0.592, 0.4203, 0.5754, 0.4269, 0.5633, 0.4359, 0.3698,
  0.4325, 0.3765, 0.4375, 0.383, 0.441, 0.3925, 0.4443, 0.4075, 0.4458, 0.4228, 0.4448, 0.4376,
  0.4432, 0.448, 0.4432, 0.4528, 0.4424, 0.3737, 0.4292, 0.3785, 0.4258, 0.387, 0.4217, 0.4019,
  0.4189, 0.4181, 0.4202, 0.4348, 0.4268, 0.4472, 0.4362, 0.4319, 0.6584, 0.4396, 0.6658, 0.4499,
  0.6727, 0.465, 0.6818, 0.4847, 0.6878, 0.5066, 0.6894, 0.5291, 0.6872, 0.5487, 0.6805, 0.5641,
  0.6715, 0.5747, 0.6638, 0.5819, 0.6567, 0.574, 0.6522, 0.5637, 0.6471, 0.5491, 0.6409, 0.5286,
  0.6348, 0.5071, 0.6399, 0.485, 0.6352, 0.4642, 0.6416, 0.4501, 0.6481, 0.4399, 0.6534, 0.4382,
  0.6584, 0.4493, 0.659, 0.4593, 0.6588, 0.4729, 0.6588, 0.4887, 0.6589, 0.5067, 0.6599, 0.5246,
  0.6589, 0.541, 0.6575, 0.5543, 0.6574, 0.5647, 0.6573, 0.576, 0.6568, 0.5641, 0.6568, 0.5541,
  0.6569, 0.5409, 0.6575, 0.5251, 0.6589, 0.507, 0.66, 0.4891, 0.6591, 0.4732, 0.6581, 0.4598,
  0.6583, 0.4495, 0.6583, 0.505, 0.4322, 0.5052, 0.4574, 0.505, 0.4811, 0.5052, 0.5028, 0.5049,
  0.5256, 0.5049, 0.5525, 0.5051, 0.572, 0.5052, 0.5817, 0.5053, 0.5864, 0.5057, 0.5898, 0.4562,
  0.5843, 0.5553, 0.584, 0.4496, 0.5729, 0.5622, 0.5724, 0.4444, 0.5618, 0.5679, 0.5614, 0.4489,
  0.5528, 0.5627, 0.5526, 0.4499, 0.5641, 0.5617, 0.5638, 0.4592, 0.5573, 0.5517, 0.5572, 0.4721,
  0.5536, 0.5384, 0.5533, 0.4872, 0.5523, 0.5231, 0.5526, 0.4879, 0.5274, 0.5217, 0.5269, 0.4893,
  0.5054, 0.5211, 0.5052, 0.3531, 0.545, 0.6606, 0.5428, 0.3818, 0.5728, 0.6324, 0.5714, 0.3392,
  0.5888, 0.6755, 0.5865, 0.3077, 0.5339, 0.7061, 0.5313, 0.3028, 0.4892, 0.7108, 0.4861, 0.3391,
  0.4906, 0.6744, 0.4885, 0.3646, 0.4993, 0.6488, 0.4978, 0.3987, 0.5213, 0.6143, 0.5201, 0.412,
  0.5488, 0.601, 0.5479, 0.4365, 0.5332, 0.5762, 0.5326, 0.4275, 0.5772, 0.5852, 0.5764, 0.4093,
  0.597, 0.6047, 0.5957, 0.3942, 0.6231, 0.6194, 0.6217, 0.3659, 0.6053, 0.6485, 0.6032, 0.3617,
  0.6612, 0.6531, 0.6591, 0.3871, 0.6594, 0.6268, 0.6571, 0.4028, 0.6837, 0.6117, 0.6822, 0.4227,
  0.7053, 0.592, 0.7035, 0.4101, 0.7217, 0.6053, 0.7198, 0.4363, 0.7406, 0.5789, 0.7392, 0.5075,
  0.7563, 0.508, 0.7753, 0.5047, 0.3238, 0.5048, 0.3815, 0.5047, 0.4082, 0.4522, 0.3231, 0.5574,
  0.3226, 0.4049, 0.3242, 0.6047, 0.323, 0.3599, 0.3319, 0.6507, 0.3301, 0.4225, 0.6751, 0.5908,
  0.6742, 0.4081, 0.6565, 0.6052, 0.6548, 0.416, 0.6386, 0.5974, 0.6378, 0.4301, 0.6236, 0.5828,
  0.6225, 0.4486, 0.6131, 0.5639, 0.6124, 0.4082, 0.4309, 0.4279, 0.431, 0.4083, 0.4136, 0.3885,
  0.4307, 0.4082, 0.449, 0.605, 0.4311, 0.6244, 0.4308, 0.6048, 0.4137, 0.585, 0.431, 0.6044,
  0.4489,
]

const options = (radius: number, symmetric = false, falloff = 'smooth'): ProportionalOptions =>
  ({ radius, falloff, symmetric }) as ProportionalOptions

const IRIS_LANDMARKS = [...FACE_PARTS.rightIris, ...FACE_PARTS.leftIris].map(
  (i) => FACE_POINT_INDICES[i]!,
)

/** The field at a landmark of the character, as a share of its pin (along the pin). */
function delivered(field: ShapeField, pins: FacePins, landmark: number): number {
  const [x, y] = unpackPoints(CHARACTER)[facePointOf(landmark)]!
  const out = [0, 0, 0]
  field(x, y, out)
  const pin = pins[landmark]!
  return (out[0]! * pin[0] + out[1]! * pin[1] + out[2]! * pin[2]) / Math.hypot(...pin) ** 2
}

/**
 * Over a grid round the pinned landmarks: the least det(I + ∇d) of the
 * field's move across the front view (0 or less where the skin folds over)
 * and its longest move.
 */
function survey(field: ShapeField, pins: FacePins) {
  const points = unpackPoints(CHARACTER)
  const pinned = Object.keys(pins).map((landmark) => points[facePointOf(Number(landmark))]!)
  const xs = pinned.map(([x]) => x)
  const ys = pinned.map(([, y]) => y)
  const out = [0, 0, 0]
  const right = [0, 0, 0]
  const below = [0, 0, 0]
  const h = 0.001
  let fold = Number.POSITIVE_INFINITY
  let longest = 0
  for (let y = Math.min(...ys) - 0.08; y <= Math.max(...ys) + 0.08; y += 0.006) {
    for (let x = Math.min(...xs) - 0.08; x <= Math.max(...xs) + 0.08; x += 0.006) {
      field(x, y, out)
      field(x + h, y, right)
      field(x, y + h, below)
      const det =
        (1 + (right[0]! - out[0]!) / h) * (1 + (below[1]! - out[1]!) / h) -
        ((below[0]! - out[0]!) / h) * ((right[1]! - out[1]!) / h)
      fold = Math.min(fold, det)
      longest = Math.max(longest, Math.hypot(out[0]!, out[1]!, out[2]!))
    }
  }
  return { fold, longest }
}

type Pull = [landmark: number, delta: [number, number, number], options: ProportionalOptions]

const sculpted = (pulls: readonly Pull[], on: readonly number[] = CHARACTER) =>
  pulls.reduce<FacePins>(
    (pins, [landmark, delta, how]) => sculpt(pins, landmark, delta, how, on),
    {},
  )

describe('reading pins', () => {
  test('rejects what isn’t pins', () => {
    for (const junk of [null, undefined, 3, 'pins', [], [[0.01, 0, 0]], true]) {
      expect(readFacePins(junk)).toEqual({})
    }
  })

  test('drops unknown landmarks, the irises and malformed pins, and keeps the rest in range', () => {
    const unknown = Array.from({ length: 478 }, (_, i) => i).find(
      (i) => !FACE_POINT_INDICES.includes(i),
    )!
    const pins = readFacePins({
      4: [0.012345, -0.02, 0.005],
      [unknown]: [0.01, 0, 0],
      999: [0.01, 0, 0],
      468: [0.01, 0, 0],
      474: [0, 0.01, 0],
      nose: [0.01, 0, 0],
      '04': [0.01, 0, 0],
      '1.0': [0.01, 0, 0],
      1: [0.01, 0],
      2: [Number.NaN, 0, 0],
      5: ['0.01', 0, 0],
      6: [0, 0, 0],
      19: [1, 0, 0],
      152: [0.3, 0.4, 0],
    })
    expect(pins).toEqual({
      4: [0.0123, -0.02, 0.005],
      19: [MAX_PIN, 0, 0],
      152: [0.6 * MAX_PIN, 0.8 * MAX_PIN, 0],
    })
    expect(readFacePins(JSON.parse(JSON.stringify(pins)))).toEqual(pins)
  })

  test('says whether any pin pulls', () => {
    expect(hasPins(null)).toBe(false)
    expect(hasPins({})).toBe(false)
    expect(hasPins({ 4: [0, 0, 0] })).toBe(false)
    expect(hasPins({ 4: [0, 0, 0.01] })).toBe(true)
  })
})

describe('sculpting', () => {
  test('with radius 0 pins only the grabbed landmark', () => {
    expect(sculpt({}, 116, [0.01, -0.02, 0.03], options(0), target)).toEqual({
      116: [0.01, -0.02, 0.03],
    })
  })

  test('adds pulls up, and leaves the pins it was given be', () => {
    const once = sculpt({}, 116, [0.01, 0, 0.02], options(0), target)
    const twice = sculpt(once, 116, [0.01, 0, 0.02], options(0), target)
    expect(twice).toEqual({ 116: [0.02, 0, 0.04] })
    expect(once).toEqual({ 116: [0.01, 0, 0.02] })
    const more = sculpt(twice, 4, [0, 0, 0.01], options(0), target)
    expect(more).toEqual({ 4: [0, 0, 0.01], 116: [0.02, 0, 0.04] })
  })

  test('spreads a pull by the falloff, and never past MAX_PIN', () => {
    const pins = sculpt({}, 116, [0, 0, 0.04], options(0.15), target)
    expect(pins[116]).toEqual([0, 0, 0.04])
    expect(Object.keys(pins).length).toBeGreaterThan(3)
    for (const pin of Object.values(pins)) {
      expect(pin[2]).toBeGreaterThan(0)
      expect(pin[2]).toBeLessThanOrEqual(0.04)
    }
    const far = sculpt(pins, 116, [0.5, 0, 0.5], options(0.15), target)
    for (const pin of Object.values(far)) {
      expect(Math.hypot(...pin)).toBeLessThanOrEqual(MAX_PIN + 1e-4)
    }
  })

  test('with symmetry pins the other side with the mirror image, exactly', () => {
    const pins = sculpt({}, 116, [-0.013, 0.007, 0.021], options(0.2, true), target)
    expect(pins[345]).toEqual([0.013, 0.007, 0.021])
    FACE_POINT_INDICES.forEach((landmark, i) => {
      const partner = FACE_POINT_INDICES[FACE_POINT_MIRRORS[i]!]!
      const pin = pins[landmark] ?? [0, 0, 0]
      const mirror = pins[partner] ?? [0, 0, 0]
      expect([pin[0], pin[1], pin[2]]).toEqual([-mirror[0] + 0, mirror[1], mirror[2]])
    })
    // A pull on the middle stays on it.
    const chin = sculpt({}, 152, [0.02, 0.01, 0], options(0.1, true), target)
    expect(chin[152]).toEqual([0, 0.01, 0])
  })

  test('never pins an iris: grabbing one pins nothing, and pulls round one leave it be', () => {
    const pins = sculpt({}, 116, [0.01, 0, 0], options(0), target)
    for (const iris of IRIS_LANDMARKS)
      expect(sculpt(pins, iris, [0.01, 0, 0], options(0.1), target)).toBe(pins)
    const lid = sculpt({}, 159, [0, -0.02, 0.01], options(0.2, true), CHARACTER)
    expect(Object.keys(lid).length).toBeGreaterThan(10)
    for (const iris of IRIS_LANDMARKS) expect(lid[iris]).toBeUndefined()
  })
})

describe('the pins’ field', () => {
  test('is nothing without pins, nor with only an iris pinned', () => {
    expect(pinsField({}, CHARACTER)).toBe(null)
    expect(pinsField({ 4: [0, 0, 0] }, CHARACTER)).toBe(null)
    expect(pinsField({ 468: [0.01, 0, 0], 473: [0, 0.01, 0] }, CHARACTER)).toBe(null)
  })

  test('puts a lone pin at full strength on its landmark, crowded or not', () => {
    // The lower lid sits by the iris's rim, the eyes' corners by the lids, the mouth's by the lips.
    for (const landmark of [145, 33, 133, 263, 61, 4]) {
      const pins = sculpted([[landmark, [0.004, 0.01, 0.006], options(0)]])
      expect(delivered(pinsField(pins, CHARACTER)!, pins, landmark)).toBeCloseTo(1, 9)
    }
  })

  test('puts the grabbed landmark of a small pull nearly where it is pinned', () => {
    for (const landmark of [145, 33, 61]) {
      const pins = sculpted([[landmark, [0, 0.01, 0], options(0.02)]])
      const share = delivered(pinsField(pins, CHARACTER)!, pins, landmark)
      expect(share).toBeGreaterThan(0.9)
      expect(share).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  test('never folds the skin over, nor moves it further than the longest pin', () => {
    const cases: Pull[][] = [
      [[61, [-0.02, 0, 0], options(0)]], // the mouth's corner out, alone
      [[61, [0.06, 0, 0], options(0)]], // …and into the lips, past its neighbours
      [[61, [-0.02, 0, 0], options(0.03)]],
      [[145, [0, 0.01, 0], options(0.02)]],
      [[105, [0, -0.03, 0], options(0.04, true)]], // the brows up, steeply
      [[172, [0.03, -0.004, 0], options(0.12, true)]], // the jaw in
      [[172, [0.03, 0, 0], options(0.08, true, 'constant')]],
      [
        [4, [0, 0, 0.03], options(0.05)],
        [4, [0, -0.01, 0.02], options(0)],
      ],
      [
        [205, [0.02, 0.012, 0], options(0.1, true)], // both cheeks in, meeting at the nose
        [4, [0.01, 0.01, 0.01], options(0)],
      ],
    ]
    for (const pulls of cases) {
      const pins = sculpted(pulls)
      const { fold, longest } = survey(pinsField(pins, CHARACTER)!, pins)
      expect(fold).toBeGreaterThan(0.1)
      expect(longest).toBeLessThanOrEqual(
        Math.max(...Object.values(pins).map((pin) => Math.hypot(...pin))) + 1e-9,
      )
    }
  })

  test('is nothing far from the pins', () => {
    const pins = sculpted([[116, [0.01, -0.006, 0.02], options(0.05)]])
    const field = pinsField(pins, CHARACTER)!
    const out = [1, 1, 1]
    for (const [x, y] of [
      [0.02, 0.02],
      [0.9, 0.3],
      [0.5, 1.4],
      [-1, 0.5],
    ] as Point[]) {
      field(x, y, out)
      expect(out).toEqual([0, 0, 0])
    }
  })

  test('mirrors symmetric pins', () => {
    const pins = sculpt({}, 116, [-0.01, 0.005, 0.02], options(0.2, true), target)
    const field = pinsField(pins, target)!
    const left = [0, 0, 0]
    const right = [0, 0, 0]
    for (const [x, y] of [
      [0.3, 0.5],
      [0.35, 0.6],
      [0.42, 0.4],
      [0.2, 0.7],
    ] as Point[]) {
      field(x, y, left)
      field(1 - x, y, right)
      expect(left[0]).toBeCloseTo(-right[0]!, 9)
      expect(left[1]).toBeCloseTo(right[1]!, 9)
      expect(left[2]).toBeCloseTo(right[2]!, 9)
    }
  })
})
