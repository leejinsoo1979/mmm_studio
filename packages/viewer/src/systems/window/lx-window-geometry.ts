import {
  LX_WINDOW_COLORS,
  type LxEdge,
  type LxFrameKind,
  type LxPoint,
  lxEdgeSection,
  lxWindowGlass,
  type WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { createDefaultMaterial, type RenderShading } from '../../lib/materials'

/**
 * mmmcraft `LxSystemWindow3D`: the traced head / sill / jamb sections of the
 * LX Z:IN E9-PTT85 PHI extruded along each edge (fixed frame, sash frame and
 * their cross-hatched inserts as separate solids), plus the glass slab.
 * mmmcraft's extrusion matrices, in mm, with the origin moved from the sill
 * to the window centre. Closed display only.
 */

const MM = 0.001
type Part = LxFrameKind | 'insert' | 'glass'

const materialCache = new Map<string, THREE.Material>()
function material(part: Part, shading: RenderShading): THREE.Material {
  const key = `${part}:${shading}`
  let m = materialCache.get(key)
  if (!m) {
    const glass = part === 'glass'
    m = createDefaultMaterial(
      LX_WINDOW_COLORS[part],
      glass ? 0.12 : 0.65,
      shading,
      THREE.DoubleSide,
    )
    if (glass) {
      m.transparent = true
      m.opacity = 0.36
      m.depthWrite = false
    }
    materialCache.set(key, m)
  }
  return m
}

function shape(outline: LxPoint[], holes: LxPoint[][] = []): THREE.Shape {
  const s = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2(u, v)))
  for (const hole of holes)
    s.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, v))))
  return s
}

/** Shape (u, v) extruded w → window-local mm, per edge (mmmcraft transforms). */
function edgeMatrix(edge: LxEdge, widthMm: number, heightMm: number): THREE.Matrix4 {
  const m = new THREE.Matrix4()
  if (edge === 'head') {
    // x = w − W/2, y = H − v, z = u − 42.5
    m.set(0, 0, 1, -widthMm / 2, 0, -1, 0, heightMm, 1, 0, 0, -42.5, 0, 0, 0, 1)
  } else if (edge === 'sill') {
    // x = w − W/2, y = v, z = u − 42.5
    m.set(0, 0, 1, -widthMm / 2, 0, 1, 0, 0, 1, 0, 0, -42.5, 0, 0, 0, 1)
  } else {
    // x = ±(u − W/2), y = w, z = v − 42.5
    const right = edge === 'right-jamb'
    m.set(
      right ? -1 : 1,
      0,
      0,
      right ? widthMm / 2 : -widthMm / 2,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      -42.5,
      0,
      0,
      0,
      1,
    )
  }
  // Metres, centred on the opening height.
  return new THREE.Matrix4()
    .makeTranslation(0, (-heightMm / 2) * MM, 0)
    .multiply(new THREE.Matrix4().makeScale(MM, MM, MM))
    .multiply(m)
}

function extrude(s: THREE.Shape, lengthMm: number, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(s, {
    depth: lengthMm,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  })
  g.applyMatrix4(matrix)
  g.computeVertexNormals()
  return g
}

export function addLxWindow(parent: THREE.Object3D, node: WindowNode, shading: RenderShading) {
  const selection = node.windowSystem
  if (!selection) return
  const widthMm = node.width * 1000
  const heightMm = node.height * 1000
  for (const edge of ['head', 'sill', 'left-jamb', 'right-jamb'] as const) {
    const matrix = edgeMatrix(edge, widthMm, heightMm)
    const length = edge === 'head' || edge === 'sill' ? widthMm : heightMm
    for (const kind of ['fixed-frame', 'sash-frame'] as const) {
      const section = lxEdgeSection(edge, kind)
      const frame = new THREE.Mesh(
        extrude(shape(section.outline, section.cavities), length, matrix),
        material(kind, shading),
      )
      frame.name = `lx-window:${kind}:${edge}`
      parent.add(frame)
      section.inserts.forEach((ring, i) => {
        const insert = new THREE.Mesh(
          extrude(shape(ring), length, matrix),
          material('insert', shading),
        )
        insert.name = `lx-window:insert:${kind}:${edge}:${i}`
        parent.add(insert)
      })
    }
  }
  const g = lxWindowGlass(widthMm, heightMm, selection)
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(g.width * MM, g.height * MM, g.thickness * MM),
    material('glass', shading),
  )
  glass.name = 'lx-window:glass'
  glass.position.z = g.centerZ * MM
  parent.add(glass)
}
