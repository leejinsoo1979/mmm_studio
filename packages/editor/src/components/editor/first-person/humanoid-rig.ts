import {
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three'

/**
 * Humanoid skeletons by their joints, whatever a rig calls its bones, and
 * motion carried from one to another: the Rocketbox motion-capture clips
 * (Bip01 bones) played by a body rigged otherwise — Mixamo-style names,
 * Character Creator's CC_Base_, Unreal's pelvis/spine_01/upperarm_l.
 *
 * Each bone takes the turn its counterpart makes in the world from where it
 * stands at rest, so the two rigs' bone axes needn't agree. Limbs standing
 * otherwise at rest (a T-pose against the clips' A-pose) are first turned
 * to the clips' rest, so a lowered arm is lowered on both. Only the hips
 * move, by the clip's hips scaled to the body's height.
 */

const SIDES = ['left', 'right'] as const
type Side = (typeof SIDES)[number]

const LIMBS = [
  'shoulder',
  'upperArm',
  'lowerArm',
  'hand',
  'upperLeg',
  'lowerLeg',
  'foot',
  'toes',
  'eye',
] as const
type Limb = (typeof LIMBS)[number]

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const
type Finger = (typeof FINGERS)[number]

/** A joint a rig may have: hips, the spine and neck chains (by position along them), a limb or a finger segment on a side. */
export type HumanoidJoint =
  | 'hips'
  | 'head'
  | `spine${number}`
  | `neck${number}`
  | `${Side}.${Limb}`
  | `${Side}.${Finger}${1 | 2 | 3}`

/**
 * A rig's bones by joint. A bone is any node of the rig: a skinned body's
 * are three's Bones, a clips-only file's (the shared motion) plain nodes.
 */
export type HumanoidBones = Map<HumanoidJoint, Object3D>

/** Lower case with every prefix rigs put before a bone's own name (mixamorig:, CC_Base_, Bip01 …) gone, letters and digits only. */
export function plainBoneName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^(mixamorig\d*|ccbase|bip0?0?1|armature|def|jbipc|jbip)/, '')
}

/** The plain names a limb goes by, `*` standing for the side's letter or word. */
const LIMB_NAMES: Record<Limb, string[]> = {
  shoulder: ['*shoulder', '*clavicle', 'clavicle*', 'shoulder*'],
  upperArm: ['*arm', '*upperarm', 'upperarm*'],
  lowerArm: ['*forearm', '*lowerarm', 'lowerarm*', 'forearm*'],
  hand: ['*hand', 'hand*'],
  upperLeg: ['*upleg', '*upperleg', '*thigh', 'thigh*'],
  lowerLeg: ['*leg', '*lowerleg', '*calf', 'calf*'],
  foot: ['*foot', 'foot*'],
  toes: ['*toebase', '*toe0', '*toes', 'ball*', '*toe'],
  eye: ['*eye', 'eye*', 'facial*eye'],
}

/** A finger's plain names, `*` the side and `#` the segment (1–3). */
const FINGER_NAMES: Record<Finger, string[]> = {
  thumb: ['*handthumb#', '*thumb#', 'thumb0#*', '*finger0@'],
  index: ['*handindex#', '*index#', 'index0#*', '*finger1@'],
  middle: ['*handmiddle#', '*mid#', '*middle#', 'middle0#*', '*finger2@'],
  ring: ['*handring#', '*ring#', 'ring0#*', '*finger3@'],
  pinky: ['*handpinky#', '*pinky#', 'pinky0#*', '*finger4@'],
}

const SIDE_WORDS: Record<Side, string[]> = { left: ['left', 'l'], right: ['right', 'r'] }

/** Rocketbox numbers a finger's segments after its own: Finger1 (the first), Finger11, Finger12. */
const ROCKETBOX_SEGMENT = ['', '1', '2']

function limbNames(side: Side, patterns: string[]): Set<string> {
  const names = new Set<string>()
  for (const pattern of patterns) {
    for (const word of SIDE_WORDS[side]) names.add(pattern.replace('*', word))
  }
  return names
}

function fingerNames(side: Side, finger: Finger, segment: 1 | 2 | 3): Set<string> {
  const names = new Set<string>()
  for (const pattern of FINGER_NAMES[finger]) {
    for (const word of SIDE_WORDS[side]) {
      names.add(
        pattern
          .replace('*', word)
          .replace('#', String(segment))
          .replace('@', ROCKETBOX_SEGMENT[segment - 1]!),
      )
    }
  }
  return names
}

const HIPS_NAMES = ['hips', 'hip', 'pelvis']
const NECK = /^neck(\d*|twist\d*)$/
const SPINE = /^(spine\d*|waist|chest|upperchest)$/
const HEAD = /^head$/

