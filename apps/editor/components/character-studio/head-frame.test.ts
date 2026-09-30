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
import { headSpan } from './head-frame'

type Point = { at: [number, number, number]; bones: [number, number]; weights: [number, number] }

/** Bones: 0 the root, 1 the neck, 2 the head, 3 an eye (in front of the head, as Rocketbox's are). */
function skeleton(model: Group) {
  const root = new Bone()
  root.name = 'Bip01'
  const neck = new Bone()
  neck.name = 'Bip01_Neck'
  neck.position.set(0, 1.4, 0)
  const head = new Bone()
  head.name = 'Bip01_Head'
  head.position.set(0, 0.1, 0)
  const eye = new Bone()
  eye.name = 'Bip01_LEye'
  eye.position.set(0.03, 0.1, 0.08)
  root.add(neck)
  neck.add(head)
  head.add(eye)
  model.add(root)
  model.updateMatrixWorld(true)
  return { bones: [root, neck, head, eye], neck, head }
}

function mesh(model: Group, bones: Bone[], points: Point[]) {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      points.flatMap((p) => p.at),
      3,
    ),
  )
  geometry.setAttribute(
    'skinIndex',
    new Uint16BufferAttribute(
      points.flatMap((p) => [...p.bones, 0, 0]),
      4,
    ),
  )
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(
      points.flatMap((p) => [...p.weights, 0, 0]),
      4,
    ),
  )
  const skinned = new SkinnedMesh(geometry, new MeshBasicMaterial())
  model.add(skinned)
  skinned.bind(new Skeleton(bones))
  return skinned
}

const HEAD: [number, number] = [2, 0]
const ALL: [number, number] = [1, 0]

/** A body with a crown at 1.75, a chin at 1.47, long hair down its back and a shoulder. */
function body() {
  const model = new Group()
  const { bones, neck, head } = skeleton(model)
  const skin = mesh(model, bones, [
    { at: [0, 1.75, 0], bones: HEAD, weights: ALL },
    { at: [0, 1.47, 0.12], bones: HEAD, weights: ALL },
    // Long hair, held by the head but behind the eyes: not the chin.
    { at: [0, 1.2, -0.1], bones: HEAD, weights: ALL },
    // The shoulder, on the root.
    { at: [0.2, 1.4, 0.15], bones: [0, 0], weights: ALL },
    // The throat, mostly the neck's.
    { at: [0, 1.3, 0.15], bones: [1, 2], weights: [0.6, 0.4] },
  ])
  return { model, bones, neck, head, skin }
}

describe('the span of a head', () => {
  test('runs from the crown to the chin in front of the eyes', () => {
    const span = headSpan(body().model)!
    expect(span.top).toBeCloseTo(1.75, 6)
    expect(span.bottom).toBeCloseTo(1.47, 6)
    expect(span.x).toBeCloseTo(0, 6)
  })

  test('follows the body as it grows and the head as it moves', () => {
    const { model, neck } = body()
    model.scale.setScalar(1.1)
    expect(headSpan(model)!.top).toBeCloseTo(1.925, 6)
    expect(headSpan(model)!.bottom).toBeCloseTo(1.617, 6)
    model.scale.setScalar(1)
    neck.position.set(0.05, 1.5, 0)
    const span = headSpan(model)!
    expect(span.top).toBeCloseTo(1.85, 6)
    expect(span.bottom).toBeCloseTo(1.57, 6)
    expect(span.x).toBeCloseTo(0.05, 6)
  })

  test('takes in a hat or hair over the crown while it shows', () => {
    const { model, bones } = body()
    const hat = mesh(model, bones, [{ at: [0, 1.85, 0.02], bones: HEAD, weights: ALL }])
    expect(headSpan(model)!.top).toBeCloseTo(1.85, 6)
    hat.visible = false
    expect(headSpan(model)!.top).toBeCloseTo(1.75, 6)
  })

  test('measures a reshaped head anew', () => {
    const { model, skin } = body()
    expect(headSpan(model)!.top).toBeCloseTo(1.75, 6)
    const reshaped = skin.geometry.clone()
    reshaped.getAttribute('position').setY(0, 1.8)
    skin.geometry = reshaped
    expect(headSpan(model)!.top).toBeCloseTo(1.8, 6)
  })

  test('is unknown for a body without a head', () => {
    const model = new Group()
    const root = new Bone()
    model.add(root)
    model.updateMatrixWorld(true)
    mesh(model, [root], [{ at: [0, 1, 0], bones: [0, 0], weights: ALL }])
    expect(headSpan(model)).toBeNull()
  })
})
