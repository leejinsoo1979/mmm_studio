import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AnimationClip,
  Bone,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  EmoteFace,
  type EmoteFaceShape,
  type FaceRest,
  faceRest,
  restingFace,
} from './emote-face'

const EMOTES = join(import.meta.dir, '../../../../../../apps/editor/public/characters/rocketbox')

/** A Rocketbox-like head at rest: face bones under a head turned and scaled as the rig's is (cm, 3ds Max's axes). */
function tinyRig(): Object3D {
  const head = new Bone()
  head.name = 'Bip01_Head'
  // The rig's head: its x up the face, scaled from centimetres.
  head.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  head.scale.setScalar(0.01)
  const names = [
    'MJaw',
    'MUpperLip',
    'MNose',
    'MMiddleEyebrow',
    'LMouthCorner',
    'RMouthCorner',
    'LInnerEyebrow',
    'RInnerEyebrow',
    'LOuterEyebrow',
    'ROuterEyebrow',
    'LEyeBlinkTop',
    'REyeBlinkTop',
    'LEyeBlinkBottom',
    'REyeBlinkBottom',
  ]
  for (const name of names) {
    const bone = new Bone()
    bone.name = `Bip01_${name}`
    head.add(bone)
  }
  const lip = new Bone()
  lip.name = 'Bip01_MBottomLip'
  lip.position.set(-1, 0, 10)
  head.getObjectByName('Bip01_MJaw')!.add(lip)
  return head
}

/** A clip moving one head-child bone by `move` (head-local cm) over a second. */
const moveClip = (bone: string, move: Vector3) =>
  new AnimationClip('test', 1, [
    new VectorKeyframeTrack(`Bip01_${bone}.position`, [0, 1], [0, 0, 0, move.x, move.y, move.z]),
  ])

describe('an emote’s face', () => {
  let rest: FaceRest
  beforeAll(() => {
    rest = faceRest(tinyRig())!
  })

  test('reads a face bone’s move along the face, in millimetres', () => {
    // Head-local +x is up the face: a lip corner 0.7 cm up is a full smile on that side only.
    const face = new EmoteFace(moveClip('LMouthCorner', new Vector3(0.7, 0, 0)), rest)
    const out = face.sample(1, restingFace())
    expect(out.mouthSmileLeft).toBeCloseTo(1, 5)
    expect(out.mouthSmileRight).toBe(0)
    expect(face.sample(0.5, restingFace()).mouthSmileLeft).toBeCloseTo(0.5, 5)
  })

  test('opens the jaw from the bottom lip, turned on the jaw', () => {
    // The jaw turning 20° about the face's side axis swings the lip, 10 cm forward, down by about 3.4 cm.
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (-20 * Math.PI) / 180)
    const clip = new AnimationClip('test', 1, [
      new QuaternionKeyframeTrack('Bip01_MJaw.quaternion', [0, 1], [0, 0, 0, 1, ...turn.toArray()]),
    ])
    const out = new EmoteFace(clip, rest).sample(1, restingFace())
    expect(out.jawOpen).toBe(1)
    expect(new EmoteFace(clip, rest).sample(0, restingFace()).jawOpen).toBe(0)
  })

  test('closes the eyes when the upper lid comes down', () => {
    const face = new EmoteFace(moveClip('REyeBlinkTop', new Vector3(-1, 0, 0)), rest)
    const out = face.sample(1, restingFace())
    expect(out.eyeBlinkRight).toBe(1)
    expect(out.eyeBlinkLeft).toBe(0)
  })
})

describe('the game’s emotes', () => {
  const faces = new Map<string, Map<string, EmoteFace>>()
  beforeAll(async () => {
    for (const gender of ['male', 'female']) {
      const bytes = readFileSync(join(EMOTES, `emotes-${gender}.glb`))
      const gltf = await new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
      const rest = faceRest(gltf.scene)!
      faces.set(
        gender,
        new Map(gltf.animations.map((clip) => [clip.name, new EmoteFace(clip, rest)])),
      )
    }
  })

  /** A shape's largest and its mean weight over the first `seconds` of an emote. */
  function over(gender: string, id: string, shapes: EmoteFaceShape[], seconds = 8) {
    const face = faces.get(gender)!.get(id)!
    let peak = 0
    let sum = 0
    let n = 0
    for (let t = 0; t <= seconds; t += 1 / 30) {
      const out = face.sample(t, restingFace())
      const value = Math.max(...shapes.map((shape) => out[shape]))
      peak = Math.max(peak, value)
      sum += value
      n++
    }
    return { peak, mean: sum / n }
  }

  test.each(['male', 'female'])('make faces (%s): a laugh smiles, a yawn opens wide', (gender) => {
    expect(over(gender, 'laugh', ['mouthSmileLeft', 'mouthSmileRight']).peak).toBeGreaterThan(0.6)
    expect(over(gender, 'laugh', ['jawOpen']).peak).toBeGreaterThan(0.2)
    expect(over(gender, 'yawn', ['jawOpen']).peak).toBeGreaterThan(0.5)
    expect(over(gender, 'yawn', ['eyeBlinkLeft']).peak).toBeGreaterThan(0.8)
    expect(over(gender, 'talk', ['jawOpen']).peak).toBeGreaterThan(0.1)
  })

  test('sad raises the brows’ inner ends and turns the mouth down; angry knits the brows', () => {
    expect(over('male', 'sad', ['browInnerUp']).mean).toBeGreaterThan(0.4)
    expect(over('male', 'sad', ['mouthFrownLeft', 'mouthFrownRight']).mean).toBeGreaterThan(0.3)
    expect(over('male', 'angry', ['browDownLeft', 'browDownRight']).mean).toBeGreaterThan(0.4)
    expect(over('male', 'angry', ['mouthSmileLeft', 'mouthSmileRight']).mean).toBeLessThan(0.3)
  })
})
