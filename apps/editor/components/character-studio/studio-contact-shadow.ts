import {
  Color,
  Group,
  HalfFloatType,
  Mesh,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  type Scene,
} from 'three'
import {
  cameraFar,
  cameraNear,
  Fn,
  float,
  positionLocal,
  positionView,
  pow,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  viewZToOrthographicDepth,
} from 'three/tsl'
import {
  MeshBasicNodeMaterial,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu'

/**
 * The soft shadow under the feet, as drei's ContactShadows drew it on the
 * WebGL stage: what stands within `far` of the floor, seen from below by an
 * orthographic camera, darker the nearer the floor, blurred twice and laid
 * on the floor in black. Here the nearest surface sets each texel (drei's
 * draws without a depth test, so whichever triangle came last did), the
 * blur runs in half floats, and the shadow is darkened by its blend being
 * linear: see SHADOW_GAMMA.
 */
export const CONTACT = {
  /** The shadow map's size (texels), the square of floor it covers (m) and how high it looks (m). */
  resolution: 512,
  scale: 2.6,
  far: 1.2,
  /** drei's blur: texels per 256 of the map, then again at 0.4 of it. */
  blur: 2.4,
  smooth: 0.4,
  opacity: 0.6,
  /** How far over the floor (m) it lies, above the platform. */
  lift: 0.003,
} as const

/**
 * The frame blends in linear light before Neutral tone maps it, where WebGL
 * blended the encoded colours. On the platform's dark tones Neutral goes as
 * the square of the light and the encoding as its 1/2.4 power, so a shadow
 * that lets k of the light through shows as k^(2/2.4) of it: letting
 * (1 − a)^1.2 through shows as 1 − a, as the WebGL shadow did.
 */
const SHADOW_GAMMA = 1.2

/** The renderer's clear colour with its alpha (three's Color4, which it does not export). */
type ClearColor = Parameters<WebGPURenderer['getClearColor']>[0]

/** Weights of drei's (three's) 9-tap Gaussian blur, from the middle out. */
const TAPS = [0.1633, 0.1531, 0.12245, 0.0918, 0.051] as const

function blurMaterial(source: Texture, direction: 'x' | 'y') {
  const step = uniform(0)
  const material = new NodeMaterial()
  material.fragmentNode = Fn(() => {
    const at = uv()
    const offset = direction === 'x' ? vec2(step, 0) : vec2(0, step)
    let sum = texture(source, at).mul(TAPS[0])
    for (let k = 1; k < TAPS.length; k++) {
      sum = sum
        .add(texture(source, at.sub(offset.mul(k))).mul(TAPS[k]!))
        .add(texture(source, at.add(offset.mul(k))).mul(TAPS[k]!))
    }
    return sum
  })()
  material.depthTest = false
  material.depthWrite = false
  return { quad: new QuadMesh(material), material, step }
}

export class ContactShadow {
  /** What the stage shows: the shadow on the floor. Hide it to hide the shadow (and skip drawing it). */
  readonly group = new Group()
  private readonly camera: OrthographicCamera
  private readonly map: RenderTarget
  private readonly blurred: RenderTarget
  private readonly depth: MeshBasicNodeMaterial
  private readonly across: ReturnType<typeof blurMaterial>
  private readonly along: ReturnType<typeof blurMaterial>
  private readonly plane: Mesh<PlaneGeometry, MeshBasicNodeMaterial>
  private readonly clear = Object.assign(new Color(), { a: 1 }) as ClearColor

  constructor() {
    const { resolution, scale, far, lift, opacity } = CONTACT
    const options = { type: HalfFloatType, generateMipmaps: false }
    this.map = new RenderTarget(resolution, resolution, options)
    this.blurred = new RenderTarget(resolution, resolution, { ...options, depthBuffer: false })

    // Looking up from the floor: its x is the world's x and its up the world's z.
    this.camera = new OrthographicCamera(-scale / 2, scale / 2, scale / 2, -scale / 2, 0, far)
    this.camera.position.y = lift
    this.camera.rotation.x = Math.PI / 2
    this.camera.updateMatrixWorld()

    this.depth = new MeshBasicNodeMaterial()
    this.depth.fragmentNode = vec4(
      vec3(0),
      viewZToOrthographicDepth(positionView.z, cameraNear, cameraFar).oneMinus(),
    )

    this.across = blurMaterial(this.map.texture, 'x')
    this.along = blurMaterial(this.blurred.texture, 'y')

    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    material.colorNode = vec3(0)
    // A texture's v runs down from its top: here the map's up, the world's +z.
    const shade = texture(
      this.map.texture,
      vec2(float(0.5).add(positionLocal.x.div(scale)), float(0.5).sub(positionLocal.z.div(scale))),
    ).a
    material.opacityNode = float(1).sub(pow(shade.mul(opacity).oneMinus(), SHADOW_GAMMA))
    this.plane = new Mesh(new PlaneGeometry(scale, scale).rotateX(-Math.PI / 2), material)
    this.plane.position.y = lift
    this.group.add(this.plane)
  }

  /**
   * Draws the shadow map for this frame: `scene` from below with only
   * depth, the shadow itself and `hidden` (the backdrop, the platform) left
   * out, then blurred. Leaves the renderer's target and clear colour as
   * they were.
   */
  update(renderer: WebGPURenderer, scene: Scene, hidden: (Object3D | null)[]) {
    const target = renderer.getRenderTarget()
    const clearAlpha = renderer.getClearAlpha()
    renderer.getClearColor(this.clear)
    const { background, overrideMaterial } = scene
    const shown = hidden.map((object) => object?.visible ?? false)
    this.group.visible = false
    for (const object of hidden) if (object) object.visible = false
    try {
      scene.background = null
      scene.overrideMaterial = this.depth
      renderer.setClearColor(0x000000, 0)
      renderer.setRenderTarget(this.map)
      renderer.render(scene, this.camera)
      scene.overrideMaterial = overrideMaterial
      this.blur(renderer, CONTACT.blur)
      this.blur(renderer, CONTACT.blur * CONTACT.smooth)
    } finally {
      scene.background = background
      scene.overrideMaterial = overrideMaterial
      hidden.forEach((object, index) => {
        if (object) object.visible = shown[index]!
      })
      this.group.visible = true
      renderer.setClearColor(this.clear, clearAlpha)
      renderer.setRenderTarget(target)
    }
  }

  private blur(renderer: WebGPURenderer, amount: number) {
    this.across.step.value = amount / 256
    this.along.step.value = amount / 256
    renderer.setRenderTarget(this.blurred)
    this.across.quad.render(renderer)
    renderer.setRenderTarget(this.map)
    this.along.quad.render(renderer)
  }

  dispose() {
    this.map.dispose()
    this.blurred.dispose()
    this.depth.dispose()
    this.across.material.dispose()
    this.along.material.dispose()
    this.plane.geometry.dispose()
    this.plane.material.dispose()
  }
}
