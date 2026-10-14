'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  type AnimationAction,
  type AnimationClip,
  type AnimationMixer,
  LoopOnce,
  LoopRepeat,
} from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type AvatarGender, avatarGender, type RocketboxAvatar } from './avatar-catalog'
import { fitClips } from './avatar-rig'
import { EmoteFace, faceRest } from './emote-face'
import {
  EMOTES,
  type EmoteCue,
  type EmoteId,
  emoteClipsUrl,
  isEmoteId,
  ONCE_MAX_SECONDS,
} from './emotes'
import { MOTION_SETS } from './locomotion'

const emoteFiles = new Map<AvatarGender, Promise<GLTF>>()
const emoteFaces = new Map<AvatarGender, Promise<Map<EmoteId, EmoteFace>>>()

/** A gender's emotes file (one each, fetched the first time a body needs it). */
function loadEmoteFile(gender: AvatarGender): Promise<GLTF> {
  let file = emoteFiles.get(gender)
  if (!file) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    file = loader.loadAsync(emoteClipsUrl(gender))
    // A failed download can be tried again later.
    file.catch(() => emoteFiles.delete(gender))
    emoteFiles.set(gender, file)
  }
  return file
}

/** A gender's emote clips. */
export function loadEmoteClips(gender: AvatarGender): Promise<AnimationClip[]> {
  return loadEmoteFile(gender).then((gltf) => gltf.animations)
}

/** The faces a gender's emote clips make (emote-face.ts), by emote; those that move no face are left out. */
export function loadEmoteFaces(gender: AvatarGender): Promise<Map<EmoteId, EmoteFace>> {
  let faces = emoteFaces.get(gender)
  if (!faces) {
    faces = loadEmoteFile(gender).then((gltf) => {
      const found = new Map<EmoteId, EmoteFace>()
      const rest = faceRest(gltf.scene)
      if (!rest) return found
      for (const clip of gltf.animations) {
        const face = new EmoteFace(clip, rest)
        if (isEmoteId(clip.name) && face.moves) found.set(clip.name, face)
      }
      return found
    })
    faces.catch(() => emoteFaces.delete(gender))
    emoteFaces.set(gender, faces)
  }
  return faces
}

/** The faces of a gender's emotes (null until they arrive); fetched only once `wanted`. */
export function useEmoteFaces(
  gender: AvatarGender,
  wanted: boolean,
): ReadonlyMap<EmoteId, EmoteFace> | null {
  const [loaded, setLoaded] = useState<{
    gender: AvatarGender
    faces: Map<EmoteId, EmoteFace>
  } | null>(null)
  useEffect(() => {
    if (!wanted || loaded?.gender === gender) return
    let current = true
    loadEmoteFaces(gender)
      .then((faces) => {
        if (current) setLoaded({ gender, faces })
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [gender, loaded?.gender, wanted])
  return loaded?.gender === gender ? loaded.faces : null
}

/**
 * The emote clips fitted to a body (null until they arrive). They load only
 * once `wanted` — a body that never emotes never fetches them.
 */
export function useEmoteClips(avatar: RocketboxAvatar, wanted: boolean): AnimationClip[] | null {
  const gender = avatarGender(avatar.id)
  const [loaded, setLoaded] = useState<{ gender: AvatarGender; clips: AnimationClip[] } | null>(
    null,
  )
  useEffect(() => {
    if (!wanted || loaded?.gender === gender) return
    let current = true
    loadEmoteClips(gender)
      .then((clips) => {
        if (current) setLoaded({ gender, clips })
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [gender, loaded?.gender, wanted])
  const scale = avatar.hip / MOTION_SETS[gender].hip
  return useMemo(
    () => (loaded?.gender === gender ? fitClips(loaded.clips, scale) : null),
    [gender, loaded, scale],
  )
}

const FADE_IN = 7
const FADE_OUT = 5

/**
 * The emote layer over a body's other motion: starts each new cue's clip
 * from the top, fades it in over whatever the body was doing, and out again
 * when it ends (a one-off played through, or cut at ONCE_MAX_SECONDS), is
 * dropped, or the body moves off (`interrupted`).
 */
export class EmoteLayer {
  weight = 0
  private cue: EmoteCue | null = null
  private action: AnimationAction | null = null
  private fading: AnimationAction[] = []
  private played = 0
  /** The emote the body shows (playing, or fading out after it) and its clip's action. */
  private shown: { id: EmoteId; action: AnimationAction } | null = null
  private clips = new Map<string, AnimationClip>()

  constructor(private readonly mixer: AnimationMixer) {}

  /** The emote the body shows (fading in, playing or fading out); null when none does. */
  get showing(): EmoteId | null {
    return this.weight > 0 ? (this.shown?.id ?? null) : null
  }

  /** Where (s) the clip of the emote showing is. */
  get time(): number {
    return this.shown?.action.time ?? 0
  }

  setClips(clips: readonly AnimationClip[] | null) {
    this.clips = new Map((clips ?? []).map((clip) => [clip.name, clip]))
  }

  /** Whether the cue this layer took up has finished (so the caller can clear it). */
  finished(cue: EmoteCue | null) {
    return Boolean(cue && this.cue && cue.at === this.cue.at && !this.action)
  }

  /** Advances the layer; returns its weight (0–1) over the body's other motion. */
  update(cue: EmoteCue | null, interrupted: boolean, delta: number): number {
    if (cue && isEmoteId(cue.id) && (cue.at !== this.cue?.at || cue.id !== this.cue?.id)) {
      const clip = this.clips.get(cue.id)
      if (clip) {
        if (this.action) this.fading.push(this.action)
        const action = this.mixer.clipAction(clip)
        const loop = EMOTES[cue.id].loop
        action.reset()
        action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Number.POSITIVE_INFINITY : 1)
        action.clampWhenFinished = true
        action.setEffectiveWeight(0)
        action.play()
        this.action = action
        this.cue = cue
        this.shown = { id: cue.id, action }
        this.played = 0
      }
    }
    if (!cue && this.action && this.cue) this.end()

    let target = 0
    if (this.action && this.cue) {
      this.played += delta
      const clip = this.action.getClip()
      const once = !EMOTES[this.cue.id].loop
      const length = Math.min(clip.duration, ONCE_MAX_SECONDS)
      const ending = once && this.played >= length - 1 / FADE_OUT
      if (interrupted || ending) this.end()
      else target = 1
    }
    this.weight += (target - this.weight) * (1 - Math.exp(-(target ? FADE_IN : FADE_OUT) * delta))
    if (this.action) this.action.setEffectiveWeight(this.weight)
    for (const action of this.fading) {
      action.setEffectiveWeight(this.action ? 0 : this.weight)
    }
    if (this.weight < 0.01 && !this.action) {
      for (const action of this.fading) action.stop()
      this.fading = []
      this.weight = 0
      this.shown = null
    }
    return this.weight
  }

  private end() {
    if (this.action) this.fading.push(this.action)
    this.action = null
  }
}
