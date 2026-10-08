import { describe, expect, test } from 'bun:test'
import type { SkinnedMesh } from 'three'
import { headOf } from './avatar-shape'
import { HAIR_HEADS } from './hair-fixtures'
import { hairBaseInput } from './hair-input'
import { loadCharacterScene, loadHairHead } from './hair-test-utils'

const largest = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  expect(a.length).toBe(b.length)
  let most = 0
  for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i]! - b[i]!))
  return most
}

describe('hairBaseInput', () => {
  for (const id of HAIR_HEADS) {
    test(`gathers ${id} as its frozen head keeps it (to the fixture's quantisation)`, async () => {
      const [scene, frozen] = await Promise.all([loadCharacterScene(id), loadHairHead(id)])
      const input = hairBaseInput(scene, id)!
      const want = frozen.input
      expect(input.avatar).toBe(id)
      expect(input.material).toBe(want.material)
      expect(input.metresPerUnit).toBeCloseTo(want.metresPerUnit, 6)
      expect(largest(input.head.points, want.head.points)).toBeLessThan(2e-5)
      expect(largest(input.head.normals, want.head.normals)).toBeLessThan(0.01)
      expect(largest(input.head.uvs, want.head.uvs)).toBeLessThan(2e-5)
      expect([...input.head.index]).toEqual([...want.head.index])
      expect([...input.head.skinIndex]).toEqual([...want.head.skinIndex])
      expect(largest(input.head.skinWeight, want.head.skinWeight)).toBeLessThan(0.003)
      expect(largest(input.body.points, want.body.points)).toBeLessThan(2e-5)
      expect([...input.body.index]).toEqual([...want.body.index])
      expect(largest(input.cards!, want.cards!)).toBeLessThan(2e-5)
      expect(input.lashes).toEqual(want.lashes)
      expect(input.bones).toEqual(want.bones)
      expect(input.boneIndex).toEqual(want.boneIndex)
      expect(input.marks).toEqual(want.marks)
      expect([...input.ears!]).toEqual([...want.ears!])
    })
  }

  test('reads the head as loaded and the body unshaped, whatever the character shows now', async () => {
    const scene = await loadCharacterScene('Male_Adult_01')
    const before = hairBaseInput(scene, 'Male_Adult_01')!
    const head = headOf(scene) as SkinnedMesh
    const loaded = head.geometry
    const shown = loaded.clone()
    shown.getAttribute('position').setY(0, 5)
    head.userData.hairOriginal = loaded
    head.geometry = shown
    const after = hairBaseInput(scene, 'Male_Adult_01')!
    expect(after.head.points).toEqual(before.head.points)
  })

  test('has no input for a character without a head of its own', async () => {
    const scene = await loadCharacterScene('Male_Adult_01')
    headOf(scene)!.removeFromParent()
    expect(hairBaseInput(scene, 'Male_Adult_01')).toBeNull()
  })
})
