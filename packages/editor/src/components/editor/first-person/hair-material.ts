import type { DirectionalLight, Mesh, SkinnedMesh } from 'three'
import {
  abs,
  asin,
  atan,
  attribute,
  cameraViewMatrix,
  clamp,
  cross,
  directionToColor,
  dot,
  exp,
  Fn,
  float,
  floor,
  fwidth,
  hash,
  int,
  ivec2,
  length,
  lightShadowMatrix,
  log2,
  materialEnvIntensity,
  max,
  min,
  mix,
  modelViewMatrix,
  mrt,
  mx_noise_float,
  normalLocal,
  normalViewGeometry,
  normalWorld,
  output,
  pmremTexture,
  positionGeometry,
  positionLocal,
  positionView,
  positionViewDirection,
  positionWorld,
  reference,
  saturate,
  select,
  smoothstep,
  step,
  tangentLocal,
  texture,
  textureLevel,
  textureLoad,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import {
  AddEquation,
  ClampToEdgeWrapping,
  Color,
  CustomBlending,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshStandardNodeMaterial,
  NoColorSpace,
  type NodeBuilder,
  NormalBlending,
  OneFactor,
  OneMinusDstAlphaFactor,
  PhysicalLightingModel,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  ZeroFactor,
} from 'three/webgpu'
import {
  ATLAS_HEIGHT,
  ATLAS_KINDS,
  ATLAS_LAYERS,
  ATLAS_TILE_WIDTH,
  type AtlasMip,
  LAYER_STRIDE,
  STRIP_LAYER,
  strandAtlas,
} from './hair-atlas'
import type { HairBuild } from './hair-grow'
import {
  HAIRLINE_STEPS,
  hairLookValues,
  rootsStyleValues,
  WOBBLE_OCTAVES,
  wobbleCorners,
} from './hair-shading'

/**
 * Generated hair's materials: the strands', the studio's soft pass over
 * them, and the root layer's, each one instance shared by every character.
 * What differs per character lives on that character's hair meshes and is
 * read per drawn object, so the shadow pass and any override pass see the
 * same values as the camera, and writing them needs no texture, look job
 * or new pipeline.
 */

/** three's TSL types cannot follow an attribute's swizzles or a lighting model's inputs. */
type N = any

/** A character's hair colours (#rrggbb; no tip colour: null), its shine (0–1), and its skin for the roots' tint. */
export type HairLook = { base: string; tip: string | null; shine: number; skin: string }

export type HairCharacter = { readonly meshes: readonly Mesh[] }

/** What the root layer takes from a build. */
export type RootsStyle = Pick<HairBuild, 'hairline' | 'part' | 'undercut'>

/** A character's values for the shared materials; its hair meshes share one (`mesh.userData.hair`). */
export type HairValues = {
  base: Color
  root: Color
  tip: Color
  skin: Color
  /** expR, expTRT, kR. */
  shine: Vector3
  /** Bind heights where an ombré tip starts (ear level) and is full (the cut). */
  ombre: Vector2
  /** Bind units over which the root's darker shade fades out (about 1.2 cm): also hair's scale for tip lengths. */
  rootFade: number
  /** The share of strips drawn (1 in the studio), and how much wider they are drawn for it. */
  detail: number
  width: number
  hairline: number[]
  /** x, fadeFrom, fadeTo, crown (see hair-shading's RootsStyleValues). */
  part: Vector4
  undercut: Vector4
}

export function newHairValues(): HairValues {
  const values: HairValues = {
    base: new Color(),
    root: new Color(),
    tip: new Color(),
    skin: new Color(),
    shine: new Vector3(),
    ombre: new Vector2(0.7, 0.5),
    rootFade: 0.0135,
    detail: 1,
    width: 1,
    hairline: new Array(HAIRLINE_STEPS).fill(0.7),
    part: new Vector4(),
    undercut: new Vector4(),
  }
  writeLook(values, { base: '#4f3426', tip: null, shine: 0.5, skin: '#c8987a' })
  writeRoots(values, {
    hairline: new Float32Array(HAIRLINE_STEPS).fill(0.7),
    part: { x: 0, fade: [-0.04, 0.08], crown: -0.02 },
    undercut: null,
  })
  return values
}

/**
 * Puts a character's values on one of its hair meshes. `core` is the
 * coverage under which this mesh draws nothing: the studio draws its outer
 * strips' cores alone (0.85) and their soft edges in the soft pass.
 */
export function holdHairValues(mesh: Mesh, values: HairValues, core = MIN_COVERAGE) {
  mesh.userData.hair = values
  mesh.userData.hairCore = core
}

const MIN_COVERAGE = 0.02
export const CORE_COVERAGE = 0.85

function writeLook(values: HairValues, look: HairLook) {
  const v = hairLookValues(look)
  values.base.setRGB(...v.base)
  values.root.setRGB(...v.root)
  values.tip.setRGB(...v.tip)
  values.skin.setRGB(...v.skin)
  values.shine.set(v.expR, v.expTRT, v.kR)
}

function writeRoots(values: HairValues, build: RootsStyle) {
  const v = rootsStyleValues(build)
  for (let i = 0; i < HAIRLINE_STEPS; i++) values.hairline[i] = v.hairline[i]!
  values.part.set(...v.part)
  values.undercut.set(...v.undercut)
}

function eachValues(character: HairCharacter, write: (values: HairValues) => void) {
  const seen = new Set<HairValues>()
  for (const mesh of character.meshes) {
    const values = mesh.userData.hair as HairValues | undefined
    if (!values || seen.has(values)) continue
    seen.add(values)
    write(values)
  }
}

/** Gives a character's hair its colours and shine, from the next frame. */
export function setHairLook(character: HairCharacter, look: HairLook): void {
  eachValues(character, (values) => writeLook(values, look))
}

/** Gives a character's root layer the hairline, part and undercut of the build it wears. */
export function setRootsStyle(character: HairCharacter, build: RootsStyle): void {
  eachValues(character, (values) => writeRoots(values, build))
}

// --- The atlas -------------------------------------------------------------

let atlas: DataTexture | null = null

/**
 * The strand atlas as a texture, made once and never disposed. One 2D
 * texture rather than an array texture: r184's WebGPU backend uploads only
 * an array texture's first mip. `mips` lets a worker make it.
 */
export function hairAtlas(mips?: AtlasMip[]): DataTexture {
  if (atlas) return atlas
  const levels = mips ?? strandAtlas()
  const top = levels[0]!
  const made = new DataTexture(top.data, top.width, top.height, RGBAFormat, UnsignedByteType)
  made.mipmaps = levels.map(({ data, width, height }) => ({ data, width, height }))
  made.generateMipmaps = false
  made.minFilter = LinearMipmapLinearFilter
  made.magFilter = LinearFilter
  made.wrapS = ClampToEdgeWrapping
  made.wrapT = RepeatWrapping
  // The studio's own sharpening never reaches node materials.
  made.anisotropy = 8
  made.colorSpace = NoColorSpace
  made.name = 'hair-atlas'
  made.needsUpdate = true
  atlas = made
  return made
}

// --- Shared inputs ---------------------------------------------------------

const value = (name: keyof HairValues, type: string): N =>
  reference(`userData.hair.${name}`, type, null)

/** The key light's normal bias, cancelled on hair for hair's own. */
const shadowCancel = uniform(0)
/** Hair's own shadow bias (m): it must cover a camera-facing strip turning to face the light. */
const SELF_BIAS = 0.0025
/** 1 where the renderer has no MSAA (WebGPU compatibility): coverage becomes a hard edge. */
const hardEdges = uniform(0)

/** Rec. 709 luminance's square root: how far a colour is from dark, perceptually. */
const lightness = (c: N): N => dot(c, vec3(0.2126, 0.7152, 0.0722)).sqrt()

function strandInputs() {
  const data: N = attribute('hairData', 'vec4')
  const shape: N = attribute('hairShape', 'vec4')
  const layer = floor(shape.z.add(0.5).div(LAYER_STRIDE))
  const atlasLayer = shape.z.sub(layer.mul(LAYER_STRIDE))
  const at: N = uv()
  // Layers sit side by side. Clamping across to 2.5 texels, with each layer's two edge columns
  // empty, keeps a far mip's coverage the layer's own (measured on 4-12 px strips); clamping
  // to half a texel of the level sampled instead pulls a narrow strip's edges to its densest
  // middle and makes the wispy layers read twice as dense.
  const across = clamp(at.x, 2.5 / ATLAS_TILE_WIDTH, 1 - 2.5 / ATLAS_TILE_WIDTH)
  const atlasUv = vec2(atlasLayer.add(across).div(ATLAS_LAYERS), at.y)
  const map = hairAtlas()
  const texel = texture(map, atlasUv)
  const { wispy, stray } = ATLAS_KINDS
  const frays = atlasLayer
    .greaterThan(wispy.first - 0.5)
    .and(atlasLayer.lessThan(stray.first + stray.count - 0.5))
  const fray = float(1).sub(select(frays, 0.65, 0.45).mul(smoothstep(0.65, 1, data.x)))
  // Every strip's end breaks into sub-locks: each sixth across ends up to 6 mm short (at most
  // 8% of the strip), so a blunt cut stays blunt overall but never ends in a ruled line.
  const length_ = shape.y.div(max(data.x, 0.05))
  const short: N = hash(
    data.w
      .mul(7)
      .add(floor(at.x.mul(6)))
      .add(0.5),
  )
    .mul(value('rootFade', 'float').mul(0.5))
    .div(max(length_, 1e-4))
  const end = float(1).sub(min(short, 0.08))
  const ends = float(1).sub(smoothstep(end.sub(max(fwidth(data.x), 1e-4)), end, data.x))
  const coverage: N = texel.r.mul(fray).mul(ends)
  const shadowCoverage: N = textureLevel(texture(map), atlasUv, float(3)).r.mul(fray)
  const tangentView: N = modelViewMatrix
    .mul(vec4(tangentLocal, 0))
    .xyz.toVarying('v_hairTangent')
    .normalize()
  return { data, shape, layer, texel, coverage, shadowCoverage, tangentView }
}

const toBind = new Matrix4()

/** The camera (in the shadow pass, the light) in a hair mesh's bind space, through its head bone. */
function cameraInBind({ object, camera }: N, self: N) {
  const mesh = object as SkinnedMesh
  const bone = mesh.userData.hairBone as number
  const { bones, boneInverses } = mesh.skeleton
  toBind
    .multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse)
    .multiply(bones[bone]!.matrixWorld)
    .multiply(boneInverses[bone]!)
    .multiply(mesh.bindMatrix)
    .invert()
  return self.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(toBind)
}
const bindCamera = uniform(new Vector3()).onObjectUpdate(cameraInBind as N)

