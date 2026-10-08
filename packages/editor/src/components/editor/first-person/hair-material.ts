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
  ATLAS_LAYERS,
  ATLAS_TILE_WIDTH,
  type AtlasMip,
  strandAtlas,
} from './hair-atlas'
import type { HairBuild } from './hair-grow'
import { HAIRLINE_STEPS, hairLookValues, rootsStyleValues } from './hair-shading'

/**
 * Generated hair's materials: the strands', the studio's soft pass over
 * them, and the root layer's, each one instance shared by every character.
 * What differs per character (colours, shine, hairline, part, undercut)
 * lives on that character's hair meshes, so writing it is a value change:
 * no texture, no look job, no new pipeline.
 */

/**
 * A shader graph value. three's TSL types cannot follow an attribute's
 * swizzles or a lighting model's inputs, so the graph here is untyped.
 */
type N = any

/** A character's hair colours (#rrggbb; no tip colour: null), its shine (0–1), and its skin for the roots' tint. */
export type HairLook = { base: string; tip: string | null; shine: number; skin: string }

/** A character's hair meshes, which carry its own values for the shared materials. */
export type HairCharacter = { readonly meshes: readonly Mesh[] }

/** What the root layer takes from a build: its hairline, part and undercut. */
export type RootsStyle = Pick<HairBuild, 'hairline' | 'part' | 'undercut'>

/**
 * A character's values for the shared materials. Its hair meshes share one
 * (`mesh.userData.hair`); the materials read it per drawn object, so the
 * shadow pass and any override pass see the same values as the camera.
 */
export type HairValues = {
  base: Color
  root: Color
  tip: Color
  skin: Color
  /** The highlights' exponents (R, TRT) and R's strength. */
  shine: Vector3
  /** Bind heights where an ombré tip starts (ear level) and is full (the cut). */
  ombre: Vector2
  /** How far from the root (bind units, about 1.2 cm) the root's darker shade fades out. */
  rootFade: number
  /** The share of strips drawn (1 in the studio), and how much wider they are drawn for it. */
  detail: number
  width: number
  /** The root layer's hairline (33 steps of |a| over [0, π]), part (x, fade) and undercut (line, shells). */
  hairline: number[]
  part: Vector2
  undercut: Vector4
}