/** The nodes under `root` that may be bones (not meshes), parents first. */
function bonesOf(root: Object3D): Object3D[] {
  const bones: Object3D[] = []
  root.traverse((object) => {
    if (object !== root && !(object as Mesh).isMesh) bones.push(object)
  })
  return bones
}

/** The bones from `from` (excluded) down to `to` (excluded), top first; null when `to` isn't under `from`. */
function between(from: Object3D, to: Object3D): Object3D[] | null {
  const chain: Object3D[] = []
  for (let at = to.parent; at; at = at.parent) {
    if (at === from) return chain.reverse()
    chain.push(at)
  }
  return null
}

/**
 * A rig's humanoid joints, by its bones' names: null when it lacks what
 * walking needs (hips, a spine up to the neck and head, arms and legs).
 */
export function humanoidBones(root: Object3D): HumanoidBones | null {
  const bones = bonesOf(root)
  const byName = new Map<string, Object3D>()
  for (const bone of bones) {
    const plain = plainBoneName(bone.name)
    if (!byName.has(plain)) byName.set(plain, bone)
  }
  const find = (names: Iterable<string>) => {
    for (const name of names) {
      const bone = byName.get(name)
      if (bone) return bone
    }
    return null
  }
  const found: HumanoidBones = new Map()
  const hips = find(HIPS_NAMES)
  const head = bones.find((bone) => HEAD.test(plainBoneName(bone.name)))
  if (!(hips && head)) return null
  found.set('hips', hips)
  found.set('head', head)
  for (const side of SIDES) {
    for (const limb of LIMBS) {
      const bone = find(limbNames(side, LIMB_NAMES[limb]))
      if (bone) found.set(`${side}.${limb}`, bone)
    }
    for (const finger of FINGERS) {
      for (const segment of [1, 2, 3] as const) {
        const bone = find(fingerNames(side, finger, segment))
        if (bone) found.set(`${side}.${finger}${segment}`, bone)
      }
    }
  }
  // The spine and neck: the bones between the hips and the head, the ones
  // named as a neck the neck's and the rest the spine's.
  const trunk = between(hips, head)
  if (!trunk) return null
  let spine = 0
  let neck = 0
  for (const bone of trunk) {
    const plain = plainBoneName(bone.name)
    if (NECK.test(plain)) found.set(`neck${neck++}`, bone)
    else if (SPINE.test(plain) || neck === 0) found.set(`spine${spine++}`, bone)
  }
  const needed: HumanoidJoint[] = [
    'spine0',
    'left.upperArm',
    'left.lowerArm',
    'left.hand',
    'right.upperArm',
    'right.lowerArm',
    'right.hand',
    'left.upperLeg',
    'left.lowerLeg',
    'left.foot',
    'right.upperLeg',
    'right.lowerLeg',
    'right.foot',
  ]
  return needed.every((joint) => found.has(joint)) ? found : null
}

/** How many of a chain's joints (spine0, spine1, …) a rig has. */
function chainLength(bones: HumanoidBones, chain: 'spine' | 'neck'): number {
  let count = 0
  while (bones.has(`${chain}${count}` as HumanoidJoint)) count++
  return count
}

/**
 * Which source joint drives each target joint: the same joint, and along
 * the spine and neck the source joint at the same share of its chain (rigs
 * have two to five spine bones).
 */
export function jointPairs(source: HumanoidBones, target: HumanoidBones): [Object3D, Object3D][] {
  const pairs: [Object3D, Object3D][] = []
  for (const [joint, bone] of target) {
    const chain = /^(spine|neck)(\d+)$/.exec(joint)
    if (chain) {
      const name = chain[1] as 'spine' | 'neck'
      const sourceCount = chainLength(source, name)
      const targetCount = chainLength(target, name)
      if (sourceCount === 0) continue
      const at = Math.min(
        sourceCount - 1,
        Math.round((Number(chain[2]) * (sourceCount - 1)) / Math.max(1, targetCount - 1)),
      )
      pairs.push([source.get(`${name}${at}` as HumanoidJoint)!, bone])
      continue
    }
    const from = source.get(joint)
    if (from) pairs.push([from, bone])
  }
  return pairs
}

/** The joint a bone points to (its direction at rest), for those that point somewhere. */
const POINTS_TO: Partial<Record<Limb, Limb>> = {
  shoulder: 'upperArm',
  upperArm: 'lowerArm',
  lowerArm: 'hand',
  upperLeg: 'lowerLeg',
  lowerLeg: 'foot',
  foot: 'toes',
}