/**
 * Turns the strip from its centreline to its width: inner strips flat on
 * the head, the others toward the camera (in the shadow pass, the light).
 * In r184 positionLocal, normalLocal and tangentLocal are still bind-space
 * here (skinning runs on what this returns), hence the camera in bind space.
 */
function expandStrip(shape: N, layer: N) {
  return Fn(() => {
    const along: N = tangentLocal.normalize()
    const toCamera = bindCamera.sub(positionLocal).normalize()
    // Arithmetic, not select(): a branch would set up normalLocal on its own side only,
    // leaving camera-facing strips with a zero normal.
    const facing = mix(toCamera, normalLocal, step(layer, 0.5))
    const upright: N = step(0.9, abs(along.y))
    const axis = vec3(upright, upright.oneMinus(), 0)
    const side = cross(along, facing)
    const safe = select(length(side).lessThan(1e-4), cross(along, axis), side).normalize()
    return positionLocal.add(safe.mul(shape.x.mul(value('width', 'float'))))
  })()
}

/** The generator's hairline wobble over azimuth a (hair-shading's hairlineWobble), from its noise corners. */
function wobbleOf(a: N): N {
  let sum: N = float(0)
  for (const octave of WOBBLE_OCTAVES) {
    const { first, values } = wobbleCorners(octave)
    const corners: N = uniformArray(Array.from(values), 'float')
    const x = a.mul(octave.freq)
    const i = floor(x)
    const f = x.sub(i)
    const t = f.mul(f).mul(f.mul(-2).add(3))
    const k = int(clamp(i.sub(first), 0, values.length - 2))
    sum = sum.add(mix(corners.element(k), corners.element(k.add(1)), t).mul(octave.amp))
  }
  return sum
}

