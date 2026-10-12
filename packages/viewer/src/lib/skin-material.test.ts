// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { MeshPhysicalMaterial } from 'three'
import { SheenSafeLightingModel } from './sheen-safe-material'
import {
  markSkin,
  SkinPhysicalNodeMaterial,
  setSkinShading,
  skinDetailNormals,
  skinSettings,
  skinShading,
} from './skin-material'

describe('skin shading', () => {
  test('is off until turned on, and stays within 0–1', () => {
    expect(skinShading.value).toBe(0)
    setSkinShading(3)
    expect(skinShading.value).toBe(1)
    setSkinShading(-1)
    expect(skinShading.value).toBe(0)
  })

  test("a material's skin mark goes with its copies", () => {
    const material = new MeshPhysicalMaterial()
    expect(skinSettings(material)).toBeNull()
    markSkin(material, 16)
    expect(skinSettings(material.clone())).toEqual({ detailRepeat: 16 })
  })

  test('an unmarked material is lit as any sheen-safe physical material', () => {
    const material = new SkinPhysicalNodeMaterial()
    material.sheen = 1
    const model = material.setupLightingModel() as unknown as { sheen: boolean }
    expect(model).toBeInstanceOf(SheenSafeLightingModel)
    expect(model.constructor).toBe(SheenSafeLightingModel)
    expect(model.sheen).toBe(true)
  })
})

describe('skinDetailNormals', () => {
  const size = 512
  const normals = skinDetailNormals(size)
  const at = (x: number, y: number, c: number) => normals[(y * size + x) * 4 + c]!

  test('is the same every time', () => {
    expect(skinDetailNormals(size)).toEqual(normals)
  })

  test('is a gentle tangent-space normal map: facing out, tilting both ways', () => {
    let sumX = 0
    let sumZ = 0
    let minZ = 255
    for (let i = 0; i < size * size; i++) {
      sumX += normals[i * 4]!
      sumZ += normals[i * 4 + 2]!
      minZ = Math.min(minZ, normals[i * 4 + 2]!)
      expect(normals[i * 4 + 3]).toBe(255)
    }
    expect(Math.abs(sumX / (size * size) - 127.5)).toBeLessThan(6)
    expect(sumZ / (size * size)).toBeGreaterThan(232)
    expect(minZ).toBeGreaterThan(128)
  })

  test('tiles: its far edge runs on into its near one as smoothly as anywhere', () => {
    let across = 0
    let inside = 0
    for (let y = 0; y < size; y++) {
      for (let c = 0; c < 3; c++) {
        across += Math.abs(at(size - 1, y, c) - at(0, y, c))
        inside += Math.abs(at(size / 2, y, c) - at(size / 2 + 1, y, c))
      }
    }
    expect(across).toBeLessThan(inside * 1.6)
  })
})
