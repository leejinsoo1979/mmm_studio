import { useGLTF } from '@react-three/drei/core/Gltf'
import { useMemo } from 'react'
import { AnimationClip, type Material, type Mesh, type Object3D } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { avatarGender, avatarUrl, findAvatar } from './avatar-catalog'
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

function prepareModel(source: Object3D): Object3D {
  const model = cloneSkinned(source)
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Skinned bounds follow the bind pose, not the animated body.
    mesh.frustumCulled = false
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]
    for (const material of materials) {
      // Hair and lashes are alpha cards: cut them out instead of sorting them.
      if (material.transparent) {
        material.transparent = false
        material.alphaTest = 0.4
        material.depthWrite = true
      }
    }
  })
  return model
}

/**
 * A Rocketbox body ready to animate: its own mesh (cloned, so one avatar can
 * appear more than once), its gender's shared clips fitted to it, and the
 * gaits' strides scaled to its size — times `heightScale`, how much taller
 * a look makes it (bodyHeightScale), so its feet don't slide. Suspends
 * while the files load.
 */
export function useAvatarBody(avatarId: string, heightScale = 1) {
  const avatar = findAvatar(avatarId)
  const motion = MOTION_SETS[avatarGender(avatar.id)]
  const body = useGLTF(avatarUrl(avatar.id))
  const moves = useGLTF(motion.url)
  const scale = avatar.hip / motion.hip
  const model = useMemo(() => prepareModel(body.scene), [body.scene])
  const clips = useMemo(() => fitClips(moves.animations, scale), [moves.animations, scale])
  const gaitSet = useMemo(
    () => ({ gaits: scaledGaits(motion.gaits, scale * heightScale) }),
    [motion, scale, heightScale],
  )
  return { avatar, motion, model, clips, gaitSet }
}
