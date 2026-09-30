'use client'

import { useEffect } from 'react'
import {
  BufferAttribute,
  type BufferGeometry,
  Matrix3,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
  Vector3,
} from 'three'
import type { AvatarLook } from '../../../store/use-avatar-profile'
import { bodyShaper } from './body-shape'
import { earShaper } from './ear-shape'
import { faceShapeField, hasSliders, type ShapeField } from './face-shape'
import { loadFaceTargets } from './face-targets'
import { type HeadFrame, headFrame, originalGeometry } from './head-geometry'

/**
 * How much of a shape reaches a point by its depth in the head (as a share
 * of the way from the neck to the face's front): none at the back of the
 * head, all over the face, so the skull and the ears stay put.
 */
const DEPTH_FROM = -0.25
const DEPTH_TO = 0.3

/**
 * Part of a body's reshaping, for one of its meshes: where one of its
 * points (in the bind pose; `index` is its vertex) moves, written into
 * `move` — a zero move leaves it be.
 */
export type PointMove = (point: Vector3, index: number, move: Vector3) => void

/** A reshaping's moves for a mesh of the body, or null when it leaves that mesh be. */
export type Shaper = (mesh: Mesh) => PointMove | null

/** The face shape's field (on the head's front view) as moves of bind-pose points, for every mesh. */
export function faceShaper(field: ShapeField, frame: HeadFrame): Shaper {
  const { left, top, size, neck, front } = frame
  const depth = Math.max(front - neck.z, 1e-6)
  const out = [0, 0, 0]
  const move: PointMove = (point, _index, move) => {
    const t = ((point.z - neck.z) / depth - DEPTH_FROM) / (DEPTH_TO - DEPTH_FROM)
    if (t <= 0) {
      move.set(0, 0, 0)
      return
    }
    const reach = t >= 1 ? 1 : t * t * (3 - 2 * t)
    field((point.x - left) / size, (top - point.y) / size, out)
    move.set(out[0]! * size, -out[1]! * size, out[2]! * size).multiplyScalar(reach)
  }
  return () => move
}

/** Finite-difference step for the normals, as a share of the front view. */
const STEP = 0.002

const part = new Vector3()

/** The moves summed. */
function summed(moves: readonly PointMove[]): PointMove {
  if (moves.length === 1) return moves[0]!
  return (point, index, move) => {
    move.set(0, 0, 0)
    for (const each of moves) {
      each(point, index, part)
      move.add(part)
    }
  }
}

/**
 * A mesh's geometry reshaped: each point moved (worked out in the bind
 * pose, where the head's front view is framed and the bones stand), its
 * normal turned the way the surface round it turned. Positions and normals
 * come out as plain floats: the loaded ones are quantized to the mesh's
 * bounds, which a point moved out past would wrap round.
 */
function reshaped(mesh: Mesh, original: BufferGeometry, move: PointMove, step: number) {
  const skinned = mesh as SkinnedMesh
  const position = original.getAttribute('position')
  const normal = original.getAttribute('normal')
  if (!position) return null
  const toBind = skinned.isSkinnedMesh ? skinned.bindMatrix : null
  // Not the mesh's bindMatrixInverse: that follows where the mesh is now.
  const unbind = toBind ? toBind.clone().invert() : null
  const fromBind = unbind ? new Matrix3().setFromMatrix4(unbind) : null
  const normalToBind = toBind ? new Matrix3().getNormalMatrix(toBind) : null
  const normalFromBind = unbind ? new Matrix3().getNormalMatrix(unbind) : null
  const positions = new Float32Array(position.count * 3)
  const normals = normal ? new Float32Array(normal.count * 3) : null
  const point = new Vector3()
  const shifted = new Vector3()
  const displacement = new Vector3()
  const around = new Vector3()
  const n = new Vector3()
  const jacobian = new Matrix3()
  const columns = [new Vector3(), new Vector3(), new Vector3()]
  let moved = false
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i)
    if (normals) n.fromBufferAttribute(normal!, i).toArray(normals, i * 3)
    if (toBind) point.applyMatrix4(toBind)
    move(point, i, displacement)
    if (displacement.lengthSq() === 0) {
      point.fromBufferAttribute(position, i).toArray(positions, i * 3)
      continue
    }
    moved = true
    if (normals) {
      // The surface's stretch round the point: d(point + move)/d(point).
      for (let axis = 0; axis < 3; axis++) {
        shifted.copy(point).setComponent(axis, point.getComponent(axis) + step)
        move(shifted, i, around)
        columns[axis]!.copy(around).sub(displacement).divideScalar(step)
        columns[axis]!.setComponent(axis, columns[axis]!.getComponent(axis) + 1)
      }
      jacobian.set(
        columns[0]!.x,
        columns[1]!.x,
        columns[2]!.x,
        columns[0]!.y,
        columns[1]!.y,
        columns[2]!.y,
        columns[0]!.z,
        columns[1]!.z,
        columns[2]!.z,
      )
      if (jacobian.determinant() > 1e-6) {
        if (normalToBind) n.applyMatrix3(normalToBind)
        n.applyMatrix3(jacobian.invert().transpose())
        if (normalFromBind) n.applyMatrix3(normalFromBind)
        n.normalize().toArray(normals, i * 3)
      }
    }
    if (fromBind) displacement.applyMatrix3(fromBind)
    point
      .fromBufferAttribute(position, i)
      .add(displacement)
      .toArray(positions, i * 3)
  }
  if (!moved) return null
  const geometry = original.clone()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  if (normals) geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  return geometry
}

