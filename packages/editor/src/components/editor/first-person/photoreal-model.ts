import { humanMaterial, humanSurfaceOf } from '@pascal-app/viewer'
import type { Material, Mesh, Object3D, SkinnedMesh } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

/**
 * A 실사 body's mesh made ready to draw — every material in the human
 * shading (human-shading.ts) — and how tall it stands. No React: the
 * studio, the game and the test harness share it.
 */

const shaded = new WeakMap<Material, Material>()

/** A copy of a loaded body, every material in the human shading (once per material, shared by its copies). */
export function preparePhotorealModel(source: Object3D, anisotropy = 1): Object3D {
  const model = cloneSkinned(source)
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Skinned bounds follow the bind pose, not the animated body.
    mesh.frustumCulled = false
    const swap = (material: Material) => {
      let made = shaded.get(material)
      if (!made) {
        made = humanMaterial(material, humanSurfaceOf(material.name), { anisotropy })
        shaded.set(material, made)
      }
      return made
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
  return model
}

/** How tall a body stands as it is posed now (m): its skinned meshes' highest point over its lowest. */
export function postureHeight(model: Object3D): number {
  let top = Number.NEGATIVE_INFINITY
  let bottom = Number.POSITIVE_INFINITY
  model.updateWorldMatrix(true, true)
  model.traverse((object) => {
    const mesh = object as SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    mesh.computeBoundingBox()
    const box = mesh.boundingBox!.clone().applyMatrix4(mesh.matrixWorld)
    top = Math.max(top, box.max.y)
    bottom = Math.min(bottom, box.min.y)
  })
  return Number.isFinite(top - bottom) ? top - bottom : 1.7
}
