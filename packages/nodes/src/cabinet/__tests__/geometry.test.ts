import { describe, expect, test } from 'bun:test'
import { Box3, type Mesh } from 'three'
import { CABINET_PRESETS, instantiateSpec } from '../engine/presets'
import { buildCabinetGeometry } from '../geometry'
import { CabinetNode } from '../schema'

describe('cabinet geometry', () => {
  test('a notched side keeps its outer box and gains the notch faces', () => {
    const preset = CABINET_PRESETS.find((p) => p.id === 'lower-door-lift-2tier')
    const node = CabinetNode.parse(instantiateSpec(preset?.spec() as never))
    const group = buildCabinetGeometry(node)
    const side = group.getObjectByName('cabinet-side-side-left') as Mesh
    expect(side).toBeDefined()
    side.updateMatrixWorld(true)
    const box = new Box3().setFromObject(side)
    expect(box.max.x - box.min.x).toBeCloseTo(0.018, 6)
    expect(box.max.y - box.min.y).toBeCloseTo(0.785, 6)
    expect(box.max.z - box.min.z).toBeCloseTo(0.6, 6)
    // Left edge of the cabinet sits at −W/2, the side's bottom on the toe kick.
    expect(box.min.x).toBeCloseTo(-0.3, 6)
    expect(box.min.y).toBeCloseTo(0.065, 6)
    // More than a plain box's 12 triangles: the profile has a notch.
    const triangles =
      (side.geometry.index?.count ?? side.geometry.attributes.position?.count ?? 0) / 3
    expect(triangles).toBeGreaterThan(12)
  })
})
