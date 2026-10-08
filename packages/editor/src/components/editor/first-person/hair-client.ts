import {
  BufferAttribute,
  BufferGeometry,
  type Material,
  type Matrix4,
  type Skeleton,
  SkinnedMesh,
} from 'three'
import type { BaseResult } from './hair-base'
import type { RibbonArrays } from './hair-grow'
import { CORE_COVERAGE, type HairValues, hairMaterials, holdHairValues } from './hair-material'

/**
 * Generated hair on the page: a build's arrays as geometry with the one
 * fixed layout every strip geometry shares (so they all share one
 * pipeline), and the meshes that draw them on a character's skeleton.
 */

/**
 * A build's strips as geometry. `uv2` is the very attribute `uv` is, so a
 * viewer that adds a second uv where one is missing copies nothing.
 */
export function ribbonGeometry(arrays: RibbonArrays): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(arrays.position, 3))
  geometry.setAttribute('normal', new BufferAttribute(arrays.normal, 3))
  geometry.setAttribute('tangent', new BufferAttribute(arrays.tangent, 4))
  const uv = new BufferAttribute(arrays.uv, 2)
  geometry.setAttribute('uv', uv)
  geometry.setAttribute('uv2', uv)
  geometry.setAttribute('hairData', new BufferAttribute(arrays.hairData, 4))
  geometry.setAttribute('hairShape', new BufferAttribute(arrays.hairShape, 4))
  geometry.setAttribute('skinIndex', new BufferAttribute(arrays.skinIndex, 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(arrays.skinWeight, 4))
  geometry.setIndex(new BufferAttribute(arrays.index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * The scalp's root layer and undercut shells as geometry. The shells,
 * after `shellStart` indices, are drawn only under a cut with an undercut
 * (see `showShells`).
 */
export function rootsGeometry(roots: BaseResult['roots']): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(roots.position, 3))
  geometry.setAttribute('normal', new BufferAttribute(roots.normal, 3))
  geometry.setAttribute('scalpDir', new BufferAttribute(roots.scalpDir, 4))
  geometry.setAttribute('comb', new BufferAttribute(roots.comb, 3))
  geometry.setAttribute('skinIndex', new BufferAttribute(roots.skinIndex, 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(roots.skinWeight, 4))
  geometry.setIndex(new BufferAttribute(roots.index, 1))
  geometry.userData.shellStart = roots.shellStart
  geometry.computeBoundingSphere()
  showShells(geometry, false)
  return geometry
}

/** Draws a root layer's undercut shells, or leaves them out. */
export function showShells(geometry: BufferGeometry, shown: boolean) {
  geometry.setDrawRange(
    0,
    shown ? Number.POSITIVE_INFINITY : (geometry.userData.shellStart as number),
  )
}

/** Which of a character's hair meshes this is (its name is `hair:<part>`). */
export type HairPart = 'inner' | 'outer' | 'strays' | 'soft' | 'roots'

/** How each part is drawn: its material, order after the head, shadows, and which coverage it draws. */
const PARTS: Record<
  HairPart,
  { order: number; casts: boolean; core: (studio: boolean) => number | undefined }
> = {
  roots: { order: 1, casts: false, core: () => undefined },
  inner: { order: 2, casts: true, core: () => undefined },
  outer: { order: 2, casts: true, core: (studio) => (studio ? CORE_COVERAGE : undefined) },
  strays: { order: 2, casts: false, core: (studio) => (studio ? CORE_COVERAGE : undefined) },
  soft: { order: 3, casts: false, core: () => undefined },
}

const materialOf = (part: HairPart): Material =>
  part === 'roots'
    ? hairMaterials.roots
    : part === 'soft'
      ? hairMaterials.soft
      : hairMaterials.strands

/**
 * A hair mesh on a character's skeleton (the head's, with its bind matrix),
 * carrying the character's values. Hair is never picked. In the studio the
 * outer strips draw their solid cores here and their soft edges in the soft
 * pass.
 */
export function hairMesh(
  part: HairPart,
  geometry: BufferGeometry,
  skeleton: Skeleton,
  bindMatrix: Matrix4,
  values: HairValues,
  studio: boolean,
): SkinnedMesh {
  const { order, casts, core } = PARTS[part]
  const mesh = new SkinnedMesh(geometry, materialOf(part))
  mesh.name = `hair:${part}`
  mesh.bind(skeleton, bindMatrix)
  mesh.renderOrder = order
  mesh.castShadow = casts
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  mesh.raycast = () => {}
  // The bone the strips follow (the head's): camera-facing strips turn in its frame.
  mesh.userData.hairBone = geometry.getAttribute('skinIndex').getX(0)
  holdHairValues(mesh, values, core(studio))
  return mesh
}
