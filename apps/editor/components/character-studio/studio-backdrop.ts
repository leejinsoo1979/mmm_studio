import { BufferGeometry, Float32BufferAttribute, Mesh, Vector2, Vector4 } from 'three'
import {
  clamp,
  dot,
  Fn,
  fract,
  length,
  max,
  min,
  mix,
  positionGeometry,
  screenCoordinate,
  select,
  smoothstep,
  sqrt,
  sRGBTransferEOTF,
  toneMappingExposure,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import type { StageInsets } from './stage-contract'

/**
 * The backdrop: a dark studio, lightest behind the character (the free
 * room's middle) and falling off to near black at the edges, with a faint
 * glow on the floor round the platform. It works in the view's own uv, so
 * any render size draws the same picture; a snapshot of part of the view
 * (`view`) draws its part of it. Its colours are sRGB, dithered by half a
 * level, and drawn as what the frame's tone mapping turns into them.
 */

/** The free room's middle in view uv (x from the left, y from the bottom). */
export function freeRoomCentre(
  size: { width: number; height: number },
  insets: StageInsets,
): { x: number; y: number } {
  const freeWidth = Math.max(1, size.width - insets.left - insets.right)
  const freeHeight = Math.max(1, size.height - insets.top - insets.bottom)
  return {
    x: (insets.left + freeWidth / 2) / size.width,
    y: 1 - (insets.top + freeHeight / 2) / size.height,
  }
}

/**
 * The floor glow's ellipse from the platform as the camera sees it (NDC):
 * its centre and where its rim crosses the x and z axes. Returns the
 * centre in view uv and the radii, across in view heights (`aspect` is the
 * view's width / height) and up in view uv.
 */
export function floorGlowEllipse(
  centre: { x: number; y: number },
  rimX: { x: number },
  rimZ: { y: number },
  aspect: number,
): [x: number, y: number, across: number, up: number] {
  const x = centre.x * 0.5 + 0.5
  const y = centre.y * 0.5 + 0.5
  return [x, y, Math.abs(rimX.x * 0.5 + 0.5 - x) * aspect, Math.abs(rimZ.y * 0.5 + 0.5 - y)]
}

const CENTRE = vec3(42, 46, 53).div(255)
const MIDDLE = vec3(20, 22, 26).div(255)
const EDGE = vec3(7, 8, 10).div(255)
const FLOOR = vec3(29, 34, 41).div(255)

/** neutralUntone (studio-tone.ts) in TSL: the linear colour Neutral tone maps to `linear`. */
const untone = Fn(([linear]: any[]) => {
  const darkest = max(min(linear.x, min(linear.y, linear.z)), 0)
  const offset = select(darkest.lessThan(0.04), sqrt(darkest).mul(0.4).sub(darkest), 0.04)
  return linear.add(offset).div(toneMappingExposure)
})

export type Backdrop = {
  mesh: Mesh<BufferGeometry, MeshBasicNodeMaterial>
  /** Which part of the whole view a render is (view uv: x, y from the bottom, width, height). */
  view: Vector4
  /** The view's width / height. */
  aspect: { value: number }
  /** The free room's middle (view uv), which the light falls off from. */
  centre: Vector2
  /** The floor glow's centre (view uv) and radii (floorGlowEllipse). */
  floorGlow: Vector4
}

export function createBackdrop(): Backdrop {
  const view = uniform(new Vector4(0, 0, 1, 1))
  const aspect = uniform(1)
  const centre = uniform(new Vector2(0.5, 0.5))
  const floorGlow = uniform(new Vector4(0.5, -1, 0, 0))

  const material = new MeshBasicNodeMaterial()
  // One triangle over the whole view, straight in clip space.
  material.vertexNode = vec4(positionGeometry.xy, 0.5, 1)
  const viewUv = varying(positionGeometry.xy.mul(0.5).add(0.5))
  material.fragmentNode = Fn(() => {
    const uv = view.xy.add(viewUv.mul(view.zw))
    // An ellipse 1.3 times as wide as it is tall, in the view's heights.
    const t = length(uv.sub(centre).mul(vec2(aspect.div(1.3), 1))).div(0.75)
    const ramp = select(
      t.lessThan(0.55),
      mix(CENTRE, MIDDLE, t.div(0.55)),
      mix(MIDDLE, EDGE, clamp(t.sub(0.55).div(0.45), 0, 1)),
    )
    const floorAt = uv
      .sub(floorGlow.xy)
      .mul(vec2(aspect, 1))
      .div(max(floorGlow.zw.mul(1.6), vec2(1e-4)))
    const lit = mix(ramp, FLOOR, smoothstep(0, 1, length(floorAt)).oneMinus().mul(0.25))
    const noise = fract(
      fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189),
    )
    return vec4(untone(sRGBTransferEOTF(lit.add(noise.sub(0.5).div(255)))), 1)
  })()
  material.depthTest = false
  material.depthWrite = false

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  return {
    mesh,
    view: view.value,
    aspect,
    centre: centre.value,
    floorGlow: floorGlow.value,
  }
}
