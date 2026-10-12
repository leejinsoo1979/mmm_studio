import {
  type BufferAttribute,
  type BufferGeometry,
  type Material,
  Matrix3,
  Matrix4,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
  Vector3,
} from 'three'
import { isFeetCopy } from './avatar-feet'
import { cardKinds, HAIR, LASH } from './avatar-hair'
import { earsOf } from './ear-shape'
import type { BaseInput } from './hair-base'
import { loadedGeometry, originalGeometry } from './head-geometry'

/**
 * What the hair worker is sent for a loaded character (see hair-base.ts's
 * BaseInput): its head as loaded, its body round the neck, its bones, its
 * lashes and ears, and where its own hair cards are, all in the bind pose.
 * The same for every shape and look the character wears, so a character
 * sends it once.
 */

/** How far under the head bone (bind units) the body is kept: the neck, the collar and the shoulders' tops. */
const BODY_BELOW = 0.4

/** How near (bind units) an ear's point and a head's point are to be one. */
const SAME_POINT = 1e-4

const materialOf = (mesh: Mesh) => (mesh.userData.lookOriginal ?? mesh.material) as Material

/** A character's own skinned mesh showing `part` (its material ends `_part`): not a copy following another. */
function partOf(model: Object3D, part: 'head' | 'body' | 'opacity'): SkinnedMesh | null {
  let found: SkinnedMesh | null = null
  model.traverse((object) => {
    const mesh = object as SkinnedMesh
    if (found || !mesh.isSkinnedMesh || Array.isArray(mesh.material)) return
    if (mesh.userData.follows || isFeetCopy(mesh) || mesh.userData.hair) return
    if (materialOf(mesh).name.endsWith(`_${part}`)) found = mesh
  })
  return found
}

/** A geometry's points or normals in its mesh's bind pose. */
export function bindArray(
  mesh: SkinnedMesh,
  geometry: BufferGeometry,
  name: 'position' | 'normal',
) {
  const attribute = geometry.getAttribute(name)
  const normalMatrix = new Matrix3().getNormalMatrix(mesh.bindMatrix)
  const out = new Float32Array(attribute.count * 3)
  const v = new Vector3()
  for (let i = 0; i < attribute.count; i++) {
    v.fromBufferAttribute(attribute, i)
    if (name === 'position') v.applyMatrix4(mesh.bindMatrix)
    else v.applyMatrix3(normalMatrix).normalize()
    v.toArray(out, i * 3)
  }
  return out
}

const valuesOf = (attribute: BufferAttribute) =>
  Float32Array.from({ length: attribute.count * attribute.itemSize }, (_, j) =>
    attribute.getComponent(Math.floor(j / attribute.itemSize), j % attribute.itemSize),
  )

const indexOf = (geometry: BufferGeometry) =>
  Uint32Array.from(
    geometry.index?.array ??
      Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i),
  )

/** Which of `points` (x y z triples) lie on `marked` (within SAME_POINT): 1 each, else 0. */
function marked(points: Float32Array, marked: readonly Vector3[]): Uint8Array {
  const cell = (value: number) => Math.floor(value / SAME_POINT)
  const grid = new Map<string, Vector3[]>()
  for (const point of marked) {
    const key = `${cell(point.x)},${cell(point.y)},${cell(point.z)}`
    const list = grid.get(key)
    if (list) list.push(point)
    else grid.set(key, [point])
  }
  const flags = new Uint8Array(points.length / 3)
  const at = new Vector3()
  for (let i = 0; i < flags.length; i++) {
    at.fromArray(points, i * 3)
    const [cx, cy, cz] = [cell(at.x), cell(at.y), cell(at.z)]
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const point of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (point.distanceToSquared(at) < SAME_POINT * SAME_POINT) {
              flags[i] = 1
              break search
            }
          }
        }
      }
    }
  }
  return flags
}

/**
 * A character's BaseInput, or null when it has no head or body of its own
 * to grow hair on. `model` is the character as loaded (any pose, shape or
 * look on it is left out: its head as loaded and its body unshaped are read).
 */
