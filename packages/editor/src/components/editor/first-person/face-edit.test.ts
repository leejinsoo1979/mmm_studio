import { describe, expect, test } from 'bun:test'
import {
  dragPoints,
  FACE_POINT_MIRRORS,
  FALLOFFS,
  faceAcross,
  falloffWeight,
  landmarkGroups,
  MASK_GROUPS,
  MASK_HANDLES,
  nearestHandle,
  type ProportionalOptions,
  proportionalShares,
} from './face-edit'
import {
  FACE_PARTS,
  FACE_POINT_COUNT,
  FACE_POINT_INDICES,
  facePointOf,
  type Point,
  packPoints,
  unpackPoints,
} from './face-points'
import { delaunay } from './face-warp'

/**
 * A face's points, exactly mirror-symmetric across x = 0.5: every pair
 * spread (repeatably) over the face, the middle ones on the middle, and
 * the eyes as lids round their irises.
 */
function facePoints(): Point[] {
  const points: Point[] = Array.from({ length: FACE_POINT_COUNT }, () => [0.5, 0.5] as Point)
  /** A point and, on the other side, its mirror image. */
  const place = (i: number, [x, y]: Point) => {
    points[i] = [x, y]
    points[FACE_POINT_MIRRORS[i]!] = [1 - x, y]
  }
  let seed = 11
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  FACE_POINT_MIRRORS.forEach((partner, i) => {
    if (partner < i) return
    const y = 0.25 + random() * 0.6
    place(i, partner === i ? [0.5, y] : [0.2 + random() * 0.27, y])
  })
  // The image's left eye: its lower lid corner to corner, the upper lid between, the iris inside.
  const eye = FACE_PARTS.rightEye
  eye.slice(0, 9).forEach((i, k) => {
    place(i, [0.33 + (0.1 * k) / 8, 0.46 + 0.02 * Math.sin((Math.PI * k) / 8)])
  })
  eye.slice(9).forEach((i, k) => {
    place(i, [0.33 + (0.1 * (k + 1)) / 8, 0.46 - 0.025 * Math.sin((Math.PI * (k + 1)) / 8)])
  })
  const [centre, ...rim] = FACE_PARTS.rightIris
  place(centre!, [0.38, 0.46])
  rim.forEach((i, k) => {
    const angle = (k * Math.PI) / 2
    place(i, [0.38 + 0.015 * Math.cos(angle), 0.46 + 0.015 * Math.sin(angle)])
  })
  return points
}

const face = packPoints(facePoints())

/**
 * MediaPipe's points on a character's head rendered turned 35° (Male_Adult_16,
 * its right side towards the camera): the image's right side of the face is
 * the far one, foreshortened.
 */
