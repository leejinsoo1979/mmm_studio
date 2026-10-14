import { type Camera, cameraLookingAt, headRotation, toCamera } from '../camera'
import type { FitView } from '../fit'
import { type HeadModel, landmarkPosition } from '../head-model'
import type { Vec3 } from '../linalg'
import { fillTriangles } from '../silhouette'

/**
 * Photos of a known head, made up: what a capture of it would give the fit
 * (MediaPipe's landmarks, the person's mask, where skin shows), with the
 * faults the real ones have — landmarks on a turned face pulled towards an
 * average face, none at all on a side view, hair over the top of the head.
 * For measuring the fit against the truth.
 */

export type SyntheticShot = {
  /** Degrees, > 0 to the subject's left. */
  yaw: number
  pitch?: number
}

export type SyntheticCapture = { views: FitView[]; cameras: Camera[] }

/** Seeded pseudo-random numbers (mulberry32), normal by Box–Muller. */
export function randomNormal(seed: number): () => number {
  let state = seed >>> 0
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return () =>
    Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12))) * Math.cos(2 * Math.PI * uniform())
}

/**
 * Shots of `truth` (positions of the model's region) from a camera that
 * stays put while the head turns. `average` is the face MediaPipe leans
 * towards (the base head): a turned view's landmarks are pulled `lean` of
 * the way to where it would put them at 45°, more past it.
 */
export function syntheticCapture(
  model: HeadModel,
  truth: Float64Array,
  average: Float64Array,
  shots: SyntheticShot[],
  {
    width = 480,
    height = 480,
    distance = 0.45,
    noise = 0.4,
    lean = 0.35,
    hair = 0.012,
    seed = 7,
  }: {
    width?: number
    height?: number
    distance?: number
    /** Landmark noise (mm). */
    noise?: number
    lean?: number
    /** How far hair stands off the top and back of the head (m). */
    hair?: number
    seed?: number
  } = {},
): SyntheticCapture {
  const normal = randomNormal(seed)
  const views: FitView[] = []
  const cameras: Camera[] = []
  const n = model.vertices.length
  const { frame } = model
  // Hair: the top and back of the head, pushed out along the normals.
  const hairy = new Uint8Array(n)
  const withHair = Float64Array.from(truth)
  for (let i = 0; i < n; i++) {
    const y = model.rest[i * 3 + 1]!
    const z = model.rest[i * 3 + 2]!
    if (y > frame.eyes[1] + 0.045 || (z < frame.earZ - 0.03 && y > frame.chinY)) {
      hairy[i] = 1
      for (let k = 0; k < 3; k++)
        withHair[i * 3 + k] = truth[i * 3 + k]! + hair * model.normals[i * 3 + k]!
    }
  }
  for (const shot of shots) {
    const yaw = (shot.yaw * Math.PI) / 180
    const pitch = ((shot.pitch ?? 0) * Math.PI) / 180
    const camera = cameraLookingAt({
      width,
      height,
      rotation: headRotation(yaw, pitch),
      target: frame.eyes,
      at: [width / 2, height * 0.45],
      distance,
    })
    cameras.push(camera)
    const xy = new Float64Array(n * 2)
    const project = (p: Vec3) => {
      const q = toCamera(camera, p)
      return [(camera.focal * q[0]) / q[2] + camera.cx, (camera.focal * q[1]) / q[2] + camera.cy]
    }
    for (let i = 0; i < n; i++) {
      const [x, y] = project([withHair[i * 3]!, withHair[i * 3 + 1]!, withHair[i * 3 + 2]!])
      xy[i * 2] = x!
      xy[i * 2 + 1] = y!
    }
    const mask = new Uint8Array(width * height)
    fillTriangles(xy, model.triangles, width, height, mask)
    // The neck and shoulders below the region: a column down from the neck's cut.
    const neck: Vec3[] = [
      [-0.055, frame.chinY - 0.06, frame.earZ - 0.06],
      [0.055, frame.chinY - 0.06, frame.earZ - 0.06],
      [0.055, frame.chinY - 0.06, frame.earZ + 0.03],
      [-0.055, frame.chinY - 0.06, frame.earZ + 0.03],
    ]
    const low = neck.map(([x, y, z]) => project([x, y - 0.25, z]))
    const high = neck.map((p) => project(p))
    const quad = [...high, ...low].flat()
    for (const [a, b, c] of [
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
    ]) {
      fillTriangles(quad, [a!, b!, c!], width, height, mask)
    }
    const skin = new Uint8Array(width * height)
    fillTriangles(xy, model.triangles, width, height, skin, 255, (t) => {
      const a = model.triangles[t * 3]!
      return !hairy[a]
    })
    // Hair over skin: drawn after, so it wins where the two overlap.
    const hairMask = new Uint8Array(width * height)
    fillTriangles(
      xy,
      model.triangles,
      width,
      height,
      hairMask,
      255,
      (t) => hairy[model.triangles[t * 3]!] === 1,
    )
    for (let i = 0; i < skin.length; i++) if (hairMask[i]) skin[i] = 0

    let landmarks: Float32Array | null = null
    if (Math.abs(shot.yaw) <= 65) {
      landmarks = new Float32Array(478 * 2)
      const pixelsPerMm = camera.focal / distance / 1000
      const pull = lean * (Math.abs(shot.yaw) / 45) ** 1.5
      for (let l = 0; l < 478; l++) {
        const p = landmarkPosition(model, truth, l)
        const a = landmarkPosition(model, average, l)
        if (!(p && a)) continue
        const [px, py] = project(p)
        const [ax, ay] = project(a)
        landmarks[l * 2] = px! + pull * (ax! - px!) + normal() * noise * pixelsPerMm
        landmarks[l * 2 + 1] = py! + pull * (ay! - py!) + normal() * noise * pixelsPerMm
      }
    }
    views.push({
      width,
      height,
      landmarks,
      mask,
      skin,
      covered: hairMask,
      yaw: landmarks ? yaw * 0.85 : yaw,
      pitch,
      guessedYaw: !landmarks,
    })
  }
  return { views, cameras }
}
