import { describe, expect, test } from 'bun:test'
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import {
  BODY_SLIDERS,
  type BodySliderId,
  bodyShaper,
  bonePart,
  DEFAULT_BODY_SHAPE,
  hasBodyShape,
  readBodyShape,
} from './body-shape'

/** How far out from the upper arm's line the test's rings sit. */
const RADIUS = 0.05
/** Where along the upper arm (from the shoulder) they sit. */
const ALONG = 0.15

/** A point of the test's arm, and how much of it the upper arm and the hand carry. */
type ArmPoint = { at: [number, number, number]; upper: number; hand: number }

/**
 * A left arm held straight out along +X from a shoulder at (0.2, 1, 0) —
 * upper arm, forearm, hand — skinning `points`, with a material named as
 * one of a character's own meshes or as something it carries.
 */
function arm(points: ArmPoint[], material = 'm001_body', corners: number[] = []) {
  const upper = new Bone()
  upper.name = 'Bip01_L_UpperArm'
  upper.position.set(0.2, 1, 0)
  const forearm = new Bone()
  forearm.name = 'Bip01 L Forearm'
  forearm.position.set(0.3, 0, 0)
  const hand = new Bone()
  hand.name = 'Bip01_L_Hand'
  hand.position.set(0.25, 0, 0)
  upper.add(forearm)
  forearm.add(hand)

  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      points.flatMap((p) => p.at),
      3,
    ),
  )
  geometry.setAttribute(
    'skinIndex',
    new Uint16BufferAttribute(
      points.flatMap(() => [0, 2, 0, 0]),
      4,
    ),
  )
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(
      points.flatMap((p) => [p.upper, p.hand, 0, 0]),
      4,
    ),
  )
  if (corners.length > 0) geometry.setIndex(corners)
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial({ name: material }))
  mesh.add(upper)
  mesh.updateMatrixWorld(true)
  mesh.bind(new Skeleton([upper, forearm, hand]))
  return mesh
}

/** A ring of points round the middle of the upper arm, `at` along it. */
const ring = (upper: number, hand: number, along = ALONG): ArmPoint[] =>
  Array.from({ length: 8 }, (_, k) => {
    const angle = (k / 8) * Math.PI * 2
    return {
      at: [0.2 + along, 1 + RADIUS * Math.cos(angle), RADIUS * Math.sin(angle)],
      upper,
      hand,
    }
  })

/**
 * How far apart (m) along the upper arm the test's rings sit: points at one
 * spot are one point's copies, moved alike.
 */
const RING_GAP = 0.01

/** Three rings round the upper arm: all the upper arm's, half its and half the hand's, all the hand's. */
const rings = () => [
  ...ring(1, 0),
  ...ring(0.5, 0.5, ALONG + RING_GAP),
  ...ring(0, 1, ALONG + 2 * RING_GAP),
]

const average = (vectors: Vector3[]) =>
  vectors.reduce((sum, each) => sum.add(each), new Vector3()).divideScalar(vectors.length)

/** Whether points moved by `moves` keep their distances from one another: moved whole, turned or not. */
const keepsShape = (points: Vector3[], moves: Vector3[]) =>
  points.every((a, i) =>
    points.every((b, j) => {
      const apart = a.clone().add(moves[i]!).distanceTo(b.clone().add(moves[j]!))
      return Math.abs(apart - a.distanceTo(b)) < 1e-9
    }),
  )

/** Each point's move under a build, beside the point's offset from the upper arm's line. */
function moves(mesh: SkinnedMesh, sliders: Parameters<typeof bodyShaper>[0]['sliders']) {
  const move = bodyShaper({ height: 0, sliders })?.(mesh)
  if (!move) throw new Error('expected the arm to be reshaped')
  const position = mesh.geometry.getAttribute('position')
  return Array.from({ length: position.count }, (_, index) => {
    const point = new Vector3().fromBufferAttribute(position, index)
    const moved = new Vector3()
    move(point, index, moved)
    const out = point.clone().sub(new Vector3(point.x, 1, 0))
    return { out, moved }
  })
}

