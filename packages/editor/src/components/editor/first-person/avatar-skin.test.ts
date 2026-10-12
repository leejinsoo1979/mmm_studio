import { describe, expect, test } from 'bun:test'
import { SKIN_EYE_ATTRIBUTE } from '@pascal-app/viewer'
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  type Material,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Texture,
} from 'three'
import { eyeShading, prepareSkin, skinMaterialOf } from './avatar-skin'

/** An eyeball's points round (0, 0, 0), radius 1: its front (+z), its rim, its top; and a point on the face. */
const EYE_POINTS = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
]
const FACE_POINT = [3, 0, 0]

function head() {
  const points = [...EYE_POINTS, FACE_POINT]
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(points.flat()), 3))
  // Bone 1 holds the eye, bone 0 the face.
  const joints = points.map((_, i) => [i < EYE_POINTS.length ? 1 : 0, 0, 0, 0])
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(joints.flat()), 4))
  geometry.setAttribute(
    'skinWeight',
    new BufferAttribute(new Float32Array(points.flatMap(() => [1, 0, 0, 0])), 4),
  )
  const head = new Bone()
  head.name = 'Bip01 Head'
  const eye = new Bone()
  eye.name = 'Bip01 LEye'
  const lid = new Bone()
  lid.name = 'Bip01 LEyeBlinkTop'
  const material = new MeshPhysicalMaterial({ name: 'f001_head' })
  const mesh = new SkinnedMesh<BufferGeometry, Material>(geometry, material)
  mesh.bind(new Skeleton([head, eye, lid]), new Matrix4())
  return mesh
}

describe('eyeShading', () => {
  const shading = eyeShading(head().geometry, new Matrix4(), [1])
  const eyeAt = (i: number) => [shading[i * 2], shading[i * 2 + 1]]

  test('marks the eyeball, not the face', () => {
    for (let i = 0; i < EYE_POINTS.length; i++) expect(eyeAt(i)[0]).toBe(1)
    expect(eyeAt(EYE_POINTS.length)).toEqual([0, 0])
  })

  test('leaves the iris lit and shades the white towards the corners, the upper lid most', () => {
    const [front, side, top, , bottom] = EYE_POINTS.map((_, i) => eyeAt(i)[1]!)
    expect(front).toBe(0)
    expect(side).toBeCloseTo(0.35)
    expect(top).toBeCloseTo(0.65)
    expect(bottom).toBeCloseTo(side!)
    expect(top).toBeGreaterThan(side!)
  })

  test('never shades an eye darker than a share of its own colour', () => {
    for (let i = 0; i < EYE_POINTS.length; i++) expect(eyeAt(i)[1]).toBeLessThanOrEqual(0.7)
  })
})

describe('prepareSkin', () => {
  test("marks a head's eyes once, and makes its material skin", () => {
    const mesh = head()
    const loaded = mesh.material
    prepareSkin(mesh)
    expect(mesh.material).toBe(loaded)
    expect((mesh.material as MeshPhysicalMaterial).userData.skin).toEqual({ detailRepeat: 16 })
    const marked = mesh.geometry.getAttribute(SKIN_EYE_ATTRIBUTE)
    expect(marked.itemSize).toBe(2)
    prepareSkin(mesh)
    expect(mesh.geometry.getAttribute(SKIN_EYE_ATTRIBUTE)).toBe(marked)
  })

  test("turns a body's standard material physical, the same copy for every body drawn from it", () => {
    const map = new Texture()
    const rough = new Texture()
    const loaded = new MeshStandardMaterial({
      name: 'f001_body',
      map,
      roughnessMap: rough,
      metalnessMap: rough,
      roughness: 0.8,
    })
    const skin = skinMaterialOf(loaded, 'body')
    expect(skin).toBeInstanceOf(MeshPhysicalMaterial)
    expect(skin.name).toBe('f001_body')
    expect(skin.map).toBe(map)
    expect(skin.roughnessMap).toBe(rough)
    expect(skin.roughness).toBe(0.8)
    expect(skin.metalnessMap).toBeNull()
    expect(skin.metalness).toBe(0)
    expect(skin.sheen).toBe(0)
    expect(skin.clearcoat).toBe(0)
    expect(skin.userData.skin).toEqual({ detailRepeat: 40 })
    expect(skinMaterialOf(loaded, 'body')).toBe(skin)
  })

  test('leaves other materials be', () => {
    const mesh = head()
    const hair = new MeshStandardMaterial({ name: 'f001_opacity' })
    mesh.material = hair
    prepareSkin(mesh)
    expect(mesh.material).toBe(hair)
    expect(hair.userData.skin).toBeUndefined()
    expect(mesh.geometry.hasAttribute(SKIN_EYE_ATTRIBUTE)).toBe(false)
  })
})
