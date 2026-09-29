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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type AvatarGender, avatarGender, type RocketboxAvatar } from './avatar-catalog'
import { fitClips } from './avatar-rig'
import { EMOTES, type EmoteCue, emoteClipsUrl, isEmoteId, ONCE_MAX_SECONDS } from './emotes'
import { MOTION_SETS } from './locomotion'

const emoteFiles = new Map<AvatarGender, Promise<AnimationClip[]>>()

/** A gender's emote clips (one file each, fetched the first time a body needs them). */
export function loadEmoteClips(gender: AvatarGender): Promise<AnimationClip[]> {
  let clips = emoteFiles.get(gender)
  if (!clips) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    clips = loader.loadAsync(emoteClipsUrl(gender)).then((gltf) => gltf.animations)
    // A failed download can be tried again later.
    clips.catch(() => emoteFiles.delete(gender))
    emoteFiles.set(gender, clips)
  }
  return clips
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
  private clips = new Map<string, AnimationClip>()

  constructor(private readonly mixer: AnimationMixer) {}

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
    }
    return this.weight
  }

  private end() {
    if (this.action) this.fading.push(this.action)
    this.action = null
  }
}
