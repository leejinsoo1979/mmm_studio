import type { Object3D, SkinnedMesh, Vector3 } from 'three'
import { type BodyShape, type BodySliderId, bonePart } from './body-shape'

/** How far (as a share of the collarbone) the shoulders widen or narrow at full setting. */
const SHOULDER_REACH = 0.25
/**
 * The most (as a share of the collarbone) the arms stand further out to
 * make room by a filled-out trunk, however the sliders add up: otherwise a
 * heavier body's sides would swallow its elbows and hands whenever they
 * rest against it. Well short of the shoulders' own reach, so narrowed
 * shoulders still read narrower on the heaviest body.
 */
const MOST_ARM_ROOM = 0.1
/**
 * How much of that room each slider that fills out the trunk where the
 * arms hang by it takes at full setting (weight all of it; the rest add
 * up to it). Slimming leaves the arms where they are.
 */
const ARM_ROOM: Partial<Record<BodySliderId, number>> = {
  weight: 1,
  waist: 0.9,
  hips: 0.55,
  muscle: 0.45,
  belly: 0.3,
}
/** How much bigger or smaller the head grows at full setting. */
const HEAD_GROWTH = 0.12
/** How much taller or shorter the whole body stands at full setting. */
const HEIGHT_GROWTH = 0.12

/**
 * How many times its own size a build makes the whole body: what its
 * strides and anything placed by its size (a name over its head) scale by.
 */
export const bodyHeightScale = (body: BodyShape) => 1 + HEIGHT_GROWTH * body.height

/** How far (as a share of the collarbone) a build moves the arms out, or in for narrow shoulders. */
function shoulderShift(body: BodyShape) {
  let fullness = 0
  for (const [id, share] of Object.entries(ARM_ROOM) as [BodySliderId, number][]) {
    fullness += share * Math.max(0, body.sliders[id] ?? 0)
  }
  return SHOULDER_REACH * (body.sliders.shoulders ?? 0) + MOST_ARM_ROOM * Math.min(1, fullness)
}

/**
 * Sets a vector (a bone's place or scale) to `value` and returns what puts
 * it back — unless something else has set it since, which is then left be.
 */
function setFor(vector: Vector3, value: Vector3): () => void {
  const original = vector.clone()
  vector.copy(value)
  return () => {
    if (vector.equals(value)) vector.copy(original)
  }
}

/**
 * The body's skeleton, from any of its skinned meshes: one made all in one
 * piece (Female_Adult_16) has no head mesh of its own to find it by.
 */
const skinOf = (model: Object3D) =>
  model.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh | undefined

/**
 * The build's changes that are the skeleton's rather than the geometry's:
 * the shoulders (each upper arm moved along its collarbone, so the arm
 * follows, and further out to make room by a filled-out trunk), the head's
 * size (its bone scaled, the face and hair with it) and the height (the
 * whole body scaled from its feet, so they stay on the ground). The clips
 * animate only the bones' turns and the hips' place, so none of this is
 * overwritten as the body moves. Returns what puts them back.
 */
export function applyBodyBones(model: Object3D, body: BodyShape): () => void {
  const undo: (() => void)[] = []
  const shoulders = shoulderShift(body)
  const headSize = body.sliders.headSize ?? 0
  for (const bone of skinOf(model)?.skeleton.bones ?? []) {
    const part = bonePart(bone.name)
    if (part === 'upperArm' && shoulders !== 0) {
      // An upper arm's place is along its collarbone, from the collarbone's joint.
      undo.push(setFor(bone.position, bone.position.clone().multiplyScalar(1 + shoulders)))
    } else if (part === 'head' && headSize !== 0) {
      undo.push(setFor(bone.scale, bone.scale.clone().multiplyScalar(1 + HEAD_GROWTH * headSize)))
    }
  }
  if (body.height !== 0) {
    undo.push(setFor(model.scale, model.scale.clone().multiplyScalar(bodyHeightScale(body))))
  }
  return () => {
    for (const step of undo) step()
  }
}
