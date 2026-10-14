import type { Mesh, Object3D } from 'three'
import { EMOTE_FACE_SHAPES, type EmoteFace, type FaceWeights, restingFace } from './emote-face'

/**
 * A 실사 body's face in motion: a blink every few seconds and, while an
 * emote plays, the face its capture makes (emote-face.ts) — a laugh's smile
 * and squint, a talk's jaw, sad brows, a yawn — on whatever of those blend
 * shapes the body carries (a photo avatar has them all; a base body only
 * its blinks). No React: the studio and the game share it.
 */

/** How long (s) a blink takes, and the wait between blinks. */
const BLINK_TIME = 0.16
const BLINK_EVERY: [number, number] = [2.2, 5.5]
/** Blinks under the names other rigs give them, as well as ARKit's. */
const BLINK_SHAPE = /^(eyeblink_?(left|right|l|r)|eyesclosed|blink(_?[lr])?)$/i

/** What the body's emote layer shows now (emote-player.ts's EmoteLayer has these). */
export type ShownEmote = { showing: string | null; time: number; weight: number }

type Slot = { influences: number[]; index: number }

export class FaceMotion {
  /** The blinks, each with whether the emotes' faces write it too (ARKit's eyeBlinkLeft/Right). */
  private readonly blinks: (Slot & { shaped: boolean })[] = []
  private readonly shapes = new Map<keyof FaceWeights, Slot[]>()
  private readonly face = restingFace()
  private faces: ReadonlyMap<string, EmoteFace> | null = null
  private wait = BLINK_EVERY[0]
  private blinking = -1

  constructor(model: Object3D) {
    const known = new Set<string>(EMOTE_FACE_SHAPES)
    model.traverse((object) => {
      const mesh = object as Mesh
      const dictionary = mesh.morphTargetDictionary
      if (!(dictionary && mesh.morphTargetInfluences)) return
      for (const [name, index] of Object.entries(dictionary)) {
        const slot = { influences: mesh.morphTargetInfluences, index }
        if (BLINK_SHAPE.test(name)) this.blinks.push({ ...slot, shaped: known.has(name) })
        if (!known.has(name)) continue
        const list = this.shapes.get(name as keyof FaceWeights)
        if (list) list.push(slot)
        else this.shapes.set(name as keyof FaceWeights, [slot])
      }
    })
  }

  /** The faces of the emotes (by id) the body may play; null while they load. */
  setFaces(faces: ReadonlyMap<string, EmoteFace> | null) {
    this.faces = faces
  }

  update(delta: number, emote: ShownEmote | null) {
    const closed = this.blink(delta)
    const face = emote?.showing ? this.faces?.get(emote.showing) : undefined
    if (face) face.sample(emote!.time, this.face)
    const weight = face ? emote!.weight : 0
    for (const [name, slots] of this.shapes) {
      const value = weight * this.face[name]
      for (const { influences, index } of slots) influences[index] = value
    }
    // A blink closes the eyes over whatever the face does.
    for (const { influences, index, shaped } of this.blinks)
      influences[index] = Math.max(shaped ? influences[index]! : 0, closed)
  }

  /** How closed the eyes are by the blink under way (0–1). */
  private blink(delta: number): number {
    if (this.blinks.length === 0) return 0
    if (this.blinking < 0) {
      this.wait -= delta
      if (this.wait > 0) return 0
      this.blinking = 0
      this.wait = BLINK_EVERY[0] + Math.random() * (BLINK_EVERY[1] - BLINK_EVERY[0])
    }
    this.blinking += delta / BLINK_TIME
    const closed = this.blinking >= 1 ? 0 : 1 - Math.abs(this.blinking * 2 - 1)
    if (this.blinking >= 1) this.blinking = -1
    return closed
  }
}
