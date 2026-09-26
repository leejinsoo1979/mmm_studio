import type { GeometryContext, LightSwitchNode } from '@pascal-app/core'
import { createDefaultMaterial, type RenderShading } from '@pascal-app/viewer'
import { BoxGeometry, Group, type Material, Mesh } from 'three'

/** Plate 70 × 120 mm, 8 mm proud of the wall; one rocker per gang. */
export const SWITCH_PLATE = { width: 0.07, height: 0.12, depth: 0.008 }

const materials = new Map<string, Material>()
function material(color: string, shading: RenderShading): Material {
  const key = `${color}:${shading}`
  let m = materials.get(key)
  if (!m) {
    m = createDefaultMaterial(color, 0.5, shading)
    materials.set(key, m)
  }
  return m
}

/** Origin at the plate centre on the wall face; +Z faces the room. */
export function buildLightSwitchGeometry(
  node: LightSwitchNode,
  _ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
): Group {
  const group = new Group()
  const { width: w, height: h, depth: d } = SWITCH_PLATE
  const plate = new Mesh(new BoxGeometry(w, h, d), material('#f4f4f1', shading))
  plate.position.z = d / 2
  plate.name = 'switch-plate'
  group.add(plate)
  const gap = 0.004
  const rw = (w - 0.012 - gap * (node.gangs - 1)) / node.gangs
  for (let g = 0; g < node.gangs; g += 1) {
    const on = node.on[g] === true
    const rocker = new Mesh(
      new BoxGeometry(rw, h - 0.03, 0.006),
      material(on ? '#ffd166' : '#e6e6e2', shading),
    )
    rocker.position.set(-w / 2 + 0.006 + rw / 2 + g * (rw + gap), 0, d + 0.003)
    // A pressed rocker tips its top in.
    rocker.rotation.x = on ? 0.12 : -0.12
    rocker.name = `switch-gang-${g}`
    group.add(rocker)
  }
  return group
}
