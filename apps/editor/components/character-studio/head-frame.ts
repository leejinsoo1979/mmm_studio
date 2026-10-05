import {
  type Bone,
  type BufferGeometry,
  Matrix4,
  type Object3D,
  type SkinnedMesh,
  Vector3,
} from 'three'
import type { AiPhotoFraming } from '@/lib/ai-photo/client'
import type { StageInsets } from './stage-contract'

/** Rocketbox's head bone (`Bip01_Head`, at the top of the neck); the face's bones hang under it. */
const HEAD_BONE = /Head$/
/** The eyeballs' bones (`Bip01_LEye`, `Bip01_REye`; not the lids' `…EyeBlinkTop`). */
const EYE_BONE = /Eye$/
/** How much of a point's skinning the head and the face's bones must hold for the point to move with the head. */
const HEAD_HELD = 0.5

/**
 * A mesh's reach over the head, in the head bone's own space so that it
 * follows the head as it moves, grows or shrinks: its highest point (the
 * crown, or the hair, hat or helmet over it), its lowest in front of the
 * eyes (the chin, or a beard or mask under it; long hair falls behind),
 * and how far it reaches forward and back (the nose's tip, the back of the
 * head or the hair), as points on the head's middle at those depths: a
 * head turned to the side spans across between them.
 */
type Reach = {
  head: number
  crown: Vector3 | null
  chin: Vector3 | null
  front: Vector3 | null
  back: Vector3 | null
  /** Where the eyes are, and which way the face looks (in the head bone's space). */
  eyes: Vector3
  forward: Vector3
}

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
  const middle = new Vector3().setFromMatrixPosition(
    new Matrix4().copy(boneInverses[head]!).invert(),
  )
  const point = new Vector3()
  let crown: Vector3 | null = null
  let chin: Vector3 | null = null
  let front: Vector3 | null = null
  let back: Vector3 | null = null
  for (let i = 0; i < position.count; i++) {
    let weight = 0
    for (let k = 0; k < joints.itemSize; k++) {
      if (held.has(joints.getComponent(i, k))) weight += weights.getComponent(i, k)
    }
    if (weight < HEAD_HELD) continue
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix)
    if (!crown || point.y > crown.y) crown = point.clone()
    if (point.z > eyeFront && (!chin || point.y < chin.y)) chin = point.clone()
    if (!front || point.z > front.z) front = new Vector3(middle.x, middle.y, point.z)
    if (!back || point.z < back.z) back = new Vector3(middle.x, middle.y, point.z)
  }
  const toHead = boneInverses[head]!
  const eyes = new Vector3().setFromMatrixPosition(new Matrix4().copy(boneInverses[eye]!).invert())
  return {
    head,
    crown: crown?.applyMatrix4(toHead) ?? null,
    chin: chin?.applyMatrix4(toHead) ?? null,
    front: front?.applyMatrix4(toHead) ?? null,
    back: back?.applyMatrix4(toHead) ?? null,
    eyes: eyes.applyMatrix4(toHead),
    forward: new Vector3(0, 0, 1).transformDirection(toHead),
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

/**
 * Where a head is now, in the world: the heights of its crown and chin,
 * and across, the middle of what it spans (and how wide that is, when
 * known: its depth, seen from the side). `front` is where across its
 * foremost point (the nose's tip) is, and `eyes` the eyes' height.
 */
export type HeadSpan = {
  top: number
  bottom: number
  x: number
  width?: number
  front?: number
  eyes?: number
}

const point = new Vector3()
const facing = new Vector3()

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
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let head: Bone | null = null
  let eyes = 0
  let front = 0
  let foremost = Number.NEGATIVE_INFINITY
  for (const mesh of meshes) {
    const reach = reachOf(mesh)
    if (!reach) continue
    head = mesh.skeleton.bones[reach.head]!
    head.updateWorldMatrix(true, false)
    if (reach.crown) top = Math.max(top, point.copy(reach.crown).applyMatrix4(head.matrixWorld).y)
    if (reach.chin)
      bottom = Math.min(bottom, point.copy(reach.chin).applyMatrix4(head.matrixWorld).y)
    eyes = point.copy(reach.eyes).applyMatrix4(head.matrixWorld).y
    facing.copy(reach.forward).transformDirection(head.matrixWorld)
    for (const at of [reach.front, reach.back]) {
      if (!at) continue
      point.copy(at).applyMatrix4(head.matrixWorld)
      left = Math.min(left, point.x)
      right = Math.max(right, point.x)
      const ahead = point.dot(facing)
      if (ahead > foremost) {
        foremost = ahead
        front = point.x
      }
    }
  }
  if (!head || top <= bottom) return null
  return { top, bottom, x: (left + right) / 2, width: right - left, front, eyes }
}

/** The stage a camera frames on: its size (CSS px), and how far the studio's chrome reaches in over it along each edge. */
export type Stage = { width: number; height: number; insets: StageInsets }

