import { type Material, type MeshStandardMaterial, type Texture, Vector2, Vector3 } from 'three'
import {
  BRDF_GGX,
  BRDF_Lambert,
  bitangentView,
  diffuseColor,
  float,
  mix,
  normalMap,
  normalView,
  normalViewGeometry,
  positionViewDirection,
  roughness,
  smoothstep,
  specularColor,
  tangentView,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshPhysicalNodeMaterial,
  PhysicalLightingModel,
  RepeatWrapping,
  type UniformNode,
} from 'three/webgpu'
import { SheenSafePhysicalNodeMaterial } from './sheen-safe-material'

/**
 * Shading for scanned and sculpted humans (any rigged glTF person): skin
 * that light sinks into, wet eyes, and hair and lashes cut from cards.
 * Generic — it knows surfaces by their materials' names, nothing of who
 * draws them.
 *
 * Skin: light wraps past the terminator further in red than in blue, and
 * red follows the smooth surface more than the bumps (light scattered under
 * the skin softens its shading, reddest where it is shallowest); its
 * highlight is two lobes, a tight one and a broad haze, as oily skin over
 * pores shows; and a tiling micro-relief (pores and creases, made here)
 * breaks the sheen where a texture has none. The rest is three's physical
 * model.
 */

export type HumanSurface = 'skin' | 'eyes' | 'hair' | 'lashes' | 'mouth' | 'cloth'

/**
 * A surface by its material's name, as the exporters of rigged people name
 * them (MakeHuman `Human.body`, Avaturn `Head`/`Body`, `AvatarHead`,
 * Character Creator `Std_Skin_Head`, MetaHuman `M_Head`): what isn't skin,
 * eyes, hair, lashes or the mouth is clothing.
 */
export function humanSurfaceOf(name: string): HumanSurface {
  const plain = name.toLowerCase()
  if (/lash|brow/.test(plain)) return 'lashes'
  if (/hair|ponytail|braid|bun\b|wig|bang/.test(plain)) return 'hair'
  if (/teeth|tooth|tongue|gum|mouth/.test(plain)) return 'mouth'
  if (/eye(?!lash|brow|ao|shadow|line)|cornea|iris|pupil|sclera|high-?poly/.test(plain)) {
    return /ao|occlusion|tear|meniscus|shell/.test(plain) ? 'cloth' : 'eyes'
  }
  if (/skin|body|head|face|^human$|human\.body|nail/.test(plain)) return 'skin'
  return 'cloth'
}

/** The skin model's settings: see SkinMaterial. */
export type SkinSettings = {
  /** How far (0–1) light wraps past the terminator, per channel. */
  wrap: [number, number, number]
  /** How much (0–1) each channel follows the smooth surface rather than the bumps. */
  soften: [number, number, number]
  /** The tight and broad highlight's roughness, as multiples of the surface's, and the broad one's share. */
  lobes: [number, number, number]
  /** How deep the micro-relief is, and how many times it tiles across the texture. */
  relief: number
  tiling: number
  /** The skin's index of refraction (its highlight's strength at normal incidence), and a scale on it. */
  ior: number
  specular: number
  /** The skin's roughness where its material has no roughness texture. */
  roughness: number
}

export const DEFAULT_SKIN: SkinSettings = {
  wrap: [0.32, 0.13, 0.07],
  soften: [0.7, 0.35, 0.15],
  lobes: [0.8, 1.6, 0.3],
  relief: 0.22,
  tiling: 24,
  ior: 1.4,
  specular: 0.8,
  roughness: 0.62,
}

type SkinUniforms = {
  wrap: UniformNode<'vec3', Vector3>
  soften: UniformNode<'vec3', Vector3>
  lobes: UniformNode<'vec3', Vector3>
}

/** Three's physical model with the skin's diffuse and highlight (direct light only; the environment's is three's). */
class SkinLightingModel extends PhysicalLightingModel {
  constructor(private readonly skin: SkinUniforms) {
    super(false, false, false, false, false, false)
  }