const TURNED = [
  0.641, 0.2568, 0.6894, 0.2622, 0.7187, 0.2731, 0.7346, 0.2909, 0.7363, 0.3173, 0.7276, 0.3522,
  0.7127, 0.3895, 0.691, 0.4366, 0.6755, 0.4826, 0.6682, 0.5305, 0.661, 0.5822, 0.6547, 0.6393,
  0.6564, 0.688, 0.6633, 0.7256, 0.6676, 0.7603, 0.6689, 0.7857, 0.6669, 0.8087, 0.6541, 0.8273,
  0.6211, 0.8382, 0.5712, 0.8412, 0.5215, 0.8319, 0.4701, 0.8148, 0.421, 0.7932, 0.3626, 0.759,
  0.312, 0.7182, 0.2713, 0.6641, 0.2506, 0.5993, 0.2447, 0.539, 0.2469, 0.4841, 0.2542, 0.4315,
  0.2794, 0.3773, 0.3159, 0.3349, 0.3701, 0.2976, 0.4358, 0.271, 0.5123, 0.2567, 0.5782, 0.2529,
  0.755, 0.3934, 0.7543, 0.3812, 0.7415, 0.3755, 0.7178, 0.3784, 0.6804, 0.393, 0.7544, 0.3848,
  0.7553, 0.3691, 0.7445, 0.3611, 0.7229, 0.3627, 0.6902, 0.3682, 0.4335, 0.3917, 0.4708, 0.3785,
  0.5129, 0.3732, 0.5593, 0.3776, 0.6087, 0.3949, 0.4098, 0.3808, 0.4554, 0.3646, 0.506, 0.3567,
  0.5598, 0.3608, 0.6095, 0.3683, 0.7334, 0.4229, 0.7315, 0.4297, 0.7279, 0.4345, 0.7206, 0.4383,
  0.7079, 0.4398, 0.6923, 0.4382, 0.6796, 0.4352, 0.6713, 0.4333, 0.6672, 0.4319, 0.7333, 0.4194,
  0.7316, 0.4156, 0.7254, 0.4108, 0.7127, 0.409, 0.6955, 0.4111, 0.6809, 0.4176, 0.672, 0.4257,
  0.4573, 0.4234, 0.4685, 0.4299, 0.48, 0.4346, 0.4944, 0.4385, 0.5129, 0.4402, 0.5276, 0.4389,
  0.5415, 0.4363, 0.5513, 0.4358, 0.5562, 0.4346, 0.466, 0.4191, 0.4751, 0.4149, 0.4886, 0.4101,
  0.5086, 0.4073, 0.5262, 0.4084, 0.5424, 0.4163, 0.5524, 0.4277, 0.5509, 0.676, 0.5625, 0.6836,
  0.5795, 0.6911, 0.6034, 0.7005, 0.6293, 0.7065, 0.6543, 0.7077, 0.6711, 0.7041, 0.6828, 0.6965,
  0.688, 0.6874, 0.6891, 0.6804, 0.6881, 0.6743, 0.69, 0.6669, 0.6899, 0.6591, 0.6856, 0.6506,
  0.6744, 0.6438, 0.6573, 0.6487, 0.6335, 0.6442, 0.6033, 0.6533, 0.581, 0.6616, 0.5635, 0.6688,
  0.5595, 0.6751, 0.5713, 0.6736, 0.5873, 0.6725, 0.6078, 0.6713, 0.6303, 0.6709, 0.6512, 0.6717,
  0.6639, 0.6707, 0.6725, 0.6701, 0.677, 0.6708, 0.6803, 0.672, 0.6832, 0.6736, 0.6783, 0.6724,
  0.6754, 0.6717, 0.6704, 0.6713, 0.6631, 0.6719, 0.65, 0.673, 0.6303, 0.6721, 0.6078, 0.6713,
  0.5877, 0.6725, 0.5722, 0.6736, 0.6449, 0.4217, 0.6548, 0.4484, 0.6643, 0.4738, 0.6742, 0.4972,
  0.6845, 0.5222, 0.6932, 0.5513, 0.6903, 0.5735, 0.6811, 0.5859, 0.671, 0.5915, 0.6604, 0.5962,
  0.5866, 0.5922, 0.6923, 0.5886, 0.5835, 0.5787, 0.7031, 0.5749, 0.5665, 0.566, 0.6959, 0.5623,
  0.5851, 0.5558, 0.7067, 0.5523, 0.5923, 0.5688, 0.7103, 0.5653, 0.6168, 0.5605, 0.7126, 0.5575,
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: a measured point, not √½
  0.6453, 0.5551, 0.7121, 0.5526, 0.6723, 0.5521, 0.7071, 0.5514, 0.6644, 0.5248, 0.6976, 0.5234,
  0.6554, 0.5006, 0.6869, 0.4998, 0.4449, 0.5494, 0.743, 0.5434, 0.4889, 0.5801, 0.7309, 0.5731,
  0.409, 0.6009, 0.7344, 0.5886, 0.3546, 0.5386, 0.7432, 0.5309, 0.3505, 0.4879, 0.7428, 0.4848,
  0.4198, 0.4896, 0.7444, 0.4875, 0.4603, 0.4991, 0.7368, 0.4972, 0.5087, 0.5218, 0.718, 0.5191,
  0.5277, 0.5519, 0.7136, 0.5485, 0.5544, 0.5342, 0.6961, 0.5318, 0.5451, 0.5836, 0.7052, 0.5793,
  0.525, 0.6065, 0.717, 0.6, 0.5018, 0.6376, 0.72, 0.6286, 0.4575, 0.6192, 0.7307, 0.6075, 0.4315,
  0.6885, 0.7146, 0.6681, 0.4802, 0.6827, 0.7122, 0.6677, 0.4967, 0.7123, 0.7016, 0.6962, 0.523,
  0.738, 0.6902, 0.721, 0.5009, 0.7622, 0.6914, 0.739, 0.5422, 0.7823, 0.6828, 0.7645, 0.6379,
  0.7945, 0.6327, 0.8204, 0.6486, 0.312, 0.6509, 0.3731, 0.6473, 0.3995, 0.5956, 0.3077, 0.6916,
  0.3138, 0.5399, 0.306, 0.7208, 0.3165, 0.4728, 0.3117, 0.7393, 0.3243, 0.5304, 0.699, 0.6937,
  0.6898, 0.5145, 0.6775, 0.7036, 0.6679, 0.5329, 0.6543, 0.7085, 0.6481, 0.5563, 0.6362, 0.7061,
  0.6305, 0.5819, 0.6234, 0.6981, 0.6192, 0.506, 0.4214, 0.5252, 0.4213, 0.5052, 0.4022, 0.4851,
  0.4214, 0.506, 0.4417, 0.7064, 0.4226, 0.7231, 0.4221, 0.706, 0.405, 0.6892, 0.4227, 0.7059,
  0.4406,
]

