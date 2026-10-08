import { describe, expect, test } from 'bun:test'
import { Mesh, type Object3D, SkinnedMesh } from 'three'
import { type DrawItem, webglOpaqueOrder } from './studio-contact-shadow'

function item(
  id: number,
  material: { id: number },
  z: number,
  object: Object3D = new Mesh(),
): DrawItem {
  return { id, object, material, groupOrder: 0, renderOrder: 0, z }
}

describe('webglOpaqueOrder', () => {
  test('draws by material before depth, as WebGL does', () => {
    const [older, newer] = [{ id: 7 }, { id: 8 }]
    const near = item(1, newer, 0.1)
    const far = item(2, older, 0.9)
    expect([near, far].sort(webglOpaqueOrder)).toEqual([far, near])
  })

  test('within a material, draws plain meshes before skinned ones, then near before far', () => {
    const material = { id: 7 }
    const skinned = item(1, material, 0.1, new SkinnedMesh())
    const far = item(2, material, 0.9)
    const near = item(3, material, 0.2)
    expect([skinned, far, near].sort(webglOpaqueOrder)).toEqual([near, far, skinned])
  })

  test('keeps group and render order first', () => {
    const [older, newer] = [{ id: 7 }, { id: 8 }]
    const late = { ...item(1, older, 0.1), renderOrder: 1 }
    const early = item(2, newer, 0.9)
    const outer = { ...item(3, older, 0.1), groupOrder: 1 }
    expect([outer, late, early].sort(webglOpaqueOrder)).toEqual([early, late, outer])
  })
})