  override direct(input: Parameters<PhysicalLightingModel['direct']>[0]) {
    const { lightDirection, lightColor, reflectedLight } = input as unknown as {
      lightDirection: any
      lightColor: any
      reflectedLight: { directDiffuse: any; directSpecular: any }
    }
    const { wrap, soften, lobes } = this.skin
    const smooth = normalViewGeometry
    const facing = (share: any): any =>
      (mix(normalView, smooth, share) as any).normalize().dot(lightDirection)
    const wrapped = (nDotL: any, amount: any): any => nDotL.add(amount).div(amount.add(1)).clamp()
    const diffuse = vec3(
      wrapped(facing(soften.x), wrap.x),
      wrapped(facing(soften.y), wrap.y),
      wrapped(facing(soften.z), wrap.z),
    )
    const lambert: any = BRDF_Lambert({ diffuseColor: diffuseColor.rgb })
    reflectedLight.directDiffuse.addAssign(diffuse.mul(lightColor).mul(lambert))
    const irradiance = normalView.dot(lightDirection).clamp().mul(lightColor)
    const lobe = (scale: any): any =>
      BRDF_GGX({
        lightDirection,
        f0: specularColor,
        f90: float(1),
        roughness: roughness.mul(scale).clamp(0.04, 1),
      })
    reflectedLight.directSpecular.addAssign(
      irradiance.mul(mix(lobe(lobes.x), lobe(lobes.y), lobes.z) as any),
    )
  }
}

/** A physical material whose direct light is the skin model's. */
export class SkinMaterial extends MeshPhysicalNodeMaterial {
  readonly skin: SkinUniforms = {
    wrap: uniform(new Vector3(...DEFAULT_SKIN.wrap)),
    soften: uniform(new Vector3(...DEFAULT_SKIN.soften)),
    lobes: uniform(new Vector3(...DEFAULT_SKIN.lobes)),
  }

  override setupLightingModel() {
    return new SkinLightingModel(this.skin)
  }
}

let relief: DataTexture | null = null

/**
 * A tiling micro-relief for skin (512², tangent-space normals): small round
 * pores about every nine texels and fine creases stretched one way, from a
 * seeded height field — the same every time, and nobody's picture.
 */
export function skinReliefTexture(): DataTexture {
  if (relief) return relief
  const size = 512
  const height = new Float32Array(size * size)
  let seed = 7
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const wrapIndex = (i: number) => ((i % size) + size) % size
  for (let k = 0; k < 3300; k++) {
    const cx = random() * size
    const cy = random() * size
    const radius = 0.9 + random() * 1.4
    const depth = 0.6 + random() * 0.6
    const reach = Math.ceil(radius * 2.5)
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = Math.floor(cx) + dx
        const y = Math.floor(cy) + dy
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (radius * radius)
        height[wrapIndex(y) * size + wrapIndex(x)]! -= depth * Math.exp(-d2)
      }
    }
  }
  const octave = (cells: number, amplitude: number, stretch: number) => {
    const grid = Float32Array.from({ length: cells * cells }, () => random() * 2 - 1)
    const at = (i: number, j: number) =>
      grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]!
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const fy = ((y / size) * cells) / stretch
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const tx = fx - x0
        const ty = fy - y0
        const sx = tx * tx * (3 - 2 * tx)
        const sy = ty * ty * (3 - 2 * ty)
        const a = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx
        const b = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx
        height[y * size + x]! += amplitude * (a * (1 - sy) + b * sy)
      }
    }
  }
  octave(64, 0.35, 1)
  octave(128, 0.25, 4)
  octave(32, 0.25, 1)
  const data = new Uint8Array(size * size * 4)
  const steep = 2.2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (i: number, j: number) => height[wrapIndex(j) * size + wrapIndex(i)]!
      const dx = (at(x + 1, y) - at(x - 1, y)) * steep
      const dy = (at(x, y + 1) - at(x, y - 1)) * steep
      const length = Math.hypot(dx, dy, 1)
      const p = (y * size + x) * 4
      data[p] = Math.round(((-dx / length) * 0.5 + 0.5) * 255)
      data[p + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255)
      data[p + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255)
      data[p + 3] = 255
    }
  }
  relief = new DataTexture(data, size, size)
  relief.wrapS = RepeatWrapping
  relief.wrapT = RepeatWrapping
  relief.generateMipmaps = true
  relief.minFilter = LinearMipmapLinearFilter
  relief.magFilter = LinearFilter
  relief.anisotropy = 8
  relief.needsUpdate = true
  return relief
}

/** A standard material's own settings (textures, factors) on a node material. */
function copyStandard(target: MeshPhysicalNodeMaterial, source: Material) {
  const from = source as MeshStandardMaterial
  target.name = from.name
  target.side = from.side
  target.color.copy(from.color)
  target.map = from.map
  target.normalMap = from.normalMap
  target.normalMapType = from.normalMapType
  target.normalScale.copy(from.normalScale ?? new Vector2(1, 1))
  target.roughness = from.roughness ?? 1
  target.roughnessMap = from.roughnessMap ?? null
  target.metalness = from.metalness ?? 0
  target.metalnessMap = from.metalnessMap ?? null
  target.aoMap = from.aoMap ?? null
  target.aoMapIntensity = from.aoMapIntensity ?? 1
  target.emissive.copy(from.emissive)
  target.emissiveMap = from.emissiveMap ?? null
  target.emissiveIntensity = from.emissiveIntensity ?? 1
  target.alphaMap = from.alphaMap ?? null
  target.alphaTest = from.alphaTest
  target.transparent = from.transparent
  target.opacity = from.opacity
  target.depthWrite = from.depthWrite
  target.envMapIntensity = from.envMapIntensity ?? 1
  target.vertexColors = from.vertexColors
  target.userData = { ...from.userData }
}