const moves = (before: readonly number[], after: readonly number[]): Point[] => {
  const a = unpackPoints(before)
  return unpackPoints(after).map(([x, y], i) => [x - a[i]![0], y - a[i]![1]])
}

const smooth = (radius: number, symmetric = false): ProportionalOptions => ({
  radius,
  falloff: 'smooth',
  symmetric,
})

const irisRadii = (points: readonly Point[], iris: readonly number[]) => {
  const [cx, cy] = points[iris[0]!]!
  return iris.slice(1).map((i) => Math.hypot(points[i]![0] - cx, points[i]![1] - cy))
}

/** Whether `p` lies inside the eye's outline (its lower lid, then its upper lid back). */
function inEye(points: readonly Point[], eye: readonly number[], [x, y]: Point) {
  const ring = [...eye.slice(0, 9), ...eye.slice(9).reverse()].map((i) => points[i]!)
  let within = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i]!
    const [bx, by] = ring[j]!
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) within = !within
  }
  return within
}

const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/**
 * The triangles of the mask (as a warp meshes it) that a drag turned over,
 * leaving out slivers (their area under a twentieth of their longest side
 * squared) whose corners lie all but in a line, which any nudge turns.
 */
function turnedOver(before: readonly number[], after: readonly number[]): number {
  const [from, to] = [before, after].map((flat) => {
    const points = unpackPoints(flat)
    return FACE_PARTS.warp.map((i) => points[i]!)
  }) as [Point[], Point[]]
  return delaunay(from).filter(([a, b, c]) => {
    const area = cross(from[a]!, from[b]!, from[c]!)
    const longest = Math.max(
      ...[
        [a, b],
        [b, c],
        [c, a],
      ].map(([p, q]) => Math.hypot(from[p!]![0] - from[q!]![0], from[p!]![1] - from[q!]![1])),
    )
    return Math.abs(area) >= longest ** 2 / 20 && area * cross(to[a]!, to[b]!, to[c]!) <= 0
  }).length
}

describe('the mask', () => {
  test('shows a few dozen handles by part of the face, each side with its mirror', () => {
    const handles = MASK_HANDLES.flatMap((group) => group.landmarks)
    expect(handles.length).toBeGreaterThanOrEqual(50)
    expect(handles.length).toBeLessThanOrEqual(70)
    expect(new Set(handles).size).toBe(handles.length)
    expect(handles.every((landmark) => FACE_POINT_INDICES.includes(landmark))).toBe(true)
    expect(MASK_HANDLES.map((group) => group.id)).toEqual([...MASK_GROUPS])
    for (const group of MASK_HANDLES) expect(group.label).toMatch(/^[가-힣·]+$/)
    const shown = new Set(handles)
    const mirror = (landmark: number) =>
      FACE_POINT_INDICES[FACE_POINT_MIRRORS[facePointOf(landmark)]!]!
    expect(handles.every((landmark) => shown.has(mirror(landmark)))).toBe(true)
  })

  test("mirrors pair each side's landmarks, and leave the middle's alone", () => {
    FACE_POINT_MIRRORS.forEach((partner, i) => {
      expect(FACE_POINT_MIRRORS[partner]).toBe(i)
    })
    const pair = (a: number, b: number) =>
      expect(FACE_POINT_MIRRORS[facePointOf(a)]).toBe(facePointOf(b))
    pair(33, 263) // the eyes' outer corners
    pair(61, 291) // the mouth's corners
    pair(468, 473) // the irises
    pair(234, 454) // the face's sides
    for (const middle of [10, 1, 4, 13, 152]) pair(middle, middle)
  })

  test('outlines the brows, eyes, irises, nose, lips and face over the photo', () => {
    const outlines = landmarkGroups(face)
    const count = (group: string) => outlines.filter((outline) => outline.group === group).length
    expect(count('brows')).toBe(2)
    expect(count('eyes')).toBe(4)
    expect(count('nose')).toBe(2)
    expect(count('lips')).toBe(2)
    expect(count('outline')).toBe(1)
    const points = unpackPoints(face)
    const oval = outlines.find((outline) => outline.group === 'outline')!
    expect(oval.closed).toBe(true)
    expect(oval.points).toEqual(FACE_PARTS.oval.map((i) => points[i]!))
    // An iris is drawn as the circle through its rim.
    const iris = outlines.filter((outline) => outline.group === 'eyes')[1]!
    for (const [x, y] of iris.points) expect(Math.hypot(x - 0.38, y - 0.46)).toBeCloseTo(0.015, 4)
  })
})

