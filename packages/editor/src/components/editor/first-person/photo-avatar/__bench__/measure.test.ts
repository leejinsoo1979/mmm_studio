import { beforeAll, describe, expect, test } from 'bun:test'
import { type HeadModel, landmarkPosition, shapePositions } from '../head-model'
import { applySimilarity, rotation, type Vec3 } from '../linalg'
import { loadBaseForTests } from './base-for-tests'
import { measureFit, PROFILE_POINTS, type TruthHead, truthHead } from './measure'

/**
 * The bench's measure on heads whose answer is known: the base head against
 * itself, moved, scaled, with its face pushed forward on its skull, and with
 * a deeper nose.
 */

let model: HeadModel
let base: Float64Array
let truth: TruthHead

const landmarksOf = (positions: Float64Array): (Vec3 | null)[] =>
  Array.from({ length: 478 }, (_, l) => landmarkPosition(model, positions, l))

beforeAll(async () => {
  model = (await loadBaseForTests('female')).head
  base = shapePositions(model, new Float64Array(model.targetNames.length))
  truth = truthHead({ positions: base, triangles: model.triangles }, landmarksOf(base), {
    absoluteScale: true,
  })
})

/** The region's positions moved by a similarity. */
function moved(positions: Float64Array, scale: number, turn: Vec3, shift: Vec3): Float64Array {
  const out = new Float64Array(positions.length)
  const s = { scale, rotation: rotation(turn), translation: shift }
  for (let i = 0; i < positions.length; i += 3) {
    const p = applySimilarity(s, [positions[i]!, positions[i + 1]!, positions[i + 2]!])
    out.set(p, i)
  }
  return out
}

describe('the bench geometry measure', () => {
  test('scores a head against itself as exact', () => {
    const report = measureFit(truth, model, base)
    for (const name of PROFILE_POINTS) expect(Math.abs(report.points[name])).toBeLessThan(0.3)
    expect(Math.abs(report.points.submental)).toBeLessThan(0.3)
    expect(report.profile.mean).toBeLessThan(0.2)
    expect(report.profile.points).toBeGreaterThan(200)
    expect(Math.abs(report.alignment.scaleError)).toBeLessThan(0.002)
    expect(report.outline45.mean).toBeLessThan(0.2)
    expect(Math.abs(report.width.cheek)).toBeLessThan(0.005)
    expect(Math.abs(report.width.jaw)).toBeLessThan(0.005)
  })

  test('takes a head moved and turned back to where it was, and reports its size apart', () => {
    const report = measureFit(
      truth,
      model,
      moved(base, 1.05, [0.08, -0.12, 0.05], [0.02, -0.03, 0.04]),
    )
    expect(report.alignment.scaleError).toBeCloseTo(0.05, 2)
    for (const name of PROFILE_POINTS) expect(Math.abs(report.points[name])).toBeLessThan(0.4)
    expect(report.profile.mean).toBeLessThan(0.3)
    // In proportion the face is right; in absolute size it is 5 % too wide.
    expect(Math.abs(report.width.cheekScaled)).toBeLessThan(0.01)
    expect(report.width.cheek).toBeCloseTo(0.05, 1)
  })

  test('counts a face pushed forward on its skull as error everywhere on the profile', () => {
    const pushed = Float64Array.from(base)
    for (let i = 0; i < model.vertices.length; i++) {
      if (model.rest[i * 3 + 2]! > model.frame.eyes[2] - 0.02)
        pushed[i * 3 + 2] = pushed[i * 3 + 2]! + 0.003
    }
    const report = measureFit(truth, model, pushed)
    expect(Math.abs(report.alignment.scaleError)).toBeLessThan(0.005)
    expect(report.faceOffset).toBeCloseTo(3, 0)
    for (const name of ['glabella', 'nasion', 'pronasale', 'upperLip', 'pogonion'] as const)
      expect(report.points[name]).toBeCloseTo(3, 0)
    expect(Math.abs(report.points.noseProjection)).toBeLessThan(0.4)
  })

  test('sees a deeper nose as the nose projecting further, and nothing else', () => {
    const coefficients = new Float64Array(model.targetNames.length)
    coefficients[model.targetNames.indexOf('nose-scale-depth-incr')] = 1
    const deeper = shapePositions(model, coefficients)
    const tipMove =
      (landmarkPosition(model, deeper, 1)![2] - landmarkPosition(model, base, 1)![2]) * 1000
    const report = measureFit(truth, model, deeper)
    expect(tipMove).toBeGreaterThan(2)
    expect(report.points.pronasale).toBeGreaterThan(tipMove * 0.7)
    expect(report.points.noseProjection).toBeGreaterThan(tipMove * 0.5)
    expect(Math.abs(report.points.glabella)).toBeLessThan(0.4)
    expect(Math.abs(report.points.pogonion)).toBeLessThan(0.4)
    expect(Math.abs(report.alignment.scaleError)).toBeLessThan(0.005)
  })
})