// --- Lighting --------------------------------------------------------------

type HairShading = {
  albedo: N
  tangent: N
  normal: N
  /** 0 at the outside of the hair, 1 deep inside. */
  depth: N
  /** Root (0) to tip (1). */
  along: N
  shift: N
  expR: N
  expTRT: N
  kR: N
  kTRT: N
  /** R's colour: white on light hair, a little of the hair's hue on dark (brown gloss, not silver). */
  rTint: N
  /** R's strength along the strand. */
  rNoise: N
  scatter: N
  /** Wrapped diffuse: how much light reaches round past the terminator. */
  wrap: N
  /** The most deep hair and deep shadow may darken (dark hair less, so it never goes black). */
  deepest: N
}

const lobe = (tangent: N, half: N, exponent: N) => {
  const th = dot(tangent, half)
  return smoothstep(-1, 0, th).mul(max(float(1).sub(th.mul(th)), 1e-4).pow(exponent.mul(0.5)))
}

/**
 * Deeper hair is darker and more saturated. The saturation works on the
 * colour's own hue (each channel against the brightest) and goes gentler on
 * dark colours: a dark brown raised to a power would go black.
 */
function deepAlbedo(h: HairShading): N {
  const peak = max(max(h.albedo.x, h.albedo.y), max(h.albedo.z, 1e-4))
  const saturation = h.depth.mul(mix(0.6, 0.8, lightness(h.albedo)))
  return h.albedo.mul(h.albedo.div(peak).pow(saturation)).mul(mix(1, h.deepest.oneMinus(), h.depth))
}