describe('falloffs', () => {
  test('move all at the grab, nothing from the radius on, less and less between', () => {
    for (const falloff of FALLOFFS) {
      expect(falloffWeight(falloff, 0)).toBe(1)
      expect(falloffWeight(falloff, 1)).toBe(0)
      expect(falloffWeight(falloff, 1.5)).toBe(0)
      let last = 1
      for (let t = 0.05; t < 1; t += 0.05) {
        const weight = falloffWeight(falloff, t)
        expect(weight).toBeLessThanOrEqual(last)
        expect(weight).toBeGreaterThan(0)
        last = weight
      }
    }
  })

  test("have Blender's shapes: a dome, an ease, a spike, a plateau", () => {
    expect(falloffWeight('smooth', 0.5)).toBeCloseTo(0.5, 10)
    expect(falloffWeight('sphere', 0.5)).toBeCloseTo(Math.sqrt(0.75), 10)
    expect(falloffWeight('sharp', 0.5)).toBeCloseTo(0.25, 10)
    expect(falloffWeight('constant', 0.99)).toBe(1)
    for (let t = 0.1; t < 1; t += 0.1) {
      expect(falloffWeight('sphere', t)).toBeGreaterThanOrEqual(falloffWeight('smooth', t))
      expect(falloffWeight('smooth', t)).toBeGreaterThanOrEqual(falloffWeight('sharp', t))
    }
  })
})

