import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three'
import { dyeHair } from './photoreal-model'

describe('dyeing a 실사 body’s hair', () => {
  const hair = () => {
    const material = new MeshStandardMaterial({ name: 'Hair' })
    material.userData.hairColour = '#5a3c28'
    const cloth = new MeshStandardMaterial({ name: 'Outfit' })
    const model = new Group()
    model.add(new Mesh(new BoxGeometry(), material), new Mesh(new BoxGeometry(), cloth))
    return { model, material, cloth }
  }

  test('takes the hair from the colour its picture holds to the dye, the rest untouched', () => {
    const { model, material, cloth } = hair()
    expect(dyeHair(model, '#b4783c')).toBe(true)
    const own = new Color('#5a3c28')
    const want = new Color('#b4783c')
    expect(material.color.r * own.r).toBeCloseTo(want.r, 5)
    expect(material.color.g * own.g).toBeCloseTo(want.g, 5)
    expect(material.color.b * own.b).toBeCloseTo(want.b, 5)
    expect(cloth.color.getHex()).toBe(0xffffff)
    // No dye: its own colour back.
    dyeHair(model, null)
    expect(material.color.getHex()).toBe(0xffffff)
  })

  test('a body without such hair takes no dye', () => {
    const model = new Group()
    model.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: 'Hair' })))
    expect(dyeHair(model, '#b4783c')).toBe(false)
  })
})