/**
 * Hair's light: two shifted strand highlights (R, TRT in the hair's
 * colour), seen only from the lit side; wrapped diffuse darkening and
 * saturating with depth; tips glowing against a light behind; a capped
 * deep-shadow term; the environment along the fibre's bent normal. Each
 * light's highlight is capped at its colour, so resolved HDR edges never
 * sparkle.
 */
class HairLightingModel extends PhysicalLightingModel {
  constructor(private readonly hair: HairShading) {
    super()
  }

  private lightOn(L: N, lightColor: N, reflectedLight: Record<string, N>, withR: boolean) {
    const h = this.hair
    const normal = h.normal
    const V = positionViewDirection
    const H = L.add(V).normalize()
    const NL = dot(normal, L)
    const T1 = h.tangent.add(normal.mul(h.shift.sub(0.08))).normalize()
    const T2 = h.tangent.add(normal.mul(h.shift.add(0.12))).normalize()
    const visible = saturate(NL.mul(0.5).add(0.5)).pow(2)
    const trt = lobe(T2, H, h.expTRT).mul(h.kTRT).mul(h.albedo)
    // R reflects off the fibre's surface: gone with the light straight behind the fibre, so a
    // rim light never sheens the front.
    const across = (d: N) => d.sub(h.tangent.mul(dot(h.tangent, d))).normalize()
    const sameSide = saturate(dot(across(L), across(V)).mul(0.5).add(0.5)).sqrt()
    const r: N = withR
      ? h.rTint.mul(lobe(T1, H, h.expR).mul(h.kR).mul(h.rNoise).mul(sameSide))
      : vec3(0)
    const specular = min(r.add(trt), vec3(1)).mul(visible)
    const deep = max(
      h.deepest.oneMinus(),
      exp(h.depth.mul(-2.2).mul(float(1.25).sub(saturate(NL)))),
    )
    const diffuse = deepAlbedo(h)
      .mul(saturate(NL.mul(h.wrap.oneMinus()).add(h.wrap)))
      .mul(1 / Math.PI)
    const scatter = saturate(dot(V.negate(), L))
      .pow(4)
      .mul(h.albedo.mul(h.albedo))
      .mul(h.along.pow(1.5))
      .mul(h.scatter)
    reflectedLight.directDiffuse!.addAssign(lightColor.mul(diffuse.add(scatter)).mul(deep))
    reflectedLight.directSpecular!.addAssign(lightColor.mul(specular).mul(deep))
  }

  override direct({
    lightDirection,
    lightColor,
    reflectedLight,
  }: {
    lightDirection: N
    lightColor: N
    reflectedLight: Record<string, N>
  }) {
    this.lightOn(lightDirection, lightColor, reflectedLight, true)
  }

  /** Rect lights: diffuse and the tinted highlight only, from the rectangle's middle. */
  override directRectArea({
    lightColor,
    lightPosition,
    halfWidth,
    halfHeight,
    reflectedLight,
  }: {
    lightColor: N
    lightPosition: N
    halfWidth: N
    halfHeight: N
    reflectedLight: Record<string, N>
  }) {
    const toLight = lightPosition.sub(positionView)
    const area = length(halfWidth).mul(length(halfHeight)).mul(4)
    const reach = area.div(max(dot(toLight, toLight), 1e-4).mul(Math.PI))
    this.lightOn(toLight.normalize(), lightColor.mul(min(reach, 1)), reflectedLight, false)
  }

  override indirect(builder: NodeBuilder) {
    const h = this.hair
    const context = (builder as N).context as Record<string, N>
    const { irradiance, iblIrradiance, ambientOcclusion, reflectedLight } = context as Record<
      string,
      N
    > & {
      reflectedLight: Record<string, N>
    }
    const ambient = irradiance!
      .add(iblIrradiance!)
      .mul(deepAlbedo(h))
      .mul(1 / Math.PI)
    reflectedLight.indirectDiffuse!.addAssign(ambient.mul(ambientOcclusion!))
    const environment = (builder as unknown as { scene: { environment: unknown } | null }).scene
      ?.environment
    if (environment) {
      const V = positionViewDirection
      const bent = V.sub(h.tangent.mul(dot(h.tangent, V))).normalize()
      const direction = bent.add(h.normal).normalize().transformDirection(cameraViewMatrix)
      const sheen = pmremTexture(environment as never, direction, float(0.65)).rgb.mul(
        materialEnvIntensity,
      )
      reflectedLight.indirectSpecular!.addAssign(
        sheen.mul(h.albedo.mul(0.3).add(h.rTint.mul(0.02))).mul(ambientOcclusion!),
      )
    }
  }

