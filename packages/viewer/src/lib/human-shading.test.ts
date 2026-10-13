// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { AdditiveBlending, type MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three'
import { humanMaterial, humanSurfaceOf } from './human-shading'

describe('human surfaces', () => {
  test('tells the MakeHuman base bodies’ parts by their materials’ names', () => {
    expect(humanSurfaceOf('Head_Skin')).toBe('skin')
    expect(humanSurfaceOf('Body_Skin')).toBe('skin')
    expect(humanSurfaceOf('Eye_Sclera')).toBe('eyes')
    expect(humanSurfaceOf('Eye_Iris')).toBe('eyes')
    expect(humanSurfaceOf('Eye_Cornea')).toBe('cornea')
    expect(humanSurfaceOf('Eyebrows')).toBe('lashes')
    expect(humanSurfaceOf('Eyelashes')).toBe('lashes')
    expect(humanSurfaceOf('Hair')).toBe('hair')
    expect(humanSurfaceOf('Teeth')).toBe('mouth')
    expect(humanSurfaceOf('Tongue')).toBe('mouth')
    expect(humanSurfaceOf('Outfit_male_casualsuit01')).toBe('cloth')
  })

  test('a cornea from another exporter is a cornea too; eye shells and occlusion stay clothing', () => {
    expect(humanSurfaceOf('Std_Cornea_L')).toBe('cornea')
    expect(humanSurfaceOf('Human.high-poly')).toBe('eyes')
    expect(humanSurfaceOf('Std_Eye_Occlusion_R')).toBe('cloth')
  })

  test('the cornea adds its reflections alone over the eye', () => {
    const source = new MeshStandardMaterial({ name: 'Eye_Cornea', color: 0xffffff })
    const cornea = humanMaterial(source, 'cornea') as MeshStandardMaterial
    expect(cornea).not.toBe(source)
    expect(cornea.name).toBe('Eye_Cornea')
    expect(cornea.color.getHex()).toBe(0x000000)
    expect(cornea.transparent).toBe(true)
    expect(cornea.depthWrite).toBe(false)
    expect(cornea.blending).toBe(AdditiveBlending)
    expect(cornea.roughness).toBeLessThan(0.1)
  })

  test('a cornea that carries a picture keeps it, drawn as the wet eye', () => {
    const map = new Texture()
    const source = new MeshStandardMaterial({ name: 'Std_Cornea_L', color: 0xffffff, map })
    const eye = humanMaterial(source, 'cornea') as MeshPhysicalMaterial
    expect(eye.map).toBe(map)
    expect(eye.blending).not.toBe(AdditiveBlending)
    expect(eye.color.getHex()).toBe(0xffffff)
    expect(eye.clearcoat).toBe(1)
  })

  test('an iris drawn apart reflects nothing under its cornea; the rest of the eye stays wet', () => {
    const eye = (name: string) =>
      humanMaterial(new MeshStandardMaterial({ name }), 'eyes') as MeshPhysicalMaterial
    const iris = eye('Eye_Iris')
    const sclera = eye('Eye_Sclera')
    const whole = eye('Human.high-poly')
    expect(iris.clearcoat).toBe(0)
    expect(iris.specularIntensity).toBe(0)
    expect(sclera.specularIntensity).toBe(1)
    expect(sclera.clearcoat).toBe(1)
    expect(whole.clearcoat).toBe(1)
  })
})
