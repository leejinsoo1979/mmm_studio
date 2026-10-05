import { describe, expect, test } from 'bun:test'
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { curve, halfWidth, LITTLE_TOE_TIP, TOE_TIP } from './bare-foot'
import { feetShaper, footGeometry } from './feet'
import { unpackFeet } from './feet-paint'

/** The ground the test's shoes stand on, and their top edge, where the leg carries on. */
const GROUND = -1
const EDGE = -0.9
/** The left shoe: a box round its ankle's x, from its heel (z = −0.1) to its toe (z = 0.24). */
const SHOE = { x: 0.13, half: 0.06, back: -0.1, front: 0.24 }
/** Steps a side each face of the test's boxes is split into. */
const STEPS = 6

/**
 * A skeleton's legs as Rocketbox names and stands them in the bind pose —
 * calf (the knee), foot (the ankle) and toe (the ball of the foot), left
 * (bones 1–3) and right (4–6) — but with the feet pointing straight ahead.
 */
function legBones() {
  const pelvis = new Bone()
  pelvis.name = 'Bip01_Pelvis'
  const bones = [pelvis]
  for (const side of [1, -1]) {
    const letter = side > 0 ? 'L' : 'R'
    const calf = new Bone()
    calf.name = `Bip01_${letter}_Calf`
    calf.position.set(0.12 * side, -0.45, 0)
    const foot = new Bone()
    foot.name = `Bip01 ${letter} Foot`
    foot.position.set(0.01 * side, -0.436, -0.03)
    const toe = new Bone()
    toe.name = `Bip01_${letter}_Toe0`
    toe.position.set(0, -0.11, 0.15)
    pelvis.add(calf)
    calf.add(foot)
    foot.add(toe)
    bones.push(calf, foot, toe)
  }
  return bones
}

type Parts = {
  positions: number[]
  joints: number[]
  weights: number[]
  uvs: number[]
  corners: number[]
}

/**
 * A face of the test's boxes, `origin` plus some of `across` and `upward`,
 * split STEPS a side, skinned wholly to `bone`: a texture island of its own.
 */
function face(parts: Parts, origin: number[], across: number[], upward: number[], bone: number) {
  const first = parts.positions.length / 3
  for (let j = 0; j <= STEPS; j++) {
    for (let i = 0; i <= STEPS; i++) {
      for (let k = 0; k < 3; k++) {
        parts.positions.push(origin[k]! + (across[k]! * i + upward[k]! * j) / STEPS)
      }
      parts.joints.push(bone, 0, 0, 0)
      parts.weights.push(1, 0, 0, 0)
      parts.uvs.push(i / STEPS, j / STEPS)
    }
  }
  for (let j = 0; j < STEPS; j++) {
    for (let i = 0; i < STEPS; i++) {
      const a = first + j * (STEPS + 1) + i
      parts.corners.push(a, a + 1, a + STEPS + 1, a + 1, a + STEPS + 2, a + STEPS + 1)
    }
  }
}

/**
 * A pair of shoes, each an open-topped box skinned to its foot, and a leg
 * rising from each shoe's top edge skinned to its calf (the leg's bottom
 * edge shares the shoe's top edge's spots, as a trouser leg's does), the
 * right a mirror image of the left; with a material named as a
 * character's body (or `material`).
 */
