import { useGLTF } from '@react-three/drei/core/Gltf'
import { useMemo } from 'react'
import {
  AnimationClip,
  BufferAttribute,
  BufferGeometry,
  type InterleavedBufferAttribute,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { avatarGender, avatarUrl, findAvatar } from './avatar-catalog'
import { foldCardTwins } from './avatar-hair'
import { bleedTexture } from './hair-bleed'
import { MOTION_SETS, scaledGaits } from './locomotion'

/** The hips carry the clips' only translation: their dips and bounce. */
const HIP_TRACK = 'Bip01_Pelvis.position'

/**
 * The shared clips fitted to one body. Every Rocketbox skeleton names and
 * orients its bones alike, so bone rotations carry over as they are; bone
 * offsets are the body's own (the clips' would impose the reference body's
 * proportions), except the hips' motion, scaled to this body's size.
 */
export function fitClips(clips: AnimationClip[], scale: number): AnimationClip[] {
  return clips.map((clip) => {
    const tracks = clip.tracks
      .filter((track) => track.name.endsWith('.quaternion') || track.name === HIP_TRACK)
      .map((track) => {
        if (track.name !== HIP_TRACK || scale === 1) return track
        const fitted = track.clone()
        for (let i = 0; i < fitted.values.length; i++) fitted.values[i]! *= scale
        return fitted
      })
    return new AnimationClip(clip.name, clip.duration, tracks)
  })
}

/** The attributes a look writes anew, as plain floats, in a body's geometry (see withPlainVertices). */
const REWRITTEN = new Set(['position', 'normal'])

const plainGeometries = new WeakMap<BufferGeometry, BufferGeometry>()

const isPlain = (attribute: BufferAttribute | InterleavedBufferAttribute) =>
  attribute instanceof BufferAttribute &&
  attribute.array instanceof Float32Array &&
  !attribute.normalized

/**
 * A loaded geometry with its positions and normals as plain floats, all
 * else shared with it; the same one for every character drawn from it.
 *
 * The WebGPU renderer builds a mesh's pipeline for the vertex formats of the
 * geometry it draws with a material, and keeps it whenever the mesh shows
 * that material, whatever geometry the mesh was given since: one laid out
 * otherwise is read in the old formats, its points thrown about the body's
 * bounds as a ball of shards. The Rocketbox files store positions and
 * normals quantized (16- and 8-bit, interleaved), while every geometry a
 * look puts in a mesh's place writes them as floats: reshaped
 * (avatar-shape.ts), made bald (avatar-hair.ts) or without its shoes
 * (avatar-feet.ts). Floats from the start, a mesh's geometries are all laid
 * out alike.
 */
export function withPlainVertices(geometry: BufferGeometry): BufferGeometry {
  const known = plainGeometries.get(geometry)
  if (known) return known
  const rewritten = Object.entries(geometry.attributes).filter(
    ([name, attribute]) => REWRITTEN.has(name) && !isPlain(attribute),
  )
  if (rewritten.length === 0) return geometry
  const plain = new BufferGeometry()
  plain.name = geometry.name
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    plain.setAttribute(name, attribute)
  }
  for (const [name, attribute] of rewritten) {
    const { count, itemSize } = attribute
    const values = new Float32Array(count * itemSize)
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < itemSize; c++) values[i * itemSize + c] = attribute.getComponent(i, c)
    }
    plain.setAttribute(name, new BufferAttribute(values, itemSize))
  }
  plain.setIndex(geometry.index)
  for (const { start, count, materialIndex } of geometry.groups) {
    plain.addGroup(start, count, materialIndex)
  }
  plain.setDrawRange(geometry.drawRange.start, geometry.drawRange.count)
  plainGeometries.set(geometry, plain)
  return plain
}

export function prepareModel(source: Object3D): Object3D {
  const model = cloneSkinned(source)
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry = withPlainVertices(mesh.geometry)
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Skinned bounds follow the bind pose, not the animated body.
    mesh.frustumCulled = false
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]
    for (const material of materials) {
      // Hair and lashes are alpha cards: cut them out instead of sorting them.
      // Not softened by alpha to coverage here: it writes the cut's soft
      // alpha, and the game's post-processing takes the scene's alpha for
      // where geometry is, so the cards' edges would let the background
      // through. A canvas drawn opaque with MSAA (the character studio's)
      // turns it on itself.
      if (material.transparent) {
        material.transparent = false
        material.alphaTest = 0.4
        material.depthWrite = true
      }
      if (material.alphaTest === 0) continue
      // Drei's texture and geometry themselves, shared by every character
      // drawn from them: none wants the black under the cards, nor a card's
      // two sides drawn over each other.
      const map = (material as MeshStandardMaterial).map
      if (map) bleedTexture(map)
      if (!Array.isArray(mesh.material)) foldCardTwins(mesh.geometry)
    }
  })
  return model
}

/**
 * A Rocketbox body ready to animate: its own mesh (cloned, so one avatar can
 * appear more than once), its gender's shared clips fitted to it, and the
 * gaits' strides scaled to its size — times `strideScale`, how much
 * further a look's legs reach (bodyStrideScale), so its feet don't slide.
 * Suspends while the files load.
 */
export function useAvatarBody(avatarId: string, strideScale = 1) {
  const avatar = findAvatar(avatarId)
  const motion = MOTION_SETS[avatarGender(avatar.id)]
  const body = useGLTF(avatarUrl(avatar.id))
  const moves = useGLTF(motion.url)
  const scale = avatar.hip / motion.hip
  const model = useMemo(() => prepareModel(body.scene), [body.scene])
  const clips = useMemo(() => fitClips(moves.animations, scale), [moves.animations, scale])
  const gaitSet = useMemo(
    () => ({ gaits: scaledGaits(motion.gaits, scale * strideScale) }),
    [motion, scale, strideScale],
  )
  return { avatar, motion, model, clips, gaitSet }
}
