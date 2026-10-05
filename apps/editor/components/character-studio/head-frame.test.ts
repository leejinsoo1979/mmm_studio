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
import { aiShotFraming, headFraming, headSpan } from './head-frame'

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

  test('centres across what a head turned to the side spans, nose to hair', () => {
    const { model, neck } = body()
    neck.rotation.y = Math.PI / 2
    model.updateMatrixWorld(true)
    const span = headSpan(model)!
    // The chin (0.12 in front) now lies to the right, the hair (0.1 behind) to the left.
    expect(span.x).toBeCloseTo(0.01, 6)
    expect(span.width).toBeCloseTo(0.22, 6)
    expect(span.top).toBeCloseTo(1.75, 6)
    // The face looks the chin's way.
    expect(span.front).toBeCloseTo(0.12, 6)
  })

  test('knows the eyes’ height, and the face’s front seen from the front', () => {
    const span = headSpan(body().model)!
    expect(span.eyes).toBeCloseTo(1.6, 6)
    expect(span.front).toBeCloseTo(0, 6)
  })

  test('keeps to the head’s middle seen from the front, hair to one side or not', () => {
    const { model, bones } = body()
    mesh(model, bones, [{ at: [0.08, 1.6, -0.14], bones: HEAD, weights: ALL }])
    const span = headSpan(model)!
    expect(span.x).toBeCloseTo(0, 6)
    expect(span.width).toBeCloseTo(0, 6)
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

describe('framing a head', () => {
  const span = { top: 1.75, bottom: 1.47, x: 0.02 }
  const insets = (top: number, right: number, bottom: number, left: number) => ({
    top,
    right,
    bottom,
    left,
  })
  /** Where a height shows on the stage, in px from its top. */
  const onStage = (y: number, aim: { y: number; half: number }, height: number) =>
    height / 2 - ((y - aim.y) / (2 * aim.half)) * height
  /** Where a place across shows on the stage, in px from its left. */
  const across = (x: number, aim: { x: number; half: number }, width: number, height: number) =>
    width / 2 + ((x - aim.x) / (2 * aim.half)) * height

  test('fills the share asked of the free room, centred there', () => {
    const stage = { width: 1060, height: 860, insets: insets(100, 0, 40, 0) }
    const aim = headFraming(span, stage, 0.8)
    const crown = onStage(span.top, aim, stage.height)
    const chin = onStage(span.bottom, aim, stage.height)
    expect(chin - crown).toBeCloseTo(0.8 * (860 - 140), 6)
    expect((crown + chin) / 2).toBeCloseTo(100 + (860 - 140) / 2, 6)
    expect(aim.x).toBeCloseTo(0.02, 6)
  })

  test('centres across in the free room when the chrome covers more of one side', () => {
    const stage = { width: 1280, height: 720, insets: insets(112, 552, 112, 328) }
    const aim = headFraming(span, stage, 0.8)
    const middle = across(span.x, aim, stage.width, stage.height)
    expect(middle).toBeCloseTo(328 + (1280 - 328 - 552) / 2, 6)
    const crown = onStage(span.top, aim, stage.height)
    const chin = onStage(span.bottom, aim, stage.height)
    expect((crown + chin) / 2).toBeCloseTo(112 + (720 - 224) / 2, 6)
  })

  test('keeps the head inside a narrow free room', () => {
    const stage = { width: 900, height: 860, insets: insets(72, 400, 72, 200) }
    const aim = headFraming(span, stage, 0.8)
    const seen = (2 * aim.half * 300) / stage.height
    expect((0.28 * 0.8) / seen).toBeCloseTo(0.9, 6)
    expect(onStage(span.bottom, aim, 860) - onStage(span.top, aim, 860)).toBeLessThan(0.8 * 716)
    expect(across(span.x, aim, stage.width, stage.height)).toBeCloseTo(200 + 150, 6)
  })

  test('leaves the head room on a stage the chrome nearly covers', () => {
    const stage = { width: 1000, height: 200, insets: insets(72, 0, 72, 0) }
    const aim = headFraming(span, stage, 0.8)
    expect(onStage(span.bottom, aim, 200) - onStage(span.top, aim, 200)).toBeCloseTo(0.8 * 100, 6)
  })

  test('frames a head seen from the side by how deep it is', () => {
    const stage = { width: 1280, height: 720, insets: insets(112, 552, 112, 328) }
    const side = { ...span, width: 0.4 }
    const aim = headFraming(side, stage, 0.8)
    const seen = (2 * aim.half * 400) / stage.height
    expect(0.4 / seen).toBeCloseTo(0.9, 6)
  })

  test('keeps a profile’s nose clear of the edge it points to', () => {
    const stage = { width: 1280, height: 720, insets: insets(112, 552, 112, 328) }
    const side = { ...span, x: 0.01, width: 0.22, front: 0.12 }
    const aim = headFraming(side, stage, 0.8)
    expect(across(0.12, aim, 1280, 720)).toBeCloseTo(1280 - 552 - 64, 6)
    // Turned the other way, the other edge.
    const other = { ...span, x: -0.01, width: 0.22, front: -0.12 }
    expect(across(-0.12, headFraming(other, stage, 0.8), 1280, 720)).toBeCloseTo(328 + 64, 6)
    // A face already clear of the edge stays centred.
    const near = { ...span, front: 0.03 }
    expect(across(span.x, headFraming(near, stage, 0.8), 1280, 720)).toBeCloseTo(528, 6)
  })

  test('zooms about the free room’s middle', () => {
    const stage = { width: 1280, height: 720, insets: insets(112, 552, 112, 328) }
    const aim = headFraming(span, stage, 0.8, { zoom: 0.6 })
    expect(aim.half).toBeCloseTo(0.6 * headFraming(span, stage, 0.8).half, 9)
    expect(across(span.x, aim, 1280, 720)).toBeCloseTo(328 + 200, 6)
  })
})

describe('framing an AI photo', () => {
  /** Where a height shows in the shot, as a share of its height from the top. */
  const share = (y: number, aim: { y: number; half: number }) => 0.5 - (y - aim.y) / (2 * aim.half)

  test('frames the head and shoulders, the crown just under the top', () => {
    const { model } = body()
    const aim = aiShotFraming('face', model, 1.8, 1, 1)
    expect(share(1.75, aim)).toBeCloseTo(0.08, 6)
    const head = 1.75 - 1.47
    expect(share(1.47 - 0.6 * head, aim) - share(1.75, aim)).toBeCloseTo(0.62, 6)
  })

  test('frames the upper body from the crown down to about the hips', () => {
    const { model } = body()
    const aim = aiShotFraming('upper', model, 1.8, 1, 2 / 3)
    expect(share(1.75, aim)).toBeCloseTo(0.04, 6)
    expect(share(1.75 - 0.55 * 1.8, aim)).toBeCloseTo(0.96, 6)
  })

  test('frames the whole body, the floor just over the bottom', () => {
    const { model } = body()
    const aim = aiShotFraming('full', model, 1.8, 1, 2 / 3)
    expect(share(0, aim)).toBeCloseTo(0.96, 6)
    expect(share(0, aim) - share(1.75, aim)).toBeCloseTo(0.9, 6)
    expect(aim.x).toBe(0)
  })

  test('goes by the body’s height until its head is found', () => {
    const aim = aiShotFraming('full', null, 1.6, 1.1, 2 / 3)
    expect(share(0, aim) - share(1.76, aim)).toBeCloseTo(0.9, 6)
  })
})
