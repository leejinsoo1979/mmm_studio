import {
  type BufferGeometry,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
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
  mix,
  nodeObject,
  normalMap,
  normalView,
  property,
  roughness,
  specularF90,
  texture,
  uniform,
  uv,
  vec2,
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
 * Skin shading for physical materials marked as skin (`markSkin`): light
 * that wraps a little round the terminator, further in red than in blue,
 * as light scattered under the skin does, over a shape seen through a
 * softer copy of the normal map; a broader second highlight over the
 * main one, as skin's oily top layer gives; and fine pores and creases
 * from a tiling detail normal. How much a texel is skin is the red channel
 * of the material's roughness map (glTF leaves it unused); a geometry may
 * also carry `skinEye` (x: 1 on an eyeball; y: how much its white is shaded
 * towards the lids and corners), whose eyes turn wet and sit in their
 * sockets. `skinShading` sets how much of it every renderer draws: at 0,
 * a marked material draws as any other.
 */

/** How much of the skin shading is drawn, 0–1, by every renderer: none until it is turned on. */
export const skinShading = uniform(0)

export function setSkinShading(amount: number) {
  skinShading.value = Math.min(1, Math.max(0, amount))
}

/** The vertex attribute that marks a skin geometry's eyes (see above). */
export const SKIN_EYE_ATTRIBUTE = 'skinEye'

const SKIN = 'skin'

type SkinSettings = { detailRepeat: number }

/**
 * Marks a material (its copies too: they carry its userData) as skin, its
 * detail normal tiled `detailRepeat` times across its UVs.
 */
export function markSkin(material: Material, detailRepeat: number) {
  material.userData[SKIN] = { detailRepeat } satisfies SkinSettings
}

export function skinSettings(material: {
  userData?: Record<string, unknown>
}): SkinSettings | null {
  const settings = material.userData?.[SKIN] as SkinSettings | undefined
  return settings && typeof settings.detailRepeat === 'number' ? settings : null
}

/** How far the light wraps round, per channel (red furthest). */
const WRAP = [0.22, 0.1, 0.07] as const
/** How far towards the softer normal each channel's diffuse light turns, and how soft (mip bias) that is. */
const SOFTEN = [0.7, 0.35, 0.15] as const
const SOFTEN_BIAS = 3
/** How much the wrapped light rolls off into the shadow as its square does. */
const ROLL_OFF = 0.4
/** The main highlight's roughness, and skin's reflectance (F0 0.04 × this) under it. */
const LOBE_ROUGHNESS = 0.85
const REFLECTANCE = 0.7
/** The second, broader highlight: its roughness against the main one's, and its share. */
const SECOND_LOBE_ROUGHNESS = 1.4
const SECOND_LOBE = 0.1
/** How strongly the detail normal tilts the surface. */
const DETAIL = 0.13
/** An eye's roughness: a wet cornea, catching the lights' reflections sharply. */
const EYE_ROUGHNESS = 0.04

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
  /** How much a texel is lit as skin: the shading drawn, times the mask, off the eyes. */
  amount: any
  /** The eye attribute (zero without it). */
  eye: any
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
    const { amount, soft } = this.skin
    const light = (this as unknown as { sheen: boolean }).sheen
      ? lightColor.mul(this.sheenEnergy(lightDirection))
      : lightColor
    const towards = (share: number) => mix(normalView, soft, share).normalize().dot(lightDirection)
    const facing = vec3(towards(SOFTEN[0]), towards(SOFTEN[1]), towards(SOFTEN[2]))
    const wrap = vec3(...WRAP)
    const wrapped = facing.add(wrap).div(wrap.add(1)).clamp()
    const lit = mix(wrapped, wrapped.mul(wrapped), ROLL_OFF)
    const skinDiffuse = lit
      .mul(light)
      .mul((BRDF_Lambert as any)({ diffuseColor: diffuseContribution }))
    reflectedLight.directDiffuse.addAssign(mix(diffuse, skinDiffuse, amount))
    const irradiance: any = normalView.dot(lightDirection).clamp().mul(light)
    const broad = BRDF_GGX({
      lightDirection,
      f0: specularColorBlended,
      f90: specularF90,
      roughness: roughness.mul(SECOND_LOBE_ROUGHNESS).min(1),
    } as any)
    reflectedLight.directSpecular.addAssign(
      mix(specular, irradiance.mul(broad), amount.mul(SECOND_LOBE)),
    )
  }
}

