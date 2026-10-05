import { type Object3D, type SkinnedMesh, Vector3 } from 'three'
import {
  type BodyShape,
  type BodySliderId,
  bindPositions,
  bonePart,
  boneReach,
  lengthScale,
} from './body-shape'

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
 * How much of the body's height, sole to crown, the legs (the hip joints to
 * the ankles) and the spine (the small of the back to the neck) make:
 * about alike on every Rocketbox body, child or adult.
 */
const LEGS_OF_HEIGHT = 0.46
const TORSO_OF_HEIGHT = 0.26

const heightGrowth = (body: BodyShape) => 1 + HEIGHT_GROWTH * body.height

/**
 * How many times its own height a build makes the body stand, sole to
 * crown — its height, and its legs' and torso's lengths: what anything
 * placed by its size (a name over its head) scales by.
 */
export const bodyHeightScale = (body: BodyShape) =>
  heightGrowth(body) *
  (1 +
    LEGS_OF_HEIGHT * (lengthScale(body, 'legLength') - 1) +
    TORSO_OF_HEIGHT * (lengthScale(body, 'torsoLength') - 1))

/**
 * How many times its own size a build makes the body's legs — its height,
 * and their length: what its strides scale by, so its feet don't slide.
 */
export const bodyStrideScale = (body: BodyShape) =>
  heightGrowth(body) * lengthScale(body, 'legLength')

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
 * Keeps the feet on the floor under legs of another length: the hips, and
 * all above them, rise by as far as the ankles sank in the bind pose, and
 * the clips' dips of the hips (a stride's bounce, a crouch) grow with the
 * legs, so bending them lowers the hips as far as it lowers those legs'
 * feet. The clips move the hips about their parent's origin (Rocketbox's
 * Avatar node, at the hips' height in the model), so that parent scales
 * with the legs and the hips' own bone as much the other way: nothing else
 * changes size. Returns what puts them back (nothing for a body not rigged
 * so).
 */
function standOnLegs(model: Object3D, mesh: SkinnedMesh, body: BodyShape): (() => void)[] {
  const legs = lengthScale(body, 'legLength')
  const { bones, boneInverses } = mesh.skeleton
  const pelvis = bones.find((bone) => bonePart(bone.name) === 'pelvis')
  const hips = pelvis?.parent
  if (legs === 1 || !(pelvis && hips && hips.parent === model)) return []
  const positions = bindPositions(mesh)
  const indexOf = new Map<Object3D, number>(bones.map((bone, index) => [bone, index]))
  let sunk = 0
  let feet = 0
  for (const foot of bones) {
    if (bonePart(foot.name) !== 'foot') continue
    for (let bone: Object3D = foot; bone.parent && indexOf.has(bone.parent); bone = bone.parent) {
      const from = positions[indexOf.get(bone.parent)!]!
      const to = positions[indexOf.get(bone)!]!
      sunk += (boneReach(body, bone) - 1) * (from.y - to.y)
    }
    feet++
  }
  if (feet === 0) return []
  // The bind pose's frame is the model's scaled, never turned (Rocketbox's is
  // quantized, about 0.9 m to its unit): what one of its units makes in the
  // model is the hips' size in the model over their size in it, however
  // the clips turn them.
  let unit = new Vector3().setFromMatrixScale(boneInverses[indexOf.get(pelvis)!]!).x
  for (let node: Object3D | null = pelvis; node && node !== model; node = node.parent) {
    unit *= node.scale.x
  }
  const raised = hips.position.clone()
  raised.y += (unit * sunk) / feet
  return [
    setFor(hips.position, raised),
    setFor(hips.scale, hips.scale.clone().multiplyScalar(legs)),
    setFor(pelvis.scale, pelvis.scale.clone().divideScalar(legs)),
  ]
}

/**
 * The build's changes that are the skeleton's rather than the geometry's:
 * the shoulders (each upper arm moved along its collarbone, so the arm
 * follows, and further out to make room by a filled-out trunk), the head's
 * size (its bone scaled, the face and hair with it), the legs' and the
 * torso's lengths (the joints at the ends of their bones moved out along
 * them, the geometry between stretched by bodyShaper, and the body raised
 * to keep its feet down) and the height (the whole body scaled from its
 * feet, so they stay on the ground). The clips animate only the bones'
 * turns and the hips' place, so none of this is overwritten as the body
 * moves. Returns what puts them back.
 */
export function applyBodyBones(model: Object3D, body: BodyShape): () => void {
  const undo: (() => void)[] = []
  const shoulders = shoulderShift(body)
  const headSize = body.sliders.headSize ?? 0
  const mesh = skinOf(model)
  for (const bone of mesh?.skeleton.bones ?? []) {
    const part = bonePart(bone.name)
    if (part === 'upperArm' && shoulders !== 0) {
      // An upper arm's place is along its collarbone, from the collarbone's joint.
      undo.push(setFor(bone.position, bone.position.clone().multiplyScalar(1 + shoulders)))
    } else if (part === 'head' && headSize !== 0) {
      undo.push(setFor(bone.scale, bone.scale.clone().multiplyScalar(1 + HEAD_GROWTH * headSize)))
    }
    const reach = boneReach(body, bone)
    if (reach !== 1) undo.push(setFor(bone.position, bone.position.clone().multiplyScalar(reach)))
  }
  if (mesh) undo.push(...standOnLegs(model, mesh, body))
  if (body.height !== 0) {
    undo.push(setFor(model.scale, model.scale.clone().multiplyScalar(heightGrowth(body))))
  }
  return () => {
    for (const step of undo) step()
  }
}
