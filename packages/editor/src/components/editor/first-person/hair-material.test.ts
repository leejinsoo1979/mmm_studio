import { describe, expect, test } from 'bun:test'
import { Mesh, RepeatWrapping } from 'three'
import { ATLAS_HEIGHT, ATLAS_WIDTH } from './hair-atlas'
import {
  hairAtlas,
  holdHairValues,
  newHairValues,
  setHairLook,
  setRootsStyle,
} from './hair-material'
import { HAIRLINE_STEPS } from './hair-scalp'
import { hairLookValues, NO_UNDERCUT } from './hair-shading'

function character() {
  const values = newHairValues()
  const meshes = [new Mesh(), new Mesh(), new Mesh()]
  for (const [i, mesh] of meshes.entries()) holdHairValues(mesh, values, i === 1 ? 0.85 : undefined)
  return { values, meshes }
}

describe('setHairLook', () => {
  test("writes the look's values once into the character's shared values", () => {
    const { values, meshes } = character()
    const look = { base: '#6a4a3a', tip: '#e0c080', shine: 0.8, skin: '#d0a080' }
    setHairLook({ meshes }, look)
    const want = hairLookValues(look)
    for (const [k, c] of values.base.toArray().entries()) expect(c).toBeCloseTo(want.base[k]!, 6)
    expect(values.tip.r).toBeCloseTo(want.tip[0], 6)
    expect(values.root.g).toBeCloseTo(want.root[1], 6)
    expect(values.skin.b).toBeCloseTo(want.skin[2], 6)
    expect(values.shine.toArray()).toEqual([want.expR, want.expTRT, want.kR])
    expect(meshes[1]!.userData.hairCore).toBe(0.85)
    expect(meshes[0]!.userData.hairCore).toBe(0.02)
  })

  test('leaves other characters alone', () => {
    const a = character()
    const b = character()
    const before = b.values.base.getHex()
    setHairLook({ meshes: a.meshes }, { base: '#ffffff', tip: null, shine: 0.5, skin: '#c8987a' })
    expect(b.values.base.getHex()).toBe(before)
    expect(a.values.base.getHex()).toBe(0xffffff)
  })
})

describe('setRootsStyle', () => {
  test("writes a build's hairline, part and undercut", () => {
    const { values, meshes } = character()
    const hairline = Float32Array.from({ length: HAIRLINE_STEPS }, (_, i) => 0.7 - i * 0.05)
    setRootsStyle(
      { meshes },
      {
        hairline,
        part: { x: 0.02, fade: [-0.04, 0.08], crown: -0.02 },
        undercut: { line: 0.35, shells: [0.85, 0.55, 0.3] },
      },
    )
    expect(values.hairline).toHaveLength(HAIRLINE_STEPS)
    expect(values.hairline[32]).toBeCloseTo(0.7 - 32 * 0.05, 6)
    expect(values.part.toArray()).toEqual([0.02, -0.04, 0.08, -0.02])
    expect(values.undercut.x).toBeCloseTo(0.35, 6)
    setRootsStyle(
      { meshes },
      { hairline, part: { x: 0, fade: [-0.04, 0.08], crown: -0.02 }, undercut: null },
    )
    expect(values.undercut.x).toBe(NO_UNDERCUT)
  })
})

describe('hairAtlas', () => {
  test('is one texture with every mip of its own, repeating along the strand', () => {
    const atlas = hairAtlas()
    expect(hairAtlas()).toBe(atlas)
    expect(atlas.image.width).toBe(ATLAS_WIDTH)
    expect(atlas.image.height).toBe(ATLAS_HEIGHT)
    expect(atlas.mipmaps).toHaveLength(12)
    expect(atlas.generateMipmaps).toBe(false)
    expect(atlas.wrapT).toBe(RepeatWrapping)
    expect(atlas.anisotropy).toBe(8)
  })
})
