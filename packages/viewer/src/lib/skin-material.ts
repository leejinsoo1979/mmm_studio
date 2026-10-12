import {
  type BufferGeometry,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshPhysicalMaterial,
  type MeshPhysicalMaterialParameters,
  RepeatWrapping,
  type Texture,
} from 'three'
import {
  attribute,
  BRDF_GGX,
  BRDF_Lambert,
  diffuseColor,
  float,
  materialReference,
  materialRoughness,
  mix,
  nodeObject,
  normalMap,
  normalView,
  property,
  roughness,
  specularF90,
  subBuild,
  texture,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import {
  type Builder,
  type DirectInput,
  type PhysicalFeatures,
  SheenSafeLightingModel,
  SheenSafePhysicalNodeMaterial,
} from './sheen-safe-material'

/**
 * Skin shading for skin materials (SkinMaterial): light that wraps a little
 * round the terminator, further in red than in blue, as light scattered
 * under the skin does, over a shape seen through a softer copy of the
 * normal map; a broader second highlight over the main one, as skin's oily
 * top layer gives; and fine pores and creases from a tiling detail normal.
 * How much a texel is skin is the red channel of the material's roughness
 * map (glTF leaves it unused); a geometry may also carry `skinEye` (x: 1 on
 * an eyeball; y: how much its white is shaded towards the lids and
 * corners), whose eyes turn wet and sit in their sockets.
 *
 * Every renderer draws it while it is on (setSkinShading). Off, a skin
 * material is built as the plain physical one: it costs nothing then, and
 * turning it on or off rebuilds the skin materials' shaders once.
 */

/** The vertex attribute that marks a skin geometry's eyes (see above). */
export const SKIN_EYE_ATTRIBUTE = 'skinEye'

export type SkinSettings = {
  /** How many times the detail normal tiles across the material's UVs. */
  detailRepeat: number
  /** How much of it is skin where it has no roughness map to say: 0 when unset. */
  mask?: number
}

let skinOn = false

/** The skin materials there are (weakly): turning skin shading on or off rebuilds them. */
const live = new Set<WeakRef<SkinMaterial>>()
const gone = new FinalizationRegistry<WeakRef<SkinMaterial>>((ref) => live.delete(ref))

/** Whether every renderer draws skin materials as skin. */
export const skinShadingOn = () => skinOn

export function setSkinShading(on: boolean) {
  if (on === skinOn) return
  skinOn = on
  for (const ref of live) {
    const material = ref.deref()
    if (material?.skin) material.needsUpdate = true
  }
}

/**
 * A physical material that is skin (`skin`, null: not after all). Its
 * copies are too, which a plain material's userData couldn't promise the
 * renderer: it tells shaders apart by what this keys, not by userData.
 */
export class SkinMaterial extends MeshPhysicalMaterial {
  readonly isSkinMaterial = true
  skin: SkinSettings | null

  constructor(skin: SkinSettings | null = null, parameters?: MeshPhysicalMaterialParameters) {
    super(parameters)
    this.skin = skin
    const ref = new WeakRef(this)
    live.add(ref)
    gone.register(this, ref)
  }

  override copy(source: MeshPhysicalMaterial) {
    super.copy(source)
    const skin = (source as Partial<SkinMaterial>).isSkinMaterial
      ? (source as SkinMaterial).skin
      : this.skin
    this.skin = skin ? { ...skin } : null
    return this
  }

  override customProgramCacheKey() {
    const key = super.customProgramCacheKey()
    const skin = this.skin
    return skin && skinOn ? `${key}|skin:${skin.detailRepeat}:${skin.mask ?? 0}` : key
  }
}

export const isSkinMaterial = (material: unknown): material is SkinMaterial =>
  (material as Partial<SkinMaterial> | null)?.isSkinMaterial === true

/** How far the light wraps round, per channel (red furthest). */
const WRAP = [0.22, 0.1, 0.07] as const
/** How much the wrapped light rolls off into the shadow as its square does. */
const ROLL_OFF = 0.4
/**
 * Each channel's wrapped diffuse is `mix(t, t², ROLL_OFF)` of t = (n·l + w) /
 * (1 + w): over a whole sphere it catches (1 + w)(1 − ROLL_OFF / 3) of what
 * Lambert's n·l does. Divided by that, a channel keeps its energy, so a lit
 * ball keeps its colour and only its terminator turns red.
 */
const wrapEnergy = (w: number) => (1 + w) * (1 - ROLL_OFF / 3)
export const SKIN_DIFFUSE = {
  wrap: WRAP,
  rollOff: ROLL_OFF,
  energy: [wrapEnergy(WRAP[0]), wrapEnergy(WRAP[1]), wrapEnergy(WRAP[2])],
} as const
/** How far towards the softer normal each channel's diffuse light turns, and how soft (mip bias) that is. */
const SOFTEN = [0.7, 0.35, 0.15] as const
const SOFTEN_BIAS = 3
/** The main highlight's roughness, and skin's reflectance (F0 0.04 × this) under it. */
const LOBE_ROUGHNESS = 0.85
const REFLECTANCE = 0.7
/** The second, broader highlight: its roughness against the main one's, and its share. */
const SECOND_LOBE_ROUGHNESS = 1.4
const SECOND_LOBE = 0.1
/** How strongly the detail normal tilts the surface. */
const DETAIL = 0.13
/**
 * An eye's roughness: a wet cornea, mirroring its surroundings (the
 * studio's softboxes) sharply and brightly (EYE_REFLECTANCE × F0 0.04).
 * The lights themselves glint in it softly (EYE_GLINT, at F0 0.04), so
 * that only the brightest shows, and as a sheen, not a pinpoint each.
 */
const EYE_ROUGHNESS = 0.04
const EYE_REFLECTANCE = 2.5
const EYE_GLINT = 0.35

const DETAIL_SIZE = 512
const PORES = 3300

/**
 * A tiling detail normal map (RGBA, `size`², tangent space): fine pores
 * and creases from a height field made here, the same every time.
 */
export function skinDetailNormals(size = DETAIL_SIZE): Uint8Array {
  const height = new Float32Array(size * size)
  let seed = 7
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const wrap = (i: number) => ((i % size) + size) % size
  // Pores: small round dips, about one per 9 × 9 texels at 512.
  const pores = Math.round((PORES * size * size) / (DETAIL_SIZE * DETAIL_SIZE))
  for (let k = 0; k < pores; k++) {
    const cx = random() * size
    const cy = random() * size
    const radius = 0.9 + random() * 1.4
    const depth = 0.6 + random() * 0.6
    const reach = Math.ceil(radius * 2.5)
    const x0 = Math.floor(cx)
    const y0 = Math.floor(cy)
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d2 = ((x0 + dx - cx) ** 2 + (y0 + dy - cy) ** 2) / (radius * radius)
        height[wrap(y0 + dy) * size + wrap(x0 + dx)]! -= depth * Math.exp(-d2)
      }
    }
  }
  // Fine creases: tiling value noise over a lattice of `across` × `down` cells.
  const octave = (across: number, down: number, amplitude: number) => {
    const grid = Float32Array.from({ length: across * down }, () => random() * 2 - 1)
    const lattice = (f: number, cells: number) => {
      const i = Math.floor(f)
      const t = f - i
      return { i: i % cells, next: (i + 1) % cells, s: t * t * (3 - 2 * t) }
    }
    const columnAt = new Int32Array(size)
    const columnNext = new Int32Array(size)
    const columnShare = new Float32Array(size)
    for (let x = 0; x < size; x++) {
      const column = lattice((x / size) * across, across)
      columnAt[x] = column.i
      columnNext[x] = column.next
      columnShare[x] = column.s
    }
    for (let y = 0; y < size; y++) {
      const row = lattice((y / size) * down, down)
      const top = row.i * across
      const bottom = row.next * across
      for (let x = 0; x < size; x++) {
        const i = columnAt[x]!
        const next = columnNext[x]!
        const s = columnShare[x]!
        const above = grid[top + i]! * (1 - s) + grid[top + next]! * s
        const below = grid[bottom + i]! * (1 - s) + grid[bottom + next]! * s
        height[y * size + x]! += amplitude * (above * (1 - row.s) + below * row.s)
      }
    }
  }
  octave(64, 64, 0.35)
  // Creases run one way: four times as long as they are wide.
  octave(128, 32, 0.25)
  octave(32, 32, 0.25)
  const data = new Uint8Array(size * size * 4)
  const strength = 2.2
  for (let y = 0; y < size; y++) {
    const row = y * size
    const up = wrap(y - 1) * size
    const down = wrap(y + 1) * size
    for (let x = 0; x < size; x++) {
      const left = wrap(x - 1)
      const right = wrap(x + 1)
      const dx = (height[row + right]! - height[row + left]!) * strength
      const dy = (height[down + x]! - height[up + x]!) * strength
      const length = Math.sqrt(dx * dx + dy * dy + 1)
      const p = (y * size + x) * 4
      data[p] = Math.round((-dx / length / 2 + 0.5) * 255)
      data[p + 1] = Math.round((-dy / length / 2 + 0.5) * 255)
      data[p + 2] = Math.round((1 / length / 2 + 0.5) * 255)
      data[p + 3] = 255
    }
  }
  return data
}