function pointsTo(bones: HumanoidBones, joint: HumanoidJoint): Object3D | null {
  const limb = /^(left|right)\.(\w+)$/.exec(joint)
  if (limb) {
    const side = limb[1] as Side
    const name = limb[2] as Limb | `${Finger}${number}`
    const next = POINTS_TO[name as Limb]
    if (next) return bones.get(`${side}.${next}`) ?? null
    if (name === 'hand') return bones.get(`${side}.middle1`) ?? null
    const finger = /^(\w+)([12])$/.exec(name)
    if (finger)
      return bones.get(`${side}.${finger[1]}${Number(finger[2]) + 1}` as HumanoidJoint) ?? null
    return null
  }
  const chain = /^(spine|neck)(\d+)$/.exec(joint)
  if (chain) {
    const next = bones.get(`${chain[1]}${Number(chain[2]) + 1}` as HumanoidJoint)
    if (next) return next
    return chain[1] === 'spine'
      ? (bones.get('neck0') ?? bones.get('head') ?? null)
      : (bones.get('head') ?? null)
  }
  return null
}

/**
 * A bone at rest: its rotation and place in its rig's own space — the
 * root's, scaled as an exporter left it, wherever the root itself is put in
 * the world — and its own transform.
 */
type BoneRest = {
  matrix: Matrix4
  rotation: Quaternion
  position: Vector3
  local: { quaternion: Quaternion; position: Vector3; scale: Vector3 }
}

const toRoot = new Matrix4()
const relative = new Matrix4()
const ignored = new Vector3()

/** A bone's matrix in its rig's space (the root's parent's), as the bones stand now, into `out`. */
function inRoot(root: Object3D, bone: Object3D, out: Matrix4) {
  if (!root.parent) return out.copy(bone.matrixWorld)
  return out.multiplyMatrices(toRoot.copy(root.parent.matrixWorld).invert(), bone.matrixWorld)
}

/** A rig at rest, ready to give clips to another or take them: what retargetClip needs of each. */
export type RigRest = {
  root: Object3D
  bones: HumanoidBones
  stance: Map<Object3D, BoneRest>
  /** How high its hips stand over its lowest bone (m): the feet and toes are its lowest. */
  hipHeight: number
  /** Which way (rad about +Y, 0 = +Z) it faces at rest, from its thighs: its left is the left thigh's side. */
  facing: number
}

/** A rig as it stands now (its rest), or null when it isn't a humanoid this can tell. */
export function rigRest(root: Object3D): RigRest | null {
  const bones = humanoidBones(root)
  if (!bones) return null
  root.updateWorldMatrix(true, true)
  const stance = new Map<Object3D, BoneRest>()
  for (const bone of bonesOf(root)) {
    const rotation = new Quaternion()
    const position = new Vector3()
    const matrix = inRoot(root, bone, new Matrix4())
    matrix.decompose(position, rotation, ignored)
    stance.set(bone, {
      matrix,
      rotation,
      position,
      local: {
        quaternion: bone.quaternion.clone(),
        position: bone.position.clone(),
        scale: bone.scale.clone(),
      },
    })
  }
  let floor = Number.POSITIVE_INFINITY
  for (const { position } of stance.values()) floor = Math.min(floor, position.y)
  const at = (joint: HumanoidJoint) => stance.get(bones.get(joint)!)!.position
  // The body's left (+X when it faces +Z) crossed with up is its front.
  const left = at('left.upperLeg').clone().sub(at('right.upperLeg'))
  const facing = Math.atan2(-left.z, left.x)
  return { root, bones, stance, hipHeight: at('hips').y - floor, facing }
}

const direction = new Vector3()
const other = new Vector3()
const UP = new Vector3(0, 1, 0)

/**
 * For each target bone driven by a source bone, the constant K that turns
 * the source's rotation, faced the target's way (F), into the target's:
 * with the source's rest turned by C so the bone points where the target's
 * does at rest, target = F · source · (C · F · rest)⁻¹ · targetRest.
 */
function pairOffsets(source: RigRest, target: RigRest, face: Quaternion) {
  const pairs = jointPairs(source.bones, target.bones)
  const jointOf = new Map<Object3D, HumanoidJoint>()
  for (const [joint, bone] of target.bones) jointOf.set(bone, joint)
  const sourceJointOf = new Map<Object3D, HumanoidJoint>()
  for (const [joint, bone] of source.bones) sourceJointOf.set(bone, joint)
  return pairs.map(([from, to]) => {
    const sourceRest = source.stance.get(from)!
    const targetRest = target.stance.get(to)!
    const align = new Quaternion()
    const sourceNext = pointsTo(source.bones, sourceJointOf.get(from)!)
    const targetNext = pointsTo(target.bones, jointOf.get(to)!)
    if (sourceNext && targetNext) {
      direction
        .copy(source.stance.get(sourceNext)!.position)
        .sub(sourceRest.position)
        .applyQuaternion(face)
      other.copy(target.stance.get(targetNext)!.position).sub(targetRest.position)
      if (direction.lengthSq() > 1e-10 && other.lengthSq() > 1e-10) {
        align.setFromUnitVectors(direction.normalize(), other.normalize())
      }
    }
    const offset = align
      .multiply(face)
      .multiply(sourceRest.rotation)
      .invert()
      .multiply(targetRest.rotation)
    return { from, to, offset }
  })
}

