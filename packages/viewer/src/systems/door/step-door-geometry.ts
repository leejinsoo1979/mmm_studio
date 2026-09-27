import { type DoorNode, type StepDoorBox, stepDoorBoxes, stepDoorModel } from '@pascal-app/core'
import * as THREE from 'three'
import { createDefaultMaterial, type RenderShading } from '../../lib/materials'

/**
 * mmmcraft `StepDoor3D`: jambs, finish returns and the header stay fixed;
 * the leaf and its handles turn about the hinge. Built in the door's local
 * frame (x along the wall, y centred on the opening, z across the wall).
 */

const MM = 0.001

const materialCache = new Map<string, THREE.Material>()
function material(metal: boolean, shading: RenderShading): THREE.Material {
  const key = `${metal}:${shading}`
  let m = materialCache.get(key)
  if (!m) {
    m = createDefaultMaterial(metal ? '#8f949a' : '#e8e2d8', metal ? 0.3 : 0.72, shading)
    materialCache.set(key, m)
  }
  return m
}

function addBox(parent: THREE.Object3D, b: StepDoorBox, yOffset: number, shading: RenderShading) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(b.size[0] * MM, b.size[1] * MM, b.size[2] * MM),
    material(!!b.metal, shading),
  )
  mesh.name = b.name
  mesh.position.set(b.at[0] * MM, b.at[1] * MM + yOffset, b.at[2] * MM)
  parent.add(mesh)
}

export function addStepDoor(
  parent: THREE.Object3D,
  node: DoorNode,
  swingAngle: number,
  shading: RenderShading,
) {
  const m = stepDoorModel(node, swingAngle / (Math.PI / 2))
  const { fixed, leaf } = stepDoorBoxes(m)
  const bottom = -node.height / 2
  for (const b of fixed) addBox(parent, b, bottom, shading)
  const hinge = new THREE.Group()
  hinge.name = 'step-door-hinge'
  hinge.position.set(m.hingeX * MM, 0, m.hingeZ * MM)
  hinge.rotation.y = -m.angle
  parent.add(hinge)
  for (const b of leaf) addBox(hinge, b, bottom, shading)
}