function feetBody(material = 'm001_body') {
  const parts: Parts = { positions: [], joints: [], weights: [], uvs: [], corners: [] }
  for (const side of [1, -1]) {
    const [calf, foot] = side > 0 ? [1, 2] : [4, 5]
    const inner = side * (SHOE.x - SHOE.half)
    const width = side * 2 * SHOE.half
    const length = SHOE.front - SHOE.back
    const low = [inner, GROUND, SHOE.back]
    // The shoe: sole, back, front and sides.
    face(parts, low, [width, 0, 0], [0, 0, length], foot)
    face(parts, low, [width, 0, 0], [0, EDGE - GROUND, 0], foot)
    face(parts, [inner, GROUND, SHOE.front], [width, 0, 0], [0, EDGE - GROUND, 0], foot)
    face(parts, low, [0, 0, length], [0, EDGE - GROUND, 0], foot)
    face(parts, [inner + width, GROUND, SHOE.back], [0, 0, length], [0, EDGE - GROUND, 0], foot)
    // The leg over it.
    const top = [inner, EDGE, SHOE.back]
    face(parts, top, [width, 0, 0], [0, 0.4, 0], calf)
    face(parts, [inner, EDGE, SHOE.front], [width, 0, 0], [0, 0.4, 0], calf)
    face(parts, top, [0, 0, length], [0, 0.4, 0], calf)
    face(parts, [inner + width, EDGE, SHOE.back], [0, 0, length], [0, 0.4, 0], calf)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(parts.positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(parts.uvs, 2))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(parts.joints, 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(parts.weights, 4))
  geometry.setIndex(parts.corners)
  const bones = legBones()
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial({ name: material }))
  mesh.add(bones[0]!)
  mesh.updateMatrixWorld(true)
  mesh.bind(new Skeleton(bones))
  return mesh
}

/** Each point of a body's mesh, whether it is a shoe's, and where the feet's shaper moves it to. */
function reshaped(mesh: SkinnedMesh, wear: 'socks' | 'bare' = 'bare') {
  const move = feetShaper({ wear, color: null })?.(mesh)
  if (!move) throw new Error('expected the shoes to be reshaped')
  const position = mesh.geometry.getAttribute('position')
  const foot = mesh.geometry.getAttribute('skinIndex')
  return Array.from({ length: position.count }, (_, index) => {
    const point = new Vector3().fromBufferAttribute(position, index)
    const moved = new Vector3()
    move(point, index, moved)
    const bone = foot.getX(index)
    return { index, point, moved, to: point.clone().add(moved), shoe: bone === 2 || bone === 5 }
  })
}

describe('the shoes taken in to feet', () => {
  test('leaves shoes on', () => {
    expect(feetShaper({ wear: 'shoes', color: null })).toBeNull()
  })

  test('reshapes only the body mesh', () => {
    const shaper = feetShaper({ wear: 'bare', color: null })!
    expect(shaper(feetBody('m001_tools'))).toBeNull()
    expect(shaper(feetBody())).not.toBeNull()
  })

  test("moves only the shoes' points, and not those on the edge the leg carries on from", () => {
    const points = reshaped(feetBody())
    for (const { shoe, point, moved } of points) {
      if (!shoe || Math.abs(point.y - EDGE) < 1e-6) expect(moved.length()).toBe(0)
    }
    const moved = points.filter(({ shoe, moved }) => shoe && moved.length() > 1e-4)
    expect(moved.length).toBeGreaterThan(points.filter(({ shoe }) => shoe).length / 2)
  })

  test('keeps the sole flat on the ground, and nothing under it', () => {
    for (const { shoe, point, to } of reshaped(feetBody())) {
      if (!shoe) continue
      expect(to.y).toBeGreaterThanOrEqual(GROUND - 1e-6)
      if (point.y === GROUND) expect(to.y).toBeCloseTo(GROUND, 6)
    }
  })

  test('narrows the foot and lowers its toes, and never grows it', () => {
    const points = reshaped(feetBody()).filter(({ shoe, point }) => shoe && point.x > 0)
    const below = points.filter(({ point }) => point.y < EDGE - 0.04)
    const widest = Math.max(...below.map(({ to }) => Math.abs(to.x - SHOE.x)))
    expect(widest).toBeLessThan(SHOE.half * 0.85)
    const toes = points.filter(({ point }) => point.z === SHOE.front && point.y < EDGE - 0.04)
    for (const { point, to } of toes) expect(to.y).toBeLessThan(point.y - 0.01)
    for (const { point, to } of points) {
      expect(Math.abs(to.x - SHOE.x)).toBeLessThanOrEqual(SHOE.half + 1e-6)
      expect(to.y).toBeLessThanOrEqual(point.y + 1e-6)
    }
  })

  test('shapes the right foot as the mirror image of the left', () => {
    const points = reshaped(feetBody())
    const half = points.length / 2
    for (const { index, moved } of points.slice(0, half)) {
      const mirror = points[index + half]!.moved
      expect(mirror.x).toBeCloseTo(-moved.x, 9)
      expect(mirror.y).toBeCloseTo(moved.y, 9)
      expect(mirror.z).toBeCloseTo(moved.z, 9)
    }
  })

  test('makes a foot in a sock a little fuller than a bare one', () => {
    const width = (wear: 'socks' | 'bare') =>
      Math.max(
        ...reshaped(feetBody(), wear)
          .filter(({ shoe, point }) => shoe && point.x > 0 && point.y < EDGE - 0.04)
          .map(({ to }) => Math.abs(to.x - SHOE.x)),
      )
    expect(width('socks')).toBeGreaterThan(width('bare'))
  })
})