describe('dragging the mask', () => {
  const corner = 61
  const cornerAt = facePointOf(corner)
  /** A move `size` away from the face's middle (x = 0.5) for a handle, and `down`. */
  const outwards = (landmark: number, size: number, down: number): Point => [
    Math.sign(unpackPoints(face)[facePointOf(landmark)]![0] - 0.5) * size,
    down,
  ]

  test('with radius 0 moves only the handle', () => {
    const moved = moves(face, dragPoints(face, corner, [0.03, -0.02], smooth(0)))
    moved.forEach(([dx, dy], i) => {
      if (i === cornerAt) {
        expect(dx).toBeCloseTo(0.03, 4)
        expect(dy).toBeCloseTo(-0.02, 4)
      } else {
        expect([dx, dy]).toEqual([0, 0])
      }
    })
  })

  test('moves the points round the handle by the falloff of their distance', () => {
    const radius = 0.12
    const delta: Point = [0.02, 0.01]
    for (const falloff of FALLOFFS) {
      const after = dragPoints(face, corner, delta, { radius, falloff, symmetric: false })
      const points = unpackPoints(face)
      const [hx, hy] = points[cornerAt]!
      moves(face, after).forEach(([dx, dy], i) => {
        if (FACE_PARTS.rightIris.includes(i) || FACE_PARTS.leftIris.includes(i)) return
        const weight = falloffWeight(
          falloff,
          Math.hypot(points[i]![0] - hx, points[i]![1] - hy) / radius,
        )
        expect(dx).toBeCloseTo(weight * delta[0], 4)
        expect(dy).toBeCloseTo(weight * delta[1], 4)
      })
    }
  })

  test('with symmetry moves the other side by the mirror image, exactly', () => {
    for (const handle of [corner, 116, 33, 172]) {
      const delta = outwards(handle, 0.025, -0.015)
      const moved = moves(face, dragPoints(face, handle, delta, smooth(0.2, true)))
      expect(moved[facePointOf(handle)]![0]).toBeCloseTo(delta[0], 4)
      expect(moved[facePointOf(handle)]![1]).toBeCloseTo(delta[1], 4)
      moved.forEach(([dx, dy], i) => {
        const [mx, my] = moved[FACE_POINT_MIRRORS[i]!]!
        expect(dx).toBeCloseTo(-mx, 4)
        expect(dy).toBeCloseTo(my, 4)
      })
    }
  })

  test('weighs each mirrored pair alike, however uneven the face', () => {
    const uneven = facePoints().map(([x, y]): Point => [x + 0.04 * (y - 0.5), y + 0.03 * x])
    const shares = proportionalShares(uneven, corner, smooth(0.25, true))
    shares.forEach((share, i) => {
      const partner = shares[FACE_POINT_MIRRORS[i]!]!
      expect(share.weight).toBe(partner.weight)
      expect(share.across).toBe(FACE_POINT_MIRRORS[i] === i ? 0 : -partner.across)
    })
    expect(shares[cornerAt]).toEqual({ weight: 1, across: 1 })
    expect(shares[FACE_POINT_MIRRORS[cornerAt]!]).toEqual({ weight: 1, across: -1 })
  })

  test('with symmetry mirrors about the middle of a tilted face', () => {
    const angle = (35 * Math.PI) / 180
    const turn = ([x, y]: Point, by: number): Point => [
      0.5 + (x - 0.5) * Math.cos(by) - (y - 0.5) * Math.sin(by),
      0.5 + (x - 0.5) * Math.sin(by) + (y - 0.5) * Math.cos(by),
    ]
    const tilted = facePoints().map((point) => turn(point, angle))
    const [ax, ay] = faceAcross(tilted)
    expect(ax).toBeCloseTo(Math.cos(angle), 9)
    expect(ay).toBeCloseTo(Math.sin(angle), 9)
    const before = packPoints(tilted)
    // Away from the middle, along the tilted face's own line across.
    const side = Math.sign(outwards(corner, 1, 0)[0])
    const after = dragPoints(before, corner, [side * 0.02, side * 0.015], smooth(0.2, true))
    // Turned back upright, the moves mirror across x.
    const upright = (flat: readonly number[]) => unpackPoints(flat).map((p) => turn(p, -angle))
    const was = upright(before)
    const moved = upright(after).map(([x, y], i): Point => [x - was[i]![0], y - was[i]![1]])
    expect(Math.hypot(...moved[cornerAt]!)).toBeCloseTo(0.025, 3)
    moved.forEach(([dx, dy], i) => {
      const [mx, my] = moved[FACE_POINT_MIRRORS[i]!]!
      expect(Math.abs(dx + mx)).toBeLessThan(2e-4)
      expect(Math.abs(dy - my)).toBeLessThan(2e-4)
    })
  })

  test('with symmetry keeps the middle on the middle', () => {
    const chin = 152
    const moved = moves(face, dragPoints(face, chin, [0.03, 0.02], smooth(0.15, true)))
    expect(moved[facePointOf(chin)]![0]).toBeCloseTo(0, 6)
    expect(moved[facePointOf(chin)]![1]).toBeCloseTo(0.02, 4)
    FACE_POINT_MIRRORS.forEach((partner, i) => {
      if (partner === i) expect(moved[i]![0]).toBeCloseTo(0, 6)
    })
  })

  test('with symmetry keeps each side on its side of the middle, however far it is pulled', () => {
    const inwards = outwards(corner, -0.4, 0)
    const after = unpackPoints(dragPoints(face, corner, inwards, smooth(0.3, true)))
    unpackPoints(face).forEach(([x], i) => {
      if (FACE_POINT_MIRRORS[i] === i || FACE_PARTS.rightIris.includes(i)) return
      if (FACE_PARTS.leftIris.includes(i)) return
      // Eased ever nearer, a point may come to rest on the middle as stored, never past it.
      expect((after[i]![0] - 0.5) * (x - 0.5)).toBeGreaterThanOrEqual(0)
    })
    // Pulled a little, the handle goes all the way.
    const little = outwards(corner, -0.01, 0.005)
    const moved = moves(face, dragPoints(face, corner, little, smooth(0.1, true)))
    expect(moved[cornerAt]![0]).toBeCloseTo(little[0], 4)
  })

  test('on a turned head foreshortens the far side, so the mask does not fold over', () => {
    const points = unpackPoints(TURNED)
    const [ax, ay] = faceAcross(points)
    const across = ([x, y]: Point) => x * ax + y * ay
    // The jaw's corner pulled in (along the face's own line across) and a little up.
    const delta: Point = [0.045 * ax + 0.01 * ay, 0.045 * ay - 0.01 * ax]
    const after = dragPoints(TURNED, 172, delta, smooth(0.18, true))
    const moved = unpackPoints(after)
    expect(turnedOver(TURNED, after)).toBe(0)
    // The far corner of the jaw stays on its side of the chin, moving in far less than the near one.
    const [chin, near, far] = [152, 172, 397].map(facePointOf) as [number, number, number]
    expect(across(points[far]!) > across(points[chin]!)).toBe(true)
    expect(across(moved[far]!) > across(moved[chin]!)).toBe(true)
    const inwards = (i: number) =>
      Math.abs(across(points[i]!) - across(points[chin]!)) -
      Math.abs(across(moved[i]!) - across(moved[chin]!))
    expect(inwards(near)).toBeGreaterThan(0.04)
    expect(inwards(far)).toBeGreaterThan(0)
    expect(inwards(far)).toBeLessThan(0.25 * inwards(near))
    // The same drag one-sided (no mirror) folds nothing either.
    expect(turnedOver(TURNED, dragPoints(TURNED, 172, delta, smooth(0.18)))).toBe(0)
  })
})