describe('a build as saved', () => {
  test('keeps the known sliders, in range, and drops the rest', () => {
    expect(
      readBodyShape({
        height: 3,
        sliders: { weight: 0.4, legs: -7, tail: 1, arms: 0, chest: 'big', waist: Number.NaN },
      }),
    ).toEqual({ height: 1, sliders: { weight: 0.4, legs: -1 } })
  })

  test('falls back to the default build for anything else', () => {
    expect(readBodyShape(null)).toBe(DEFAULT_BODY_SHAPE)
    expect(readBodyShape('tall')).toBe(DEFAULT_BODY_SHAPE)
    expect(readBodyShape({ height: 'tall' })).toEqual(DEFAULT_BODY_SHAPE)
  })

  test('counts as a change only when something is set', () => {
    expect(hasBodyShape(null)).toBe(false)
    expect(hasBodyShape(DEFAULT_BODY_SHAPE)).toBe(false)
    expect(hasBodyShape({ height: -0.2, sliders: {} })).toBe(true)
    expect(hasBodyShape({ height: 0, sliders: { hips: 0.5 } })).toBe(true)
  })
})

describe('bone parts', () => {
  test('are told apart by the end of the name, however it is spelt', () => {
    expect(bonePart('Bip01_L_UpperArm')).toBe('upperArm')
    expect(bonePart('Bip01 R Forearm')).toBe('forearm')
    expect(bonePart('Bip01_Spine1')).toBe('spine1')
    expect(bonePart('Bip01_Spine')).toBe('spine')
    expect(bonePart('Bip01_Head')).toBe('head')
    expect(bonePart('Bip01_MJaw')).toBeNull()
    expect(bonePart('Bip01_L_Finger01')).toBeNull()
  })
})

describe('the body shaper', () => {
  test('is nothing without a girth slider', () => {
    expect(bodyShaper(DEFAULT_BODY_SHAPE)).toBeNull()
    expect(bodyShaper({ height: 1, sliders: { shoulders: 1, headSize: -1 } })).toBeNull()
  })

  test('leaves meshes without skin weights be', () => {
    const plain = new Mesh(new BufferGeometry())
    plain.geometry.setAttribute('position', new Float32BufferAttribute([0, 1, 0], 3))
    expect(bodyShaper({ height: 0, sliders: { arms: 1 } })?.(plain)).toBeNull()
  })

  test('fills a limb out straight away from its line, as much as the bone carries each point', () => {
    const points = moves(arm(rings()), { arms: 1 })
    const whole = points.slice(0, 8)
    const half = points.slice(8, 16)
    const none = points.slice(16)
    for (const { out, moved } of whole) {
      // Straight out: along the offset, nothing along the arm.
      expect(moved.x).toBeCloseTo(0, 6)
      expect(moved.clone().normalize().dot(out.clone().normalize())).toBeCloseTo(1, 5)
      expect(moved.length()).toBeGreaterThan(RADIUS * 0.2)
    }
    whole.forEach(({ moved }, k) => {
      expect(half[k]!.moved.length()).toBeCloseTo(moved.length() / 2, 6)
    })
    for (const { moved } of none) expect(moved.length()).toBe(0)
  })

  test('slims a limb towards its line by as much', () => {
    const filled = moves(arm(rings()), { arms: 1 })
    const slimmed = moves(arm(rings()), { arms: -1 })
    slimmed.forEach(({ out, moved }, k) => {
      expect(moved.x).toBeCloseTo(0, 6)
      if (k < 16) expect(moved.dot(out)).toBeLessThan(0)
      expect(moved.length()).toBeCloseTo(filled[k]!.moved.length(), 6)
    })
  })

  test('scales with the slider', () => {
    const full = moves(arm(rings()), { arms: 1 })
    const part = moves(arm(rings()), { arms: 0.25 })
    part.forEach(({ moved }, k) => {
      expect(moved.length()).toBeCloseTo(full[k]!.moved.length() / 4, 6)
    })
  })

  test('carries a worn thing’s pieces off to the side along whole, but fills out what wraps the limb', () => {
    // A band round the upper arm (two rings joined into quads) and a pouch
    // hanging off its top, well clear of the arm's line.
    const band = [...ring(1, 0, ALONG - 0.02), ...ring(1, 0, ALONG + 0.02)]
    const pouch: ArmPoint[] = [
      { at: [0.35, 1.15, 0], upper: 1, hand: 0 },
      { at: [0.37, 1.17, 0], upper: 1, hand: 0 },
      { at: [0.35, 1.17, 0.02], upper: 1, hand: 0 },
    ]
    const quads = Array.from({ length: 8 }, (_, k) => {
      const next = (k + 1) % 8
      return [k, next, 8 + k, next, 8 + next, 8 + k]
    }).flat()
    const worn = moves(arm([...band, ...pouch], 'm001_equipment', [...quads, 16, 17, 18]), {
      arms: 1,
    })
    const [top, , , , bottom] = worn
    expect(top!.moved.y).toBeGreaterThan(0)
    expect(bottom!.moved.y).toBeLessThan(0)
    const carried = worn.slice(16).map(({ moved }) => moved)
    expect(
      keepsShape(
        pouch.map((p) => new Vector3(...p.at)),
        carried,
      ),
    ).toBe(true)
    // Its middle as far as its points would move on average, filled out with the arm.
    const own = moves(arm(pouch), { arms: 1 }).map(({ moved }) => moved)
    expect(average(carried).distanceTo(average(own))).toBeCloseTo(0, 6)
    expect(average(carried).y).toBeGreaterThan(0)
  })
})

