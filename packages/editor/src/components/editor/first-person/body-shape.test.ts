import { describe, expect, test } from 'bun:test'
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { bodyShaper, bonePart, DEFAULT_BODY_SHAPE, hasBodyShape, readBodyShape } from './body-shape'

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

/** Three rings round the upper arm: all the upper arm's, half its and half the hand's, all the hand's. */
const rings = () => [...ring(1, 0), ...ring(0.5, 0.5), ...ring(0, 1)]

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
    const [first, second, third] = worn.slice(16).map(({ moved }) => moved)
    expect(second).toEqual(first!)
    expect(third).toEqual(first!)
    // As far as its points would move on average, filled out with the arm.
    const own = moves(arm(pouch), { arms: 1 }).map(({ moved }) => moved)
    const average = own.reduce((sum, each) => sum.add(each), new Vector3()).divideScalar(3)
    expect(first!.distanceTo(average)).toBeCloseTo(0, 6)
    expect(first!.y).toBeGreaterThan(0)
  })
})
