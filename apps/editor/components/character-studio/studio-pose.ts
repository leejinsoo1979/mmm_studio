import type { EmoteCue, EmoteLayer } from '@pascal-app/editor'
import {
  type AnimationAction,
  type AnimationClip,
  type AnimationMixer,
  type Bone,
  Matrix4,
  type Object3D,
  Quaternion,
  type SkinnedMesh,
  Vector3,
} from 'three'
import { wrapAngle } from './sculpt-gesture'

/**
 * The studio character's pose. Live: the idle clip, with emotes over it.
 * Still: the idle's first frame held, the head and neck turned so the face
 * looks into the camera while the body is seen from the front, the aim
 * fading as the turntable turns it to the side so the true profile shows.
 * Into and out of still the pose glides; the eyes keep the held frame's
 * turn, so they look where the face does.
 */

/** The idle clip's time the still pose holds: its first frame, the lids open. */
export const STILL_TIME = 0

/** The neck's share of the head's turn to the camera; the head takes the rest. */
const NECK_SHARE = 0.35
/** How far (radians) the head turns to the camera at most, across and up or down. */
const AIM_YAW = (30 * Math.PI) / 180
const AIM_PITCH = (15 * Math.PI) / 180
/** The turntable's turn (radians) where the aim starts to fade, and where it is gone. */
const AIM_FADE_FROM = (10 * Math.PI) / 180
const AIM_FADE_TO = (25 * Math.PI) / 180
/** How quickly (per second) the aim and the glide into the still pose settle. */
const RESPONSE = 8

const HEAD_BONE = /Head$/
const EYE_BONE = /Eye$/

type BonePose = { quaternion: Quaternion; position: Vector3 }[]

const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value))

const IDENTITY = new Quaternion()
const towards = new Vector3()
const facing = new Vector3()
const eyes = new Vector3()
const turned = new Vector3()
const skin = new Matrix4()
const share = new Quaternion()
const parent = new Quaternion()
const scratch = new Vector3()

/** Turns a bone by a world-space rotation, about its own place. */
function turnBone(bone: Object3D, rotation: Quaternion) {
  if (bone.parent) bone.parent.getWorldQuaternion(parent)
  else parent.identity()
  // local' = parent⁻¹ · rotation · parent · local
  share.copy(parent).invert().multiply(rotation).multiply(parent)
  bone.quaternion.premultiply(share)
  bone.updateWorldMatrix(false, true)
}

export type PoseFrame = {
  still: boolean
  cue: EmoteCue | null
  /** The camera's place (world), which the still face looks at. */
  camera: Vector3
  /** The turntable's turn now (radians). */
  yaw: number
}

export class StudioPose {
  private readonly bones: Bone[] = []
  private readonly head: Bone | null = null
  private readonly eyes: Bone[] = []
  /** A mesh the head bone skins, and the head bone's place in its skeleton. */
  private readonly skinned: SkinnedMesh | null = null
  private readonly index: number = -1
  private idle: AnimationAction | null = null
  private still = false
  private held: BonePose | null = null
  private from: BonePose | null = null
  private glide = 1
  private aimYaw = 0
  private aimPitch = 0
  /** The neck's and head's turn before the aim, so an aim never builds on the last. */
  private unaimed: Quaternion[] = []

  constructor(
    private readonly model: Object3D,
    private readonly mixer: AnimationMixer,
    private readonly layer: EmoteLayer,
  ) {
    let skinned: SkinnedMesh | null = null
    model.traverse((object) => {
      if ((object as Bone).isBone) this.bones.push(object as Bone)
      if (!skinned && (object as SkinnedMesh).isSkinnedMesh) skinned = object as SkinnedMesh
    })
    this.head = this.bones.find((bone) => HEAD_BONE.test(bone.name)) ?? null
    this.eyes = this.bones.filter((bone) => EYE_BONE.test(bone.name))
    const mesh = skinned as SkinnedMesh | null
    this.index = mesh && this.head ? mesh.skeleton.bones.indexOf(this.head) : -1
    this.skinned = this.index >= 0 ? mesh : null
  }

  /**
   * Where the face looks now (world): the bind pose's forward (+z, as the
   * head's front view has it) carried by the head bone's skinning, which
   * holds whatever turn the mesh's bind space has from the world.
   */
  private faceForward(out: Vector3): Vector3 {
    const mesh = this.skinned!
    skin
      .copy(mesh.matrixWorld)
      .multiply(mesh.bindMatrixInverse)
      .multiply(this.head!.matrixWorld)
      .multiply(mesh.skeleton.boneInverses[this.index]!)
    return out.set(0, 0, 1).transformDirection(skin)
  }

  /** The idle clip to play (and to hold the first frame of). */
  setIdle(clip: AnimationClip | null) {
    this.idle?.stop()
    this.idle = clip ? this.mixer.clipAction(clip) : null
    this.idle?.play()
  }

