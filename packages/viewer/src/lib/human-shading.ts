import {
  type Material,
  type MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Texture,
  Vector2,
} from 'three'
import {
  float,
  mix,
  normalView,
  positionViewDirection,
  smoothstep,
  texture,
  uniform,
  vec4,
} from 'three/tsl'
import type { MeshPhysicalNodeMaterial } from 'three/webgpu'
import { SheenSafePhysicalNodeMaterial } from './sheen-safe-material'
import { SkinMaterial } from './skin-material'

/**
 * Shading for scanned and sculpted humans (any rigged glTF person): skin
 * that light sinks into, wet eyes, and hair and lashes cut from cards.
 * Generic — it knows surfaces by their materials' names, nothing of who
 * draws them. Skin is the renderers' skin shading (skin-material.ts),
 * always on and over all of it: such a character is made to be seen so.
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
/** How many times the skin's pore detail tiles across its texture: most exports put the whole body's skin on one. */
const SKIN_DETAIL_REPEAT = 24
/** The skin's roughness where its material has no roughness texture, as most exports have none for skin. */
const SKIN_ROUGHNESS = 0.62

/** A loaded material's skin: the same textures and factors, drawn as skin. */
function skinOf(source: Material): SkinMaterial {
  const material = new SkinMaterial({ detailRepeat: SKIN_DETAIL_REPEAT, mask: 1, always: true })
  if ((source as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    material.copy(source as MeshPhysicalMaterial)
  } else {
    // The standard material's own properties; the physical ones stay as plain as standard's.
    MeshStandardMaterial.prototype.copy.call(material, source as MeshStandardMaterial)
    material.defines = { STANDARD: '', PHYSICAL: '' }
  }
  if (!material.roughnessMap) material.roughness = SKIN_ROUGHNESS
  material.metalness = 0
  material.metalnessMap = null
  return material
}

/**
 * A rigged person's material made for its surface (see humanSurfaceOf):
 * skin drawn as skin (skinOf), the eyes wet and glossy with their rims
 * shaded where the lids meet them, hair and lashes as alpha-cut cards with
 * a soft sheen along them, the mouth kept dim. Clothing is returned as it
 * is. `anisotropy` sharpens the textures at a slant.
 */
export function humanMaterial(
  source: Material,
  surface: HumanSurface,
  { anisotropy = 1 }: { anisotropy?: number } = {},
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
    const material = skinOf(source)
    sharpen(material.map)
    sharpen(material.normalMap)
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
