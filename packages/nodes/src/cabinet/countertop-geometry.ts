import type { GeometryContext } from '@pascal-app/core'
import { createDefaultMaterial, type RenderShading } from '@pascal-app/viewer'
import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, Path, Shape } from 'three'
import { countertopCutoutCenterZ } from './floorplan'
import type { CountertopNode } from './schema'

const MM = 0.001
const STEEL = '#c7cbd0'
const GLASS = '#1d1f22'
const BOWL_DEPTH_MM = 200
const BOWL_WALL_MM = 2

/**
 * Countertop slab with real holes for each cutout, a stainless bowl hung
 * under a sink cutout (plus a faucet on the deck behind it) and a glass
 * cooktop dropped into a cooktop cutout. Local frame: centre of the slab's
 * underside, length along X, front towards +Z.
 */
export function buildCountertopGeometry(
  node: CountertopNode,
  _ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
): Group {
  const group = new Group()
  group.name = 'countertop-geometry'
  const L = node.lengthMm
  const D = node.depthMm
  const T = node.thicknessMm
  const stone = createDefaultMaterial(node.color, 0.35, shading)
  const steel = createDefaultMaterial(STEEL, 0.25, shading)
  const glass = createDefaultMaterial(GLASS, 0.15, shading)

  // Shape in (x, z) plan coordinates (mm, centred), extruded by T upwards.
  const shape = new Shape()
  shape.moveTo(-L / 2, -D / 2)
  shape.lineTo(L / 2, -D / 2)
  shape.lineTo(L / 2, D / 2)
  shape.lineTo(-L / 2, D / 2)
  shape.closePath()
  for (const cut of node.cutouts) {
    const cx = cut.centerMm - L / 2
    const cz = countertopCutoutCenterZ(node, cut.depthMm)
    const hw = Math.min(cut.widthMm / 2, L / 2 - 20)
    const hd = cut.depthMm / 2
    if (hw <= 0) continue
    const hole = new Path()
    hole.moveTo(cx - hw, cz - hd)
    hole.lineTo(cx - hw, cz + hd)
    hole.lineTo(cx + hw, cz + hd)
    hole.lineTo(cx + hw, cz - hd)
    hole.closePath()
    shape.holes.push(hole)
  }
  const slabGeometry = new ExtrudeGeometry(shape, { depth: T, bevelEnabled: false })
  slabGeometry.rotateX(Math.PI / 2)
  slabGeometry.translate(0, T, 0)
  slabGeometry.scale(MM, MM, MM)
  const slab = new Mesh(slabGeometry, stone)
  slab.name = 'countertop-slab'
  group.add(slab)

  // 상판내림: the stone's front apron hangs down, its top flush with the slab.
  if (node.frontDropMm > 0) {
    const apron = new Mesh(new BoxGeometry(L * MM, node.frontDropMm * MM, T * MM), stone)
    apron.position.set(0, (T - node.frontDropMm / 2) * MM, (D / 2 - T / 2) * MM)
    apron.name = 'countertop-front-apron'
    group.add(apron)
  }

  if (node.backsplashMm > 0) {
    const splash = new Mesh(new BoxGeometry(L * MM, node.backsplashMm * MM, 20 * MM), stone)
    splash.position.set(0, (T + node.backsplashMm / 2) * MM, (-D / 2 + 10) * MM)
    splash.name = 'countertop-backsplash'
    group.add(splash)
  }

  for (const cut of node.cutouts) {
    const cx = cut.centerMm - L / 2
    const cz = countertopCutoutCenterZ(node, cut.depthMm)
    const w = cut.widthMm
    const d = cut.depthMm
    if (cut.kind === 'sink') {
      const bowl = new Group()
      bowl.name = `countertop-sink-${cut.id}`
      const add = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => {
        const m = new Mesh(new BoxGeometry(bw * MM, bh * MM, bd * MM), steel)
        m.position.set(x * MM, y * MM, z * MM)
        bowl.add(m)
      }
      const y0 = T - BOWL_DEPTH_MM
      add(w, BOWL_WALL_MM, d, cx, y0, cz)
      add(w, BOWL_DEPTH_MM, BOWL_WALL_MM, cx, y0 + BOWL_DEPTH_MM / 2, cz - d / 2)
      add(w, BOWL_DEPTH_MM, BOWL_WALL_MM, cx, y0 + BOWL_DEPTH_MM / 2, cz + d / 2)
      add(BOWL_WALL_MM, BOWL_DEPTH_MM, d, cx - w / 2, y0 + BOWL_DEPTH_MM / 2, cz)
      add(BOWL_WALL_MM, BOWL_DEPTH_MM, d, cx + w / 2, y0 + BOWL_DEPTH_MM / 2, cz)
      // Faucet on the deck behind the bowl.
      const deckZ = cz - d / 2 - 35
      const column = new Mesh(new CylinderGeometry(18 * MM, 22 * MM, 280 * MM, 16), steel)
      column.position.set(cx * MM, (T + 140) * MM, deckZ * MM)
      bowl.add(column)
      const spout = new Mesh(new CylinderGeometry(11 * MM, 11 * MM, 200 * MM, 12), steel)
      spout.rotation.x = Math.PI / 2
      spout.position.set(cx * MM, (T + 270) * MM, (deckZ + 100) * MM)
      bowl.add(spout)
      group.add(bowl)
    } else {
      const top = new Mesh(new BoxGeometry((w + 40) * MM, 6 * MM, (d + 40) * MM), glass)
      top.position.set(cx * MM, (T + 3) * MM, cz * MM)
      top.name = `countertop-cooktop-${cut.id}`
      group.add(top)
      for (const [ox, oz, r] of [
        [-130, 100, 90],
        [130, 100, 90],
        [0, -100, 100],
      ] as const) {
        const ring = new Mesh(new CylinderGeometry((r - 8) * MM, r * MM, 1 * MM, 32), steel)
        ring.position.set((cx + ox) * MM, (T + 6.5) * MM, (cz + oz) * MM)
        group.add(ring)
      }
    }
  }

  for (const child of group.children) {
    child.castShadow = true
    child.receiveShadow = true
  }
  return group
}
