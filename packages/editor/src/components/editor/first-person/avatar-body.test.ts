import { describe, expect, test } from 'bun:test'
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three'
import { applyBodyBones, bodyHeightScale } from './avatar-body'

/** A body just big enough to hold the bones a build moves: a collarbone and its upper arm, and a head. */
function body() {
  const pelvis = new Bone()
  pelvis.name = 'Bip01_Pelvis'
  const clavicle = new Bone()
  clavicle.name = 'Bip01_L_Clavicle'
  clavicle.position.set(0.05, 0.5, 0)
  const upperArm = new Bone()
  upperArm.name = 'Bip01_L_UpperArm'
  upperArm.position.set(0.14, 0.01, 0)
  const head = new Bone()
  head.name = 'Bip01_Head'
  head.position.set(0, 0.7, 0)
  pelvis.add(clavicle, head)
  clavicle.add(upperArm)

  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 1.7, 0, 0.1, 1.7, 0, 0, 1.8, 0], 3),
  )
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Array(12).fill(0), 4))
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  )
  const material = new MeshBasicMaterial()
  material.name = 'm001_head'
  const mesh = new SkinnedMesh(geometry, material)
  const model = new Group()
  model.scale.setScalar(1.5)
  model.add(mesh, pelvis)
  model.updateMatrixWorld(true)
  mesh.bind(new Skeleton([pelvis, clavicle, upperArm, head]))
  return { model, clavicle, upperArm, head }
}

describe('a build’s bones', () => {
  test('widen the shoulders along the collarbone, grow the head and scale the body', () => {
    const { model, upperArm, head } = body()
    const reach = upperArm.position.clone()
    applyBodyBones(model, { height: 1, sliders: { shoulders: 1, headSize: -1 } })
    // Along the collarbone: the same direction, further out.
    expect(upperArm.position.clone().normalize().dot(reach.clone().normalize())).toBeCloseTo(1, 6)
    expect(upperArm.position.length()).toBeGreaterThan(reach.length() * 1.1)
    expect(head.scale.x).toBeLessThan(0.95)
    expect(head.scale.x).toBeCloseTo(head.scale.z, 6)
    expect(model.scale.x).toBeCloseTo(1.5 * bodyHeightScale({ height: 1, sliders: {} }), 6)
    expect(bodyHeightScale({ height: 1, sliders: {} })).toBeGreaterThan(1.1)
    expect(bodyHeightScale({ height: -1, sliders: {} })).toBeLessThan(0.9)
  })

  test('make room for the arms by a filled-out trunk, but not by a slimmed one', () => {
    const { model, upperArm } = body()
    const reach = upperArm.position.length()
    const undo = applyBodyBones(model, { height: 0, sliders: { weight: 1 } })
    expect(upperArm.position.length()).toBeGreaterThan(reach)
    undo()
    applyBodyBones(model, { height: 0, sliders: { weight: -1 } })
    expect(upperArm.position.length()).toBe(reach)
  })

  test('are put back exactly', () => {
    const { model, clavicle, upperArm, head } = body()
    const before = [
      model.scale,
      clavicle.position,
      upperArm.position,
      head.scale,
      head.position,
    ].map((vector) => vector.toArray())
    const undo = applyBodyBones(model, {
      height: -0.7,
      sliders: { shoulders: -0.3, headSize: 0.8, waist: 1 },
    })
    undo()
    expect(
      [model.scale, clavicle.position, upperArm.position, head.scale, head.position].map((vector) =>
        vector.toArray(),
      ),
    ).toEqual(before)
  })

  test('leave be what something else has set since', () => {
    const { model, head } = body()
    const undo = applyBodyBones(model, { height: 0.5, sliders: { headSize: 1 } })
    head.scale.setScalar(2)
    undo()
    expect(head.scale.toArray()).toEqual([2, 2, 2])
    expect(model.scale.x).toBe(1.5)
  })
})
