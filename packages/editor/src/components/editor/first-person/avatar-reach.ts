import { type Object3D, Quaternion, Vector3 } from 'three'

/**
 * Arms that reach for a point over whatever the animation plays: a two-bone
 * IK (upper arm → forearm → hand of a Rocketbox Biped rig) with the elbow
 * bent toward a pole, blended in and out by a weight, and an optional curl of
 * the fingers into a fist. Run it after the animation mixer each frame; the
 * player's body and the NPCs' share it.
 */

export type ArmSide = 'left' | 'right'

export type TwoBoneSolution = {
  elbow: Vector3
  hand: Vector3
  /** The target was within the arm's reach (not clamped). */
  reached: boolean
}

/** Keeps a reach this much short of a straight arm, so the elbow's bend stays defined. */
const STRAIGHT_SLACK = 1e-4

const projected = new Vector3()

/** `v` without its component along unit `axis`. */
function perpendicular(v: Vector3, axis: Vector3, out: Vector3): Vector3 {
  return out.copy(v).sub(projected.copy(axis).multiplyScalar(v.dot(axis)))
}

const toTarget = new Vector3()
const direction = new Vector3()
const bend = new Vector3()
const scratch = new Vector3()

/**
 * Where the elbow and hand go for the hand to reach `target` (all world
 * points): bone lengths from the current `shoulder → elbow → hand`, the
 * elbow bent toward `pole`. A target out of reach is clamped onto the arm's
 * reach along the shoulder → target line (too far: straight toward it; too
 * near: as close as the folded arm gets).
 */
export function solveTwoBoneIk(
  shoulder: Vector3,
  elbow: Vector3,
  hand: Vector3,
  target: Vector3,
  pole: Vector3,
): TwoBoneSolution {
  const upper = elbow.distanceTo(shoulder)
  const lower = hand.distanceTo(elbow)
  toTarget.copy(target).sub(shoulder)
  const distance = toTarget.length()
  if (distance > 1e-6) direction.copy(toTarget).divideScalar(distance)
  else direction.copy(hand).sub(shoulder).normalize()
  const min = Math.abs(upper - lower) + STRAIGHT_SLACK
  const max = upper + lower - STRAIGHT_SLACK
  const reach = Math.min(max, Math.max(min, distance))
  const reached = distance <= upper + lower && distance >= Math.abs(upper - lower)

  // The law of cosines: how far along the reach the elbow sits, and how far off it.
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach)
  const off = Math.sqrt(Math.max(0, upper * upper - along * along))

  perpendicular(scratch.copy(pole).sub(shoulder), direction, bend)
  if (bend.lengthSq() < 1e-10) perpendicular(scratch.copy(elbow).sub(shoulder), direction, bend)
  if (bend.lengthSq() < 1e-10) {
    bend.set(0, -1, 0)
    perpendicular(bend.clone(), direction, bend)
    if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0)
  }
  bend.normalize()

  return {
    elbow: shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, off),
    hand: shoulder.clone().addScaledVector(direction, reach),
    reached,
  }
}

// ─── Bones ───────────────────────────────────────────────────────────

/** A Biped bone's name without separators, lower case: `Bip01_R_UpperArm` → `bip01rupperarm`. */
const plainName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

const boneTables = new WeakMap<Object3D, Map<string, Object3D>>()

function bonesOf(model: Object3D): Map<string, Object3D> {
  let table = boneTables.get(model)
  if (!table) {
    table = new Map()
    const found = table
    model.traverse((object) => {
      const key = plainName(object.name)
      if (key && !found.has(key)) found.set(key, object)
    })
    boneTables.set(model, table)
  }
  return table
}

/** A Biped bone by its plain name (`bip01head`), or null. */
export function findBipedBone(model: Object3D, plain: string): Object3D | null {
  return bonesOf(model).get(plain) ?? null
}

export type ArmBones = {
  upper: Object3D
  forearm: Object3D
  hand: Object3D
  /** Each finger's joints from the knuckle out; the thumb first. */
  fingers: Object3D[][]
}

/** The arm of `side` (`Bip01_R/L_UpperArm → Forearm → Hand`, `Finger0..4`), or null. */
export function findArmBones(model: Object3D, side: ArmSide): ArmBones | null {
  const s = side === 'right' ? 'r' : 'l'
  const upper = findBipedBone(model, `bip01${s}upperarm`)
  const forearm = findBipedBone(model, `bip01${s}forearm`)
  const hand = findBipedBone(model, `bip01${s}hand`)
  if (!(upper && forearm && hand)) return null
  const fingers: Object3D[][] = []
  for (let finger = 0; finger <= 4; finger++) {
    const joints = [`${finger}`, `${finger}1`, `${finger}2`]
      .map((suffix) => findBipedBone(model, `bip01${s}finger${suffix}`))
      .filter((bone): bone is Object3D => bone !== null)
    if (joints.length > 0) fingers.push(joints)
  }
  return { upper, forearm, hand, fingers }
}

