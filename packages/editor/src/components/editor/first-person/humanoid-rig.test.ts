import { describe, expect, test } from 'bun:test'
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Group,
  LoopOnce,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import { humanoidBones, jointPairs, plainBoneName, retargetClip, rigRest } from './humanoid-rig'

type Joint = { name: string; parent: string | null; at: [number, number, number] }

/**
 * A skeleton from joints placed in the world: each bone's local frame turned
 * by `twist` (radians about a tilted axis, per bone), so its axes are its
 * own and only where the bones stand is shared; the whole body laid turned
 * by `turn` about +Y, and held by a root scaled as an exporter may leave it.
 */
function skeleton(
  joints: Joint[],
  { twist = 0, scale = 1, turn = 0 }: { twist?: number; scale?: number; turn?: number } = {},
): { root: Group; bones: Map<string, Bone> } {
  const root = new Group()
  root.scale.setScalar(scale)
  const laid = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn)
  const place = (at: [number, number, number]) =>
    new Vector3(...at).applyQuaternion(laid).divideScalar(scale)
  const bones = new Map<string, Bone>()
  const worldRotation = new Map<string, Quaternion>()
  const axis = new Vector3(0.3, 1, 0.5).normalize()
  joints.forEach((joint, index) => {
    const bone = new Bone()
    bone.name = joint.name
    const rotation = laid
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(axis, twist * (index + 1)))
    worldRotation.set(joint.name, rotation)
    const parent = joint.parent ? bones.get(joint.parent)! : null
    const at = place(joint.at)
    if (parent) {
      const parentAt = place(joints.find((j) => j.name === joint.parent)!.at)
      const parentRotation = worldRotation.get(joint.parent!)!
      bone.position.copy(at.sub(parentAt).applyQuaternion(parentRotation.clone().invert()))
      bone.quaternion.copy(parentRotation.clone().invert().multiply(rotation))
      parent.add(bone)
    } else {
      bone.position.copy(at)
      bone.quaternion.copy(rotation)
      root.add(bone)
    }
    bones.set(joint.name, bone)
  })
  root.updateMatrixWorld(true)
  return { root, bones }
}

/** A humanoid laid out in the world (facing +Z, its left at +X), its bones named by `name`. */
function body(name: (joint: string) => string, armDrop: number, height = 1): Joint[] {
  const h = height
  const arm = (side: number, joint: string, reach: number): [number, number, number] => [
    side * (0.18 + reach * Math.cos(armDrop)),
    h * 1.4 - reach * Math.sin(armDrop),
    0,
  ]
  const joints: Joint[] = [
    { name: name('hips'), parent: null, at: [0, h * 0.95, 0] },
    { name: name('spine0'), parent: name('hips'), at: [0, h * 1.05, 0] },
    { name: name('spine1'), parent: name('spine0'), at: [0, h * 1.18, 0] },
    { name: name('spine2'), parent: name('spine1'), at: [0, h * 1.3, 0] },
    { name: name('neck0'), parent: name('spine2'), at: [0, h * 1.45, 0] },
    { name: name('head'), parent: name('neck0'), at: [0, h * 1.55, 0.01] },
  ]
  for (const [side, s] of [
    ['left', 1],
    ['right', -1],
  ] as const) {
    joints.push(
      { name: name(`${side}.shoulder`), parent: name('spine2'), at: [s * 0.05, h * 1.4, 0] },
      { name: name(`${side}.upperArm`), parent: name(`${side}.shoulder`), at: arm(s, '', 0) },
      { name: name(`${side}.lowerArm`), parent: name(`${side}.upperArm`), at: arm(s, '', 0.28) },
      { name: name(`${side}.hand`), parent: name(`${side}.lowerArm`), at: arm(s, '', 0.52) },
      { name: name(`${side}.upperLeg`), parent: name('hips'), at: [s * 0.1, h * 0.92, 0] },
      {
        name: name(`${side}.lowerLeg`),
        parent: name(`${side}.upperLeg`),
        at: [s * 0.1, h * 0.5, 0],
      },
      { name: name(`${side}.foot`), parent: name(`${side}.lowerLeg`), at: [s * 0.1, h * 0.08, 0] },
      { name: name(`${side}.toes`), parent: name(`${side}.foot`), at: [s * 0.1, 0, 0.12] },
    )
  }
  return joints
}

