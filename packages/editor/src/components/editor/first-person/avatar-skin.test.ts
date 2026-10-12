import { describe, expect, test } from 'bun:test'
import { isSkinMaterial, SKIN_EYE_ATTRIBUTE, SkinMaterial } from '@pascal-app/viewer'
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
import { eyeShading, feetSkin, prepareSkin, skinMaterialOf } from './avatar-skin'

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
    expect(side).toBeCloseTo(0.2)
    expect(top).toBeCloseTo(0.3)
    expect(bottom).toBeCloseTo(side!)
    expect(top).toBeGreaterThan(side!)
  })

  test('keeps the white white: shaded by 30% at most', () => {
    for (let i = 0; i < EYE_POINTS.length; i++) expect(eyeAt(i)[1]).toBeLessThanOrEqual(0.3 + 1e-6)
  })
})

describe('prepareSkin', () => {
  test("marks a head's eyes once, and gives it a skin material copied from its own", () => {
    const mesh = head()
    const loaded = mesh.material as MeshPhysicalMaterial
    loaded.sheen = 1
    prepareSkin(mesh)
    const skin = mesh.material as SkinMaterial
    expect(skin).not.toBe(loaded)
    expect(isSkinMaterial(skin)).toBe(true)
    expect(skin.skin).toEqual({ detailRepeat: 16 })
    expect(skin.name).toBe('f001_head')
    expect(skin.sheen).toBe(1)
    const marked = mesh.geometry.getAttribute(SKIN_EYE_ATTRIBUTE)
    expect(marked.itemSize).toBe(2)
    prepareSkin(mesh)
    expect(mesh.material).toBe(skin)
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
    expect(skin).toBeInstanceOf(SkinMaterial)
    expect(skin.name).toBe('f001_body')
    expect(skin.map).toBe(map)
    expect(skin.roughnessMap).toBe(rough)
    expect(skin.roughness).toBe(0.8)
    expect(skin.metalnessMap).toBeNull()
    expect(skin.metalness).toBe(0)
    expect(skin.sheen).toBe(0)
    expect(skin.clearcoat).toBe(0)
    expect(skin.skin).toEqual({ detailRepeat: 40 })
    expect(skinMaterialOf(loaded, 'body')).toBe(skin)
  })

  test('bare feet are skin all over, socks none', () => {
    const body = skinMaterialOf(new MeshStandardMaterial({ name: 'f001_body' }), 'body')
    const bare = body.clone()
    feetSkin(bare, true)
    expect(bare.skin).toEqual({ detailRepeat: 40, mask: 1 })
    const socks = body.clone()
    feetSkin(socks, false)
    expect(socks.skin).toBeNull()
    expect(body.skin).toEqual({ detailRepeat: 40 })
  })

  test('leaves other materials be', () => {
    const mesh = head()
    const hair = new MeshStandardMaterial({ name: 'f001_opacity' })
    mesh.material = hair
    prepareSkin(mesh)
    expect(mesh.material).toBe(hair)
    expect(isSkinMaterial(hair)).toBe(false)
    expect(mesh.geometry.hasAttribute(SKIN_EYE_ATTRIBUTE)).toBe(false)
  })
})
