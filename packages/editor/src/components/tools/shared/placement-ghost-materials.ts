import { DoubleSide, Vector2 } from 'three'
import {
  abs,
  color,
  float,
  fract,
  fwidth,
  max,
  min,
  mix,
  normalLocal,
  positionLocal,
  positionWorld,
  smoothstep,
  step,
  time,
  uniform,
  uv,
} from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'

// inZOI's placement ghost vocabulary: a pale-cyan hologram volume with a fine
// grid + rising scan lines and crisp white edges while the drop is valid; a
// red 25 cm tile footprint (with a dark tile ring fading out around it) when
// it overlaps something.
export const GHOST_CYAN = 0x8f_e3_f7
export const GHOST_EDGE = 0xff_ff_ff

const GRID_CELLS_PER_METER = 10

/**
 * Translucent cyan volume for a ghost's bounding box. Grid lines follow the
 * box's local axes (ignoring the axis normal to each face); the top and bottom
 * faces stay clear so the object's real top surface reads through.
 */
export function createHologramMaterial(tint: number = GHOST_CYAN): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  const g = fract(positionLocal.mul(GRID_CELLS_PER_METER))
  const d = min(g, g.oneMinus())
  // Anti-aliased ~3.5 mm lines; fade out where the grid gets denser than a few
  // pixels per cell (zoomed out) so it never turns into a solid moiré.
  const w = fwidth(positionLocal.mul(GRID_CELLS_PER_METER))
  const lines = d.div(w.max(0.035)).clamp(0, 1).oneMinus()
  const density = smoothstep(float(0.2), float(0.45), max(max(w.x, w.y), w.z)).oneMinus()
  const masked = lines.mul(abs(normalLocal).oneMinus())
  const line = max(max(masked.x, masked.y), masked.z).mul(density)
  const scan = smoothstep(
    float(0),
    float(0.06),
    fract(positionWorld.y.mul(3).sub(time.mul(0.5))),
  ).oneMinus()
  const sides = step(abs(normalLocal.y), float(0.5))
  material.colorNode = mix(color(tint), color(0xff_ff_ff), max(line, scan).mul(0.7))
  // Editor overlays composite by their own alpha over a cleared target, which
  // roughly squares the authored opacity — this reads as ~35-40% on screen.
  material.opacityNode = float(0.58).add(line.mul(0.35)).add(scan.mul(0.2)).min(0.95).mul(sides)
  return material
}

export function createGhostEdgeMaterial(opacity = 0.85): LineBasicNodeMaterial {
  return new LineBasicNodeMaterial({
    color: GHOST_EDGE,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  })
}

export type FootprintTileMaterial = MeshBasicNodeMaterial & {
  /** Full plane size (footprint + ring) in the plane's UV axes. */
  setFootprint: (planeSize: [number, number], footprint: [number, number]) => void
}

/** Width of the dark tile ring that fades out around the red footprint. */
export const FOOTPRINT_RING = 0.9
const TILE = 0.25

/**
 * Red 25 cm tiles under the footprint with thin light grout, plus a ring of
 * dark translucent tiles fading out ~0.9 m around it. Built on the plane's UVs
 * so the same material works flat on a floor or upright against a wall.
 */
export function createFootprintTileMaterial(
  inside: string = '#e32a2a',
  ring: string = '#28140f',
): FootprintTileMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  }) as FootprintTileMaterial
  const planeSize = uniform(new Vector2(1, 1))
  const half = uniform(new Vector2(0.5, 0.5))
  const p = uv().sub(0.5).mul(planeSize)
  const ax = abs(p.x)
  const ay = abs(p.y)
  const inFootprint = step(ax, half.x).mul(step(ay, half.y))
  const ringD = max(ax.sub(half.x), ay.sub(half.y)).max(0)
  const ringFade = smoothstep(float(0), float(FOOTPRINT_RING), ringD).oneMinus()
  const cell = fract(p.add(half).div(TILE))
  const edge = min(min(cell.x, cell.y), min(cell.x.oneMinus(), cell.y.oneMinus()))
  const tile = smoothstep(float(0.02), float(0.06), edge)
  material.colorNode = mix(color('#ffffff'), mix(color(ring), color(inside), inFootprint), tile)
  material.opacityNode = mix(
    ringFade.mul(mix(float(0.5), float(0.75), tile)),
    mix(float(0.72), float(0.85), tile),
    inFootprint,
  )
  material.setFootprint = (size, footprint) => {
    planeSize.value.set(size[0], size[1])
    half.value.set(footprint[0] / 2, footprint[1] / 2)
  }
  return material
}

export type GridPatchMaterial = MeshBasicNodeMaterial & {
  /** `offset`: the plane centre relative to the footprint centre (the plane
   *  may be clipped off-centre by the host's edges). */
  setSize: (
    planeSize: [number, number],
    footprint: [number, number],
    offset?: [number, number],
  ) => void
}

/**
 * White 25 cm lattice patch on the host surface around a wall-mounted ghost,
 * aligned to the ghost's footprint and fading out `fadeDistance` past it.
 */
export function createGridPatchMaterial(opacity = 0.4, fadeDistance = 1.2): GridPatchMaterial {
  const material = new MeshBasicNodeMaterial({
    color: 0xff_ff_ff,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  }) as GridPatchMaterial
  const planeSize = uniform(new Vector2(1, 1))
  const half = uniform(new Vector2(0.5, 0.5))
  const center = uniform(new Vector2(0, 0))
  // Position relative to the footprint centre.
  const p = uv().sub(0.5).mul(planeSize).add(center)
  const q = p.add(half).div(TILE)
  const cell = fract(q)
  const d = min(cell, cell.oneMinus())
  const w = fwidth(q)
  const line = max(
    smoothstep(float(0), w.x.mul(1.2), d.x).oneMinus(),
    smoothstep(float(0), w.y.mul(1.2), d.y).oneMinus(),
  )
  const outside = abs(p).sub(half).max(0).length()
  const fade = smoothstep(float(fadeDistance * 0.35), float(fadeDistance), outside).oneMinus()
  material.opacityNode = line.mul(fade).mul(opacity)
  material.setSize = (size, footprint, offset = [0, 0]) => {
    planeSize.value.set(size[0], size[1])
    half.value.set(footprint[0] / 2, footprint[1] / 2)
    center.value.set(offset[0], offset[1])
  }
  return material
}

/**
 * Thin white floor grid (building-local XZ, `step` cells) for the room the
 * ghost is in. Anti-aliased with fwidth so it stays ~1 px wide at any zoom.
 */
export function createRoomGridMaterial(step = 0.5, opacity = 0.45) {
  const material = new MeshBasicNodeMaterial({
    color: 0xff_ff_ff,
    transparent: true,
    depthWrite: false,
  })
  const cellSize = uniform(step)
  const q = positionLocal.xz.div(cellSize)
  const cell = fract(q)
  const d = min(cell, cell.oneMinus())
  const w = fwidth(q)
  const line = max(
    smoothstep(float(0), w.x.mul(1.1), d.x).oneMinus(),
    smoothstep(float(0), w.y.mul(1.1), d.y).oneMinus(),
  )
  material.opacityNode = line.mul(opacity)
  return Object.assign(material, {
    setStep: (next: number) => {
      cellSize.value = next
    },
  })
}