const ROCKETBOX: Record<string, string> = {
  hips: 'Bip01_Pelvis',
  spine0: 'Bip01_Spine',
  spine1: 'Bip01_Spine1',
  spine2: 'Bip01_Spine2',
  neck0: 'Bip01_Neck',
  head: 'Bip01_Head',
  shoulder: 'Clavicle',
  upperArm: 'UpperArm',
  lowerArm: 'Forearm',
  hand: 'Hand',
  upperLeg: 'Thigh',
  lowerLeg: 'Calf',
  foot: 'Foot',
  toes: 'Toe0',
}
const rocketbox = (joint: string) => {
  const [side, limb] = joint.split('.')
  return limb ? `Bip01_${side === 'left' ? 'L' : 'R'}_${ROCKETBOX[limb]}` : ROCKETBOX[joint]!
}

const MIXAMO: Record<string, string> = {
  hips: 'Hips',
  spine0: 'Spine',
  spine1: 'Spine1',
  spine2: 'Spine2',
  neck0: 'Neck',
  head: 'Head',
  shoulder: 'Shoulder',
  upperArm: 'Arm',
  lowerArm: 'ForeArm',
  hand: 'Hand',
  upperLeg: 'UpLeg',
  lowerLeg: 'Leg',
  foot: 'Foot',
  toes: 'ToeBase',
}
const mixamo = (joint: string) => {
  const [side, limb] = joint.split('.')
  return limb
    ? `mixamorig${side === 'left' ? 'Left' : 'Right'}${MIXAMO[limb]}`
    : `mixamorig${MIXAMO[joint]}`
}

const UNREAL: Record<string, string> = {
  hips: 'pelvis',
  spine0: 'spine_01',
  spine1: 'spine_02',
  spine2: 'spine_03',
  neck0: 'neck_01',
  head: 'head',
  shoulder: 'clavicle',
  upperArm: 'upperarm',
  lowerArm: 'lowerarm',
  hand: 'hand',
  upperLeg: 'thigh',
  lowerLeg: 'calf',
  foot: 'foot',
  toes: 'ball',
}
const unreal = (joint: string) => {
  const [side, limb] = joint.split('.')
  return limb ? `${UNREAL[limb]}_${side === 'left' ? 'l' : 'r'}` : UNREAL[joint]!
}

const worldDirection = (from: Object3D, to: Object3D) =>
  to.getWorldPosition(new Vector3()).sub(from.getWorldPosition(new Vector3())).normalize()

