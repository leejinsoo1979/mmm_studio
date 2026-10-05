import {
  BufferAttribute,
  BufferGeometry,
  type Material,
  Matrix3,
  Matrix4,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  SkinnedMesh,
  Source,
  type Texture,
  Vector3,
} from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { avatarUrl } from './avatar-catalog'
import { type AtlasRect, type BodyBind, donorFeet } from './bare-feet'
import type { FeetDonor, FeetMesh, FittedFeet } from './feet-job'
import type { Footwear } from './footwear'
import { originalGeometry } from './head-geometry'
import type { Pixels } from './look-pixels'

/**
 * Borrowed bare feet on a character (see bare-feet.ts), as three.js puts
 * them on: the donors loaded, a body's bind pose read for the look worker,
 * and the fitted feet the worker sends back worn — the body mesh hidden
 * behind a copy of it without the shoe's triangles, and the feet a mesh of
 * their own on its skeleton, both dressed by the look.
 */

/** A skinned mesh's points, normals and skin in its bind pose, as flat arrays (see BodyBind). */
export function bodyBind(mesh: SkinnedMesh): BodyBind {
  const geometry = originalGeometry(mesh)
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  const skinIndex = geometry.getAttribute('skinIndex')
  const skinWeight = geometry.getAttribute('skinWeight')
  const count = position.count
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const joints = new Uint16Array(count * 4)
  const weights = new Float32Array(count * 4)
  const normalMatrix = new Matrix3().getNormalMatrix(mesh.bindMatrix)
  const v = new Vector3()
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(position, i)
      .applyMatrix4(mesh.bindMatrix)
      .toArray(positions, i * 3)
    if (normal)
      v.fromBufferAttribute(normal, i)
        .applyMatrix3(normalMatrix)
        .normalize()
        .toArray(normals, i * 3)
    if (uv) {
      uvs[i * 2] = uv.getX(i)
      uvs[i * 2 + 1] = uv.getY(i)
    }
    for (let k = 0; k < 4; k++) {
      joints[i * 4 + k] = skinIndex ? skinIndex.getComponent(i, k) : 0
      weights[i * 4 + k] = skinWeight ? skinWeight.getComponent(i, k) : 0
    }
  }
  const bones = mesh.skeleton.bones.map((bone) => bone.name)
  const bonePlaces = new Float32Array(bones.length * 3)
  const place = new Matrix4()
  mesh.skeleton.boneInverses.forEach((inverse, bone) => {
    v.setFromMatrixPosition(place.copy(inverse).invert()).toArray(bonePlaces, bone * 3)
  })
  const index = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: count }, (_, i) => i)
  return { positions, normals, uvs, joints, weights, index, bones, bonePlaces }
}

const binds = new WeakMap<BufferGeometry, BodyBind>()

/** A body mesh's bind pose (see bodyBind), read once per geometry (a body's clones share theirs). */
export function bindOf(mesh: SkinnedMesh): BodyBind {
  const geometry = originalGeometry(mesh)
  let found = binds.get(geometry)
  if (!found) {
    found = bodyBind(mesh)
    binds.set(geometry, found)
  }
  return found
}

/**
 * The two Rocketbox characters who are barefoot, with toes and nails
 * modelled (every other wears shoes, or sandals over only some of its
 * toes): the women's feet go on women and girls, the men's on the rest.
 */
const DONORS = { female: 'Sports_Female_01', male: 'Sports_Male_01' } as const

/** Whose feet a character borrows. */
export const donorFor = (avatarId: string) =>
  /Female/.test(avatarId) ? DONORS.female : DONORS.male

/**
 * A donor loaded: as the worker needs it (see FeetDonor), and its normal
 * map's part over its feet, laid out as the atlas is — the toes' and the
 * nails' relief, which only bare feet show.
 */
export type LoadedDonor = { donor: FeetDonor; normalMap: Texture | null }

/** The donor's body material: the only one its feet need. */
const BODY_MATERIAL = /_body$/

/** Loads a donor with its body's textures alone. */
function loadDonorModel(id: string) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  loader.register((parser) => ({
    name: 'feet-body-only',
    loadMaterial: (index: number) =>
      BODY_MATERIAL.test(parser.json.materials[index].name ?? '')
        ? null
        : Promise.resolve(new MeshBasicMaterial()),
  }))
  return loader.loadAsync(avatarUrl(id))
}

