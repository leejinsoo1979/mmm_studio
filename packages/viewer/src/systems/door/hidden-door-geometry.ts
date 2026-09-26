import {
  DOMUS_150,
  type DoorNode,
  HIDDEN_HANDLE,
  HIDDEN_LEAF,
  type HiddenDoorModel,
  hiddenDoorFrontPanels,
  hiddenDoorModel,
  hiddenDoorSections,
  hiddenLeafOutline,
  type SectionPoint,
  type WallNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { createDefaultMaterial, type RenderShading } from '../../lib/materials'

/**
 * mmmcraft `HiddenDoor3D`: the CAD jamb / header sections extruded around
 * the opening, the front 2P panels with their 3 mm reveal slits, the 45T
 * leaf (rebated face), three Domus 150 hinges and the lever handles on both
 * faces. Built in the door's local frame: x along the wall (centred), y up
 * (centred on the opening), z across the wall — the wall's left normal is
 * local −z, so a finish depth d sits at z = −offset(d).
 */

const MM = 0.001
const COLORS = {
  finish: '#ede5d6',
  frame: '#ede5d6',
  timber: '#bd9969',
  hinge: '#a5adb7',
  handle: '#9b9b9b',
}

const materialCache = new Map<string, THREE.Material>()
function material(kind: keyof typeof COLORS, shading: RenderShading): THREE.Material {
  const key = `${kind}:${shading}`
  let m = materialCache.get(key)
  if (!m) {
    m = createDefaultMaterial(
      COLORS[kind],
      kind === 'hinge' ? 0.2 : 0.72,
      shading,
      THREE.DoubleSide,
    )
    materialCache.set(key, m)
  }
  return m
}

/** Extrude a closed (u, v) polygon by `depth` and orient it with `place`. */
function extrude(points: [number, number][], depth: number): THREE.ExtrudeGeometry | null {
  if (points.length < 3 || depth <= 0) return null
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)))
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 })
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  mesh.position.set(x, y, z)
  return mesh
}

export function addHiddenDoor(
  parent: THREE.Object3D,
  node: DoorNode,
  wall: WallNode,
  swingAngle: number,
  shading: RenderShading,
) {
  const m: HiddenDoorModel = hiddenDoorModel(node, wall, swingAngle / (Math.PI / 2))
  const W = m.widthMm * MM
  const H = m.heightMm * MM
  const bottom = -H / 2
  const z = (depthMm: number) => -m.offset(depthMm) * MM

  // Jambs: plan sections extruded up the full opening height, both sides.
  // Shape space is (x, −z) so rotateX(−π/2) takes the extrusion onto +y.
  const rows = hiddenDoorSections(m)
  for (const side of [-1, 1]) {
    for (const row of rows) {
      const pts = row.points.map(
        (p: SectionPoint) => [side * (m.widthMm / 2 - p.x) * MM, -z(p.y)] as [number, number],
      )
      const geometry = extrude(pts, H)
      if (!geometry) continue
      geometry.rotateX(-Math.PI / 2)
      geometry.translate(0, bottom, 0)
      parent.add(new THREE.Mesh(geometry, material(row.material, shading)))
    }
  }
  // Header: the header sections run across the width (shape space (−z, y),
  // extrusion rotated onto +x). x in a header row is measured down from the
  // top of the opening.
  for (const row of rows) {
    const pts = row.header.map((p: SectionPoint) => [-z(p.y), H / 2 - p.x * MM] as [number, number])
    const geometry = extrude(pts, W)
    if (!geometry) continue
    geometry.rotateY(Math.PI / 2)
    geometry.translate(-W / 2, 0, 0)
    parent.add(new THREE.Mesh(geometry, material(row.material, shading)))
  }
  // Front 2P panel over the leaf, between the reveal slits.
  const front = hiddenDoorFrontPanels(m)
  const header = front.panels.find((p) => p.id === 'header')
  if (header && header.height > 0) {
    parent.add(
      box(
        header.width * MM,
        header.height * MM,
        9 * MM,
        header.x * MM,
        bottom + (header.bottom + header.height / 2) * MM,
        z(4.5),
        material('finish', shading),
      ),
    )
  }

  // Fixed hinge bodies in the hinge-side jamb.
  const jambGap = HIDDEN_LEAF.sideInset - Math.max(...m.frame.map((p) => p.x))
  const hingeDepth = HIDDEN_LEAF.thickness - DOMUS_150.faceMargin - DOMUS_150.width / 2
  for (const y of m.hingeHeights) {
    parent.add(
      box(
        14.3 * MM,
        DOMUS_150.length * MM,
        DOMUS_150.width * MM,
        (m.hingeX - m.handed * jambGap) * MM,
        bottom + y * MM,
        z(hingeDepth),
        material('hinge', shading),
      ),
    )
  }

  // Leaf, turning about the back hinge corner (mmmcraft's display axis).
  const pivot = new THREE.Group()
  pivot.name = 'hidden-door-leaf'
  pivot.position.set(m.hingeX * MM, 0, z(HIDDEN_LEAF.thickness))
  pivot.rotation.y = m.angle
  parent.add(pivot)
  const leafPts = hiddenLeafOutline(m).map(
    (p) => [(p.x - m.hingeX) * MM, -(z(p.y) - z(HIDDEN_LEAF.thickness))] as [number, number],
  )
  const leaf = extrude(leafPts, m.leafHeight * MM)
  if (leaf) {
    leaf.rotateX(-Math.PI / 2)
    leaf.translate(0, bottom, 0)
    pivot.add(new THREE.Mesh(leaf, material('frame', shading)))
  }
  for (const y of m.hingeHeights) {
    pivot.add(
      box(
        14.3 * MM,
        DOMUS_150.pocket.innerLength * MM,
        DOMUS_150.width * MM,
        0,
        bottom + y * MM,
        z(hingeDepth) - z(HIDDEN_LEAF.thickness),
        material('hinge', shading),
      ),
    )
  }
  // Lever handles on both faces at 945 mm.
  const h = HIDDEN_HANDLE
  const handleX = (m.handed * (m.leafWidth / 2 - h.edgeInset) - m.hingeX) * MM
  const handleY = bottom + h.height * MM
  for (const face of [-1, 1]) {
    // Depth from the front face: the front handle stands in front (negative
    // depth), the back one behind the 45 mm leaf.
    const d = (depth: number) => (face < 0 ? -depth : HIDDEN_LEAF.thickness + depth)
    const zAt = (depth: number) => z(d(depth)) - z(HIDDEN_LEAF.thickness)
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(
        (h.plateDiameter / 2) * MM,
        (h.plateDiameter / 2) * MM,
        h.plateDepth * MM,
        24,
      ),
      material('handle', shading),
    )
    plate.rotation.x = Math.PI / 2
    plate.position.set(handleX, handleY, zAt(h.plateDepth / 2))
    pivot.add(plate)
    const leverLength = (h.leverMax - h.leverMin) * MM
    const leverCentre = handleX + m.handed * ((h.leverMin + h.leverMax) / 2) * MM
    pivot.add(
      box(
        leverLength,
        h.leverHeight * MM,
        h.leverDepth * MM,
        leverCentre,
        handleY,
        zAt(h.plateDepth + h.stemDepth + h.leverDepth / 2),
        material('handle', shading),
      ),
    )
  }
}
