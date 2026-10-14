import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { holdModel, releaseModel } from './model-cache'

/** A loaded file's scene stand-in, counting what of it was disposed. */
function scene() {
  const disposed: string[] = []
  const geometry = new BoxGeometry()
  const map = new Texture()
  const normalMap = new Texture()
  const material = new MeshStandardMaterial({ map, normalMap })
  geometry.addEventListener('dispose', () => disposed.push('geometry'))
  map.addEventListener('dispose', () => disposed.push('map'))
  normalMap.addEventListener('dispose', () => disposed.push('normalMap'))
  material.addEventListener('dispose', () => disposed.push('material'))
  const root = new Group()
  // The same material on two meshes is let go of once.
  root.add(new Mesh(geometry, material), new Mesh(new BoxGeometry(), material))
  return { root, disposed }
}

const revoked: string[] = []
const realRevoke = URL.revokeObjectURL

beforeAll(() => {
  URL.revokeObjectURL = (url: string) => revoked.push(url)
})
afterAll(() => {
  URL.revokeObjectURL = realRevoke
})

describe('photo avatar model cache', () => {
  test('a file nothing draws is freed and its URL revoked at once', () => {
    const { root, disposed } = scene()
    holdModel('blob:one', root)()
    releaseModel('blob:one')
    expect(revoked).toContain('blob:one')
    expect(disposed.sort()).toEqual(['geometry', 'map', 'material', 'normalMap'])
  })

  test('a file still drawn is freed only when its last body goes', () => {
    const { root, disposed } = scene()
    const studio = holdModel('blob:two', root)
    const game = holdModel('blob:two', root)
    releaseModel('blob:two')
    expect(disposed).toEqual([])
    expect(revoked).not.toContain('blob:two')
    studio()
    expect(disposed).toEqual([])
    game()
    expect(revoked).toContain('blob:two')
    expect(disposed).toContain('map')
  })

  test('a file never released stays as it is', () => {
    const { root, disposed } = scene()
    holdModel('/characters/photoreal/shipped.glb', root)()
    expect(disposed).toEqual([])
    expect(revoked).not.toContain('/characters/photoreal/shipped.glb')
  })
})
