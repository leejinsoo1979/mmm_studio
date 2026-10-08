import { describe, expect, test } from 'bun:test'
import { Bone, Matrix4, Raycaster, Skeleton, Vector3 } from 'three'
import type { BaseResult } from './hair-base'
import { hairMesh, ribbonGeometry, rootsGeometry, showShells } from './hair-client'
import type { RibbonArrays } from './hair-grow'
import { CORE_COVERAGE, newHairValues } from './hair-material'

/** One strip of `points` points, two vertices each, as a build lays it out. */
function strip(points: number): RibbonArrays {
  const n = points * 2
  const index = new Uint32Array((points - 1) * 6)
  for (let k = 0; k < points - 1; k++)
    index.set(
      [0, 1, 2, 1, 3, 2].map((v) => v + k * 2),
      k * 6,
    )
  const skinIndex = new Uint16Array(n * 4).fill(3)
  const skinWeight = new Float32Array(n * 4)
  for (let v = 0; v < n; v++) skinWeight[v * 4] = 1
  return {
    position: Float32Array.from({ length: n * 3 }, (_, i) => (i % 3 === 1 ? -i * 0.001 : 0)),
    normal: new Float32Array(n * 3).fill(1),
    tangent: new Float32Array(n * 4).fill(1),
    uv: new Float32Array(n * 2),
    hairData: new Float32Array(n * 4),
    hairShape: new Float32Array(n * 4),
    skinIndex,
    skinWeight,
    index,
  }
}

function roots(): BaseResult['roots'] {
  return {
    position: new Float32Array(12),
    normal: new Float32Array(12),
    scalpDir: new Float32Array(16),
    comb: new Float32Array(12),
    skinIndex: new Uint16Array(16),
    skinWeight: new Float32Array(16),
    index: Uint32Array.from([0, 1, 2, 1, 3, 2, 0, 2, 3]),
    srcVertex: new Uint32Array(4),
    height: new Float32Array(4),
    grows: new Float32Array(4),
    shellStart: 6,
  }
}

describe('ribbonGeometry', () => {
  test("lays a build's strips out with the one fixed layout, uv2 the very attribute uv is", () => {
    const g = ribbonGeometry(strip(5))
    const layout = Object.fromEntries(
      Object.entries(g.attributes).map(([name, a]) => [
        name,
        [a.itemSize, a.array.constructor.name],
      ]),
    )
    expect(layout).toEqual({
      position: [3, 'Float32Array'],
      normal: [3, 'Float32Array'],
      tangent: [4, 'Float32Array'],
      uv: [2, 'Float32Array'],
      uv2: [2, 'Float32Array'],
      hairData: [4, 'Float32Array'],
      hairShape: [4, 'Float32Array'],
      skinIndex: [4, 'Uint16Array'],
      skinWeight: [4, 'Float32Array'],
    })
    expect(g.attributes.uv2).toBe(g.attributes.uv)
    expect(g.index!.array).toBeInstanceOf(Uint32Array)
    expect(g.boundingSphere).not.toBeNull()
  })
})

describe('rootsGeometry', () => {
  test('draws the undercut shells only when asked', () => {
    const g = rootsGeometry(roots())
    expect(g.drawRange.count).toBe(6)
    showShells(g, true)
    expect(g.drawRange.count).toBe(Number.POSITIVE_INFINITY)
    showShells(g, false)
    expect(g.drawRange.count).toBe(6)
    expect(Object.keys(g.attributes).sort()).toEqual(
      ['comb', 'grows', 'normal', 'position', 'scalpDir', 'skinIndex', 'skinWeight'].sort(),
    )
  })
})

describe('hairMesh', () => {
  const bones = [0, 1, 2, 3].map(() => new Bone())
  const skeleton = new Skeleton(bones)
  const values = newHairValues()
  const HEAD = 2

  test('is unpickable, drawn after the head, and carries the shared values', () => {
    const mesh = hairMesh(
      'inner',
      ribbonGeometry(strip(4)),
      skeleton,
      new Matrix4(),
      HEAD,
      values,
      true,
    )!
    expect(mesh.name).toBe('hair:inner')
    expect(mesh.renderOrder).toBe(2)
    expect(mesh.castShadow).toBe(true)
    expect(mesh.userData.hair).toBe(values)
    // The head bone as given, not the bone the first vertex leans on (3 here).
    expect(mesh.userData.hairBone).toBe(HEAD)
    const hits: unknown[] = []
    mesh.updateMatrixWorld()
    new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1)).intersectObject(
      mesh,
      false,
      hits as never,
    )
    expect(hits).toEqual([])
  })

  test("draws the outer strips' solid cores only in the studio, and never casts strays or roots", () => {
    const geometry = ribbonGeometry(strip(4))
    expect(
      hairMesh('outer', geometry, skeleton, new Matrix4(), HEAD, values, true)!.userData.hairCore,
    ).toBe(CORE_COVERAGE)
    expect(
      hairMesh('outer', geometry, skeleton, new Matrix4(), HEAD, values, false)!.userData.hairCore,
    ).toBe(0.02)
    expect(
      hairMesh('strays', geometry, skeleton, new Matrix4(), HEAD, values, true)!.castShadow,
    ).toBe(false)
    const root = hairMesh(
      'roots',
      rootsGeometry(roots()),
      skeleton,
      new Matrix4(),
      HEAD,
      values,
      true,
    )!
    expect(root.castShadow).toBe(false)
    expect(root.renderOrder).toBe(1)
    expect(
      hairMesh('soft', geometry, skeleton, new Matrix4(), HEAD, values, true)!.renderOrder,
    ).toBe(3)
  })

  test('makes no mesh for a geometry with nothing to draw', () => {
    const empty = ribbonGeometry({ ...strip(4), index: new Uint32Array(0) })
    expect(hairMesh('strays', empty, skeleton, new Matrix4(), HEAD, values, true)).toBeNull()
  })
})