let detailTexture: Texture | null = null

/** The detail normal (made once, on first use), shared by every skin. */
function skinDetail(): Texture {
  if (!detailTexture) {
    const made = new DataTexture(skinDetailNormals(), DETAIL_SIZE, DETAIL_SIZE)
    made.wrapS = RepeatWrapping
    made.wrapT = RepeatWrapping
    made.generateMipmaps = true
    made.minFilter = LinearMipmapLinearFilter
    made.magFilter = LinearFilter
    made.anisotropy = 8
    made.needsUpdate = true
    detailTexture = made
  }
  return detailTexture
}

/** r184's lighting properties the TSL index doesn't export. */
const diffuseContribution = nodeObject(property('vec3', 'DiffuseContribution'))
const specularColorBlended = nodeObject(property('color', 'SpecularColorBlended'))

/** What a skin material's build shares between its parts. */
type SkinNodes = {
  /** How much a texel is lit as skin: the mask, off the eyes. */
  amount: any
  /** The eye attribute; null without it. */
  eye: any | null
  /** The normal map, sampled as loaded, its scale and type; null without one. */
  normal: { texel: any; scale: any; type: number } | null
  /** The view normal through the softer normal map. */
  soft: any
  detailRepeat: number
}

/** The sheen-safe physical model, with skin's diffuse and second highlight blended in by `amount`. */
class SkinLightingModel extends SheenSafeLightingModel {
  constructor(
    features: PhysicalFeatures,
    private readonly skin: SkinNodes,
  ) {
    super(...features)
  }

