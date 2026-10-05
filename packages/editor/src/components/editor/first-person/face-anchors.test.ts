import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { faceAnchors } from './face-anchors'
import { FACE_HANDLE, FACE_HANDLES } from './face-handles'
import { FACE_PARTS, facePointOf, unpackPoints } from './face-points'
import { headFrame } from './head-geometry'

/** A real character's landmarks, as the app downloads them. */
const TARGET: number[] = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../../apps/editor/public/characters/rocketbox/face-points.json',
      import.meta.url,
    ),
    'utf8',
  ),
).avatars.Male_Adult_02

/** The skull's centre height and radius (m), as ear-shape.test.ts has it. */
const CENTRE = 1.6
const RADIUS = 0.1

/** Where the head's front view lies (the skull's top at 1.7, the head bone at 1.5). */
const SIZE = 0.2 * 1.45
const LEFT = -SIZE / 2
const TOP = CENTRE + RADIUS + SIZE * 0.03

/** How far apart the face's points lie (front-view fractions), and how far forward they stand. */
const SPACING = 0.005
const FACE_Z = 0.12

type Parts = { positions: number[]; normals: number[]; eye: boolean[]; index: number[] }

const at = ([x, y]: readonly number[]): [number, number] => [LEFT + x! * SIZE, TOP - y! * SIZE]

function add(parts: Parts, [x, y, z]: [number, number, number], normal: Vector3, eye = false) {
  parts.positions.push(x, y, z)
  parts.normals.push(normal.x, normal.y, normal.z)
  parts.eye.push(eye)
}

/** An ear flap at the side of the skull leaning back, as ear-shape.test.ts makes one. */
function addEar(parts: Parts, side: number, skullCount: number) {
  const first = parts.positions.length / 3
  const rows = 9
  const across = 5
  const step = 0.004
  const lean = 0.9
  for (let up = 0; up < rows; up++) {
    for (let out = 0; out < across; out++) {
      const y = CENTRE - 0.03 + up * step
      const rootX = Math.sqrt(RADIUS ** 2 - (y - CENTRE) ** 2)
      add(
        parts,
        [side * (rootX + out * step * Math.cos(lean)), y, -out * step * Math.sin(lean)],
        new Vector3(side, 0, 0),
      )
    }
  }
  const index = (up: number, out: number) => first + up * across + out
  for (let up = 0; up + 1 < rows; up++) {
    for (let out = 0; out + 1 < across; out++) {
      parts.index.push(index(up, out), index(up + 1, out), index(up, out + 1))
      parts.index.push(index(up + 1, out), index(up + 1, out + 1), index(up, out + 1))
    }
    const root = new Vector3().fromArray(parts.positions, index(up, 0) * 3)
    let nearest = 0
    for (let i = 1; i < skullCount; i++) {
      const place = new Vector3().fromArray(parts.positions, i * 3)
      if (
        place.distanceTo(root) <
        new Vector3().fromArray(parts.positions, nearest * 3).distanceTo(root)
      ) {
        nearest = i
      }
    }
    parts.index.push(index(up, 0), index(up + 1, 0), nearest)
  }
  return { first, count: rows * across }
}

/**
 * A head: a sparse skull, with (`face`) a dense face standing in front of
 * it, eyeballs (skinned to an eye bone) in front of that round the irises,
 * and at every handle's landmark a point behind the face (as the teeth lie
 * behind the lips) and one in front facing away; and (`ears`) an ear each
 * side.
 */
