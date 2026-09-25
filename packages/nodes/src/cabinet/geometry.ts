import type { GeometryContext } from '@pascal-app/core'
import { createDefaultMaterial, type RenderShading } from '@pascal-app/viewer'
import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  type Material,
  Mesh,
  Shape,
} from 'three'
import { buildCabinetParts, type CabinetPart, type PartFinish } from './engine/parts'
import type { CabinetNode } from './schema'

const MM = 0.001
const APPLIANCE_COLOR = '#b9bcc0'

/**
 * Pure cabinet geometry: every part from `buildCabinetParts` becomes one mesh
 * named `cabinet-<role>-<id>` and tagged with `userData.partId`, so the 3D
 * view shows exactly the panels the panel list reports.
 */
export function buildCabinetGeometry(
  node: CabinetNode,
  _ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
): Group {
  const group = new Group()
  group.name = 'cabinet-geometry'
  const { parts } = buildCabinetParts(node)
  const materials: Record<PartFinish, Material> = {
    body: createDefaultMaterial(node.bodyColor, 0.8, shading),
    front: createDefaultMaterial(node.frontColor, 0.6, shading),
    hardware: createDefaultMaterial(node.handleColor, 0.35, shading),
    appliance: createDefaultMaterial(APPLIANCE_COLOR, 0.4, shading),
  }
  for (const part of parts) group.add(partMesh(node, part, materials[part.finish]))
  for (const child of group.children) {
    child.castShadow = true
    child.receiveShadow = true
  }
  return group
}

/** Cabinet-local mm box → centred metres in the node's frame (origin at the
 *  footprint centre on the bottom, front towards +Z). */
export function partCenter(node: CabinetNode, part: CabinetPart): [number, number, number] {
  const b = part.box
  return [
    (b.x + b.w / 2 - node.widthMm / 2) * MM,
    (b.y + b.h / 2) * MM,
    (b.z + b.d / 2 - node.depthMm / 2) * MM,
  ]
}

function partMesh(node: CabinetNode, part: CabinetPart, material: Material): Mesh {
  const b = part.box
  let mesh: Mesh
  if (part.shape === 'rod-x') {
    const geometry = new CylinderGeometry((b.h / 2) * MM, (b.h / 2) * MM, b.w * MM, 16)
    geometry.rotateZ(Math.PI / 2)
    mesh = new Mesh(geometry, material)
  } else if (part.shape === 'foot') {
    mesh = new Mesh(new CylinderGeometry((b.w / 2) * MM, (b.w / 2) * MM, b.h * MM, 12), material)
  } else if (part.notches?.length) {
    mesh = new Mesh(notchedSideGeometry(part), material)
    // The profile is built from the part's min corner; place that corner.
    mesh.position.set((b.x - node.widthMm / 2) * MM, b.y * MM, (b.z - node.depthMm / 2) * MM)
    mesh.name = `cabinet-${part.role}-${part.id}`
    mesh.userData.partId = part.id
    return mesh
  } else {
    mesh = new Mesh(new BoxGeometry(b.w * MM, b.h * MM, b.d * MM), material)
  }
  mesh.position.set(...partCenter(node, part))
  mesh.name = `cabinet-${part.role}-${part.id}`
  mesh.userData.partId = part.id
  return mesh
}

/**
 * A side panel with front notches (목찬넬 따내기): its profile in the
 * depth/height plane, extruded through the board thickness along X. Built
 * from the part's min corner (x 0…w, y 0…h, z 0…d).
 */
function notchedSideGeometry(part: CabinetPart) {
  const { w, h, d } = part.box
  const notches = [...(part.notches ?? [])].sort((a, b) => a.fromBottom - b.fromBottom)
  // Shape plane: u = depth (z), v = height (y). Walk the outline counter-
  // clockwise: back bottom → front bottom → up the notched front → top.
  const shape = new Shape()
  shape.moveTo(0, 0)
  shape.lineTo(d, 0)
  for (const n of notches) {
    const top = Math.min(h, n.fromBottom + n.height)
    shape.lineTo(d, n.fromBottom)
    shape.lineTo(d - n.depth, n.fromBottom)
    shape.lineTo(d - n.depth, top)
    if (top < h) shape.lineTo(d, top)
  }
  const last = notches.at(-1)
  if (!last || last.fromBottom + last.height < h) shape.lineTo(d, h)
  else shape.lineTo(d - last.depth, h)
  shape.lineTo(0, h)
  shape.closePath()
  const geometry = new ExtrudeGeometry(shape, { depth: w, bevelEnabled: false })
  // (u, v, extrude) → (z, y, x): rotate the extrude axis onto +X.
  geometry.rotateY(-Math.PI / 2)
  geometry.translate(w, 0, 0)
  geometry.scale(MM, MM, MM)
  return geometry
}