/** Parts of a picture side by side, as pixels. */
function cutOut(
  image: CanvasImageSource,
  rects: readonly AtlasRect[],
  width: number,
  height: number,
): Pixels {
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
  for (const rect of rects) {
    context.drawImage(
      image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      rect.at,
      0,
      rect.width,
      rect.height,
    )
  }
  return context.getImageData(0, 0, width, height)
}

/** A copy of `template` (its sampling, colour space, flip) showing `pixels`. */
function textureFrom(pixels: Pixels, template: Texture): Texture {
  const texture = template.clone()
  texture.source = new Source(new ImageData(pixels.data, pixels.width, pixels.height))
  texture.needsUpdate = true
  return texture
}

async function loadDonor(id: string): Promise<LoadedDonor> {
  const gltf = await loadDonorModel(id)
  let body: SkinnedMesh | null = null
  gltf.scene.traverse((object) => {
    const mesh = object as SkinnedMesh
    if (mesh.isSkinnedMesh && BODY_MATERIAL.test((mesh.material as Material).name)) body = mesh
  })
  const material = (body as SkinnedMesh | null)?.material as MeshStandardMaterial | undefined
  const image = material?.map?.image as
    | (CanvasImageSource & { width: number; height: number })
    | undefined
  if (!(body && material && image)) throw new Error(`feet ${id}: no body texture`)
  const bind = bodyBind(body)
  const { feet, rects, width, height } = donorFeet(bind, image.width, image.height)
  if (rects.length === 0) throw new Error(`feet ${id}: no feet`)
  const atlas = cutOut(image, rects, width, height)
  const normalImage = material.normalMap?.image as CanvasImageSource | undefined
  const normalMap =
    material.normalMap && normalImage
      ? textureFrom(cutOut(normalImage, rects, width, height), material.normalMap)
      : null
  for (const texture of [material.map, material.normalMap]) {
    const picture = texture?.image as ImageBitmap | undefined
    if (typeof ImageBitmap !== 'undefined' && picture instanceof ImageBitmap) picture.close()
    texture?.dispose()
  }
  gltf.scene.traverse((object) => (object as SkinnedMesh).geometry?.dispose())
  return { donor: { id, bones: bind.bones, feet, atlas }, normalMap }
}

const donors = new Map<string, Promise<LoadedDonor>>()

/** A donor's feet, loaded once (one that failed to load may be tried again). */
export function loadFeetDonor(id: string): Promise<LoadedDonor> {
  let found = donors.get(id)
  if (!found) {
    found = loadDonor(id)
    found.catch(() => donors.delete(id))
    donors.set(id, found)
  }
  return found
}

/**
 * Feet worn: the body mesh they replace the shoes of (hidden), the copy of
 * it shown in its place without them, and the feet's own mesh.
 */
type Worn = {
  key: string
  body: SkinnedMesh
  kept: SkinnedMesh
  feet: SkinnedMesh
  wasVisible: boolean
}

const wornOn = new WeakMap<Object3D, Worn>()

/** Whether a mesh is the copy of a body shown without its shoes (see wearFeet). */
export const isFeetCopy = (mesh: Object3D) => Boolean(mesh.userData.feetCopyOf)

/** A geometry's points with only some of its triangles (sharing its attributes). */
function withTriangles(geometry: BufferGeometry, index: Uint32Array) {
  const subset = new BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes))
    subset.setAttribute(name, attribute)
  subset.morphAttributes = geometry.morphAttributes
  subset.morphTargetsRelative = geometry.morphTargetsRelative
  subset.setIndex(new BufferAttribute(index, 1))
  subset.boundingBox = geometry.boundingBox
  subset.boundingSphere = geometry.boundingSphere
  return subset
}

/** Puts a new skinned mesh beside a body, on its skeleton, bound as it is. */
function besides(body: SkinnedMesh, geometry: BufferGeometry, material: Material, name: string) {
  const mesh = new SkinnedMesh(geometry, material)
  mesh.name = name
  mesh.position.copy(body.position)
  mesh.quaternion.copy(body.quaternion)
  mesh.scale.copy(body.scale)
  mesh.bind(body.skeleton, body.bindMatrix)
  mesh.castShadow = body.castShadow
  mesh.receiveShadow = body.receiveShadow
  mesh.layers.mask = body.layers.mask
  // Skinned bounds follow the bind pose, not the animated body.
  mesh.frustumCulled = false
  body.parent?.add(mesh)
  return mesh
}

