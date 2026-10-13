import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readBaseBody } from './base-body'
import { type FitView, fitHead } from './fit'
import { type HeadModel, landmarkPosition, readFaceTargets, shapePositions } from './head-model'
import type { Vec3 } from './linalg'
import { type HeadSurface, type ProfileError, profileError } from './profile'
import { syntheticCapture } from './synthetic-capture'

/**
 * The fit measured against a known head: the female base body reshaped
 * (a deeper, humped, dropped nose, a prominent chin, a sloping forehead,
 * fuller cheekbones, and two bumps no target makes), photographed from the
 * capture's five turns by `syntheticCapture` with MediaPipe's faults. The
 * profile — what the side shows and the front can't — must come out close
 * from several views, and much closer than from one front photo.
 */

const PUBLIC = join(import.meta.dir, '../../../../../../../apps/editor/public/characters/photoreal')
const read = (name: string) => readFileSync(join(PUBLIC, name))
const buffer = (name: string) => {
  const bytes = read(name)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** What the prototype reached from one front photo (mm): every multi-view fit must do at least as well. */
const PROTOTYPE_LINE_MEAN = 2.23
const PROTOTYPE_LINE_MAX = 8.45

let model: HeadModel
let base: Float64Array
let truth: Float64Array

beforeAll(async () => {
  const body = await readBaseBody({
    glb: buffer('mpfb-base-female.glb'),
    basemesh: buffer('mpfb-base-female.basemesh.bin'),
    meta: JSON.parse(read('mpfb-base-female.json').toString()),
    landmarks: JSON.parse(read('mpfb-base-female.landmarks.json').toString()),
    targets: readFaceTargets(
      JSON.parse(read('mpfb-face-targets.json').toString()),
      buffer('mpfb-face-targets.bin'),
    ),
  })
  model = body.head
  base = shapePositions(model, new Float64Array(model.targetNames.length))
  const coefficients = new Float64Array(model.targetNames.length)
  for (const [name, value] of [
    ['nose-scale-depth-incr', 0.8],
    ['nose-hump-incr', 0.5],
    ['nose-point-down', 0.3],
    ['chin-prominent-incr', 0.7],
    ['mouth-trans-forward', 0.3],
    ['forehead-trans-backward', 0.4],
    ['l-cheek-bones-incr', 0.6],
    ['r-cheek-bones-incr', 0.6],
    ['head-scale-depth-incr', 0.2],
  ] as const) {
    const j = model.targetNames.indexOf(name)
    if (j < 0) throw new Error(`no target ${name}`)
    coefficients[j] = value
  }
  truth = shapePositions(model, coefficients)
  // Bumps along the normals at the nose's root (landmark 6) and under the lower lip (17).
  for (const [landmark, mm, radius] of [
    [6, 2.5, 0.008],
    [17, 1.5, 0.006],
  ] as const) {
    const c = landmarkPosition(model, base, landmark)!
    for (let i = 0; i < model.vertices.length; i++) {
      const d2 =
        (model.rest[i * 3]! - c[0]) ** 2 +
        (model.rest[i * 3 + 1]! - c[1]) ** 2 +
        (model.rest[i * 3 + 2]! - c[2]) ** 2
      const w = Math.exp(-d2 / (2 * radius * radius)) * (mm / 1000)
      for (let k = 0; k < 3; k++)
        truth[i * 3 + k] = truth[i * 3 + k]! + w * model.normals[i * 3 + k]!
    }
  }
})

function surface(positions: Float64Array): HeadSurface {
  const landmarks = new Map<number, Vec3>()
  for (let l = 0; l < 468; l++) {
    const p = landmarkPosition(model, positions, l)
    if (p) landmarks.set(l, p)
  }
  return { positions, triangles: model.triangles, landmarks }
}

describe('head model', () => {
  test('places every face landmark on the head, symmetric about the midline', () => {
    for (let l = 0; l < 478; l++) {
      const p = landmarkPosition(model, base, l)
      expect(p).not.toBeNull()
      let sum = 0
      for (let k = 0; k < 3; k++) sum += model.landmarkWeights[l * 3 + k]!
      expect(sum).toBeCloseTo(1, 4)
    }
    // Eye corners, mouth corners, cheeks' outline: mirror images (mm).
    for (const [a, b] of [
      [33, 263],
      [133, 362],
      [61, 291],
      [234, 454],
    ] as const) {
      const p = landmarkPosition(model, base, a)!
      const q = landmarkPosition(model, base, b)!
      expect(Math.abs(p[0] + q[0]) * 1000).toBeLessThan(4)
      expect(Math.abs(p[1] - q[1]) * 1000).toBeLessThan(4)
      expect(Math.abs(p[2] - q[2]) * 1000).toBeLessThan(4)
    }
    // Nose tip, the nose's root, the brows' middle, the chin: on the midline, the tip in front.
    for (const l of [1, 6, 9, 152])
      expect(Math.abs(landmarkPosition(model, base, l)![0]) * 1000).toBeLessThan(3)
    const tip = landmarkPosition(model, base, 1)!
    expect(tip[2]).toBeGreaterThan(landmarkPosition(model, base, 6)![2])
    expect(tip[2]).toBeGreaterThan(landmarkPosition(model, base, 152)![2])
  })

  test('a target moves its part of the face and nothing else', () => {
    const coefficients = new Float64Array(model.targetNames.length)
    coefficients[model.targetNames.indexOf('nose-scale-depth-incr')] = 1
    const moved = shapePositions(model, coefficients)
    const tip = landmarkPosition(model, moved, 1)!
    expect((tip[2] - landmarkPosition(model, base, 1)![2]) * 1000).toBeGreaterThan(2)
    for (const l of [33, 263, 152, 10]) {
      const p = landmarkPosition(model, moved, l)!
      const q = landmarkPosition(model, base, l)!
      expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 1000).toBeLessThan(0.5)
    }
  })

  test('pairs each left target with its right one', () => {
    expect(model.mirrored.length).toBeGreaterThan(20)
    for (const [a, b] of model.mirrored) {
      const left = model.targetNames[a]!
      const right = model.targetNames[b]!
      expect(left.replace(/^[lr]-/, '')).toBe(right.replace(/^[lr]-/, ''))
      expect(left).not.toBe(right)
    }
  })
})