const worldTurn = new Quaternion()
const boneWorld = new Quaternion()
const parentWorld = new Quaternion()
const fromDir = new Vector3()
const toDir = new Vector3()

/** Turns `bone` by the world rotation `turn` (its children go with it). */
function turnBoneInWorld(bone: Object3D, turn: Quaternion) {
  bone.getWorldQuaternion(boneWorld)
  if (bone.parent) bone.parent.getWorldQuaternion(parentWorld)
  else parentWorld.identity()
  bone.quaternion.copy(parentWorld.invert().multiply(turn.multiply(boneWorld)))
  bone.updateWorldMatrix(false, true)
}

/** Turns `bone` the shortest way so the world direction `from` comes to `to`. */
function aimBone(bone: Object3D, from: Vector3, to: Vector3) {
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return
  worldTurn.setFromUnitVectors(fromDir.copy(from).normalize(), toDir.copy(to).normalize())
  turnBoneInWorld(bone, worldTurn)
}

const shoulderAt = new Vector3()
const elbowAt = new Vector3()
const handAt = new Vector3()
const upperRest = new Quaternion()
const forearmRest = new Quaternion()

/**
 * Bends `arm` so its hand reaches `target` (world), the elbow toward `pole`
 * (world), blended over the animated pose by `weight` (0..1). The arm's
 * world matrices are brought up to date first and after.
 */
export function reachArm(arm: ArmBones, target: Vector3, pole: Vector3, weight: number) {
  const w = Math.min(1, Math.max(0, weight))
  if (w <= 0) return
  arm.upper.updateWorldMatrix(true, true)
  arm.upper.getWorldPosition(shoulderAt)
  arm.forearm.getWorldPosition(elbowAt)
  arm.hand.getWorldPosition(handAt)
  const solution = solveTwoBoneIk(shoulderAt, elbowAt, handAt, target, pole)
  upperRest.copy(arm.upper.quaternion)
  forearmRest.copy(arm.forearm.quaternion)

  aimBone(arm.upper, elbowAt.clone().sub(shoulderAt), solution.elbow.clone().sub(shoulderAt))
  arm.forearm.getWorldPosition(elbowAt)
  arm.hand.getWorldPosition(handAt)
  aimBone(arm.forearm, handAt.clone().sub(elbowAt), solution.hand.clone().sub(elbowAt))

  if (w < 1) {
    arm.upper.quaternion.copy(upperRest.slerp(arm.upper.quaternion, w))
    arm.forearm.quaternion.copy(forearmRest.slerp(arm.forearm.quaternion, w))
    arm.upper.updateWorldMatrix(false, true)
  }
}

const jointA = new Vector3()
const jointB = new Vector3()
const jointC = new Vector3()
const curlAxis = new Vector3()

/**
 * Curls the fingers (`amount` 0..1, 1 a fist) the way they already bend in
 * the pose, so the curl needs no knowledge of the rig's axes; the thumb
 * folds less.
 */
export function curlFingers(arm: ArmBones, amount: number) {
  const a = Math.min(1, Math.max(0, amount))
  if (a <= 0) return
  arm.hand.updateWorldMatrix(true, true)
  arm.fingers.forEach((joints, index) => {
    const [first, second, third] = joints
    if (!(first && second)) return
    first.getWorldPosition(jointA)
    second.getWorldPosition(jointB)
    if (third) third.getWorldPosition(jointC)
    else jointC.copy(jointB).add(jointB).sub(jointA)
    curlAxis.copy(jointB).sub(jointA).cross(jointC.sub(jointB))
    if (curlAxis.lengthSq() < 1e-12) {
      // A straight finger: bend about the hand's own side axis.
      curlAxis.setFromMatrixColumn(arm.hand.matrixWorld, 2)
    }
    curlAxis.normalize()
    const perJoint = a * (index === 0 ? 0.35 : 0.75)
    worldTurn.setFromAxisAngle(curlAxis, perJoint)
    for (const joint of joints) turnBoneInWorld(joint, worldTurn.clone())
  })
}

/**
 * A model's arm reaches, frame after frame. The animation rewrites the bones
 * it plays before each call; bones it doesn't play are put back from this
 * object's own turn first, so a reach never piles up on the last one.
 */
export class AvatarReach {
  private readonly arms: Record<ArmSide, ArmBones | null>
  private readonly touched = new Map<Object3D, { animated: Quaternion; posed: Quaternion }>()

  constructor(model: Object3D) {
    this.arms = { left: findArmBones(model, 'left'), right: findArmBones(model, 'right') }
  }