/** The feet's mesh, from the bind pose into the body mesh's own space. */
function feetGeometry(body: SkinnedMesh, mesh: FeetMesh) {
  const geometry = new BufferGeometry()
  const unbind = body.bindMatrix.clone().invert()
  const position = new BufferAttribute(mesh.positions.slice(), 3).applyMatrix4(unbind)
  const normal = new BufferAttribute(mesh.normals.slice(), 3).applyNormalMatrix(
    new Matrix3().getNormalMatrix(unbind),
  )
  geometry.setAttribute('position', position)
  geometry.setAttribute('normal', normal)
  geometry.setAttribute('uv', new BufferAttribute(mesh.uvs, 2))
  geometry.setAttribute('skinIndex', new BufferAttribute(mesh.joints, 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(mesh.weights, 4))
  geometry.setIndex(new BufferAttribute(mesh.index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

/** Rocketbox skin's roughness (its bodies' metal-roughness maps hold about this over skin). */
const SKIN_ROUGHNESS = 0.8

/**
 * The feet's own material: the body's (so they catch the light as its
 * skin does), named as a look's part (`…_feet`, which the look dresses
 * with their texture) and showing none of the body's other maps, which
 * the feet's texture coordinates don't fit; bare feet show the donor's
 * own relief (`normalMap`), socks none.
 */
function feetMaterial(body: SkinnedMesh, normalMap: Texture | null, wear: Footwear) {
  const own = (body.userData.lookOriginal ?? body.material) as MeshStandardMaterial
  const material = own.clone()
  material.name = own.name.replace(/_body$/, '_feet')
  for (const slot of [
    'aoMap',
    'bumpMap',
    'emissiveMap',
    'lightMap',
    'metalnessMap',
    'roughnessMap',
    'alphaMap',
  ] as const) {
    if (slot in material) material[slot] = null
  }
  material.normalMap = wear === 'bare' ? normalMap : null
  // Without its map the body's factors (glTF's default, fully metallic)
  // would turn skin to dark bronze: Rocketbox skin is dielectric and matte.
  material.metalness = 0
  material.roughness = SKIN_ROUGHNESS
  // The body's vertex colours are its own; the feet have none, and a
  // missing colour attribute reads as black.
  material.vertexColors = false
  return material
}

/**
 * Puts fitted feet on a body (in place of any it wears): the body hidden
 * behind a copy of it without the hidden triangles, as loaded (the look's
 * shape, which follows the feet worn, reshapes it and the feet), dressed as
 * the body is, and the feet beside it with their own material. The same fit again leaves them be. Returns what is worn.
 */
export function wearFeet(
  model: Object3D,
  body: SkinnedMesh,
  fitted: FittedFeet,
  normalMap: Texture | null,
  wear: Footwear,
): Worn {
  const worn = wornOn.get(model)
  if (worn?.key === fitted.key && worn.body === body) return worn
  takeOffFeet(model)
  const original = originalGeometry(body)
  const corners = original.index?.array
  if (!corners) throw new Error('feet: a body without an index')
  const kept: number[] = []
  for (let t = 0; t < corners.length / 3; t++) {
    if (fitted.hidden[t]! < 0) kept.push(corners[t * 3]!, corners[t * 3 + 1]!, corners[t * 3 + 2]!)
  }
  const index = Uint32Array.from(kept)
  // As loaded: the look's shape reshapes it with the feet (see useAvatarShape).
  const copy = besides(
    body,
    withTriangles(original, index),
    body.material as Material,
    `${body.name}:feet`,
  )
  copy.userData.feetCopyOf = body
  if (body.userData.lookOriginal) copy.userData.lookOriginal = body.userData.lookOriginal
  const feet = besides(
    body,
    feetGeometry(body, fitted.mesh),
    feetMaterial(body, normalMap, wear),
    `${body.name}:bare-feet`,
  )
  const now: Worn = { key: fitted.key, body, kept: copy, feet, wasVisible: body.visible }
  body.visible = false
  wornOn.set(model, now)
  return now
}

/** The feet a model wears, or null. */
export const feetOn = (model: Object3D) => wornOn.get(model) ?? null

/** Takes borrowed feet off a model, showing its body (and shoes) again. */
export function takeOffFeet(model: Object3D) {
  const worn = wornOn.get(model)
  if (!worn) return
  wornOn.delete(model)
  worn.body.visible = worn.wasVisible
  for (const mesh of [worn.kept, worn.feet]) {
    mesh.removeFromParent()
    mesh.geometry.dispose()
    if (mesh.userData.shapeOriginal) (mesh.userData.shapeOriginal as BufferGeometry).dispose()
  }
  ;(worn.feet.userData.lookOriginal ?? worn.feet.material).dispose()
}