/** A point of the test's whole body, and the bones that carry it (by name, with their weights). */
type BodyPoint = { at: [number, number, number]; bones: Record<string, number> }

/**
 * The test body's bones in the bind pose (Rocketbox's names and layout,
 * the arms held down and out), and the bone each hangs from.
 */
const SKELETON: [string, [number, number, number], string | null][] = [
  ['Bip01_Pelvis', [0, 0, 0], null],
  ['Bip01_Spine', [0, 0.15, 0], 'Bip01_Pelvis'],
  ['Bip01_Spine1', [0, 0.3, 0], 'Bip01_Spine'],
  ['Bip01_Spine2', [0, 0.45, 0], 'Bip01_Spine1'],
  ['Bip01_Neck', [0, 0.65, 0], 'Bip01_Spine2'],
  ['Bip01_Head', [0, 0.72, 0], 'Bip01_Neck'],
  ['Bip01_MJaw', [0, 0.74, 0.05], 'Bip01_Head'],
  ...(['L', 'R'] as const).flatMap((side) => {
    const x = side === 'L' ? 1 : -1
    const bone = (name: string) => `Bip01_${side}_${name}`
    return [
      [bone('Clavicle'), [0.08 * x, 0.6, 0], 'Bip01_Spine2'],
      [bone('UpperArm'), [0.23 * x, 0.57, 0], bone('Clavicle')],
      [bone('Forearm'), [0.43 * x, 0.37, 0], bone('UpperArm')],
      [bone('Hand'), [0.6 * x, 0.2, 0], bone('Forearm')],
      [bone('Finger0'), [0.65 * x, 0.15, 0], bone('Hand')],
      [bone('Thigh'), [0.1 * x, 0, 0], 'Bip01_Pelvis'],
      [bone('Calf'), [0.12 * x, -0.45, 0], bone('Thigh')],
      [bone('Foot'), [0.13 * x, -0.88, 0], bone('Calf')],
      [bone('Toe0'), [0.13 * x, -0.93, 0.1], bone('Foot')],
    ] as [string, [number, number, number], string | null][]
  }),
]

/** The test body's bones, freshly made and joined as SKELETON has them. */
function bones() {
  const made = new Map<string, Bone>()
  for (const [name, at, parent] of SKELETON) {
    const bone = new Bone()
    bone.name = name
    bone.position.set(...at)
    const above = parent ? made.get(parent)! : null
    if (above) {
      bone.position.sub(new Vector3(...SKELETON.find(([each]) => each === parent)![1]))
      above.add(bone)
    }
    made.set(name, bone)
  }
  return { root: made.get('Bip01_Pelvis')!, all: [...made.values()] }
}

/**
 * A skinned mesh of `points` on the test body's bones, with a material
 * named as one of a character's own meshes or as something worn, and its
 * triangles' `corners` (none unless given, so each point's move is the
 * sliders' alone).
 */
function skinned(
  points: BodyPoint[],
  skeleton: ReturnType<typeof bones>,
  material = 'm001_body',
  corners: number[] = [],
) {
  const names = skeleton.all.map((bone) => bone.name)
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      points.flatMap((p) => p.at),
      3,
    ),
  )
  const carried = points.map((p) => Object.entries(p.bones).slice(0, 4))
  const four = <T>(list: T[], none: T) => [...list, ...Array(4 - list.length).fill(none)]
  geometry.setAttribute(
    'skinIndex',
    new Uint16BufferAttribute(
      carried.flatMap((list) =>
        four(
          list.map(([name]) => names.indexOf(name)),
          0,
        ),
      ),
      4,
    ),
  )
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(
      carried.flatMap((list) =>
        four(
          list.map(([, weight]) => weight),
          0,
        ),
      ),
      4,
    ),
  )
  geometry.setIndex(corners)
  return new SkinnedMesh(geometry, new MeshBasicMaterial({ name: material }))
}

/** One mesh of `points` on a fresh test body, bound in the bind pose. */
function trunk(points: BodyPoint[], material?: string, corners?: number[]) {
  const skeleton = bones()
  const mesh = skinned(points, skeleton, material, corners)
  mesh.add(skeleton.root)
  mesh.updateMatrixWorld(true)
  mesh.bind(new Skeleton(skeleton.all))
  return mesh
}

