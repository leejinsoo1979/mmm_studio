import type { ElectricPanelNode, GeometryContext } from '@pascal-app/core'
import { createDefaultMaterial, type RenderShading } from '@pascal-app/viewer'
import { BoxGeometry, Group, type Material, Mesh } from 'three'

/** Enclosure 400 × 500 × 100 mm on the wall face; +Z faces the room. */
export const PANEL_BOX = { width: 0.4, height: 0.5, depth: 0.1 }

const materials = new Map<string, Material>()
function material(color: string, shading: RenderShading): Material {
  const key = `${color}:${shading}`
  let m = materials.get(key)
  if (!m) {
    m = createDefaultMaterial(color, 0.55, shading)
    materials.set(key, m)
  }
  return m
}

/** The enclosure with a row of breaker toggles (yellow = on). */
export function buildElectricPanelGeometry(
  node: ElectricPanelNode,
  _ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
): Group {
  const group = new Group()
  const { width: w, height: h, depth: d } = PANEL_BOX
  const box = new Mesh(new BoxGeometry(w, h, d), material('#d9dcdf', shading))
  box.position.z = d / 2
  box.name = 'panel-box'
  group.add(box)
  const n = Math.max(1, node.circuits.length)
  const bw = Math.min(0.05, (w - 0.06) / n)
  node.circuits.forEach((c, i) => {
    const breaker = new Mesh(
      new BoxGeometry(bw * 0.8, 0.07, 0.02),
      material(c.on ? '#ffd166' : '#495057', shading),
    )
    breaker.position.set(-((n - 1) * bw) / 2 + i * bw, 0.08, d + 0.01)
    breaker.name = `panel-breaker-${c.id}`
    group.add(breaker)
  })
  return group
}
