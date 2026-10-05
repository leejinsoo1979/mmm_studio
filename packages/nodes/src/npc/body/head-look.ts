import { type Bone, Euler, Matrix4, type Object3D, Quaternion, Vector3 } from 'three'

const DEG = Math.PI / 180

/** How far the head turns toward what it looks at (rad): to either side, up, and down. */
export const LOOK_YAW_LIMIT = 70 * DEG
export const LOOK_UP_LIMIT = 20 * DEG
export const LOOK_DOWN_LIMIT = 25 * DEG
/** Something further round than this is out of sight: the head lets go (a standing body turns). */
export const LOOK_GIVE_UP = 100 * DEG
/** How quickly (1/s) the head follows its target. */
const LOOK_RESPONSE = 6
/** The neck's share of the turn; the head takes the rest. */
const NECK_SHARE = 0.4

/** How far a speaking mouth opens at full level (rad). */
export const JAW_OPEN = 12 * DEG
/**
 * The Rocketbox jaw's hinge: `Bip01_MJaw`'s local +Z runs ear to ear on
 * every body, and turning about it drops the chin.
 */
const JAW_HINGE = new Vector3(0, 0, 1)

export type LookAngles = { yaw: number; pitch: number; inSight: boolean }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** The head turn toward a direction in the body's frame (+Z ahead, +Y up), within the neck's reach. */
export function lookAngles(x: number, y: number, z: number): LookAngles {
  const yaw = Math.atan2(x, z)
  return {
    yaw: clamp(yaw, -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT),
    pitch: clamp(Math.atan2(y, Math.hypot(x, z)), -LOOK_DOWN_LIMIT, LOOK_UP_LIMIT),
    inSight: Math.abs(yaw) <= LOOK_GIVE_UP,
  }
}

/**
 * The bones' turns as the mixer left them. The mixer writes a bone only when
 * its animated value changed since its last update, so what is laid over the
 * animation (head look, jaw, arm reach) has to come off before the next
 * update, or it piles up on bones whose clip holds still.
 */
export class MixerPose {
  private readonly bones: Object3D[] = []
  private readonly turns: Float64Array
  private kept = false

  constructor(model: Object3D) {
    model.traverse((object) => {
      if ((object as Bone).isBone) this.bones.push(object)
    })
    this.turns = new Float64Array(this.bones.length * 4)
  }

  /** Right after the mixer update. */
  keep() {
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i]!.quaternion.toArray(this.turns, i * 4)
    }
    this.kept = true
  }

  /** Right before the mixer update. */
  restore() {
    if (!this.kept) return
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i]!.quaternion.fromArray(this.turns, i * 4)
    }
  }
}

const hinge = new Quaternion()

/** Opens a speaking mouth by `level` (0–1) over the animated jaw (see MixerPose). */
export function openJaw(jaw: Object3D, level: number) {
  if (level <= 0) return
  jaw.quaternion.multiply(hinge.setFromAxisAngle(JAW_HINGE, JAW_OPEN * Math.min(1, level)))
}

const eye = new Vector3()
const toTarget = new Vector3()
const bodyTurn = new Quaternion()
const bodyTurnInverse = new Quaternion()
const lookTurn = new Quaternion()
const worldTurn = new Quaternion()
const parentTurn = new Quaternion()
const parentTurnInverse = new Quaternion()
const euler = new Euler()
const neckInverse = new Matrix4()
const shoulderLocal = new Matrix4()
const shoulderScale = new Vector3()

/**
 * A collarbone hanging off the neck, as Rocketbox rigs them. It holds still
 * while the neck turns, which moves its joint; the mixer only ever turns it,
 * so its place on the neck is put back each frame (unless something else,
 * such as a body-shape look, moved it since).
 */
type Shoulder = { bone: Object3D; world: Matrix4; rest: Vector3; held: Vector3; moved: boolean }

/**
 * Turns an animated head toward a world point: the neck and head share the
 * turn, clamped to what a neck does, and ease to and from it. The turn is laid
 * over the bones' animated pose: call `update` after each mixer update, and
 * take it off before the next (see MixerPose).
 */
export class HeadLook {
  yaw = 0
  pitch = 0
  weight = 0
  private readonly shoulders: Shoulder[]

  constructor(
    private readonly neck: Object3D | null,
    private readonly head: Object3D | null,
  ) {
    this.shoulders = (neck?.children ?? [])
      .filter((child) => child !== head)
      .map((bone) => ({
        bone,
        world: new Matrix4(),
        rest: new Vector3(),
        held: new Vector3(),
        moved: false,
      }))
  }

  /** `body` is the body's root: its frame is ahead (+Z) and up (+Y). */
  update(body: Object3D, target: Vector3 | null, delta: number) {
    if (!(this.neck && this.head)) return
    for (const shoulder of this.shoulders) {
      if (shoulder.moved && shoulder.bone.position.equals(shoulder.held)) {
        shoulder.bone.position.copy(shoulder.rest)
      }
      shoulder.moved = false
    }
    const follow = 1 - Math.exp(-LOOK_RESPONSE * delta)
    body.getWorldQuaternion(bodyTurn)
    bodyTurnInverse.copy(bodyTurn).invert()
    let aim = 0
    if (target) {
      this.head.getWorldPosition(eye)
      toTarget.subVectors(target, eye).applyQuaternion(bodyTurnInverse)
      const angles = lookAngles(toTarget.x, toTarget.y, toTarget.z)
      if (angles.inSight) {
        aim = 1
        this.yaw += (angles.yaw - this.yaw) * follow
        this.pitch += (angles.pitch - this.pitch) * follow
      }
    }
    this.weight += (aim - this.weight) * follow
    if (this.weight < 0.001) return

    this.neck.updateWorldMatrix(true, false)
    for (const shoulder of this.shoulders) {
      shoulder.rest.copy(shoulder.bone.position)
      shoulder.bone.updateMatrix()
      shoulder.world.multiplyMatrices(this.neck.matrixWorld, shoulder.bone.matrix)
    }
    this.turn(this.neck, NECK_SHARE)
    this.turn(this.head, 1 - NECK_SHARE)
    // Turning the head brought the neck's world matrix up to date.
    neckInverse.copy(this.neck.matrixWorld).invert()
    for (const shoulder of this.shoulders) {
      shoulderLocal.multiplyMatrices(neckInverse, shoulder.world)
      shoulderLocal.decompose(shoulder.bone.position, shoulder.bone.quaternion, shoulderScale)
      shoulder.held.copy(shoulder.bone.position)
      shoulder.moved = true
    }
  }

  /** Turns a bone about its joint by its share of the look, taken in the body's frame. */
  private turn(bone: Object3D, share: number) {
    if (!bone.parent) return
    const amount = this.weight * share
    lookTurn.setFromEuler(euler.set(-this.pitch * amount, this.yaw * amount, 0, 'YXZ'))
    worldTurn.copy(bodyTurn).multiply(lookTurn).multiply(bodyTurnInverse)
    bone.parent.getWorldQuaternion(parentTurn)
    parentTurnInverse.copy(parentTurn).invert()
    bone.quaternion.premultiply(parentTurnInverse.multiply(worldTurn).multiply(parentTurn))
  }
}