/** Meshes of `points` (as [points, material, corners]) on one fresh test body, bound together. */
function dressed(...meshes: [BodyPoint[], string, number[]][]) {
  const skeleton = bones()
  const made = meshes.map(([points, material, corners]) =>
    skinned(points, skeleton, material, corners),
  )
  const body = new Group()
  body.add(skeleton.root, ...made)
  body.updateMatrixWorld(true)
  const bound = new Skeleton(skeleton.all)
  for (const mesh of made) mesh.bind(bound)
  return made
}

/** Each point's move under a build (none where the shaper leaves the mesh be). */
function movesOn(mesh: Mesh, sliders: Parameters<typeof bodyShaper>[0]['sliders']) {
  const move = bodyShaper({ height: 0, sliders })?.(mesh)
  const position = mesh.geometry.getAttribute('position')
  return Array.from({ length: position.count }, (_, index) => {
    const moved = new Vector3()
    move?.(new Vector3().fromBufferAttribute(position, index), index, moved)
    return moved
  })
}

/**
 * Eight points round a vertical line through `centre`, carried by `bones`:
 * the first to the body's left (+x), the third to its front (+z), the
 * fifth to its right, the seventh to its back.
 */
const around = (
  centre: [number, number, number],
  radius: number,
  carried: Record<string, number>,
): BodyPoint[] =>
  Array.from({ length: 8 }, (_, k) => {
    const angle = (k / 8) * Math.PI * 2
    return {
      at: [centre[0] + radius * Math.cos(angle), centre[1], centre[2] + radius * Math.sin(angle)],
      bones: carried,
    }
  })

/** How far out from the spine the test's chest and belly rings sit. */
const TRUNK_RADIUS = 0.12
/** Where the test's rings sit up the spine: the chest two thirds of the way to the neck, the belly a sixth. */
const CHEST_HEIGHT = 0.45
const BELLY_HEIGHT = 0.1
const [LEFT, FRONT, RIGHT, BACK] = [0, 2, 4, 6]

const allAt = (value: number) =>
  Object.fromEntries(BODY_SLIDERS.map((slider) => [slider.id, value])) as Record<
    BodySliderId,
    number
  >