export function hairBaseInput(model: Object3D, avatar: string): BaseInput | null {
  const head = partOf(model, 'head')
  const body = partOf(model, 'body')
  if (!head || !body) return null
  const cards = partOf(model, 'opacity')
  const { bones: skeleton, boneInverses } = head.skeleton
  const bones = new Map<string, [number, number, number]>()
  skeleton.forEach((bone, i) => {
    const p = new Vector3().setFromMatrixPosition(boneInverses[i]!.clone().invert())
    bones.set(bone.name, [p.x, p.y, p.z])
  })
  const bone = (name: string) => bones.get(`Bip01_${name}`) ?? null
  const slot = (name: string) => skeleton.findIndex((b) => b.name === `Bip01_${name}`)
  const needed = ['Head', 'Neck', 'Spine', 'Spine2', 'L_Clavicle', 'R_Clavicle', 'L_UpperArm']
  if (!(needed.every(bone) && bone('R_UpperArm') && bone('LEye') && bone('REye'))) return null

  const loaded = loadedGeometry(head)
  const points = bindArray(head, loaded, 'position')
  const index = indexOf(loaded)

  // The body round the neck, its points renumbered.
  const bodyGeometry = originalGeometry(body)
  const bodyPoints = bindArray(body, bodyGeometry, 'position')
  const bodyUv = valuesOf(bodyGeometry.getAttribute('uv') as BufferAttribute)
  const bodyIndex = indexOf(bodyGeometry)
  const lowest = bone('Head')![1] - BODY_BELOW
  const renumber = new Map<number, number>()
  const keptCorners: number[] = []
  for (let t = 0; t < bodyIndex.length; t += 3) {
    const corners = [bodyIndex[t]!, bodyIndex[t + 1]!, bodyIndex[t + 2]!]
    if (!corners.every((i) => bodyPoints[i * 3 + 1]! > lowest)) continue
    for (const i of corners) {
      if (!renumber.has(i)) renumber.set(i, renumber.size)
      keptCorners.push(renumber.get(i)!)
    }
  }
  const olds = [...renumber.keys()]
  const trimmedPoints = new Float32Array(olds.length * 3)
  const trimmedUvs = new Float32Array(olds.length * 2)
  olds.forEach((old, i) => {
    trimmedPoints.set(bodyPoints.subarray(old * 3, old * 3 + 3), i * 3)
    trimmedUvs.set(bodyUv.subarray(old * 2, old * 2 + 2), i * 2)
  })

  // The lashes' box, and points over the hair cards (each triangle's middle and corners).
  let lashes: BaseInput['lashes'] = null
  let hairPoints: Float32Array | null = null
  if (cards) {
    const cardGeometry = originalGeometry(cards)
    const cardPoints = bindArray(cards, cardGeometry, 'position')
    const cardIndex = indexOf(cardGeometry)
    const kinds = cardKinds(cardPoints, cardIndex, [...bone('LEye')!, ...bone('REye')!])
    const low: [number, number, number] = [Infinity, Infinity, Infinity]
    const high: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    const found: number[] = []
    let lashCount = 0
    for (let t = 0; t < kinds.length; t++) {
      const corners = [0, 1, 2].map((k) => cardIndex[t * 3 + k]!)
      if (kinds[t] === LASH) {
        lashCount++
        for (const i of corners) {
          for (let axis = 0; axis < 3; axis++) {
            low[axis] = Math.min(low[axis]!, cardPoints[i * 3 + axis]!)
            high[axis] = Math.max(high[axis]!, cardPoints[i * 3 + axis]!)
          }
        }
      } else if (kinds[t] === HAIR) {
        for (let axis = 0; axis < 3; axis++) {
          found.push(corners.reduce((sum, i) => sum + cardPoints[i * 3 + axis]!, 0) / 3)
        }
        for (const i of corners) found.push(...cardPoints.subarray(i * 3, i * 3 + 3))
      }
    }
    if (lashCount > 0) lashes = { min: low, max: high }
    if (found.length > 0) hairPoints = Float32Array.from(found)
  }

  const ears = marked(
    points,
    earsOf(head).flatMap((ear) => ear.points),
  )

  // Bind units to metres, as the character is scaled within itself (not by
  // the room or a look's height): through its root bone, which nothing scales.
  model.updateMatrixWorld(true)
  const toModel = new Matrix4()
    .copy(model.matrixWorld)
    .invert()
    .multiply(skeleton[0]!.matrixWorld)
    .multiply(boneInverses[0]!)
  const metresPerUnit = new Vector3().setFromMatrixScale(toModel).x

  return {
    avatar,
    material: materialOf(head).name,
    metresPerUnit,
    head: {
      points,
      normals: bindArray(head, loaded, 'normal'),
      uvs: valuesOf(loaded.getAttribute('uv') as BufferAttribute),
      index,
      skinIndex: Uint16Array.from(valuesOf(loaded.getAttribute('skinIndex') as BufferAttribute)),
      skinWeight: valuesOf(loaded.getAttribute('skinWeight') as BufferAttribute),
    },
    body: { points: trimmedPoints, uvs: trimmedUvs, index: Uint32Array.from(keptCorners) },
    cards: hairPoints,
    lashes,
    faceBones: Object.fromEntries(bones),
    bones: {
      head: bone('Head')!,
      neck: bone('Neck')!,
      spine: bone('Spine')!,
      spine2: bone('Spine2')!,
      clavicleL: bone('L_Clavicle')!,
      clavicleR: bone('R_Clavicle')!,
      upperArmL: bone('L_UpperArm')!,
      upperArmR: bone('R_UpperArm')!,
    },
    boneIndex: {
      head: slot('Head'),
      neck: slot('Neck'),
      spine2: slot('Spine2'),
      clavicleL: slot('L_Clavicle'),
      clavicleR: slot('R_Clavicle'),
    },
    marks: {
      eyes: [bone('LEye')!, bone('REye')!],
      neck: bone('Head')![1],
      nape: bone('Head')![2],
    },
    ears: ears.includes(1) ? ears : null,
  }
}