/** Where hair and lash cards are cut out of their alpha. */
const CARD_ALPHA_TEST = 0.35

/**
 * A rigged person's material made for its surface (see humanSurfaceOf):
 * skin on the skin model with the micro-relief, the eyes wet and glossy
 * with their rims shaded where the lids meet them, hair and lashes as
 * alpha-cut cards with a soft sheen along them, the mouth kept dim. Clothing
 * is returned as it is. `anisotropy` sharpens the textures at a slant.
 */
export function humanMaterial(
  source: Material,
  surface: HumanSurface,
  { anisotropy = 1, skin = DEFAULT_SKIN }: { anisotropy?: number; skin?: SkinSettings } = {},
): Material {
  const sharpen = (texture: Texture | null) => {
    if (texture) texture.anisotropy = Math.max(texture.anisotropy, anisotropy)
  }
  if (surface === 'cloth') {
    const standard = source as MeshStandardMaterial
    sharpen(standard.map ?? null)
    sharpen(standard.normalMap ?? null)
    return source
  }
  if (surface === 'skin') {
    const material = new SkinMaterial()
    copyStandard(material, source)
    material.skin.wrap.value.set(...skin.wrap)
    material.skin.soften.value.set(...skin.soften)
    material.skin.lobes.value.set(...skin.lobes)
    material.ior = skin.ior
    material.specularIntensity = skin.specular
    // Most exports come with no roughness texture for skin: skin sits about here.
    if (!material.roughnessMap) material.roughness = skin.roughness
    material.metalness = 0
    material.metalnessMap = null
    sharpen(material.map)
    sharpen(material.normalMap)
    const reliefMap = skinReliefTexture()
    const fine = texture(reliefMap, uv().mul(skin.tiling)).xyz.mul(2).sub(1)
    const base: any = material.normalMap
      ? normalMap(texture(material.normalMap), uniform(material.normalScale))
      : normalViewGeometry
    const across: any = tangentView.mul(fine.x)
    const up: any = (bitangentView as any).mul(fine.y)
    material.normalNode = base.add(across.add(up).mul(skin.relief)).normalize()
    return material
  }
  const material = new SheenSafePhysicalNodeMaterial()
  copyStandard(material, source)
  sharpen(material.map)
  sharpen(material.normalMap)
  if (surface === 'eyes') {
    material.roughness = 0.12
    material.roughnessMap = null
    material.metalness = 0
    material.clearcoat = 1
    material.clearcoatRoughness = 0.04
    // The eye's rim, where the lids and corners shade it, darkens.
    const rim = mix(
      float(0.45),
      float(1),
      smoothstep(0.05, 0.6, normalView.dot(positionViewDirection)),
    )
    const color = uniform(material.color)
    material.colorNode = material.map
      ? vec4(texture(material.map).rgb.mul(color).mul(rim), texture(material.map).a)
      : vec4(color.mul(rim), 1)
    return material
  }
  if (surface === 'mouth') {
    material.roughness = Math.max(0.35, material.roughness)
    material.envMapIntensity = 0.4
    return material
  }
  // Hair and lashes: cards cut out of their alpha, edges softened by MSAA;
  // a layer made to blend (a fluffy outer layer, fine lashes) still blends,
  // drawn after the rest without hiding what is behind it.
  if (material.transparent) {
    material.depthWrite = false
    material.alphaTest = Math.max(material.alphaTest, 0.02)
  } else {
    material.depthWrite = true
    material.alphaTest = Math.max(material.alphaTest, CARD_ALPHA_TEST)
    material.alphaToCoverage = true
  }
  material.metalness = 0
  material.roughness = surface === 'hair' ? 0.6 : 0.8
  if (surface === 'hair') {
    // A soft sheen in the hair's own colour (a white one greys it over).
    material.sheen = 1
    material.sheenRoughness = 0.4
    material.sheenNode = material.map
      ? texture(material.map).rgb.mul(uniform(material.color)).mul(0.6)
      : uniform(material.color).mul(0.6)
    material.specularIntensity = 0.5
  }
  material.envMapIntensity = 0.5
  return material
}