describe('the body shaper on a whole body', () => {
  const chest = () => around([0, CHEST_HEIGHT, 0], TRUNK_RADIUS, { Bip01_Spine2: 1 })
  const belly = () => around([0, BELLY_HEIGHT, 0], TRUNK_RADIUS, { Bip01_Spine: 1 })

  test('fills out the chest in front, a little at the sides and not at all behind', () => {
    const moved = movesOn(trunk(chest()), { chest: 1 })
    expect(moved[FRONT]!.z).toBeGreaterThan(TRUNK_RADIUS * 0.3)
    expect(moved[FRONT]!.x).toBeCloseTo(0, 6)
    expect(moved[BACK]!.length()).toBeCloseTo(0, 6)
    expect(moved[LEFT]!.x).toBeGreaterThan(0)
    expect(moved[LEFT]!.x).toBeLessThan(moved[FRONT]!.z / 2)
    expect(moved[RIGHT]!.x).toBeCloseTo(-moved[LEFT]!.x, 6)
  })

  test('reaches the chest but not the belly, and the belly but not the chest', () => {
    const body = trunk([...chest(), ...belly()])
    const bigChest = movesOn(body, { chest: 1 })
    const bigBelly = movesOn(body, { belly: 1 })
    for (const moved of bigChest.slice(8)) expect(moved.length()).toBe(0)
    for (const moved of bigBelly.slice(0, 8)) expect(moved.length()).toBe(0)
    expect(bigBelly[8 + FRONT]!.z).toBeGreaterThan(TRUNK_RADIUS * 0.3)
    expect(bigBelly[8 + BACK]!.length()).toBeCloseTo(0, 6)
  })

  test('widens the waist and the hips to the sides and behind', () => {
    const waist = movesOn(trunk(around([0, 0.25, 0], TRUNK_RADIUS, { Bip01_Spine1: 1 })), {
      waist: 1,
    })
    expect(waist[LEFT]!.x).toBeGreaterThan(TRUNK_RADIUS * 0.2)
    expect(waist[RIGHT]!.x).toBeLessThan(-TRUNK_RADIUS * 0.2)
    const hips = movesOn(trunk(around([0, -0.05, 0], TRUNK_RADIUS, { Bip01_Pelvis: 1 })), {
      hips: 1,
    })
    expect(hips[LEFT]!.x).toBeGreaterThan(TRUNK_RADIUS * 0.2)
    expect(hips[BACK]!.z).toBeLessThan(-TRUNK_RADIUS * 0.15)
    expect(hips[FRONT]!.z).toBeLessThan(hips[LEFT]!.x / 3)
  })

  test('fills the limbs out alike on the left and the right, their insides the least', () => {
    const thigh = (x: number) =>
      around([x * 0.109, -0.2, 0], 0.07, { [`Bip01_${x > 0 ? 'L' : 'R'}_Thigh`]: 1 })
    const moved = movesOn(trunk([...thigh(1), ...thigh(-1)]), { legs: 1 })
    for (let k = 0; k < 8; k++) {
      const left = moved[k]!
      const right = moved[8 + ((12 - k) % 8)]!
      expect(right.x).toBeCloseTo(-left.x, 6)
      expect(right.z).toBeCloseTo(left.z, 6)
    }
    // The left thigh's inside is its right (towards the middle), and the other way round.
    expect(moved[RIGHT]!.length()).toBeLessThan(moved[LEFT]!.length() * 0.6)
    expect(moved[8 + LEFT]!.length()).toBeLessThan(moved[8 + RIGHT]!.length() * 0.6)
  })

  test('never pushes a thigh’s inside across the body’s middle', () => {
    const inner: BodyPoint[] = [
      { at: [0.02, -0.2, 0], bones: { Bip01_L_Thigh: 1 } },
      { at: [-0.02, -0.2, 0], bones: { Bip01_R_Thigh: 1 } },
    ]
    const [left, right] = movesOn(trunk(inner), { legs: 1, muscle: 1, weight: 1 })
    expect(0.02 + left!.x).toBeGreaterThan(0)
    expect(-0.02 + right!.x).toBeLessThan(0)
  })

  test('never thins a body by more than 60% of its girth, however the sliders add up', () => {
    const moved = movesOn(trunk(chest()), allAt(-1))
    expect(moved[FRONT]!.z).toBeCloseTo(-0.6 * TRUNK_RADIUS, 6)
    for (const each of moved) expect(each.length()).toBeLessThanOrEqual(0.6 * TRUNK_RADIUS + 1e-9)
  })

  test('fills out the neck but not the head beside it', () => {
    const neck = around([0, 0.68, 0], 0.05, { Bip01_Neck: 1 })
    const head = around([0, 0.685, 0], 0.05, { Bip01_Head: 1 })
    const moved = movesOn(trunk([...neck, ...head]), { neck: 1 })
    for (const each of moved.slice(0, 8)) expect(each.length()).toBeGreaterThan(0.005)
    for (const each of moved.slice(8)) expect(each.length()).toBe(0)
  })

  test('never moves what the head, the hands or the feet carry, wherever it hangs', () => {
    const still: BodyPoint[] = [
      // A long beard, the head's, hanging in front of the chest.
      { at: [0.02, 0.5, 0.13], bones: { Bip01_Head: 1 } },
      { at: [0, 0.76, 0.1], bones: { Bip01_Head: 0.5, Bip01_MJaw: 0.5 } },
      { at: [0.61, 0.19, 0.03], bones: { Bip01_L_Hand: 1 } },
      { at: [-0.66, 0.14, 0], bones: { Bip01_R_Finger0: 1 } },
      { at: [0.14, -0.9, 0.05], bones: { Bip01_L_Foot: 1 } },
      { at: [-0.13, -0.94, 0.12], bones: { Bip01_R_Toe0: 1 } },
    ]
    const body = trunk([...chest(), ...still])
    const builds = [
      ...BODY_SLIDERS.flatMap(({ id }) => [{ [id]: 1 }, { [id]: -1 }]),
      allAt(1),
      allAt(-1),
    ]
    for (const sliders of builds) {
      for (const moved of movesOn(body, sliders).slice(8)) expect(moved.length()).toBe(0)
    }
  })

  test('moves the copies of a point at one spot alike, so a texture seam never opens', () => {
    const copies: BodyPoint[] = [
      { at: [0.05, CHEST_HEIGHT, TRUNK_RADIUS], bones: { Bip01_Spine2: 1 } },
      {
        at: [0.05, CHEST_HEIGHT, TRUNK_RADIUS],
        bones: { Bip01_Spine2: 0.5, Bip01_L_Clavicle: 0.5 },
      },
    ]
    const [one, other] = movesOn(trunk(copies), { chest: 1 })
    expect(one!.z).toBeGreaterThan(0.01)
    expect(one!.toArray()).toEqual(other!.toArray())
  })

  test('fills a body made all in one piece out like one', () => {
    // Female_Adult_16's one material names only the character.
    const pouch: BodyPoint[] = [
      { at: [0.2, BELLY_HEIGHT, 0.25], bones: { Bip01_Spine: 1 } },
      { at: [0.22, BELLY_HEIGHT, 0.27], bones: { Bip01_Spine: 1 } },
      { at: [0.2, BELLY_HEIGHT + 0.02, 0.27], bones: { Bip01_Spine: 1 } },
    ]
    const at = pouch.map((point) => new Vector3(...point.at))
    expect(keepsShape(at, movesOn(trunk(pouch, 'f204', [0, 1, 2]), { belly: 1 }))).toBe(false)
    expect(keepsShape(at, movesOn(trunk(pouch, 'f204_equipment', [0, 1, 2]), { belly: 1 }))).toBe(
      true,
    )
  })
})