/** How wide a head (with its hair) is for its height, near enough to keep a narrow stage from cutting its sides. */
export const HEAD_ASPECT = 0.8
/** The share of the free room's width a span may take at most. */
const SIDE_ROOM = 0.9
/**
 * How far (CSS px) the face's foremost point (the nose's tip, turned to
 * the side) keeps inside the free room's edge: the edge is where the rail
 * starts, and the nose is what is pushed and pulled there.
 */
const FACE_LEAD = 64
/** However far the chrome reaches in, a span is framed in at least this share of the stage's height… */
const LEAST_ROOM = 0.5
/** …and of its width. */
const LEAST_WIDTH = 0.2

/**
 * A camera's aim: the point it looks at (across and up), and half the
 * height of what it sees there (its distance follows from its field of
 * view).
 */
export type HeadFraming = { x: number; y: number; half: number }

/**
 * Where a camera looks, and how much it sees there, for a span (crown to
 * chin, or the whole body) to fill `fill` of the height of the room the
 * chrome leaves, centred in that room — or less, where the room is too
 * narrow for the span's width (`aspect` × its height, or its own width
 * when wider). `zoom` scales what the camera sees about that same centre.
 * A head turned away is moved back from the edge its face points to, so
 * its profile keeps FACE_LEAD clear of it (the back of the hair goes the
 * other way).
 */
export function headFraming(
  span: HeadSpan,
  stage: Stage,
  fill: number,
  { aspect = HEAD_ASPECT, zoom = 1 }: { aspect?: number; zoom?: number } = {},
): HeadFraming {
  const { width, height, insets } = stage
  const tall = span.top - span.bottom
  const freeHeight = Math.max(height * LEAST_ROOM, height - insets.top - insets.bottom)
  const freeWidth = Math.max(width * LEAST_WIDTH, width - insets.left - insets.right)
  const half =
    zoom *
    Math.max(
      (tall * height) / (2 * fill * freeHeight),
      (Math.max(tall * aspect, span.width ?? 0) * height) / (2 * SIDE_ROOM * freeWidth),
    )
  // World units per CSS px; the free room's middle lies this many px off
  // the view's, so the camera looks that far the other way of the span's.
  const perPixel = (2 * half) / height
  let middle = span.x
  if (span.front !== undefined) {
    const lead = (span.front - span.x) / perPixel
    const room = Math.max(freeWidth / 4, freeWidth / 2 - FACE_LEAD)
    if (Math.abs(lead) > room) middle = span.front - Math.sign(lead) * room * perPixel
  }
  return {
    x: middle + ((insets.right - insets.left) / 2) * perPixel,
    y: (span.top + span.bottom) / 2 + ((insets.top - insets.bottom) / 2) * perPixel,
    half,
  }
}

/** The share of a body's height its head (crown to chin) takes, for a body whose head can't be found. */
const HEAD_SHARE = 0.13

/**
 * The AI photo's shots, as a portrait photographer frames them. face: the
 * head and shoulders (the head's span reaching `drop` head heights below
 * the chin), the crown `margin` of the frame below its top. upper: from
 * the crown `reach` of the body's height down, about to the hips. full:
 * crown to floor, the floor `margin` of the frame above its bottom.
 */
export const AI_SHOT = {
  face: { fill: 0.62, drop: 0.6, margin: 0.08, fov: 25 },
  upper: { fill: 0.92, reach: 0.55, fov: 28 },
  full: { fill: 0.9, margin: 0.04, fov: 30 },
} as const

/**
 * The camera's aim for an AI photo shot of a body as it stands now
 * (`model`): `stature` × `scale` is its height until its head is found.
 * `aspect` is the shot's width / height; a span too wide for it is
 * framed smaller.
 */
export function aiShotFraming(
  framing: AiPhotoFraming,
  model: Object3D | null,
  stature: number,
  scale: number,
  aspect: number,
): HeadFraming {
  const height = stature * scale
  const span = model ? headSpan(model) : null
  const crown = span?.top ?? height
  const x = span?.x ?? 0
  const fit = (tall: number, fill: number, wide: number) =>
    Math.max(tall / (2 * fill), wide / (2 * SIDE_ROOM * aspect))
  if (framing === 'face') {
    const { fill, drop, margin } = AI_SHOT.face
    const head = span ? span.top - span.bottom : height * HEAD_SHARE
    const tall = head * (1 + drop)
    const half = fit(tall, fill, Math.max(head * HEAD_ASPECT, span?.width ?? 0))
    return { x, y: crown + 2 * margin * half - half, half }
  }
  if (framing === 'upper') {
    const { fill, reach } = AI_SHOT.upper
    const tall = height * reach
    const half = fit(tall, fill, tall * 0.5)
    return { x, y: crown - tall / 2, half }
  }
  const { fill, margin } = AI_SHOT.full
  const half = fit(crown, fill, crown * 0.3)
  return { x: 0, y: half - 2 * margin * half, half }
}
