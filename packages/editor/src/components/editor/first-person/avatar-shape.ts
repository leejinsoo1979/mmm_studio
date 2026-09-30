'use client'

import { useEffect } from 'react'
import {
  type BufferGeometry,
  Matrix3,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
  Vector3,
} from 'three'
import type { AvatarLook } from '../../../store/use-avatar-profile'
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

/** A shape as a displacement of bind-pose points (and the points' own frame). */
function bindField(field: ShapeField, frame: HeadFrame) {
  const { left, top, size, neck, front } = frame
  const depth = Math.max(front - neck.z, 1e-6)
  const out = [0, 0, 0]
  return (point: Vector3, move: Vector3) => {
    const t = ((point.z - neck.z) / depth - DEPTH_FROM) / (DEPTH_TO - DEPTH_FROM)
    if (t <= 0) return move.set(0, 0, 0)
    const reach = t >= 1 ? 1 : t * t * (3 - 2 * t)
    field((point.x - left) / size, (top - point.y) / size, out)
    return move.set(out[0]! * size, -out[1]! * size, out[2]! * size).multiplyScalar(reach)
  }
}

/** Finite-difference step for the normals, as a share of the front view. */
const STEP = 0.002

/**
 * A mesh's geometry reshaped: each point moved by the field (worked out in
 * the bind pose, where the head's front view is framed), its normal turned
 * the way the surface round it turned.
 */
function reshaped(
  mesh: Mesh,
  original: BufferGeometry,
  move: ReturnType<typeof bindField>,
  step: number,
) {
  const skinned = mesh as SkinnedMesh
  const position = original.getAttribute('position')
  const normal = original.getAttribute('normal')
  if (!position) return null
  const geometry = original.clone()
  const positions = geometry.getAttribute('position')
  const normals = normal ? geometry.getAttribute('normal') : null
  const toBind = skinned.isSkinnedMesh ? skinned.bindMatrix : null
  // Not the mesh's bindMatrixInverse: that follows where the mesh is now.
  const unbind = toBind ? toBind.clone().invert() : null
  const fromBind = unbind ? new Matrix3().setFromMatrix4(unbind) : null
  const normalToBind = toBind ? new Matrix3().getNormalMatrix(toBind) : null
  const normalFromBind = unbind ? new Matrix3().getNormalMatrix(unbind) : null
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
    if (toBind) point.applyMatrix4(toBind)
    move(point, displacement)
    if (displacement.lengthSq() === 0) continue
    moved = true
    if (normals) {
      // The surface's stretch round the point: d(point + move)/d(point).
      for (let axis = 0; axis < 3; axis++) {
        shifted.copy(point).setComponent(axis, point.getComponent(axis) + step)
        move(shifted, around)
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
        n.fromBufferAttribute(normal!, i)
        if (normalToBind) n.applyMatrix3(normalToBind)
        n.applyMatrix3(jacobian.invert().transpose())
        if (normalFromBind) n.applyMatrix3(normalFromBind)
        n.normalize()
        normals.setXYZ(i, n.x, n.y, n.z)
      }
    }
    if (fromBind) displacement.applyMatrix3(fromBind)
    point.fromBufferAttribute(position, i).add(displacement)
    positions.setXYZ(i, point.x, point.y, point.z)
  }
  if (!moved) {
    geometry.dispose()
    return null
  }
  return geometry
}

function headOf(model: Object3D): Mesh | null {
  let head: Mesh | null = null
  model.traverse((object) => {
    const mesh = object as Mesh
    const material = (mesh.userData.lookOriginal ?? mesh.material) as MeshStandardMaterial
    if (mesh.isMesh && !Array.isArray(material) && /_head$/.test(material.name)) head = mesh
  })
  return head
}

/**
 * Reshapes a body's head (and what lies on it: lashes, hair, the neck's
 * top) by a face shape, each mesh getting its own reshaped geometry (a
 * body's clones share theirs). Returns what puts the originals back.
 */
export function applyShape(model: Object3D, field: ShapeField): () => void {
  const head = headOf(model)
  if (!head) return () => {}
  const frame = headFrame(head)
  const move = bindField(field, frame)
  const step = STEP * frame.size
  const undo: (() => void)[] = []
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const original = originalGeometry(mesh)
    const geometry = reshaped(mesh, original, move, step)
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
 * Keeps a body's face shaped by a look: the photo's proportions and the
 * sliders. The character's landmarks come with the face targets (a
 * download, once), so a shape lands a moment after the body shows.
 */
export function useAvatarShape(
  model: Object3D,
  look: Pick<AvatarLook, 'face' | 'shape'> | null | undefined,
  avatarId: string,
) {
  const shape = look?.shape
  const points = look?.face?.points
  useEffect(() => {
    if (!shape || !(hasSliders(shape) || (points && shape.fit > 0))) return
    let undo: (() => void) | null = null
    let cancelled = false
    loadFaceTargets()
      .then((targets) => {
        const target = targets[avatarId]
        if (cancelled || !target) return
        const field = faceShapeField(target, shape, points ?? null)
        if (field) undo = applyShape(model, field)
      })
      .catch((error: unknown) => console.warn('[look] could not shape the face', error))
    return () => {
      cancelled = true
      undo?.()
    }
  }, [model, shape, points, avatarId])
}