  /** Puts back the bones a reach turned that the animation since left alone. */
  begin() {
    for (const [bone, { animated, posed }] of this.touched) {
      if (bone.quaternion.equals(posed)) bone.quaternion.copy(animated)
    }
    this.touched.clear()
  }

  private remember(bones: Object3D[], apply: () => void) {
    const before = bones.map((bone) => bone.quaternion.clone())
    apply()
    bones.forEach((bone, index) => {
      if (!this.touched.has(bone)) {
        this.touched.set(bone, { animated: before[index]!, posed: bone.quaternion.clone() })
      } else this.touched.get(bone)!.posed.copy(bone.quaternion)
    })
  }

  reach(side: ArmSide, target: Vector3, pole: Vector3, weight: number) {
    const arm = this.arms[side]
    if (!arm || weight <= 0) return
    this.remember([arm.upper, arm.forearm], () => reachArm(arm, target, pole, weight))
  }

  fist(side: ArmSide, amount: number) {
    const arm = this.arms[side]
    if (!arm || amount <= 0) return
    this.remember(arm.fingers.flat(), () => curlFingers(arm, amount))
  }
}

// ─── Where a body is ─────────────────────────────────────────────────

/** World points of a standing body that gestures aim at, and its facing. */
export type BodyAnchors = {
  feet: Vector3
  head: Vector3
  /** The upper chest (Spine2). */
  chest: Vector3
  /** The hips (Pelvis). */
  waist: Vector3
  leftShoulder: Vector3
  rightShoulder: Vector3
  /** Horizontal unit vectors. */
  forward: Vector3
  right: Vector3
}

export function createBodyAnchors(): BodyAnchors {
  return {
    feet: new Vector3(),
    head: new Vector3(),
    chest: new Vector3(),
    waist: new Vector3(),
    leftShoulder: new Vector3(),
    rightShoulder: new Vector3(),
    forward: new Vector3(0, 0, 1),
    right: new Vector3(-1, 0, 0),
  }
}

const UP = new Vector3(0, 1, 0)

function setFacing(out: BodyAnchors, forward: Vector3) {
  out.forward.set(forward.x, 0, forward.z)
  if (out.forward.lengthSq() < 1e-8) out.forward.set(0, 0, 1)
  out.forward.normalize()
  out.right.copy(out.forward).cross(UP).normalize()
}

const modelForward = new Vector3()

/**
 * Measures a Biped body where it stands this frame (its world matrices are
 * brought up to date). The body faces its model's +Z. Null when the model
 * isn't a Biped rig.
 */
export function measureBodyAnchors(
  model: Object3D,
  out: BodyAnchors = createBodyAnchors(),
): BodyAnchors | null {
  const head = findBipedBone(model, 'bip01head')
  const chest = findBipedBone(model, 'bip01spine2')
  const waist = findBipedBone(model, 'bip01pelvis')
  const left = findBipedBone(model, 'bip01lupperarm')
  const right = findBipedBone(model, 'bip01rupperarm')
  if (!(head && chest && waist && left && right)) return null
  model.updateWorldMatrix(true, true)
  model.getWorldPosition(out.feet)
  head.getWorldPosition(out.head)
  chest.getWorldPosition(out.chest)
  waist.getWorldPosition(out.waist)
  left.getWorldPosition(out.leftShoulder)
  right.getWorldPosition(out.rightShoulder)
  setFacing(out, model.getWorldDirection(modelForward))
  return out
}

/**
 * A body's anchors guessed from where it stands (`feet`, world), its facing
 * (`yaw`, 0 = +Z) and its height, for a body whose bones aren't at hand
 * (another player).
 */
export function estimateBodyAnchors(
  feet: Vector3,
  yaw: number,
  height = 1.75,
  out: BodyAnchors = createBodyAnchors(),
): BodyAnchors {
  out.feet.copy(feet)
  setFacing(out, modelForward.set(Math.sin(yaw), 0, Math.cos(yaw)))
  const at = (target: Vector3, share: number) =>
    target.copy(feet).addScaledVector(UP, height * share)
  at(out.head, 0.92)
  at(out.chest, 0.74)
  at(out.waist, 0.55)
  const halfShoulders = 0.18 * (height / 1.75)
  at(out.leftShoulder, 0.82).addScaledVector(out.right, -halfShoulders)
  at(out.rightShoulder, 0.82).addScaledVector(out.right, halfShoulders)
  return out
}

/** Where an arm's elbow points: down, a little back and out to its side. */
export function armPole(body: BodyAnchors, side: ArmSide, out = new Vector3()): Vector3 {
  const shoulder = side === 'right' ? body.rightShoulder : body.leftShoulder
  return out
    .copy(shoulder)
    .addScaledVector(UP, -0.6)
    .addScaledVector(body.forward, -0.25)
    .addScaledVector(body.right, side === 'right' ? 0.3 : -0.3)
}
