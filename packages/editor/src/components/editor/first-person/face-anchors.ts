import { type BufferGeometry, Matrix3, Matrix4, type Mesh, type SkinnedMesh, Vector3 } from 'three'
import { eyeballsOf } from './avatar-shape'
import { earShares, earsOf } from './ear-shape'
import { FACE_HANDLES, type FaceHandleId } from './face-handles'
import { facePointOf, unpackPoints } from './face-points'
import { headFrame, originalGeometry } from './head-geometry'

/**
 * Where the face's handles sit on a head mesh: per handle, the vertex it
 * is drawn at. A reshaped head keeps its vertices' order, so the same
 * vertex follows the face as it is sculpted, posed and turned.
 */
export type FaceAnchor = { handle: FaceHandleId; vertex: number }

/** How far the skin must face the front (its bind normal's z) for a landmark's handle to sit on it. */
const FACING = 0.25

/**
 * How much further (fractions of the front view) than the nearest vertex
 * one in front of it may lie from a landmark and still be taken: the lips
 * over the teeth, the lids over what lies behind them.
 */
const FRONT_TIE = 0.004

/** How much of an ear a vertex must be (earShares) for an ear's handle to sit on it. */
const ON_EAR = 0.95

/** Landmark handles' vertices: the front-facing skin's (not an eyeball's) nearest each landmark. */
function landmarkAnchors(head: Mesh, target: readonly number[]): FaceAnchor[] {
  const geometry = originalGeometry(head)
  const position = geometry.getAttribute('position')
  if (!position) return []
  const normal = geometry.getAttribute('normal')
  const skinned = head as SkinnedMesh
  const bind = skinned.isSkinnedMesh ? skinned.bindMatrix : new Matrix4()
  const normalMatrix = new Matrix3().getNormalMatrix(bind)
  const { left, top, size } = headFrame(head)
  const eyeOf = eyeballsOf(head)?.eyeOf
  const vertices: number[] = []
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  const v = new Vector3()
  for (let i = 0; i < position.count; i++) {
    if (eyeOf && eyeOf[i]! >= 0) continue
    if (
      normal &&
      v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize().z <= FACING
    )
      continue
    v.fromBufferAttribute(position, i).applyMatrix4(bind)
    vertices.push(i)
    xs.push((v.x - left) / size)
    ys.push((top - v.y) / size)
    zs.push(v.z)
  }
  if (vertices.length === 0) return []
  const points = unpackPoints(target)
  const anchors: FaceAnchor[] = []
  for (const handle of FACE_HANDLES) {
    if (handle.kind !== 'landmark') continue
    const [x, y] = points[facePointOf(handle.landmark)]!
    const distances = vertices.map((_, k) => Math.hypot(xs[k]! - x, ys[k]! - y))
    const nearest = Math.min(...distances)
    let best = -1
    distances.forEach((d, k) => {
      if (d <= nearest + FRONT_TIE && (best < 0 || zs[k]! > zs[best]!)) best = k
    })
    anchors.push({ handle: handle.id, vertex: vertices[best]! })
  }
  return anchors
}

/**
 * The ears' handles' vertices: on each ear, the vertex nearest the middle
 * of its flap's outer edge (halfway up it, as far out as it stands).
 */
function earAnchors(head: Mesh): FaceAnchor[] {
  const ears = earsOf(head)
  if (ears.length === 0) return []
  const geometry = originalGeometry(head)
  const position = geometry.getAttribute('position')!
  const skinned = head as SkinnedMesh
  const bind = skinned.isSkinnedMesh ? skinned.bindMatrix : new Matrix4()
  const middle = headFrame(head).neck.x
  const place = new Vector3()
  const anchors: FaceAnchor[] = []
  for (const handle of FACE_HANDLES) {
    if (handle.kind !== 'ear') continue
    const ear = ears.find((each) => Math.sign(each.root.x - middle) === handle.side)
    if (!ear) continue
    // The root is already under the ear's middle (the mean of its points);
    // halfway up is from its top, so a lobe-heavy ear doesn't pull it down.
    const goal = ear.root
      .clone()
      .addScaledVector(ear.up, ear.tip.y - ear.length / 2 - ear.root.y)
      .addScaledVector(ear.out, ear.standing)
    let best = -1
    let bestOnEar = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < position.count; i++) {
      if (!ear.reached[i]) continue
      place.fromBufferAttribute(position, i).applyMatrix4(bind)
      // Fully on the ear, the nearest; failing any, the most on it.
      const onEar = Math.min(ON_EAR, earShares(ear, place)[0])
      const distance = place.distanceTo(goal)
      if (onEar > bestOnEar || (onEar === bestOnEar && distance < bestDistance)) {
        best = i
        bestOnEar = onEar
        bestDistance = distance
      }
    }
    if (best >= 0) anchors.push({ handle: handle.id, vertex: best })
  }
  return anchors
}

const anchorsByHead = new WeakMap<BufferGeometry, WeakMap<object, FaceAnchor[]>>()

/** The cache's key for a head without landmarks. */
const NO_TARGET = {}

/**
 * The head mesh's vertex for each handle (in FACE_HANDLES' order), found
 * on its bind-pose geometry as loaded and kept per (geometry, target). A
 * landmark's handle sits on the front-facing skin nearest the landmark in
 * the front view (the front-most of those nearly as near); an ear's on the
 * ear. Landmark handles are left out without `target` (a face the
 * character has covered), the ears' on a head without ears.
 */
export function faceAnchors(head: Mesh, target: readonly number[] | null): FaceAnchor[] {
  const geometry = originalGeometry(head)
  let byTarget = anchorsByHead.get(geometry)
  if (!byTarget) {
    byTarget = new WeakMap()
    anchorsByHead.set(geometry, byTarget)
  }
  const key = target ?? NO_TARGET
  const known = byTarget.get(key)
  if (known) return known
  const anchors = [...(target ? landmarkAnchors(head, target) : []), ...earAnchors(head)]
  byTarget.set(key, anchors)
  return anchors
}