  dispose() {
    this.mixer.stopAllAction()
  }

  /** Advances the pose by `delta` s; returns whether the cue being played has finished. */
  update(delta: number, frame: PoseFrame): boolean {
    const step = Math.min(delta, 0.1)
    const neck = this.head?.parent as Bone | null | undefined
    const aimed = this.head && neck?.isBone ? [neck, this.head] : []
    let finished = false
    if (frame.still) {
      if (!this.still) this.hold()
      this.glide += (1 - this.glide) * (1 - Math.exp(-RESPONSE * step))
      if (this.glide > 0.999) this.glide = 1
      this.restore()
    } else {
      this.still = false
      aimed.forEach((bone, i) => {
        const before = this.unaimed[i]
        if (before) bone.quaternion.copy(before)
      })
      const weight = this.layer.update(frame.cue, false, step)
      this.idle?.setEffectiveWeight(1 - weight)
      finished = Boolean(frame.cue && this.layer.finished(frame.cue))
      this.mixer.update(step)
    }
    this.unaimed = aimed.map((bone) => bone.quaternion.clone())
    this.aim(step, frame, aimed)
    return finished
  }

  /** Holds the idle's first frame, the emote let go, gliding there from the pose as it is. */
  private hold() {
    this.still = true
    this.from = this.capture()
    this.layer.update(null, true, 10)
    if (this.idle) {
      this.idle.enabled = true
      this.idle.time = STILL_TIME
      this.idle.setEffectiveWeight(1)
    }
    this.mixer.update(0)
    this.held = this.capture()
    this.glide = 0
  }

  private capture(): BonePose {
    return this.bones.map((bone) => ({
      quaternion: bone.quaternion.clone(),
      position: bone.position.clone(),
    }))
  }

  /** Puts the held frame back (on the way there, part way from the pose it left). */
  private restore() {
    const held = this.held
    if (!held) return
    const from = this.glide < 1 ? this.from : null
    this.bones.forEach((bone, i) => {
      const to = held[i]!
      const start = from?.[i]
      if (start) {
        bone.quaternion.slerpQuaternions(start.quaternion, to.quaternion, this.glide)
        bone.position.lerpVectors(start.position, to.position, this.glide)
      } else {
        bone.quaternion.copy(to.quaternion)
        bone.position.copy(to.position)
      }
    })
  }

  /** Turns the neck and head so the face looks at the camera (still, seen from the front), easing in and out. */
  private aim(step: number, frame: PoseFrame, aimed: Bone[]) {
    const head = this.head
    let targetYaw = 0
    let targetPitch = 0
    const aiming = Boolean(head && this.skinned && aimed.length === 2)
    if (aiming) {
      this.model.updateWorldMatrix(true, true)
      this.faceForward(facing)
      if (frame.still) {
        if (this.eyes.length > 0) {
          eyes.set(0, 0, 0)
          for (const eye of this.eyes) eyes.add(eye.getWorldPosition(scratch))
          eyes.divideScalar(this.eyes.length)
        } else {
          head!.getWorldPosition(eyes)
        }
        towards.copy(frame.camera).sub(eyes).normalize()
        const weight = 1 - smoothstep(AIM_FADE_FROM, AIM_FADE_TO, Math.abs(wrapAngle(frame.yaw)))
        const yawNow = Math.atan2(facing.x, facing.z)
        const pitchNow = Math.asin(Math.min(1, Math.max(-1, facing.y)))
        const yawTo = Math.atan2(towards.x, towards.z)
        const pitchTo = Math.asin(Math.min(1, Math.max(-1, towards.y)))
        targetYaw = clamp(wrapAngle(yawTo - yawNow), AIM_YAW) * weight
        targetPitch = clamp(pitchTo - pitchNow, AIM_PITCH) * weight
      }
    }
    const ease = 1 - Math.exp(-RESPONSE * step)
    this.aimYaw += (targetYaw - this.aimYaw) * ease
    this.aimPitch += (targetPitch - this.aimPitch) * ease
    if (!aiming || Math.abs(this.aimYaw) + Math.abs(this.aimPitch) < 1e-5) return
    const yaw = Math.atan2(facing.x, facing.z) + this.aimYaw
    const pitch = Math.asin(Math.min(1, Math.max(-1, facing.y))) + this.aimPitch
    turned.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw))
    const whole = new Quaternion().setFromUnitVectors(facing, turned)
    turnBone(aimed[0]!, new Quaternion().slerpQuaternions(IDENTITY, whole, NECK_SHARE))
    turnBone(aimed[1]!, new Quaternion().slerpQuaternions(IDENTITY, whole, 1 - NECK_SHARE))
  }
}
