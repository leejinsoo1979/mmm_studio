import { describe, expect, test } from 'bun:test'
import { BufferGeometry, Group, Mesh } from 'three'
import type { EmoteFace, FaceWeights } from './emote-face'
import { FaceMotion } from './face-motion'

/** A mesh carrying blend shapes by these names. */
function faceMesh(names: string[]) {
  const mesh = new Mesh(new BufferGeometry())
  mesh.morphTargetDictionary = Object.fromEntries(names.map((name, i) => [name, i]))
  mesh.morphTargetInfluences = names.map(() => 0)
  return mesh
}

/** A stand-in emote face: a fixed smile, open jaw and half-shut eyes. */
const grin = {
  sample: (_time: number, out: FaceWeights) => {
    out.mouthSmileLeft = 0.8
    out.jawOpen = 0.4
    out.eyeBlinkLeft = 0.5
    return out
  },
} as unknown as EmoteFace

const at = (mesh: Mesh, name: string) => mesh.morphTargetInfluences![mesh.morphTargetDictionary![name]!]!

describe('a 실사 face in motion', () => {
  test('shows an emote’s face by how much the emote shows, on every mesh carrying the shapes', () => {
    const skin = faceMesh(['eyeBlinkLeft', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight'])
    const teeth = faceMesh(['jawOpen'])
    const model = new Group().add(skin, teeth)
    const face = new FaceMotion(model)
    face.setFaces(new Map([['laugh', grin]]))
    face.update(0.01, { showing: 'laugh', time: 1, weight: 0.5 })
    expect(at(skin, 'mouthSmileLeft')).toBeCloseTo(0.4)
    expect(at(skin, 'mouthSmileRight')).toBe(0)
    expect(at(skin, 'jawOpen')).toBeCloseTo(0.2)
    expect(at(teeth, 'jawOpen')).toBeCloseTo(0.2)
    expect(at(skin, 'eyeBlinkLeft')).toBeCloseTo(0.25)
    // The emote over (or one with no face), the face rests.
    face.update(0.01, { showing: null, time: 0, weight: 0 })
    expect(at(skin, 'jawOpen')).toBe(0)
    face.update(0.01, { showing: 'wave', time: 0, weight: 1 })
    expect(at(skin, 'mouthSmileLeft')).toBe(0)
  })

  test('blinks every few seconds, over whatever the face does, on any rig’s blink names', () => {
    const skin = faceMesh(['eyeBlinkLeft', 'jawOpen'])
    const other = faceMesh(['eyeBlink_R'])
    const face = new FaceMotion(new Group().add(skin, other))
    face.setFaces(new Map([['laugh', grin]]))
    let most = 0
    let mostOther = 0
    for (let t = 0; t < 6; t += 1 / 60) {
      face.update(1 / 60, { showing: 'laugh', time: t, weight: 1 })
      // Never less than the face's own half-shut eyes.
      expect(at(skin, 'eyeBlinkLeft')).toBeGreaterThanOrEqual(0.5)
      most = Math.max(most, at(skin, 'eyeBlinkLeft'))
      mostOther = Math.max(mostOther, at(other, 'eyeBlink_R'))
    }
    expect(most).toBeGreaterThan(0.9)
    expect(mostOther).toBeGreaterThan(0.9)
  })
})