  override direct(input: DirectInput, builder: Builder) {
    const { lightDirection, lightColor, reflectedLight } = input as unknown as {
      lightDirection: any
      lightColor: any
      reflectedLight: { directDiffuse: any; directSpecular: any }
    }
    const diffuse = vec3(0).toVar()
    const specular = vec3(0).toVar()
    super.direct(
      {
        ...input,
        reflectedLight: { ...reflectedLight, directDiffuse: diffuse, directSpecular: specular },
      } as unknown as DirectInput,
      builder,
    )
    const { amount, eye, soft } = this.skin
    const light = (this as unknown as { sheen: boolean }).sheen
      ? lightColor.mul(this.sheenEnergy(lightDirection))
      : lightColor
    const towards = (share: number) => mix(normalView, soft, share).normalize().dot(lightDirection)
    const facing = vec3(towards(SOFTEN[0]), towards(SOFTEN[1]), towards(SOFTEN[2]))
    const wrap = vec3(...WRAP)
    const wrapped = facing.add(wrap).div(wrap.add(1)).clamp()
    const lit = mix(wrapped, wrapped.mul(wrapped), ROLL_OFF).div(vec3(...SKIN_DIFFUSE.energy))
    const skinDiffuse = lit
      .mul(light)
      .mul((BRDF_Lambert as any)({ diffuseColor: diffuseContribution }))
    reflectedLight.directDiffuse.addAssign(mix(diffuse, skinDiffuse, amount))
    const irradiance: any = normalView.dot(lightDirection).clamp().mul(light)
    const highlight = (lobeRoughness: any, f0: any = specularColorBlended) =>
      irradiance.mul(
        BRDF_GGX({ lightDirection, f0, f90: specularF90, roughness: lobeRoughness } as any),
      )
    const skinSpecular = mix(
      specular,
      highlight(roughness.mul(SECOND_LOBE_ROUGHNESS).min(1)),
      amount.mul(SECOND_LOBE),
    )
    reflectedLight.directSpecular.addAssign(
      eye
        ? mix(
            skinSpecular,
            highlight(float(EYE_GLINT), specularColorBlended.div(EYE_REFLECTANCE)),
            eye.x,
          )
        : skinSpecular,
    )
  }
}