function head({ face, ears }: { face: boolean; ears: boolean }) {
  const sphere = new SphereGeometry(RADIUS, 16, 12).translate(0, CENTRE, 0)
  const parts: Parts = {
    positions: [...sphere.getAttribute('position').array],
    normals: [...sphere.getAttribute('normal').array],
    eye: Array.from({ length: sphere.getAttribute('position').count }, () => false),
    index: [...sphere.index!.array],
  }
  const skullCount = parts.positions.length / 3
  const earPoints = ears ? [-1, 1].map((side) => addEar(parts, side, skullCount)) : []
  const front = new Vector3(0, 0, 1)
  if (face) {
    for (let row = 0; row <= Math.round(0.75 / SPACING); row++) {
      for (let column = 0; column <= Math.round(0.7 / SPACING); column++) {
        add(parts, [...at([0.15 + column * SPACING, 0.2 + row * SPACING]), FACE_Z], front)
      }
    }
    const points = unpackPoints(TARGET)
    for (const iris of [FACE_PARTS.rightIris[0]!, FACE_PARTS.leftIris[0]!]) {
      const [cx, cy] = points[iris]!
      for (let y = -0.03; y <= 0.03; y += SPACING / 2) {
        for (let x = -0.03; x <= 0.03; x += SPACING / 2) {
          if (Math.hypot(x, y) <= 0.03)
            add(parts, [...at([cx + x, cy + y]), FACE_Z + 0.005], front, true)
        }
      }
    }
    for (const handle of FACE_HANDLES) {
      if (handle.kind !== 'landmark') continue
      const place = at(points[facePointOf(handle.landmark)]!)
      add(parts, [...place, FACE_Z - 0.01], front)
      add(parts, [...place, FACE_Z + 0.01], new Vector3(0, 0, -1))
    }
  }
  const count = parts.positions.length / 3
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(parts.positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(parts.normals, 3))
  geometry.setAttribute(
    'skinIndex',
    new Uint16BufferAttribute(
      parts.eye.flatMap((eye) => [eye ? 1 : 0, 0, 0, 0]),
      4,
    ),
  )
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4),
  )
  geometry.setIndex(parts.index)
  const root = new Group()
  const headBone = new Bone()
  headBone.name = 'Bip01_Head'
  headBone.position.set(0, CENTRE - RADIUS, 0)
  const eyeBone = new Bone()
  eyeBone.name = 'Bip01_REye'
  eyeBone.position.set(-0.03, RADIUS, FACE_Z)
  headBone.add(eyeBone)
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  root.add(headBone, mesh)
  root.updateMatrixWorld(true)
  mesh.bind(new Skeleton([headBone, eyeBone]))
  return { mesh, eye: parts.eye, earPoints }
}

describe('where the handles sit on a head', () => {
  const { mesh, eye } = head({ face: true, ears: false })
  const frame = headFrame(mesh)
  const position = mesh.geometry.getAttribute('position')
  const frontView = (vertex: number) => {
    const place = new Vector3().fromBufferAttribute(position, vertex)
    return [(place.x - frame.left) / frame.size, (frame.top - place.y) / frame.size, place.z]
  }

  test('the head is framed as the test lays it out', () => {
    expect(frame.size).toBeCloseTo(SIZE, 6)
    expect(frame.left).toBeCloseTo(LEFT, 6)
    expect(frame.top).toBeCloseTo(TOP, 6)
  })

  test('each landmark handle on the skin facing the front by its landmark, never an eyeball', () => {
    const anchors = faceAnchors(mesh, TARGET)
    expect(anchors.map((anchor) => anchor.handle)).toEqual(
      FACE_HANDLES.filter((handle) => handle.kind === 'landmark').map((handle) => handle.id),
    )
    const points = unpackPoints(TARGET)
    for (const { handle, vertex } of anchors) {
      const landmark = FACE_HANDLE[handle]
      if (landmark.kind !== 'landmark') throw new Error('a landmark handle')
      const [x, y, z] = frontView(vertex)
      const [lx, ly] = points[facePointOf(landmark.landmark)]!
      expect(Math.hypot(x! - lx, y! - ly)).toBeLessThan(0.01)
      // The face itself: not what lies behind it, nor what faces away, nor an eyeball.
      expect(z).toBeCloseTo(FACE_Z, 6)
      expect(eye[vertex]).toBe(false)
    }
  })

  test('are worked out once per head and landmarks', () => {
    expect(faceAnchors(mesh, TARGET)).toBe(faceAnchors(mesh, TARGET))
  })

  test('none without landmarks (a covered face), nor ears on a head without', () => {
    expect(faceAnchors(mesh, null)).toEqual([])
  })
})

describe('where the ears’ handles sit', () => {
  test('one on each ear, the subject’s right on the image’s left', () => {
    const { mesh, earPoints } = head({ face: false, ears: true })
    const anchors = faceAnchors(mesh, null)
    expect(anchors.map((anchor) => anchor.handle)).toEqual(['ear-r', 'ear-l'])
    const position = mesh.geometry.getAttribute('position')
    anchors.forEach(({ vertex }, k) => {
      const { first, count } = earPoints[k]!
      expect(vertex).toBeGreaterThanOrEqual(first)
      expect(vertex).toBeLessThan(first + count)
      // Halfway up the ear (within a row of it), not at its top.
      const heights = Array.from({ length: count }, (_, i) => position.getY(first + i))
      const middle = (Math.min(...heights) + Math.max(...heights)) / 2
      expect(Math.abs(position.getY(vertex) - middle)).toBeLessThanOrEqual(0.004 + 1e-6)
    })
  })

  test('after the landmarks’, on a head with both', () => {
    const { mesh } = head({ face: true, ears: true })
    expect(faceAnchors(mesh, TARGET).map((anchor) => anchor.handle)).toEqual(
      FACE_HANDLES.map((handle) => handle.id),
    )
  })
})