/**
 * The material the renderer draws every MeshPhysicalMaterial with:
 * sheen-safe, and lit as skin where marked. Everything it reads of the
 * material — its maps above all, which the copies a look makes swap — it
 * reads by reference, as three's own nodes do.
 */
export class SkinPhysicalNodeMaterial extends SheenSafePhysicalNodeMaterial {
  private skinBuild: SkinNodes | null = null

  override setup(builder: any) {
    this.skinBuild = this.skinNodes(builder)
    return super.setup(builder)
  }

  private skinNodes(builder: any): SkinNodes | null {
    const material = builder.material as Material & {
      normalMap?: Texture | null
      normalMapType?: number
      roughnessMap?: Texture | null
    }
    const settings = skinSettings(material)
    if (!settings) return null
    const geometry = builder.geometry as BufferGeometry
    const eye: any = geometry.hasAttribute(SKIN_EYE_ATTRIBUTE)
      ? attribute(SKIN_EYE_ATTRIBUTE, 'vec2')
      : vec2(0)
    const mask = material.roughnessMap
      ? (materialReference('roughnessMap', 'texture') as any).r
      : float(0)
    const amount = skinShading.mul(mask).mul(eye.x.oneMinus())
    const { detailRepeat } = settings
    if (!material.normalMap) return { amount, eye, normal: null, soft: normalView, detailRepeat }
    const normalTexture = materialReference('normalMap', 'texture') as any
    // Its texture node now, so a softer sample of it follows the material's map too.
    normalTexture.updateReference(builder)
    normalTexture.updateValue()
    const scale = materialReference('normalScale', 'vec2')
    return {
      amount,
      eye,
      normal: { texel: normalTexture, scale, type: material.normalMapType ?? 0 },
      soft: normalMap(normalTexture.node.bias(SOFTEN_BIAS), scale),
      detailRepeat,
    }
  }

  override setupNormal() {
    const skin = this.skinBuild
    if (!skin?.normal) return super.setupNormal()
    const surface = skin.normal.texel.xyz.mul(2).sub(1)
    const detail = texture(skinDetail(), uv().mul(skin.detailRepeat)).xyz.mul(2).sub(1)
    const detailed = vec3(surface.xy.add(detail.xy.mul(skin.amount.mul(DETAIL))), surface.z)
    // Exactly the map's own normal while no skin shading is drawn.
    const tangent = mix(surface, detailed.normalize(), skinShading)
    const node = normalMap(tangent.mul(0.5).add(0.5), skin.normal.scale) as any
    node.normalMapType = skin.normal.type
    return node
  }

  override setupDiffuseColor(builder: any) {
    super.setupDiffuseColor(builder)
    const skin = this.skinBuild
    if (!skin) return
    const shade = skin.eye.y.mul(skinShading).oneMinus()
    diffuseColor.assign(vec4(diffuseColor.rgb.mul(shade), diffuseColor.a))
  }

  override setupVariants(builder: any) {
    super.setupVariants(builder)
    const skin = this.skinBuild
    if (!skin) return
    roughness.assign(
      mix(
        roughness.mul(mix(1, LOBE_ROUGHNESS, skin.amount)),
        EYE_ROUGHNESS,
        skin.eye.x.mul(skinShading),
      ),
    )
    specularColorBlended.assign(specularColorBlended.mul(mix(1, REFLECTANCE, skin.amount)))
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