describe("the feet's geometry for their paint", () => {
  test("gives each foot's shoe and leg triangles, placed on the foot, and its frame", () => {
    const geometry = footGeometry(feetBody())
    expect(geometry.frames.map((frame) => frame.side)).toEqual(['left', 'right'])
    const [left, right] = geometry.frames as [
      (typeof geometry.frames)[0],
      (typeof geometry.frames)[0],
    ]
    expect(left.ankle[0]).toBeCloseTo(0.13, 6)
    expect(right.outward[0]).toBeLessThan(0)
    expect(left.outward[0]).toBeGreaterThan(0)
    // The knee (the calf bone) is 0.55 up from the ground, in the foot's lengths.
    expect(left.knee * left.length).toBeCloseTo(0.55, 5)
    const triangles = unpackFeet(geometry)
    for (const side of ['left', 'right'] as const) {
      expect(triangles.filter((tri) => tri.side === side && tri.part === 'shoe').length).toBe(
        5 * STEPS * STEPS * 2,
      )
      expect(triangles.some((tri) => tri.side === side && tri.part === 'leg')).toBe(true)
    }
    // Across is measured from the foot's middle line: the feet mirror.
    const across = (side: 'left' | 'right') =>
      triangles
        .filter((tri) => tri.side === side && tri.part === 'shoe')
        .flatMap((tri) => tri.out)
        .sort((a, b) => a - b)
    const [l, r] = [across('left'), across('right')]
    for (let i = 0; i < l.length; i++) expect(l[i]!).toBeCloseTo(r[i]!, 5)
    // The shoe taken in: on the ground, and no higher than it was.
    for (const tri of triangles) {
      if (tri.part === 'shoe') for (const up of tri.up) expect(up).toBeGreaterThanOrEqual(-1e-6)
    }
  })

  test('is empty for any mesh but the body', () => {
    const body = feetBody('m001_head')
    expect(unpackFeet(footGeometry(body))).toEqual([])
  })
})

describe('a bare foot', () => {
  test('narrows to its toes, the big toe reaching furthest', () => {
    expect(halfWidth(TOE_TIP, 0.1, true)).toBe(0)
    expect(halfWidth(LITTLE_TOE_TIP, 0.1, false)).toBe(0)
    expect(halfWidth(LITTLE_TOE_TIP - 0.05, 0.1, true)).toBeGreaterThan(
      halfWidth(LITTLE_TOE_TIP - 0.05, 0.1, false),
    )
    expect(halfWidth(0.9, 0.1, true)).toBeGreaterThan(halfWidth(1.3, 0.1, true))
  })

  test('is rounded underneath and over its top', () => {
    expect(halfWidth(0.9, 0, true)).toBeLessThan(halfWidth(0.9, 0.1, true))
    expect(halfWidth(0.9, 0.3, true)).toBeLessThan(halfWidth(0.9, 0.1, true))
  })

  test('its curves pass through their knots and never overshoot them', () => {
    const through = curve([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ])
    expect(through(1)).toBeCloseTo(1, 9)
    for (let x = 0; x <= 3; x += 0.05) expect(through(x)).toBeLessThanOrEqual(1 + 1e-9)
    expect(through(-1)).toBe(0)
  })
})