/** Plays `clip` on `root` at `time` (held at its end, not wrapped back to its start). */
function pose(root: Object3D, clip: AnimationClip, time: number) {
  const mixer = new AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.setLoop(LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  mixer.setTime(time)
  root.updateMatrixWorld(true)
}

describe('humanoid bones', () => {
  test('plain names drop the rigs’ prefixes', () => {
    expect(plainBoneName('mixamorig:LeftHand')).toBe('lefthand')
    expect(plainBoneName('Bip01_L_Forearm')).toBe('lforearm')
    expect(plainBoneName('CC_Base_L_Upperarm')).toBe('lupperarm')
    expect(plainBoneName('upperarm_l')).toBe('upperarml')
  })

  test('finds the joints of Rocketbox, Mixamo and Unreal rigs alike', () => {
    for (const name of [rocketbox, mixamo, unreal]) {
      const { root, bones } = skeleton(body(name, 0.8))
      const found = humanoidBones(root)!
      expect(found).not.toBeNull()
      for (const joint of [
        'hips',
        'spine0',
        'spine2',
        'neck0',
        'head',
        'left.hand',
        'right.toes',
      ]) {
        expect(found.get(joint as never)?.name).toBe(bones.get(name(joint))!.name)
      }
    }
  })

  test('finds Rocketbox and Mixamo fingers', () => {
    const { root } = skeleton([
      ...body(rocketbox, 0.8),
      { name: 'Bip01_L_Finger1', parent: 'Bip01_L_Hand', at: [0.75, 1.0, 0] },
      { name: 'Bip01_L_Finger11', parent: 'Bip01_L_Finger1', at: [0.78, 0.98, 0] },
    ])
    const found = humanoidBones(root)!
    expect(found.get('left.index1')?.name).toBe('Bip01_L_Finger1')
    expect(found.get('left.index2')?.name).toBe('Bip01_L_Finger11')
  })

  test('is null for a rig without arms and legs', () => {
    const { root } = skeleton([
      { name: 'Hips', parent: null, at: [0, 1, 0] },
      { name: 'Spine', parent: 'Hips', at: [0, 1.2, 0] },
      { name: 'Head', parent: 'Spine', at: [0, 1.5, 0] },
    ])
    expect(humanoidBones(root)).toBeNull()
  })

  test('pairs a longer spine with the source spine at the same share', () => {
    const source = humanoidBones(skeleton(body(rocketbox, 0.8)).root)!
    const joints = body(unreal, 0.8)
    joints.splice(4, 0, { name: 'spine_04', parent: 'spine_03', at: [0, 1.36, 0] })
    joints.find((joint) => joint.name === 'neck_01')!.parent = 'spine_04'
    const target = humanoidBones(skeleton(joints).root)!
    const pairs = new Map(jointPairs(source, target).map(([from, to]) => [to.name, from.name]))
    expect(pairs.get('spine_01')).toBe('Bip01_Spine')
    expect(pairs.get('spine_04')).toBe('Bip01_Spine2')
  })
})

describe('retargetClip', () => {
  const lift = (root: Object3D, bone: Bone, angle: number) => {
    // Raises the bone's world direction about the body's front axis (+Z), whatever its local axes.
    root.updateMatrixWorld(true)
    const parent = bone.parent!.getWorldQuaternion(new Quaternion())
    const world = bone.getWorldQuaternion(new Quaternion())
    const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle).multiply(world)
    return parent.invert().multiply(turned)
  }

  test('carries a raised arm and a hip dip to a rig with other axes, scale, facing and arm rest', () => {
    // Source: Rocketbox names, arms 45° down at rest, cm-scaled root turned a quarter.
    const source = skeleton(body(rocketbox, Math.PI / 4), { twist: 0.4, scale: 0.01 })
    // Target: Mixamo names, a T-pose, taller, its own bone axes, facing +X.
    const target = skeleton(body(mixamo, 0, 1.1), { twist: -0.7 })
    const sourceRest = rigRest(source.root)!
    const targetRest = rigRest(target.root)!
    const arm = source.bones.get('Bip01_L_UpperArm')!
    const hips = source.bones.get('Bip01_Pelvis')!
    const raised = lift(source.root, arm, 0.6)
    const clip = new AnimationClip('wave', 1, [
      new QuaternionKeyframeTrack(
        `${arm.name}.quaternion`,
        [0, 1],
        [...arm.quaternion.toArray(), ...raised.toArray()],
      ),
      new VectorKeyframeTrack(
        `${hips.name}.position`,
        [0, 1],
        [...hips.position.toArray(), hips.position.x, hips.position.y - 10, hips.position.z],
      ),
    ])
    const retargeted = retargetClip(clip, sourceRest, targetRest)

    // The source is back at rest.
    source.root.updateMatrixWorld(true)
    expect(arm.quaternion.angleTo(sourceRest.stance.get(arm)!.local.quaternion)).toBeLessThan(1e-6)

    pose(source.root, clip, 1)
    pose(target.root, retargeted, 1)
    const sourceDirection = worldDirection(arm, source.bones.get('Bip01_L_Forearm')!)
    const targetDirection = worldDirection(
      target.bones.get('mixamorigLeftArm')!,
      target.bones.get('mixamorigLeftForeArm')!,
    )
    expect(targetDirection.angleTo(sourceDirection)).toBeLessThan(1e-3)
    // The other arm stays as the source's does: down 45°, though the target's rest is a T-pose.
    const otherSource = worldDirection(
      source.bones.get('Bip01_R_UpperArm')!,
      source.bones.get('Bip01_R_Forearm')!,
    )
    const otherTarget = worldDirection(
      target.bones.get('mixamorigRightArm')!,
      target.bones.get('mixamorigRightForeArm')!,
    )
    expect(otherTarget.angleTo(otherSource)).toBeLessThan(1e-3)
    // The hips dip by 10 cm scaled to the taller body.
    const hipsY = target.bones.get('mixamorigHips')!.getWorldPosition(new Vector3()).y
    expect(hipsY).toBeCloseTo(1.1 * 0.95 - 0.1 * 1.1, 4)
  })

  test('turns the motion to a rig facing another way', () => {
    const source = skeleton(body(rocketbox, Math.PI / 4))
    const target = skeleton(body(mixamo, Math.PI / 4), { turn: Math.PI / 2 })
    const arm = source.bones.get('Bip01_L_UpperArm')!
    const raised = lift(source.root, arm, 0.6)
    const clip = new AnimationClip('wave', 1, [
      new QuaternionKeyframeTrack(
        `${arm.name}.quaternion`,
        [0, 1],
        [...arm.quaternion.toArray(), ...raised.toArray()],
      ),
    ])
    const retargeted = retargetClip(clip, rigRest(source.root)!, rigRest(target.root)!)
    pose(source.root, clip, 1)
    pose(target.root, retargeted, 1)
    const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    const sourceDirection = worldDirection(
      arm,
      source.bones.get('Bip01_L_Forearm')!,
    ).applyQuaternion(facing)
    const targetDirection = worldDirection(
      target.bones.get('mixamorigLeftArm')!,
      target.bones.get('mixamorigLeftForeArm')!,
    )
    expect(targetDirection.angleTo(sourceDirection)).toBeLessThan(1e-3)
  })
})