const sourceRotation = new Quaternion()
const parentRotation = new Quaternion()
const local = new Quaternion()
const moved = new Vector3()
const hipsAt = new Vector3()

/**
 * A source clip played by the target rig: a quaternion track for every
 * target bone the source drives, and the hips' position, sampled at the
 * clip's own key times. The source rig is posed by the clip meanwhile and
 * put back at rest after; the target rig isn't touched (its rest is what
 * rigRest saw).
 */
export function retargetClip(clip: AnimationClip, source: RigRest, target: RigRest): AnimationClip {
  const face = new Quaternion().setFromAxisAngle(UP, target.facing - source.facing)
  const offsets = pairOffsets(source, target, face)
  const driven = new Map(offsets.map((entry) => [entry.to, entry]))
  // Parents first, so a bone's parent's rotation is known before it.
  const targetBones = [...target.stance.keys()]
  const targetHips = target.bones.get('hips')!
  const sourceHips = source.bones.get('hips')!
  const scale = target.hipHeight / Math.max(1e-6, source.hipHeight)
  const sourceHipsRest = source.stance.get(sourceHips)!.position
  const targetHipsRest = target.stance.get(targetHips)!
  // From the target's root space into its hips' parent's (the armature, scaled as it may be).
  const { local: hipsLocal } = targetHipsRest
  const hipsParent = targetHipsRest.matrix
    .clone()
    .multiply(
      new Matrix4().compose(hipsLocal.position, hipsLocal.quaternion, hipsLocal.scale).invert(),
    )
    .invert()
  // A bone with no bone above it hangs from something fixed (the armature).
  const fixedParent = new Map<Object3D, Quaternion>()
  for (const bone of targetBones) {
    if (bone.parent && target.stance.has(bone.parent)) continue
    const rest = target.stance.get(bone)!
    fixedParent.set(bone, rest.rotation.clone().multiply(rest.local.quaternion.clone().invert()))
  }

  const times = new Set<number>()
  for (const track of clip.tracks) for (const time of track.times) times.add(time)
  const keys = [...times].sort((a, b) => a - b)
  if (keys.length === 0) keys.push(0)

  const values = new Map<Object3D, number[]>()
  for (const bone of driven.keys()) values.set(bone, [])
  const hipsValues: number[] = []

  const mixer = new AnimationMixer(source.root)
  const action = mixer.clipAction(clip)
  action.setLoop(LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  const world = new Map<Object3D, Quaternion>()
  for (const bone of targetBones) world.set(bone, new Quaternion())
  try {
    for (const time of keys) {
      mixer.setTime(time)
      source.root.updateMatrixWorld(true)
      for (const bone of targetBones) {
        const parent = bone.parent
        parentRotation.copy(
          parent && world.has(parent) ? world.get(parent)! : fixedParent.get(bone)!,
        )
        const entry = driven.get(bone)
        const rotation = world.get(bone)!
        if (entry) {
          inRoot(source.root, entry.from, relative).decompose(moved, sourceRotation, ignored)
          rotation.copy(face).multiply(sourceRotation).multiply(entry.offset)
          local.copy(parentRotation).invert().multiply(rotation)
          values.get(bone)!.push(local.x, local.y, local.z, local.w)
        } else {
          rotation.copy(parentRotation).multiply(target.stance.get(bone)!.local.quaternion)
        }
      }
      inRoot(source.root, sourceHips, relative)
      moved
        .setFromMatrixPosition(relative)
        .sub(sourceHipsRest)
        .applyQuaternion(face)
        .multiplyScalar(scale)
      hipsAt.copy(targetHipsRest.position).add(moved).applyMatrix4(hipsParent)
      hipsValues.push(hipsAt.x, hipsAt.y, hipsAt.z)
    }
  } finally {
    mixer.stopAllAction()
    mixer.uncacheRoot(source.root)
    restore(source)
  }

  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = [...values].map(
    ([bone, list]) => new QuaternionKeyframeTrack(`${bone.name}.quaternion`, keys, list),
  )
  tracks.push(new VectorKeyframeTrack(`${targetHips.name}.position`, keys, hipsValues))
  return new AnimationClip(clip.name, clip.duration, tracks)
}

/** Puts a rig's bones back as they stood at rest. */
function restore(rig: RigRest) {
  for (const [bone, { local }] of rig.stance) {
    bone.quaternion.copy(local.quaternion)
    bone.position.copy(local.position)
    bone.scale.copy(local.scale)
  }
  rig.root.updateMatrixWorld(true)
}