/** Whether a triangle faces the way it did, with its corners moved. */
function facesAsBefore(corners: Vector3[], moves: Vector3[]) {
  const [a, b, c] = corners as [Vector3, Vector3, Vector3]
  const before = b.clone().sub(a).cross(c.clone().sub(a))
  const [ma, mb, mc] = corners.map((corner, k) => corner.clone().add(moves[k]!)) as [
    Vector3,
    Vector3,
    Vector3,
  ]
  return mb.sub(ma).cross(mc.sub(ma)).dot(before) > 0
}

describe('something hanging from a belt over the hip', () => {
  // A belt round the hips (two rings joined into quads)...
  const belt = [
    ...around([0, 0.07, 0], 0.165, { Bip01_Pelvis: 1 }),
    ...around([0, 0.09, 0], 0.165, { Bip01_Pelvis: 1 }),
  ]
  const beltCorners = Array.from({ length: 8 }, (_, k) => {
    const next = (k + 1) % 8
    return [k, next, 8 + k, next, 8 + next, 8 + k]
  }).flat()
  // ...the hip's side below it...
  const hip: BodyPoint[] = [{ at: [0.165, -0.15, 0], bones: { Bip01_Pelvis: 1 } }]
  // ...and a tool down the side, hung from the belt at its top and lying on the hip at its foot.
  const tool: BodyPoint[] = [
    { at: [0.17, 0.075, 0], bones: { Bip01_Pelvis: 1 } },
    { at: [0.17, -0.145, 0], bones: { Bip01_Pelvis: 1 } },
    { at: [0.175, -0.035, 0.005], bones: { Bip01_Pelvis: 1 } },
  ]

  test('swings out at its foot as the hip fills out more than the belt, keeping its shape', () => {
    const [, , worn] = dressed(
      [belt, 'm001_equipment', beltCorners],
      [hip, 'm001_body', []],
      [tool, 'm001_equipment', [0, 1, 2]],
    )
    const [top, foot] = movesOn(worn!, { hips: 1 })
    const at = tool.map((point) => new Vector3(...point.at))
    expect(keepsShape(at, movesOn(worn!, { hips: 1 }))).toBe(true)
    expect(foot!.x - top!.x).toBeGreaterThan(0.012)
    // Keeping to both, near enough: as far out as the body would fill it at each end.
    const [topFilled, footFilled] = movesOn(dressed([tool, 'm001_body', []])[0]!, { hips: 1 })
    expect(top!.distanceTo(topFilled!)).toBeLessThan(0.004)
    expect(foot!.distanceTo(footFilled!)).toBeLessThan(0.004)
  })
})

