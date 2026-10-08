// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { MeshPhysicalNodeMaterial, PhysicalLightingModel, type WebGPURenderer } from 'three/webgpu'
import { installSheenSafeMaterial, SheenSafePhysicalNodeMaterial } from './sheen-safe-material'

describe('installSheenSafeMaterial', () => {
  test('draws MeshPhysicalMaterial as the sheen-safe node material', () => {
    const materialNodes = new Map<string, unknown>([
      ['MeshPhysicalMaterial', MeshPhysicalNodeMaterial],
    ])
    installSheenSafeMaterial({ library: { materialNodes } } as unknown as WebGPURenderer)
    expect(materialNodes.get('MeshPhysicalMaterial')).toBe(SheenSafePhysicalNodeMaterial)
  })

  test('the material is still physical, lit by a physical lighting model with its features', () => {
    const material = new SheenSafePhysicalNodeMaterial()
    expect(material).toBeInstanceOf(MeshPhysicalNodeMaterial)
    material.sheen = 1
    const model = material.setupLightingModel() as unknown as PhysicalLightingModel & {
      sheen: boolean
      clearcoat: boolean
    }
    expect(model).toBeInstanceOf(PhysicalLightingModel)
    expect(model.sheen).toBe(true)
    expect(model.clearcoat).toBe(false)
  })
})