/** The body's head mesh (its material ends `_head`). */
export function headOf(model: Object3D): Mesh | null {
  let head: Mesh | null = null
  model.traverse((object) => {
    const mesh = object as Mesh
    const material = (mesh.userData.lookOriginal ?? mesh.material) as MeshStandardMaterial
    if (mesh.isMesh && !Array.isArray(material) && /_head$/.test(material.name)) head = mesh
  })
  return head
}

/**
 * Reshapes a body by some shapers together (the face, the ears, the
 * build), each mesh getting its own reshaped geometry (a body's clones
 * share theirs). Returns what puts the originals back.
 */
export function applyShape(model: Object3D, shapers: readonly Shaper[]): () => void {
  const head = headOf(model)
  if (!head || shapers.length === 0) return () => {}
  const step = STEP * headFrame(head).size
  const undo: (() => void)[] = []
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const moves = shapers.map((shaper) => shaper(mesh)).filter((move) => move !== null)
    if (moves.length === 0) return
    const original = originalGeometry(mesh)
    const geometry = reshaped(mesh, original, summed(moves), step)
    if (!geometry) return
    mesh.userData.shapeOriginal = original
    mesh.geometry = geometry
    undo.push(() => {
      // A later shape may have replaced this one since: leave that be.
      if (mesh.geometry === geometry) {
        mesh.geometry = original
        delete mesh.userData.shapeOriginal
      }
      geometry.dispose()
    })
  })
  return () => {
    for (const step of undo) step()
  }
}

/**
 * Keeps a body shaped by a look: the face (the photo's proportions and the
 * sliders), the ears, the build, and the head under a borrowed hairstyle
 * (`hair`, from useAvatarHair). All go in one reshaping, each mesh built
 * from its original once. The face waits for the character's landmarks (a
 * download, once); the rest needs none.
 */
export function useAvatarShape(
  model: Object3D,
  look: Pick<AvatarLook, 'face' | 'shape' | 'body'> | null | undefined,
  avatarId: string,
  hair: Shaper | null,
) {
  const shape = look?.shape
  const body = look?.body
  const points = look?.face?.points
  useEffect(() => {
    const head = headOf(model)
    if (!head) return
    const ready: Shaper[] = []
    if (hair) ready.push(hair)
    const build = body ? bodyShaper(body) : null
    if (build) ready.push(build)
    const ears = shape ? earShaper(head, shape) : null
    if (ears) ready.push(ears)
    let undo: (() => void) | null = null
    let cancelled = false
    const apply = (shapers: Shaper[]) => {
      if (!cancelled && shapers.length > 0) undo = applyShape(model, shapers)
    }
    if (!(shape && (hasSliders(shape) || (points && shape.fit > 0)))) {
      apply(ready)
    } else {
      loadFaceTargets()
        .then((targets) => {
          const target = targets[avatarId]
          const field = target ? faceShapeField(target, shape, points ?? null) : null
          apply(field ? [faceShaper(field, headFrame(head)), ...ready] : ready)
        })
        .catch((error: unknown) => {
          console.warn('[look] could not shape the face', error)
          apply(ready)
        })
    }
    return () => {
      cancelled = true
      undo?.()
    }
  }, [model, shape, body, points, avatarId, hair])
}