describe('folds', () => {
  // A needle of a solid (every edge shared), from under the chest up into
  // it: the chest filling out carries its tip forward past its base.
  const needle: BodyPoint[] = [
    { at: [0.001, 0.3, 0.15], bones: { Bip01_Spine1: 1 } },
    { at: [0, 0.31, 0.1512], bones: { Bip01_Spine1: 1 } },
    { at: [0.002, 0.45, 0.149], bones: { Bip01_Spine2: 1 } },
    { at: [0.0005, 0.305, 0.1495], bones: { Bip01_Spine1: 1 } },
  ]
  const faces = [
    [0, 1, 2],
    [0, 3, 1],
    [1, 3, 2],
    [2, 3, 0],
  ]

  test('are eased the least it takes for no triangle to turn over', () => {
    const loose = movesOn(trunk(needle), { chest: 1 })
    const at = needle.map((point) => new Vector3(...point.at))
    const turned = faces.filter(
      (face) =>
        !facesAsBefore(
          face.map((k) => at[k]!),
          face.map((k) => loose[k]!),
        ),
    )
    expect(turned.length).toBeGreaterThan(0)
    const eased = movesOn(trunk(needle, 'm001_body', faces.flat()), { chest: 1 })
    for (const face of faces) {
      expect(
        facesAsBefore(
          face.map((k) => at[k]!),
          face.map((k) => eased[k]!),
        ),
      ).toBe(true)
    }
    eased.forEach((move, k) => {
      expect(move.distanceTo(loose[k]!)).toBeLessThan(0.005)
    })
  })

  test('leave be what the build does not reach, easing the rest the more', () => {
    // The needle's base the head's (a beard's), its tip the chest's.
    const bearded = needle.map((point, k) =>
      k === 2 ? point : { ...point, bones: { Bip01_Head: 1 } },
    )
    const eased = movesOn(trunk(bearded, 'm001_body', faces.flat()), { chest: 1 })
    for (const k of [0, 1, 3]) expect(eased[k]!.length()).toBe(0)
    const at = bearded.map((point) => new Vector3(...point.at))
    for (const face of faces) {
      expect(
        facesAsBefore(
          face.map((k) => at[k]!),
          face.map((k) => eased[k]!),
        ),
      ).toBe(true)
    }
  })

  test('leave the surface’s edge where it was, so what meets it there still does', () => {
    // The needle opened up: a face gone, its corners are the surface's edge.
    const open = faces.filter((_, k) => k !== 1)
    const loose = movesOn(trunk(needle), { chest: 1 })
    const eased = movesOn(trunk(needle, 'm001_body', open.flat()), { chest: 1 })
    for (const k of faces[1]!) expect(eased[k]!.toArray()).toEqual(loose[k]!.toArray())
    const at = needle.map((point) => new Vector3(...point.at))
    for (const face of open) {
      expect(
        facesAsBefore(
          face.map((k) => at[k]!),
          face.map((k) => eased[k]!),
        ),
      ).toBe(true)
    }
  })
})