describe('fitting the profile from photos', () => {
  const shots = [{ yaw: 0, pitch: 2 }, { yaw: 45 }, { yaw: -45 }, { yaw: 90 }, { yaw: -90 }]
  let views: FitView[]
  let single: ProfileError
  let five: ProfileError
  let fiveYaws: number[]

  beforeAll(() => {
    views = syntheticCapture(model, truth, base, shots).views
    const truthSurface = surface(truth)
    single = profileError(surface(fitHead(model, [views[0]!]).positions), truthSurface)
    const result = fitHead(model, views)
    five = profileError(surface(result.positions), truthSurface)
    fiveYaws = result.views.map((v) => (v.yaw * 180) / Math.PI)
  }, 120_000)

  test('the base head is a mask: its nose is flat in profile', () => {
    const e = profileError(surface(base), surface(truth))
    expect(e.noseProjection).toBeLessThan(-6)
  })

  test('one front photo leaves the nose flat', () => {
    expect(single.noseProjection).toBeLessThan(-3)
  })

  test('five views recover the profile: nose, bridge, chin and the whole line', () => {
    expect(five.lineMean).toBeLessThan(PROTOTYPE_LINE_MEAN)
    expect(five.lineMax).toBeLessThan(PROTOTYPE_LINE_MAX)
    expect(Math.abs(five.noseProjection)).toBeLessThan(PROTOTYPE_LINE_MEAN)
    expect(Math.abs(five.shape.noseTip)).toBeLessThan(PROTOTYPE_LINE_MEAN)
    expect(Math.abs(five.shape.bridge)).toBeLessThan(PROTOTYPE_LINE_MEAN)
    expect(Math.abs(five.shape.chin)).toBeLessThan(PROTOTYPE_LINE_MEAN)
    expect(Math.abs(five.noseProjection)).toBeLessThan(Math.abs(single.noseProjection) / 2)
    expect(five.lineMean).toBeLessThan(single.lineMean)
  })

  test('solves each view’s camera', () => {
    const asked = shots.map((s) => s.yaw)
    // The front and ¾ views have landmarks; the side views only their outline.
    for (let k = 0; k < 3; k++) expect(Math.abs(fiveYaws[k]! - asked[k]!)).toBeLessThan(4)
    for (let k = 3; k < 5; k++) expect(Math.abs(fiveYaws[k]! - asked[k]!)).toBeLessThan(12)
  })
})
