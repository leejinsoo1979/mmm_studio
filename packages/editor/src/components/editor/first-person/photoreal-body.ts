'use client'

import { useGLTF } from '@react-three/drei/core/Gltf'
import { useEffect, useMemo, useState } from 'react'
import type { AnimationClip, Object3D } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { loadEmoteClips } from './emote-player'
import { type RigRest, retargetClip, rigRest } from './humanoid-rig'
import { MOTION_SETS, type MotionSet, scaledGaits } from './locomotion'
import type { PhotorealCharacter } from './photoreal-catalog'
import { postureHeight, preparePhotorealModel } from './photoreal-model'

/**
 * A 실사 body ready to draw and animate: its own copy of the file's mesh
 * in the human shading (photoreal-model.ts), and its gender's shared clips —
 * the Rocketbox motion capture the game's gaits and the studio's idle are
 * — carried onto its rig (humanoid-rig.ts). A rig this can't read as a
 * humanoid stands still in its file's pose, untouched by any clip.
 */

/** The shared motion's rig at rest, from its file's scene (a copy: the file's own is drei's). */
const motionRigs = new WeakMap<Object3D, RigRest | null>()

function motionRig(scene: Object3D): RigRest | null {
  let rig = motionRigs.get(scene)
  if (rig === undefined) {
    rig = rigRest(cloneSkinned(scene))
    motionRigs.set(scene, rig)
  }
  return rig
}

export type PhotorealBody = {
  character: PhotorealCharacter
  model: Object3D
  /** The body's rig at rest, null when it isn't a humanoid the clips can move. */
  rig: RigRest | null
  /** The rig the shared clips were made on, which the emotes are carried from too. */
  source: RigRest | null
  clips: AnimationClip[]
  motion: MotionSet
  /** Its hips' height (m), which scales the gaits' strides. */
  hip: number
  /** How tall it stands (m). */
  stature: number
  gaitSet: { gaits: MotionSet['gaits'] }
}

/**
 * A 실사 character's body (see above): its own mesh and the shared clips
 * on its rig, the gaits' strides scaled to its hips — times `strideScale`.
 * Suspends while the files load.
 */
export function usePhotorealBody(
  character: PhotorealCharacter,
  { anisotropy = 1, strideScale = 1 }: { anisotropy?: number; strideScale?: number } = {},
): PhotorealBody {
  const motion = MOTION_SETS[character.gender]
  const body = useGLTF(character.url)
  const moves = useGLTF(motion.url)
  const prepared = useMemo(() => {
    const model = preparePhotorealModel(body.scene, anisotropy)
    // Measured before any clip moves it.
    return { model, rig: rigRest(model), stature: postureHeight(model) }
  }, [body.scene, anisotropy])
  const source = motionRig(moves.scene)
  const { model, rig, stature } = prepared
  const clips = useMemo(
    () => (rig && source ? moves.animations.map((clip) => retargetClip(clip, source, rig)) : []),
    [rig, source, moves.animations],
  )
  const hip = rig?.hipHeight ?? motion.hip
  const gaitSet = useMemo(
    () => ({ gaits: scaledGaits(motion.gaits, (hip / motion.hip) * strideScale) }),
    [motion, hip, strideScale],
  )
  return { character, model, rig, source, clips, motion, hip, stature, gaitSet }
}

/** The emote clips carried onto a 실사 body (null until they arrive, and for a body the clips can't move). */
export function usePhotorealEmoteClips(
  body: PhotorealBody,
  wanted: boolean,
): AnimationClip[] | null {
  const { rig, source, character } = body
  const [clips, setClips] = useState<{ rig: RigRest; clips: AnimationClip[] } | null>(null)
  useEffect(() => {
    if (!(wanted && rig && source) || clips?.rig === rig) return
    let current = true
    loadEmoteClips(character.gender)
      .then((loaded) => {
        if (current) setClips({ rig, clips: loaded.map((clip) => retargetClip(clip, source, rig)) })
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [wanted, rig, source, character.gender, clips?.rig])
  return clips?.rig === rig ? clips.clips : null
}