/**
 * The material the renderer draws every MeshPhysicalMaterial with:
 * sheen-safe, and lit as skin where it is a SkinMaterial while skin
 * shading is on. Everything it reads of the material — its maps above
 * all, which the copies a look makes swap — it reads by reference, as
 * three's own nodes do.
 */
export class SkinPhysicalNodeMaterial extends SheenSafePhysicalNodeMaterial {
  private skinBuild: SkinNodes | null = null

  override setup(builder: any) {
    this.skinBuild = this.skinNodes(builder)
    return super.setup(builder)
  }

  private skinNodes(builder: any): SkinNodes | null {
    const material = builder.material as SkinMaterial
    const settings = isSkinMaterial(material) ? material.skin : null
    if (!(settings && skinOn)) return null
    const geometry = builder.geometry as BufferGeometry
    const eye: any = geometry.hasAttribute(SKIN_EYE_ATTRIBUTE)
      ? attribute(SKIN_EYE_ATTRIBUTE, 'vec2')
      : null
    const mask = material.roughnessMap
      ? (materialReference('roughnessMap', 'texture') as any).r
      : float(settings.mask ?? 0)
    const amount = eye ? mask.mul(eye.x.oneMinus()) : mask
    const { detailRepeat } = settings
    if (!material.normalMap) return { amount, eye, normal: null, soft: normalView, detailRepeat }
    const normalTexture = materialReference('normalMap', 'texture') as any
    // Its texture node now, so a softer sample of it follows the material's map too.
    normalTexture.updateReference(builder)
    normalTexture.updateValue()
    const scale = materialReference('normalScale', 'vec2')
    const type = material.normalMapType ?? 0
    const softer = normalMap(normalTexture.node.bias(SOFTEN_BIAS), scale) as any
    softer.normalMapType = type
    return {
      amount,
      eye,
      normal: { texel: normalTexture, scale, type },
      // Built as the material's own normal is, on the surface's frame: in
      // the lighting, the frame round the view normal is the mapped one.
      soft: subBuild(softer, 'NORMAL', 'vec3'),
      detailRepeat,
    }
  }

  override setupNormal() {
    const skin = this.skinBuild
    if (!skin?.normal) return super.setupNormal()
    const surface = skin.normal.texel.xyz.mul(2).sub(1)
    const detail = texture(skinDetail(), uv().mul(skin.detailRepeat)).xyz.mul(2).sub(1)
    const detailed = vec3(surface.xy.add(detail.xy.mul(skin.amount.mul(DETAIL))), surface.z)
    const node = normalMap(detailed.normalize().mul(0.5).add(0.5), skin.normal.scale) as any
    node.normalMapType = skin.normal.type
    return node
  }

  override setupDiffuseColor(builder: any) {
    super.setupDiffuseColor(builder)
    const eye = this.skinBuild?.eye
    if (!eye) return
    diffuseColor.assign(vec4(diffuseColor.rgb.mul(eye.y.oneMinus()), diffuseColor.a))
  }

  override setupVariants(builder: any) {
    const skin = this.skinBuild
    // Before three's floor and its geometric anti-aliasing, so a small,
    // far eye's highlight doesn't sparkle.
    if (skin) {
      const lobe = (materialRoughness as any).mul(mix(1, LOBE_ROUGHNESS, skin.amount))
      this.roughnessNode = skin.eye ? mix(lobe, EYE_ROUGHNESS, skin.eye.x) : lobe
    }
    super.setupVariants(builder)
    if (!skin) return
    const reflectance = mix(1, REFLECTANCE, skin.amount)
    specularColorBlended.assign(
      specularColorBlended.mul(
        skin.eye ? mix(reflectance, EYE_REFLECTANCE, skin.eye.x) : reflectance,
      ),
    )
  }

  override setupLightingModel() {
    return this.skinBuild
      ? new SkinLightingModel(this.physicalFeatures(), this.skinBuild)
      : super.setupLightingModel()
  }
}

/**
 * Has the renderer draw every MeshPhysicalMaterial (glTF's, with sheen) as
 * SkinPhysicalNodeMaterial. Node materials are drawn as they are.
 */
export function installPhysicalMaterial(renderer: WebGPURenderer) {
  const library = (renderer as unknown as { library: { materialNodes: Map<string, unknown> } })
    .library
  library.materialNodes.set('MeshPhysicalMaterial', SkinPhysicalNodeMaterial)
}
