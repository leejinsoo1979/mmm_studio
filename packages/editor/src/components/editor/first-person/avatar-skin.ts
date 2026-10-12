import { isSkinMaterial, SKIN_EYE_ATTRIBUTE, SkinMaterial } from '@pascal-app/viewer'
import {
  BufferAttribute,
  type BufferGeometry,
  type Material,
  type Matrix4,
  type Mesh,
  type MeshPhysicalMaterial,
  MeshStandardMaterial,
  type SkinnedMesh,
  Vector3,
} from 'three'

/**
 * A Rocketbox body's skin, for the renderers' skin shading (the viewer's
 * skin-material.ts): its head and body materials made skin materials
 * (glTF loads the body's as standard), and its eyes' vertices marked on
 * the head, their whites shaded towards the lids and corners. The build
 * puts how much each texel is skin in the red channel of the roughness map
 * (build-rocketbox-character.py).
 */

/** How many times the skin's pore detail tiles across a part's texture: the body's spans far more of the body. */
const DETAIL_REPEAT = { head: 16, body: 40 } as const
/** Rocketbox's eyeball bones (not the lids' `…EyeBlinkTop`). */
const EYE_BONE = /Eye$/
/**
 * How an eye's white darkens away from its front (the iris): towards the
 * corners and rims, from RIM_FROM° to RIM_TO° off the front, by up to RIM;
 * under the upper lid, from LID_FROM° to LID_TO° above its middle, by up
 * to LID more; by DARKEST at most, so the white stays white, as the lid's
 * own shadow does the rest.
 */
const RIM = 0.2
const RIM_FROM = 14
const RIM_TO = 42
const LID = 0.15
const LID_FROM = 2
const LID_TO = 24
const DARKEST = 0.3

type Part = keyof typeof DETAIL_REPEAT

const partOf = (material: Material): Part | null =>
  (/_(head|body)$/.exec(material.name)?.[1] as Part | undefined) ?? null

const skinMaterials = new WeakMap<Material, SkinMaterial>()

/**
 * The skin material for one of a body's materials as loaded: the same one
 * for every character drawn from it. Rocketbox has no metal: the
 * metalness the map's blue would give is its compression's noise.
 */
export function skinMaterialOf(material: MeshStandardMaterial, part: Part): SkinMaterial {
  let skin = skinMaterials.get(material)
  if (!skin) {
    skin = new SkinMaterial({ detailRepeat: DETAIL_REPEAT[part] })
    if ((material as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
      skin.copy(material as MeshPhysicalMaterial)
    } else {
      // The standard material's own properties; the physical ones stay as plain as standard's.
      MeshStandardMaterial.prototype.copy.call(skin, material)
      skin.defines = { STANDARD: '', PHYSICAL: '' }
    }
    skin.metalnessMap = null
    skin.metalness = 0
    skinMaterials.set(material, skin)
  }
  return skin
}

/**
 * Makes a copy of a body's skin material the feet's: bare feet are skin all
 * over (they have no roughness map to say so texel by texel), socks none.
 */
export function feetSkin(material: Material, bare: boolean) {
  if (!isSkinMaterial(material)) return
  material.skin = bare && material.skin ? { ...material.skin, mask: 1 } : null
}

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/**
 * Per vertex of a skinned geometry (x, y pairs, as SKIN_EYE_ATTRIBUTE
 * holds them): 1 on the eyeballs (held at least half by an `eyeBones`
 * bone), and how much each eyeball's white is shaded there. Points are
 * placed by `bind` (the bind pose, facing +z).
 */
export function eyeShading(
  geometry: BufferGeometry,
  bind: Matrix4,
  eyeBones: readonly number[],
): Float32Array {
  const position = geometry.getAttribute('position')
  const joints = geometry.getAttribute('skinIndex')
  const weights = geometry.getAttribute('skinWeight')
  const count = position.count
  const out = new Float32Array(count * 2)
  const owner = new Int32Array(count).fill(-1)
  for (let i = 0; i < count; i++) {
    eyeBones.forEach((bone, eye) => {
      let weight = 0
      for (let k = 0; k < joints.itemSize; k++)
        if (joints.getComponent(i, k) === bone) weight += weights.getComponent(i, k)
      if (weight >= 0.5) owner[i] = eye
    })
  }
  const point = new Vector3()
  const centres = eyeBones.map(() => ({ sum: new Vector3(), count: 0 }))
  for (let i = 0; i < count; i++) {
    const eye = centres[owner[i]!]
    if (!eye) continue
    eye.sum.add(point.fromBufferAttribute(position, i).applyMatrix4(bind))
    eye.count++
  }
  for (let i = 0; i < count; i++) {
    const eye = centres[owner[i]!]
    if (!eye) continue
    const off = point
      .fromBufferAttribute(position, i)
      .applyMatrix4(bind)
      .sub(eye.sum.clone().divideScalar(eye.count))
      .normalize()
    const fromFront = (Math.acos(Math.min(1, Math.max(-1, off.z))) * 180) / Math.PI
    const above = (Math.asin(Math.min(1, Math.max(-1, off.y))) * 180) / Math.PI
    const shade =
      RIM * smoothstep(RIM_FROM, RIM_TO, fromFront) + LID * smoothstep(LID_FROM, LID_TO, above)
    out[i * 2] = 1
    out[i * 2 + 1] = Math.min(DARKEST, shade)
  }
  return out
}

/**
 * Makes a prepared Rocketbox mesh's skin shadable as skin: its material
 * swapped for the skin material (head and body), and a head's eyes marked
 * on its geometry, shared by every character drawn from it.
 */
export function prepareSkin(mesh: Mesh) {
  if (Array.isArray(mesh.material)) return
  const part = partOf(mesh.material)
  const standard = mesh.material as MeshStandardMaterial
  if (!(part && standard.isMeshStandardMaterial)) return
  if (!isSkinMaterial(standard)) mesh.material = skinMaterialOf(standard, part)
  const skinned = mesh as SkinnedMesh
  if (part !== 'head' || !skinned.isSkinnedMesh) return
  const { geometry } = mesh
  if (geometry.hasAttribute(SKIN_EYE_ATTRIBUTE)) return
  if (!(geometry.hasAttribute('skinIndex') && geometry.hasAttribute('skinWeight'))) return
  const eyeBones = skinned.skeleton.bones.flatMap((bone, index) =>
    EYE_BONE.test(bone.name) ? [index] : [],
  )
  if (eyeBones.length === 0) return
  geometry.setAttribute(
    SKIN_EYE_ATTRIBUTE,
    new BufferAttribute(eyeShading(geometry, skinned.bindMatrix, eyeBones), 2),
  )
}
