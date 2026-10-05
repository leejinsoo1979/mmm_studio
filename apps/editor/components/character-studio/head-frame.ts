import {
  type Bone,
  type BufferGeometry,
  Matrix4,
  type Object3D,
  type SkinnedMesh,
  Vector3,
} from 'three'

/** Rocketbox's head bone (`Bip01_Head`, at the top of the neck); the face's bones hang under it. */
const HEAD_BONE = /Head$/
/** The eyeballs' bones (`Bip01_LEye`, `Bip01_REye`; not the lids' `…EyeBlinkTop`). */
const EYE_BONE = /Eye$/
/** How much of a point's skinning the head and the face's bones must hold for the point to move with the head. */
const HEAD_HELD = 0.5

/**
 * A mesh's reach over the head, in the head bone's own space so that it
 * follows the head as it moves, grows or shrinks: its highest point (the
 * crown, or the hair, hat or helmet over it) and its lowest in front of the
 * eyes (the chin, or a beard or mask under it; long hair falls behind).
 */
type Reach = { head: number; crown: Vector3 | null; chin: Vector3 | null }

/** Reaches by geometry: a reshaped face or a borrowed hairstyle brings a new one. */
const reaches = new WeakMap<BufferGeometry, Reach | null>()

/** The bones that move with the head: the head and every bone under it. */
function headBones(bones: readonly Bone[], head: Bone): Set<number> {
  const held = new Set<number>()
  bones.forEach((bone, index) => {
    for (let at: Object3D | null = bone; at; at = at.parent) {
      if (at === head) {
        held.add(index)
        return
      }
    }
  })
  return held
}

/**
 * Works out a mesh's reach from its bind pose, which stands as the studio
 * shows the body: up is y and the face looks along z.
 */
function measureReach(mesh: SkinnedMesh): Reach | null {
  const { bones, boneInverses } = mesh.skeleton
  const head = bones.findIndex((bone) => HEAD_BONE.test(bone.name))
  const eye = bones.findIndex((bone) => EYE_BONE.test(bone.name))
  if (head < 0 || eye < 0) return null
  const eyeFront = new Vector3().setFromMatrixPosition(
    new Matrix4().copy(boneInverses[eye]!).invert(),
  ).z
  const held = headBones(bones, bones[head]!)
  const { geometry } = mesh
  const position = geometry.getAttribute('position')
  const joints = geometry.getAttribute('skinIndex')
  const weights = geometry.getAttribute('skinWeight')
  if (!(position && joints && weights)) return null
  const point = new Vector3()
  let crown: Vector3 | null = null
  let chin: Vector3 | null = null
  for (let i = 0; i < position.count; i++) {
    let weight = 0
    for (let k = 0; k < joints.itemSize; k++) {
      if (held.has(joints.getComponent(i, k))) weight += weights.getComponent(i, k)
    }
    if (weight < HEAD_HELD) continue
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix)
    if (!crown || point.y > crown.y) crown = point.clone()
    if (point.z > eyeFront && (!chin || point.y < chin.y)) chin = point.clone()
  }
  const toHead = boneInverses[head]!
  return {
    head,
    crown: crown?.applyMatrix4(toHead) ?? null,
    chin: chin?.applyMatrix4(toHead) ?? null,
  }
}

function reachOf(mesh: SkinnedMesh): Reach | null {
  let reach = reaches.get(mesh.geometry)
  if (reach === undefined) {
    reach = measureReach(mesh)
    reaches.set(mesh.geometry, reach)
  }
  return reach
}

/** Where a head is now, in the world: the heights of its crown and chin, and across, its bone's place. */
export type HeadSpan = { top: number; bottom: number; x: number }

const point = new Vector3()

/**
 * The span of a body's head as it stands now — the hair or hat over it
 * included, whatever grew or shrank it (the height, the head's size) and
 * however the clip moves it — from its visible meshes; null while it has no
 * head to go by.
 */
export function headSpan(model: Object3D): HeadSpan | null {
  const meshes: SkinnedMesh[] = []
  model.traverseVisible((object) => {
    if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh)
  })
  let top = Number.NEGATIVE_INFINITY
  let bottom = Number.POSITIVE_INFINITY
  let head: Bone | null = null
  for (const mesh of meshes) {
    const reach = reachOf(mesh)
    if (!reach) continue
    head = mesh.skeleton.bones[reach.head]!
    head.updateWorldMatrix(true, false)
    if (reach.crown) top = Math.max(top, point.copy(reach.crown).applyMatrix4(head.matrixWorld).y)
    if (reach.chin)
      bottom = Math.min(bottom, point.copy(reach.chin).applyMatrix4(head.matrixWorld).y)
  }
  if (!head || top <= bottom) return null
  return { top, bottom, x: point.setFromMatrixPosition(head.matrixWorld).x }
}

/**
 * The stage a camera frames a head on: its size, and how far the studio's
 * bars reach in over it from the top and the bottom (CSS px).
 */
export type Stage = { width: number; height: number; top: number; bottom: number }

/** How wide a head (with its hair) is for its height, near enough to keep a narrow stage from cutting its sides. */
const HEAD_ASPECT = 0.8
/** The share of a narrow stage's width a head may take at most. */
const SIDE_ROOM = 0.9
/** However far the bars reach in, a head is framed in at least this share of the stage's height. */
const LEAST_ROOM = 0.5

/**
 * A camera's aim at a head: the point it looks at (across and up), and half
 * the height of what it sees there (its distance follows from its field of
 * view).
 */
export type HeadFraming = { x: number; y: number; half: number }

/**
 * Where a camera looks, and how much it sees there, for the head's crown to
 * chin to fill `fill` of the height left between the stage's bars, centred
 * between them — or less, on a stage too narrow for the head's width.
 */
export function headFraming(span: HeadSpan, stage: Stage, fill: number): HeadFraming {
  const tall = span.top - span.bottom
  const free = Math.max(stage.height * LEAST_ROOM, stage.height - stage.top - stage.bottom)
  const half = Math.max(
    (tall * stage.height) / (2 * fill * free),
    (tall * HEAD_ASPECT * stage.height) / (2 * SIDE_ROOM * stage.width),
  )
  // The free room's middle, in px below the view's: the camera looks that
  // far above the head's middle to show it there.
  const below = (stage.top - stage.bottom) / 2
  return {
    x: span.x,
    y: (span.top + span.bottom) / 2 + (below * 2 * half) / stage.height,
    half,
  }
}