  override ambientOcclusion() {}
}

// --- Deep opacity ------------------------------------------------------------

let deepLight: DirectionalLight | null = null
let byDepth = true
/** How fast light dies inside hair behind the first strands it meets (per metre): 1 cm in, 37% is left. */
const DEEP_DENSITY = 100

/**
 * Hair self-shadows by depth: the key light's shadow depth is read once
 * more to see how far behind the first hair toward the light a fragment
 * lies. WebGPU only (a compared depth texture cannot be read raw on WebGL 2).
 */
function deepShadow(builder: NodeBuilder, shadow: N): N {
  const light = deepLight
  const map = light?.shadow.map?.depthTexture
  const webgpu = (builder.renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend
    .isWebGPUBackend
  if (!light || !map || !webgpu || !byDepth) return shadow
  const camera = light.shadow.camera
  const at: N = lightShadowMatrix(light).mul(vec4(positionWorld, 1))
  const coord: N = at.xyz.div(at.w)
  const size = light.shadow.mapSize
  const x: N = clamp(floor(coord.x.mul(size.x)), 0, size.x - 1)
  const y: N = clamp(floor(coord.y.oneMinus().mul(size.y)), 0, size.y - 1)
  const first: N = textureLoad(texture(map), ivec2(x, y)).x
  const far: N = reference('far', 'float', camera)
  const behind: N = coord.z.sub(first).mul(far.sub(reference('near', 'float', camera)))
  const transmit = exp(max(behind.sub(SELF_BIAS), 0).mul(-DEEP_DENSITY))
  return max(shadow, transmit)
}

/**
 * Tells the hair materials which light's shadow is theirs (null: none):
 * its normal bias is cancelled for hair's own, and, where it can be read
 * and `depth` is on, its depth gives hair its self-shadow by depth.
 */
export function setHairKeyLight(light: DirectionalLight | null, depth = true) {
  deepLight = light
  byDepth = depth
  shadowCancel.value = light?.shadow.normalBias ?? 0
  for (const material of built) material.needsUpdate = true
}

/** Whether the renderer resolves coverage (MSAA); without it coverage is a hard edge. */
export function setHairCoverage(samples: number) {
  hardEdges.value = samples > 1 ? 0 : 1
}

const built: MeshStandardNodeMaterial[] = []

/**
 * The envelope normal, unflipped, for a frame's normal target, with how
 * much screen-space AO and ink it takes in `normal.a`.
 */
const normalMrt = (weight: number) =>
  mrt({ output, normal: vec4(directionToColor(normalViewGeometry), weight) })

/** Only while the frame has an MRT: drawn straight to the canvas, the mrtNode would replace the output. */
const withNormalTarget = (builder: NodeBuilder, target: N) =>
  (builder.renderer as N).getMRT() ? target : null

const shadowPosition = positionWorld.add(normalWorld.mul(float(SELF_BIAS).sub(shadowCancel)))

/** "Over" on alpha, so the frame's alpha stays 1 over the head; colour written as is. */
function blendOver(material: MeshStandardNodeMaterial) {
  material.alphaToCoverage = true
  material.blending = CustomBlending
  material.blendSrc = OneFactor
  material.blendDst = ZeroFactor
  material.blendEquation = AddEquation
  material.blendSrcAlpha = OneMinusDstAlphaFactor
  material.blendDstAlpha = OneFactor
  material.blendEquationAlpha = AddEquation
}

// --- Strands -----------------------------------------------------------------

export type StrandsKind = 'strands' | 'soft'

/**
 * Generated hair's strips. `strands` is opaque with its own coverage,
 * dithered by alpha to coverage; `soft` is the studio's second pass over
 * the outer strips: their soft edges, blended back to front.
 */
export class HairNodeMaterial extends MeshStandardNodeMaterial {
  static override get type() {
    return 'HairNodeMaterial'
  }

  readonly kind: StrandsKind
  private readonly hair: HairShading
  private readonly normalTarget: N

  constructor(kind: StrandsKind) {
    super()
    this.kind = kind
    const s = strandInputs()
    const { data, shape, coverage } = s
    const strand = data.w
    const lock = data.z
    const rootFade = smoothstep(0, value('rootFade', 'float'), shape.y)
    const ombre = value('ombre', 'vec2')
    const tipShare = float(1).sub(
      smoothstep(ombre.y, max(ombre.x, ombre.y.add(1e-4)), positionGeometry.y),
    )
    const tone = mix(
      mix(value('root', 'color'), value('base', 'color'), rootFade),
      value('tip', 'color'),
      tipShare,
    )
    const tint = hash(strand.add(17)).sub(0.5)
    const hue = vec3(tint.mul(0.04).add(1), 1, tint.mul(-0.04).add(1))
    const shade = hash(strand).sub(0.5).mul(0.12).add(1).mul(lock.sub(0.5).mul(0.24).add(1))
    const albedo = saturate(tone.mul(hue).mul(shade).mul(s.texel.g.mul(0.6).add(0.7)))
    // Crisp near; once a texel is under a pixel, the real fraction, dithered by A2C.
    const footprint = max(fwidth(uv().x).mul(ATLAS_TILE_WIDTH), fwidth(uv().y).mul(ATLAS_HEIGHT))
    const far = saturate(log2(max(footprint, 1e-4)).sub(2))
    const edge = smoothstep(0.5, max(fwidth(coverage), 1e-4).add(0.5), coverage)
    const alpha = kind === 'soft' ? coverage : mix(edge, coverage, far)
    this.colorNode = vec4(albedo, alpha)
    const core = reference('userData.hairCore', 'float', null)
    this.maskNode =
      kind === 'soft'
        ? coverage.greaterThan(MIN_COVERAGE).and(coverage.lessThan(CORE_COVERAGE))
        : coverage.greaterThanEqual(max(core, hardEdges.mul(0.5)))
    this.maskShadowNode = s.shadowCoverage.greaterThanEqual(0.4)
    this.positionNode = expandStrip(shape, s.layer)
    this.normalNode = normalViewGeometry
    this.receivedShadowPositionNode = shadowPosition
    this.receivedShadowNode = Fn(([shadow]: [N], builder: NodeBuilder) =>
      deepShadow(builder, shadow),
    ) as never
    const depth = data.y
    this.aoNode = max(0.45, float(1).sub(depth.mul(0.65)).mul(s.texel.a))
    this.normalTarget = normalMrt(0.25)
    this.roughness = 0.65
    this.metalness = 0
    this.side = DoubleSide
    this.shadowSide = DoubleSide
    this.alphaTest = 0
    if (kind === 'soft') {
      this.transparent = true
      this.depthWrite = false
      this.premultipliedAlpha = true
      this.blending = NormalBlending
    } else blendOver(this)
    // Highlight anti-aliasing: the exponent eases off on strips under 6 px, at low detail, and
    // where the fibre direction turns within a pixel (tangent variance, as Toksvig), so a
    // band that would land between two pixels widens instead of hopping strip to strip.
    const shine = value('shine', 'vec3')
    const detail = value('detail', 'float')
    const stripPixels = float(1).div(max(fwidth(uv().x), 1e-4))
    const narrow = saturate(float(1).sub(stripPixels.div(6)))
    const turn: N = fwidth(s.tangentView)
    const spread = dot(turn, turn)
    const ease = (exponent: N) => {
      const eased = mix(exponent, 16, narrow).mul(mix(0.5, 1, detail))
      return eased.div(eased.mul(spread).add(1))
    }
    const light = lightness(value('base', 'color'))
    const peak = value('base', 'color')
    const baseHue: N = peak.div(max(max(peak.x, peak.y), max(peak.z, 1e-4)))
    const period = value('rootFade', 'float').mul(5)
    this.hair = {
      albedo,
      tangent: s.tangentView,
      normal: normalViewGeometry,
      depth,
      along: data.x,
      shift: lock.mul(2).sub(1).mul(0.04).add(s.texel.b.sub(0.5).mul(0.04)),
      expR: ease(shine.x),
      expTRT: ease(shine.y),
      kR: shine.z.mul(mix(0.12, 2, light)),
      kTRT: hash(strand.add(5)).mul(0.8).add(0.6).mul(0.25),
      rTint: mix(vec3(1) as N, baseHue, light.oneMinus().mul(0.6)),
      rNoise: mx_noise_float(vec3(shape.y.div(period), strand.mul(0.37), 0))
        .mul(0.25)
        .add(1)
        .mul(s.texel.g.mul(1.2).add(0.4)),
      scatter: float(0.5),
      // Inner strips hang flat, some facing away from every light: they wrap further.
      wrap: select(s.layer.lessThan(STRIP_LAYER.mid - 0.5), 0.4, 0.25),
      deepest: mix(0.3, 0.45, light),
    }
    built.push(this)
  }

  override setupLightingModel() {
    return new HairLightingModel(this.hair) as never
  }

  override setup(builder: NodeBuilder) {
    this.mrtNode = withNormalTarget(builder, this.normalTarget)
    super.setup(builder)
  }
}

// --- Roots -------------------------------------------------------------------

/** One root's speckle cell (bind units, about 0.35 mm), stretched 3:1 along the comb. */
const ROOT_CELL = 0.0004
/** The buzz's three octaves of cells (bind units: about 0.4, 1.2 and 3.6 mm). */
const BUZZ_CELLS = [0.0004, 0.0012, 0.0036] as const
/** Shells (mm off the scalp) are told apart by height: under 1.2 mm is the root layer itself. */
const SHELL_HEIGHTS = [1.2, 2.2, 3.7] as const

/**
 * Bind-space cells of `size`, stretched 3:1 along the comb: each cell's
 * hash, and how sharp the cells may be drawn. Hard-edged cells alias until
 * they are a few pixels across (a 1-2 px cell crawled over the whole
 * undercut in the orbit), so they fade to their mean below 2 px and are
 * whole only from 4 px.
 */
function cells(bind: N, comb: N, across: N, normal: N, size: number, salt: N) {
  const cell = vec3(
    dot(bind, comb).div(size * 3),
    dot(bind, across).div(size),
    dot(bind, normal).div(size),
  )
    .add(4096)
    .floor()
  const id = hash(cell.x.add(cell.y.mul(157)).add(cell.z.mul(113)).add(salt))
  const pixels = float(size).div(max(length(fwidth(bind)), 1e-7))
  return { id, sharp: smoothstep(2, 4, pixels) }
}

/**
 * The scalp's root layer and the undercut's fur shells: roots fading into
 * the skin at the hairline and the part, and a buzz on the undercut.
 */
export class RootsNodeMaterial extends MeshStandardNodeMaterial {
  static override get type() {
    return 'RootsNodeMaterial'
  }

  private readonly hair: HairShading
  private readonly normalTarget: N

  constructor() {
    super()
    const scalp: N = attribute('scalpDir', 'vec4')
    const t = scalp.xyz
    const d = t.normalize()
    const height = scalp.w
    const a = atan(d.x, d.z)
    const e = asin(clamp(d.y, -1, 1))
    const absA = abs(a)
    const step_ = absA.div(Math.PI).mul(HAIRLINE_STEPS - 1)
    const i0 = min(floor(step_), HAIRLINE_STEPS - 2)
    const table = reference('userData.hair.hairline', 'float', null) as N
    const line = mix(table.element(int(i0)), table.element(int(i0).add(1)), step_.sub(i0))
    const inside = e.sub(line).add(wobbleOf(a))
    const grows = smoothstep(-0.04, 0.05, inside)
    // In the hairline band the roots never close over the skin.
    let density: N = min(grows, mix(0.8, 1, smoothstep(0.05, 0.25, inside)))
    const part = value('part', 'vec4')
    const partX = part.x.mul(float(1).sub(smoothstep(part.y, part.z, t.z.negate())))
    const partOpen = float(1)
      .sub(smoothstep(0.0017, 0.0045, abs(t.x.sub(partX))))
      .mul(smoothstep(part.w.sub(0.01), part.w.add(0.005), t.z))
      .mul(smoothstep(0.2, 0.35, e))
    density = min(density.mul(float(1).sub(partOpen.mul(0.6))), float(1).sub(partOpen.mul(0.2)))

    const bind = positionGeometry
    const comb = (attribute('comb', 'vec3') as N).normalize()
    const n = normalLocal.normalize()
    const across = cross(n, comb).normalize()
    const root = cells(bind, comb, across, n, ROOT_CELL, float(0))
    const facing: N = abs(dot(normalViewGeometry, positionViewDirection))
    const slant = float(1).sub(facing)
    const isShell: N = height.greaterThan(SHELL_HEIGHTS[0])

    // The buzz: density 0.55–0.9 over ~3 mm so skin glints through, broken by 1.2 and 3.6 mm
    // cells (the coarse one stays drawn at studio framing), each root a 0.4 mm cell up close.
    // Stacked fractional coverage under A2C dithers the same samples, so the shells draw whole
    // cells only, and fade out where those cells are too small: then the root layer carries
    // what the stack would.
    const undercut = value('undercut', 'vec4')
    const band: N = absA.greaterThan(0.95).and(e.lessThan(undercut.x))
    const hem = smoothstep(-0.03, 0.13, inside)
    const fine = cells(bind, comb, across, n, BUZZ_CELLS[0], float(1))
    const mid = cells(bind, comb, across, n, BUZZ_CELLS[1], float(2))
    const coarse = cells(bind, comb, across, n, BUZZ_CELLS[2], float(3))
    const patch = saturate(mx_noise_float(bind.div(0.0033)).mul(0.5).add(0.5))
    const buzz: N = saturate(
      mix(0.55, 0.9, patch)
        .add(mid.id.sub(0.5).mul(0.3).mul(mid.sharp))
        .add(coarse.id.sub(0.5).mul(0.25).mul(coarse.sharp)),
    )
      .mul(hem)
      .mul(mix(0.85, 1, slant))
    const stacked = min(1, buzz.add(0.1))
    const layerBuzz: N = mix(
      mix(stacked, buzz, mid.sharp),
      step(float(1).sub(buzz), fine.id),
      fine.sharp,
    )
    const shellCoverage: N = select(
      height.lessThan(SHELL_HEIGHTS[1]),
      undercut.y,
      select(height.lessThan(SHELL_HEIGHTS[2]), undercut.z, undercut.w),
    )
    const shellCell = cells(bind, comb, across, n, BUZZ_CELLS[1], height.mul(7))
    const shellBuzz: N = step(float(1).sub(shellCoverage.mul(buzz)), shellCell.id).mul(mid.sharp)

    density = density.mul(mix(0.65, 1, slant))
    const detail = value('detail', 'float')
    density = mix(density, grows, saturate(float(0.6).sub(detail).div(0.4)))
    const speckle = smoothstep(float(0.95).sub(density), float(1.05).sub(density), root.id)
    const rootsCoverage: N = mix(density, speckle, root.sharp)
    const coverage: N = select(
      band,
      select(isShell, shellBuzz, layerBuzz),
      rootsCoverage.mul(step(height, SHELL_HEIGHTS[0])),
    )

    const base: N = value('base', 'color')
    const jitter = hash(root.id.add(31)).sub(0.5).mul(0.16).add(1)
    const rootsAlbedo: N = mix(value('skin', 'color'), base, density.mul(0.3).add(0.55)).mul(jitter)
    // Short dense hair reads darker than the hair above it; ±15% in 2–4 mm patches.
    const buzzValue: N = mix(0.65, 0.75, coarse.id)
      .mul(mid.id.sub(0.5).mul(0.3).mul(mid.sharp).add(1))
      .mul(select(isShell, 1.05, 1))
    const buzzAlbedo: N = base.mul(buzzValue)
    const albedo: N = saturate(select(band as N, buzzAlbedo, rootsAlbedo) as N)
    this.colorNode = vec4(albedo, coverage)
    this.maskNode = coverage.greaterThan(max(MIN_COVERAGE, hardEdges.mul(0.5)))
    this.normalNode = normalViewGeometry
    this.receivedShadowPositionNode = shadowPosition
    this.normalTarget = normalMrt(0.6)
    this.roughness = 0.8
    this.metalness = 0
    this.alphaTest = 0
    blendOver(this)
    this.polygonOffset = true
    this.polygonOffsetFactor = -1
    this.polygonOffsetUnits = -2
    const tangent = modelViewMatrix.mul(vec4(comb, 0)).xyz.normalize()
    this.hair = {
      albedo,
      tangent,
      normal: normalViewGeometry,
      depth: float(0),
      along: float(0),
      shift: float(0),
      expR: float(60),
      expTRT: float(24),
      kR: float(0),
      // A buzz catches the light along its comb.
      kTRT: select(band, 0.35, 0.15),
      rTint: vec3(1),
      rNoise: float(1),
      scatter: float(0),
      wrap: float(0.25),
      deepest: float(0.3),
    }
    built.push(this)
  }

  override setupLightingModel() {
    return new HairLightingModel(this.hair) as never
  }

  override setup(builder: NodeBuilder) {
    this.mrtNode = withNormalTarget(builder, this.normalTarget)
    super.setup(builder)
  }
}

let materials: {
  strands: HairNodeMaterial
  soft: HairNodeMaterial
  roots: RootsNodeMaterial
} | null = null

/** The three shared materials, made on first use and never disposed (never clone one). */
export const hairMaterials = {
  get strands() {
    return made().strands
  },
  get soft() {
    return made().soft
  },
  get roots() {
    return made().roots
  },
}

function made() {
  materials ??= {
    strands: new HairNodeMaterial('strands'),
    soft: new HairNodeMaterial('soft'),
    roots: new RootsNodeMaterial(),
  }
  return materials
}