describe('worn things', () => {
  // A band round the upper arm (two rings joined into quads).
  const band = [...ring(1, 0, ALONG - 0.02), ...ring(1, 0, ALONG + 0.02)]
  const bandCorners = Array.from({ length: 8 }, (_, k) => {
    const next = (k + 1) % 8
    return [k, next, 8 + k, next, 8 + next, 8 + k]
  }).flat()
  // A pouch hanging from the band's top, just touching it there.
  const pouch: ArmPoint[] = [
    { at: [0.335, 1.056, 0], upper: 1, hand: 0 },
    { at: [0.35, 1.1, 0.01], upper: 1, hand: 0 },
    { at: [0.36, 1.1, -0.01], upper: 1, hand: 0 },
    { at: [0.34, 1.12, 0], upper: 1, hand: 0 },
  ]
  const pouchCorners = [0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0]
  // Something in the pouch: a piece of its own, not joined to it.
  const inside: ArmPoint[] = [
    { at: [0.352, 1.1, 0.006], upper: 1, hand: 0 },
    { at: [0.356, 1.104, 0.004], upper: 1, hand: 0 },
    { at: [0.354, 1.099, 0.002], upper: 1, hand: 0 },
  ]
  const shift = (corners: number[], by: number) => corners.map((corner) => corner + by)

  test('keep what hangs together as one, held where it touches what wraps the body', () => {
    const worn = moves(
      arm([...band, ...pouch, ...inside], 'm001_equipment', [
        ...bandCorners,
        ...shift(pouchCorners, 16),
        ...shift([0, 1, 2], 20),
      ]),
      { arms: 1 },
    ).map(({ moved }) => moved)
    const [first, ...rest] = worn.slice(16)
    for (const moved of rest) expect(moved.toArray()).toEqual(first!.toArray())
    // As far as the band moves where the pouch hangs from it (its top).
    expect(first!.distanceTo(worn[0]!)).toBeLessThan(0.003)
    expect(first!.y).toBeGreaterThan(0.01)
  })

  /** Meshes of the upper arm's points (all its), bound together to one skeleton in one body. */
  function together(...meshes: [ArmPoint[], number[], string][]) {
    const upper = new Bone()
    upper.name = 'Bip01_L_UpperArm'
    upper.position.set(0.2, 1, 0)
    const forearm = new Bone()
    forearm.name = 'Bip01_L_Forearm'
    forearm.position.set(0.3, 0, 0)
    upper.add(forearm)
    const skeleton = new Skeleton([upper, forearm])
    const made = meshes.map(([points, corners, material]) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(
          points.flatMap((p) => p.at),
          3,
        ),
      )
      geometry.setAttribute(
        'skinIndex',
        new Uint16BufferAttribute(Array(points.length * 4).fill(0), 4),
      )
      geometry.setAttribute(
        'skinWeight',
        new Float32BufferAttribute(
          points.flatMap(() => [1, 0, 0, 0]),
          4,
        ),
      )
      geometry.setIndex(corners)
      return new SkinnedMesh(geometry, new MeshBasicMaterial({ name: material }))
    })
    const body = new Group()
    body.add(upper, ...made)
    body.updateMatrixWorld(true)
    for (const mesh of made) mesh.bind(skeleton)
    return made
  }

  test('keep a thing in one mesh together with what holds it in another', () => {
    const [holster, pistol] = together(
      [[...band, ...pouch], [...bandCorners, ...shift(pouchCorners, 16)], 'm001_equipment'],
      [inside, [0, 1, 2], 'm001_pistol'],
    )
    const [held] = movesOn(holster!, { arms: 1 }).slice(16)
    for (const moved of movesOn(pistol!, { arms: 1 })) {
      expect(moved.toArray()).toEqual(held!.toArray())
    }
  })

  test('ride with the body where they rest on it, not as far as they stand out', () => {
    // The band as the body's own sleeve, the pouch resting on its top.
    const [, worn] = together(
      [band, bandCorners, 'm001_body'],
      [pouch, pouchCorners, 'm001_equipment'],
    )
    const rested = movesOn(worn!, { arms: 1 })
    // As the body would fill it out, were it the body's.
    const filled = movesOn(together([pouch, pouchCorners, 'm001_body'])[0]!, { arms: 1 })
    // Held by the sleeve at its first point only: all of it as far as that point moves,
    // less than the rest of it stands out to.
    for (const moved of rested) expect(moved.distanceTo(filled[0]!)).toBeLessThan(1e-9)
    expect(average(rested).y).toBeLessThan(average(filled).y - 0.002)
  })

  test('keep to the head what the head carries part of, a strap from a helmet', () => {
    const strap: BodyPoint[] = [
      { at: [0.1, 0.62, 0.1], bones: { Bip01_Head: 1 } },
      { at: [0.12, CHEST_HEIGHT, 0.14], bones: { Bip01_Spine2: 1 } },
      { at: [0.13, CHEST_HEIGHT - 0.02, 0.13], bones: { Bip01_Spine2: 1 } },
    ]
    const [top, ...rest] = movesOn(dressed([strap, 'm001_helmet', [0, 1, 2]])[0]!, { chest: 1 })
    expect(top!.length()).toBe(0)
    for (const moved of rest) expect(moved.z).toBeGreaterThan(0.01)
  })

  test('fill out with the body what hangs clear piece by piece but wraps it together', () => {
    // Four plates round the upper arm, each off to one side, edge to edge.
    const plates = Array.from({ length: 4 }, (_, k): ArmPoint[] =>
      [-43, 0, 43].map((degrees, corner) => {
        const angle = ((k * 90 + degrees) * Math.PI) / 180
        const radius = corner === 1 ? 0.065 : 0.06
        return {
          at: [0.2 + ALONG, 1 + radius * Math.cos(angle), radius * Math.sin(angle)],
          upper: 1,
          hand: 0,
        }
      }),
    ).flat()
    const corners = Array.from({ length: 4 }, (_, k) => [3 * k, 3 * k + 1, 3 * k + 2]).flat()
    const worn = moves(arm(plates, 'm001_equipment', corners), { arms: 1 })
    const [top, bottom] = [worn[1]!.moved, worn[7]!.moved]
    expect(top.y).toBeGreaterThan(0.01)
    expect(bottom.y).toBeLessThan(-0.01)
  })

  test('ride whole even held along a stretch, keeping to where they are held on average', () => {
    // A flap from the band's top round to its front, touching it at both.
    const flap: ArmPoint[] = [
      { at: [0.33, 1.056, 0], upper: 1, hand: 0 },
      { at: [0.33, 1, 0.056], upper: 1, hand: 0 },
      { at: [0.33, 1.06, 0.06], upper: 1, hand: 0 },
    ]
    const worn = moves(arm([...band, ...flap], 'm001_equipment', [...bandCorners, 16, 17, 18]), {
      arms: 1,
    }).map(({ moved }) => moved)
    const [top, front] = worn.slice(16)
    expect(
      keepsShape(
        flap.map((p) => new Vector3(...p.at)),
        worn.slice(16),
      ),
    ).toBe(true)
    // Between the band's top's move up and its front's forward.
    expect(average([top!, front!]).distanceTo(average([worn[0]!, worn[2]!]))).toBeLessThan(0.003)
  })
})