/** Fresh values: the default brown, a hairline at the crown, no part or undercut. */
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
    part: new Vector2(),
    undercut: new Vector4(),
  }
  writeLook(values, { base: '#4f3426', tip: null, shine: 0.5, skin: '#c8987a' })
  writeRoots(values, {
    hairline: new Float32Array(HAIRLINE_STEPS).fill(0.7),
    part: { x: 0, fade: 0 },
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

/** Coverage under which a strand texel is not drawn. */
const MIN_COVERAGE = 0.02
/** Coverage above which an outer texel is solid core, and below which the soft pass draws it. */
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
 * The strand atlas (hair-atlas.ts) as a texture, made once and never
 * disposed. `mips` lets a worker make it; otherwise it is made here.
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
  // The studio's own sharpening never reaches node materials, so the atlas sets its own.
  made.anisotropy = 8
  made.colorSpace = NoColorSpace
  made.name = 'hair-atlas'
  made.needsUpdate = true
  atlas = made
  return made
}

// --- Shared inputs ---------------------------------------------------------

/** One per-character value, read off the drawn mesh (see HairValues). */
const value = (name: keyof HairValues, type: string): N =>
  reference(`userData.hair.${name}`, type, null)

/** The light whose shadow is hair's: its normal bias is cancelled for a hair-sized one. */
const shadowCancel = uniform(0)
/** Hair's own shadow bias (m): it must cover a camera-facing strip turning to face the light. */
const SELF_BIAS = 0.0025
/** 1 where the renderer has no MSAA (WebGPU compatibility): coverage becomes a hard edge. */
const hardEdges = uniform(0)

/**
 * The shared strand inputs: the atlas texel, the strip's layers, where
 * along it, and its frame (unflipped on back faces: a card seen from behind
 * shades as from the front).
 */
function strandInputs() {
  const data: N = attribute('hairData', 'vec4')
  const shape: N = attribute('hairShape', 'vec4')
  const layer = floor(shape.z.add(0.5).div(16))
  const atlasLayer = shape.z.sub(layer.mul(16))
  const across = clamp(uv().x, 2.5 / ATLAS_TILE_WIDTH, 1 - 2.5 / ATLAS_TILE_WIDTH)
  const atlasUv = vec2(atlasLayer.add(across).div(ATLAS_LAYERS), uv().y)
  const map = hairAtlas()
  const texel = texture(map, atlasUv)
  // Wispy and stray layers fray more toward the tip.
  const wispy = atlasLayer.greaterThan(5.5).and(atlasLayer.lessThan(8.5))
  const fray = float(1).sub(select(wispy, 0.65, 0.45).mul(smoothstep(0.65, 1, data.x)))
  const coverage: N = texel.r.mul(fray)
  const shadowCoverage: N = textureLevel(texture(map), atlasUv, float(3)).r.mul(fray)
  const tangentView: N = modelViewMatrix
    .mul(vec4(tangentLocal, 0))
    .xyz.toVarying('v_hairTangent')
    .normalize()
  return { data, shape, layer, atlasUv, texel, coverage, shadowCoverage, tangentView }
}

const toBind = new Matrix4()

/**
 * The camera (in the shadow pass, the light's) in a hair mesh's bind space,
 * through the bone its strips follow (`userData.hairBone`, the head's).
 */
function cameraInBind({ object, camera }: N, self: N) {
  const mesh = object as SkinnedMesh
  const bone = (mesh.userData.hairBone as number | undefined) ?? 0
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
 * Turns the strip from its centreline to its width. three runs a
 * material's position before skinning, so this works in bind space, with
 * the camera brought there through the strips' bone: inner strips lie flat
 * on the head (the side across `out`); the others face the camera — in
 * the shadow pass, the light — so they never turn edge-on.
 */
function expandStrip(shape: N, layer: N) {
  return Fn(() => {
    const along: N = tangentLocal.normalize()
    const toCamera = bindCamera.sub(positionLocal).normalize()
    // Arithmetic, not a branch: a branch would set up the normal only on its own side.
    const facing = mix(toCamera, normalLocal, step(layer, 0.5))
    // A strip pointing at the camera (or along its own normal) has no side: any across it will do.
    const upright: N = step(0.9, abs(along.y))
    const axis = vec3(upright, upright.oneMinus(), 0)
    const side = cross(along, facing)
    const safe = select(length(side).lessThan(1e-4), cross(along, axis), side).normalize()
    return positionLocal.add(safe.mul(shape.x.mul(value('width', 'float'))))
  })()
}

/** A smooth hairline-sized wobble on the bind position (see hair-shading.ts's ROOT_WOBBLE). */
const wobble = (p: N) =>
  mx_noise_float(p.mul(9))
    .mul(0.035)
    .add(mx_noise_float(p.mul(31)).mul(0.015))

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
  /** R's strength along the strand (breaks a strip's highlight into lengths). */
  rNoise: N
  scatter: N
}

/** A strand highlight lobe: strongest where the half vector is across the fibre. */
const lobe = (tangent: N, half: N, exponent: N) => {
  const th = dot(tangent, half)
  return smoothstep(-1, 0, th).mul(max(float(1).sub(th.mul(th)), 1e-4).pow(exponent.mul(0.5)))
}

/**
 * Deeper hair is darker and more saturated, as multiple scattering makes
 * it look. The saturation works on the colour's own hue (each channel
 * against the brightest), not on the colour itself: a dark brown raised
 * to a power would go black.
 */
function deepAlbedo(h: HairShading): N {
  const peak = max(max(h.albedo.x, h.albedo.y), max(h.albedo.z, 1e-4))
  return h.albedo.mul(h.albedo.div(peak).pow(h.depth.mul(1.5))).mul(mix(1, 0.6, h.depth))
}

/**
 * Hair's light: two shifted strand highlights (R untinted, TRT in the hair's
 * colour), seen only from the lit side; wrapped diffuse darkening and
 * saturating with depth; tips glowing against a light behind; a deep-shadow
 * term that never darkens by more than half; the environment seen along
 * the fibre's bent normal. Each light's highlight is capped at its
 * colour, so resolved HDR edges never sparkle.
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
    // R reflects off the fibre's surface: strongest with light and eye on the same side of the
    // fibre, gone with the light straight behind it (a rim light must not sheen the front).
    const across = (d: N) => d.sub(h.tangent.mul(dot(h.tangent, d))).normalize()
    const sameSide = saturate(dot(across(L), across(V)).mul(0.5).add(0.5)).sqrt()
    const r: N = withR ? lobe(T1, H, h.expR).mul(h.kR).mul(h.rNoise).mul(sameSide) : float(0)
    const specular = min(vec3(r).add(trt), vec3(1)).mul(visible)
    const deep = max(0.5, exp(h.depth.mul(-2.2).mul(float(1.25).sub(saturate(NL)))))
    const albedoDeep = deepAlbedo(h)
    const diffuse = albedoDeep.mul(saturate(NL.mul(0.75).add(0.25))).mul(1 / Math.PI)
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
    const albedoDeep = deepAlbedo(h)
    const ambient = irradiance!
      .add(iblIrradiance!)
      .mul(albedoDeep)
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
        sheen.mul(h.albedo).mul(0.3).mul(ambientOcclusion!),
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
 * The light hair self-shadows by: its own shadow depth is read once more to
 * see how far behind the first hair toward the light a fragment lies, so
 * hair just under the surface stays lit while deeper hair darkens. Only on
 * WebGPU (a compared depth texture cannot be read raw on WebGL 2).
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
  const texelAt = ivec2(x, y)
  const first: N = textureLoad(texture(map), texelAt).x
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
 * much screen-space AO and ink it takes (`normal.a`): what SSGI and the
 * denoiser read is the smooth hair volume, not each strip.
 */
const normalMrt = (weight: number) =>
  mrt({ output, normal: vec4(directionToColor(normalViewGeometry), weight) })

/** A material's MRT only while the frame has one: drawn alone, it would replace the frame's output. */
const withNormalTarget = (builder: NodeBuilder, target: N) =>
  (builder.renderer as N).getMRT() ? target : null

/** The shadow lookup moved off the light's normal bias onto hair's own. */
const shadowPosition = positionWorld.add(normalWorld.mul(float(SELF_BIAS).sub(shadowCancel)))

// --- Strands -----------------------------------------------------------------

export type StrandsKind = 'strands' | 'soft'

/**
 * Generated hair's strips (see hair-grow.ts for their vertices). `strands`
 * is opaque: its own coverage, dithered by alpha to coverage under MSAA,
 * with alpha blended "over" so the frame's alpha stays 1 over the head.
 * `soft` is the studio's second pass over the outer strips: their soft
 * edges, blended in back-to-front order.
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
    // Colour: a darker root over the first centimetre, an ombré from ear level to the cut.
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
    const shade = hash(strand).sub(0.5).mul(0.12).add(1).mul(lock.sub(0.5).mul(0.08).add(1))
    const albedo = saturate(tone.mul(hue).mul(shade).mul(s.texel.g.mul(0.3).add(0.85)))
    // Coverage: crisp near, the real fraction (dithered by A2C) once a texel is under a pixel.
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
    this.aoNode = max(0.3, float(1).sub(depth.mul(0.65)).mul(s.texel.a))
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
    } else {
      this.alphaToCoverage = true
      this.blending = CustomBlending
      this.blendSrc = OneFactor
      this.blendDst = ZeroFactor
      this.blendEquation = AddEquation
      this.blendSrcAlpha = OneMinusDstAlphaFactor
      this.blendDstAlpha = OneFactor
      this.blendEquationAlpha = AddEquation
    }
    // Highlights: shifted per lock and per fibre, sharp from shine, eased off on strips under 6 px.
    const shine = value('shine', 'vec3')
    const detail = value('detail', 'float')
    const stripPixels = float(1).div(max(fwidth(uv().x), 1e-4))
    const narrow = saturate(float(1).sub(stripPixels.div(6)))
    const ease = (exponent: N) => mix(exponent, 16, narrow).mul(mix(0.5, 1, detail))
    const period = value('rootFade', 'float').mul(5)
    this.hair = {
      albedo,
      tangent: s.tangentView,
      normal: normalViewGeometry,
      depth,
      along: data.x,
      shift: lock.mul(2).sub(1).mul(0.08).add(s.texel.b.sub(0.5).mul(0.04)),
      expR: ease(shine.x),
      expTRT: ease(shine.y),
      kR: shine.z,
      kTRT: hash(strand.add(5)).mul(0.8).add(0.6).mul(0.6),
      // The highlight breaks into lengths along the strand and into its fibres across it.
      rNoise: mx_noise_float(vec3(shape.y.div(period), strand.mul(0.37), 0))
        .mul(0.25)
        .add(1)
        .mul(s.texel.g.mul(1.2).add(0.4)),
      scatter: float(0.5),
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

/** Root-layer speckle: one cell per root, 0.35 mm, stretched 3:1 along the comb (bind units). */
const ROOT_CELL = 0.0004
/** The root layer's shells (mm off the scalp) are told apart by height: under 1.2 mm is the layer itself. */
const SHELL_HEIGHTS = [1.2, 2.2, 3.7] as const

/**
 * The scalp's root layer and the undercut's fur shells: roots fading into
 * the skin at the hairline and the part, a buzz on the undercut, denser at
 * a slant as real stubble is, with each root a speckle cell that fades to
 * its mean once smaller than two pixels (bind space, so it never crawls).
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
    const d = scalp.xyz.normalize()
    const height = scalp.w
    const a = atan(d.x, d.z)
    const e = asin(clamp(d.y, -1, 1))
    const absA = abs(a)
    const step = absA.div(Math.PI).mul(HAIRLINE_STEPS - 1)
    const i0 = min(floor(step), HAIRLINE_STEPS - 2)
    const table = reference('userData.hair.hairline', 'float', null) as N
    const line = mix(table.element(int(i0)), table.element(int(i0).add(1)), step.sub(i0))
    const bind = positionGeometry
    const inside = e.sub(line).add(wobble(bind))
    // The base fades the layer out toward the ears and its lower edge in scalpDir's length.
    const grows = smoothstep(-0.04, 0.05, inside).mul(length(scalp.xyz))
    // In the hairline band the roots never close over the skin.
    let density: N = min(grows, mix(0.8, 1, smoothstep(0.05, 0.25, inside)))
    const part = value('part', 'vec2')
    const partOpen = float(1)
      .sub(smoothstep(0.0017, 0.0045, abs(d.x.mul(0.105).sub(part.x))))
      .mul(smoothstep(part.y, part.y.add(0.4), d.z))
      .mul(smoothstep(0.2, 0.35, e))
    density = min(density.mul(float(1).sub(partOpen.mul(0.6))), float(1).sub(partOpen.mul(0.2)))
    // One cell per root, stretched along the comb; faded to its mean once under two pixels.
    const comb = (attribute('comb', 'vec3') as N).normalize()
    const n = normalLocal.normalize()
    const across = cross(n, comb).normalize()
    const cell = vec3(
      dot(bind, comb).div(ROOT_CELL * 3),
      dot(bind, across).div(ROOT_CELL),
      dot(bind, n).div(ROOT_CELL),
    )
      .add(4096)
      .floor()
    const cellHash = hash(cell.x.add(cell.y.mul(157)).add(cell.z.mul(113)))
    const cellPixels = float(ROOT_CELL).div(max(length(fwidth(bind)), 1e-7))
    const sharp = smoothstep(1, 2.5, cellPixels)
    const undercut = value('undercut', 'vec4')
    const band = absA.greaterThan(0.95).and(e.lessThan(undercut.x))
    const shell = height.greaterThan(SHELL_HEIGHTS[0])
    const shellCoverage = select(
      height.lessThan(SHELL_HEIGHTS[1]),
      undercut.y,
      select(height.lessThan(SHELL_HEIGHTS[2]), undercut.z, undercut.w),
    )
    // Under a pixel, every layer's coverage dithers the same samples, so the shells would add
    // nothing: the root layer then carries the whole stack's coverage itself.
    const stack = float(1).sub(
      float(0.15).mul(undercut.y.oneMinus()).mul(undercut.z.oneMinus()).mul(undercut.w.oneMinus()),
    )
    const layerCoverage: N = mix(stack, 0.85, sharp)
    const inBand: N = grows.mul(select(shell, shellCoverage, layerCoverage))
    density = select(band, inBand, select(shell, 0, density))
    const facing: N = abs(dot(normalViewGeometry, positionViewDirection))
    // Denser at a slant, as stubble is; a buzz keeps most of its density face on.
    density = density.mul(mix(select(band, 0.85, 0.65), 1, float(1).sub(facing)))
    const detail = value('detail', 'float')
    density = mix(density, grows, saturate(float(0.6).sub(detail).div(0.4)))
    const speckle = smoothstep(float(0.95).sub(density), float(1.05).sub(density), cellHash)
    const coverage = mix(density, speckle, sharp)
    const jitter = hash(cell.x.add(cell.y.mul(157)).add(cell.z.mul(113)).add(31))
      .sub(0.5)
      .mul(0.16)
      .add(1)
    // The root layer's tint follows how dense the roots are; a buzz is all hair.
    const toHair: N = select(band.or(shell), 0.85, density.mul(0.3).add(0.55))
    const albedo: N = saturate(
      mix(value('skin', 'color'), value('base', 'color'), toHair).mul(jitter),
    )
    this.colorNode = vec4(albedo, coverage)
    this.maskNode = coverage.greaterThan(max(MIN_COVERAGE, hardEdges.mul(0.5)))
    this.normalNode = normalViewGeometry
    this.receivedShadowPositionNode = shadowPosition
    this.normalTarget = normalMrt(0.6)
    this.roughness = 0.8
    this.metalness = 0
    this.alphaTest = 0
    this.alphaToCoverage = true
    this.blending = CustomBlending
    this.blendSrc = OneFactor
    this.blendDst = ZeroFactor
    this.blendEquation = AddEquation
    this.blendSrcAlpha = OneMinusDstAlphaFactor
    this.blendDstAlpha = OneFactor
    this.blendEquationAlpha = AddEquation
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
      kTRT: float(0.15),
      rNoise: float(1),
      scatter: float(0),
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
