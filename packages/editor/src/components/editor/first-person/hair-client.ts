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
 * A build's strips as geometry, in the one layout every strip geometry
 * shares, so they all share one pipeline. `uv2` is the very attribute `uv`
 * is: the viewer adds a second uv only where one is missing, so it copies
 * nothing.
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

/** The root layer, then the undercut shells after `shellStart` indices (see `showShells`). */
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

export function showShells(geometry: BufferGeometry, shown: boolean) {
  geometry.setDrawRange(
    0,
    shown ? Number.POSITIVE_INFINITY : (geometry.userData.shellStart as number),
  )
}

/** Which of a character's hair meshes this is (its name is `hair:<part>`). */
export type HairPart = 'inner' | 'outer' | 'strays' | 'soft' | 'roots'

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
 * A hair mesh on a character's skeleton, carrying the character's values,
 * or null for a geometry with nothing to draw. `headBone` is the Head's
 * index in the skeleton: camera-facing strips turn in its frame, whatever
 * bone a strip's first vertex leans on. In the studio the outer strips
 * draw their solid cores here and their soft edges in the soft pass.
 */
export function hairMesh(
  part: HairPart,
  geometry: BufferGeometry,
  skeleton: Skeleton,
  bindMatrix: Matrix4,
  headBone: number,
  values: HairValues,
  studio: boolean,
): SkinnedMesh | null {
  if (!geometry.index?.count) return null
  const { order, casts, core } = PARTS[part]
  const mesh = new SkinnedMesh(geometry, materialOf(part))
  mesh.name = `hair:${part}`
  mesh.bind(skeleton, bindMatrix)
  mesh.renderOrder = order
  mesh.castShadow = casts
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  mesh.raycast = () => {}
  mesh.userData.hairBone = headBone
  holdHairValues(mesh, values, core(studio))
  return mesh
}