describe('the irises', () => {
  const lid = 159
  const [rightCentre] = FACE_PARTS.rightIris

  test('stay where the photo has them when a lid round them is put right', () => {
    const before = unpackPoints(face)
    for (const symmetric of [false, true]) {
      for (const handle of [lid, 145, 33]) {
        const after = unpackPoints(
          dragPoints(face, handle, [0.004, -0.01], smooth(0.05, symmetric)),
        )
        for (const i of [...FACE_PARTS.rightIris, ...FACE_PARTS.leftIris]) {
          expect(after[i]).toEqual(before[i]!)
        }
      }
    }
  })

  test('stay round when the lids round them are pulled', () => {
    for (const falloff of FALLOFFS) {
      const after = unpackPoints(
        dragPoints(face, lid, [0, -0.02], { radius: 0.03, falloff, symmetric: true }),
      )
      for (const iris of [FACE_PARTS.rightIris, FACE_PARTS.leftIris]) {
        for (const radius of irisRadii(after, iris)) expect(radius).toBeCloseTo(0.015, 3)
      }
    }
  })

  test('move whole, on their own, when grabbed, and stay in their eyes', () => {
    const after = unpackPoints(dragPoints(face, 468, [0.2, 0.1], smooth(0.3, true)))
    for (const radius of irisRadii(after, FACE_PARTS.rightIris))
      expect(radius).toBeCloseTo(0.015, 3)
    expect(inEye(after, FACE_PARTS.rightEye, after[rightCentre!]!)).toBe(true)
    // Nothing else moved: not the lids, nor the other iris.
    const before = unpackPoints(face)
    after.forEach((point, i) => {
      if (!FACE_PARTS.rightIris.includes(i)) expect(point).toEqual(before[i]!)
    })
  })

  test('are kept in their eyes when the lids close over them', () => {
    // The lower lid pulled up past the iris's middle, the upper lid barely moving.
    const after = unpackPoints(dragPoints(face, 145, [0, -0.035], smooth(0.02)))
    const centre = after[rightCentre!]!
    expect(centre).not.toEqual(unpackPoints(face)[rightCentre!]!)
    expect(inEye(after, FACE_PARTS.rightEye, centre)).toBe(true)
    for (const radius of irisRadii(after, FACE_PARTS.rightIris))
      expect(radius).toBeCloseTo(0.015, 3)
  })
})

describe('picking a handle', () => {
  test('finds the nearest handle within reach, and nothing further', () => {
    const points = unpackPoints(face)
    const [x, y] = points[facePointOf(61)]!
    expect(nearestHandle(face, [x + 0.002, y - 0.001], 0.02)).toBe(61)
    expect(nearestHandle(face, [x + 0.3, y + 0.3], 0.02)).toBe(null)
  })

  test('only among the handles, unless told what else may be grabbed', () => {
    const points = unpackPoints(face)
    const between = 39 // on the upper lip, not a handle
    const [x, y] = points[facePointOf(between)]!
    expect(nearestHandle(face, [x, y], 0.5)).not.toBe(between)
    expect(nearestHandle(face, [x, y], 0.5, [between, 61])).toBe(between)
  })
})
