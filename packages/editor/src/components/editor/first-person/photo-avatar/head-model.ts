import type { Vec3 } from './linalg'

/**
 * The head a photo is fitted to, as plain data (it crosses to a worker):
 * the base body's head and neck from MakeHuman's base mesh, the face
 * targets that reshape it (MPFB's, CC0), where MediaPipe's 478 landmarks
 * sit on it, and a smooth field of bumps along its normals for what the
 * targets can't say. Positions are glTF metres (+y up, the face towards +z,
 * the subject's left +x).
 */

/** One face target as shipped: base mesh vertex indices and their deltas (metres). */
export type FaceTarget = {
  name: string
  group: string
  vertices: Uint16Array
  deltas: Float32Array
}

/** `mpfb-face-targets.json` as shipped (the deltas are in `mpfb-face-targets.bin`). */
export type FaceTargetIndex = {
  step: number
  targets: { name: string; group: string; offset: number; count: number }[]
}

/** `mpfb-base-<gender>.landmarks.json`: each MediaPipe landmark as three base mesh vertices and weights. */
export type LandmarkMap = { vertices: number[][]; weights: number[][] }

export function readFaceTargets(index: FaceTargetIndex, data: ArrayBuffer): FaceTarget[] {
  return index.targets.map(({ name, group, offset, count }) => {
    const vertices = new Uint16Array(data.slice(offset, offset + 2 * count))
    const raw = new Int16Array(data.slice(offset + 2 * count, offset + 8 * count))
    const deltas = new Float32Array(raw.length)
    for (let i = 0; i < raw.length; i++) deltas[i] = raw[i]! * index.step
    return { name, group, vertices, deltas }
  })
}

/**
 * Targets that move or reshape the whole head or neck, which the cameras'
 * poses and the head's size already do or that a photo can't see (the
 * skull under hair, the neck under the jaw): left in, they let the skull
 * drift against the face while the outlines barely notice.
 */
const SKIPPED_TARGET = /^(head-|measure-neck-|neck-|chin-jaw-drop|mouth-dimples|mouth-laugh-lines)/

/** How far below the chin (m) the fitted region reaches: the upper neck, blended into the body below. */
const NECK_REACH = 0.07
/** The blend down the neck, from the fit's full effect to none (m). */
const NECK_BLEND = 0.04

export type HeadModel = {
  /** Base mesh vertex indices of the region the fit moves (skin, the eyes' and teeth's helpers). */
  vertices: Uint32Array
  /** Their rest positions (xyz per vertex, metres). */
  rest: Float32Array
  /** How much of the fit reaches each vertex: 1 on the head, fading to 0 down the neck. */
  reach: Float32Array
  /** Skin triangles of the region, as indices into `vertices`. */
  triangles: Uint32Array
  /** Whether each region vertex is skin (in a triangle); the rest are helpers. */
  skin: Uint8Array
  /** Unit rest normals of the skin vertices (zero for helpers). */
  normals: Float32Array
  /** The targets the fit may use, by name, and each one's RMS movement (m). */
  targetNames: string[]
  targetScale: Float32Array
  /** Per region vertex, the targets moving it: CSR offsets into `basisTarget` / `basisDelta` (xyz). */
  basisStart: Uint32Array
  basisTarget: Uint16Array
  basisDelta: Float32Array
  /** Pairs of targets that mirror each other (the subject's left and right). */
  mirrored: [number, number][]
  /** Each landmark (478) as three region vertices and weights; −1 where it has none. */
  landmarkVertices: Int32Array
  landmarkWeights: Float32Array
  /** Facts about the head at rest (metres). */
  frame: HeadFrame
}

export type HeadFrame = {
  /** Midway between the eyes' centres. */
  eyes: Vec3
  /** Between the eyes' centres. */
  eyeDistance: number
  /** The chin's lowest point (y) and the top of the head (y). */
  chinY: number
  topY: number
  /** The front of the ears (z): skin ahead of it is face. */
  earZ: number
}

/**
 * The head model of a base body: its base mesh at rest (every vertex,
 * helpers included), its skin triangles (base mesh indices), the face
 * targets, and the landmark map.
 */
export function buildHeadModel({
  basemesh,
  skinTriangles,
  targets,
  landmarks,
  eyeCentres,
}: {
  basemesh: Float32Array
  skinTriangles: Uint32Array
  targets: readonly FaceTarget[]
  landmarks: LandmarkMap
  eyeCentres: { left: Vec3; right: Vec3 }
}): HeadModel {
  const count = basemesh.length / 3
  const isSkin = new Uint8Array(count)
  for (const v of skinTriangles) isSkin[v] = 1

  // The chin: the lowest landmark on the face's outline under the mouth (MediaPipe 152).
  const chin = landmarks.vertices[152]!
  const chinY = chin.reduce(
    (sum, v, k) => sum + basemesh[v * 3 + 1]! * landmarks.weights[152]![k]!,
    0,
  )
  const floor = chinY - NECK_REACH

  const used = targets.filter((target) => !SKIPPED_TARGET.test(target.name))
  const inRegion = new Uint8Array(count)
  for (let v = 0; v < count; v++) if (basemesh[v * 3 + 1]! > floor) inRegion[v] = 1

  const vertices: number[] = []
  const local = new Int32Array(count).fill(-1)
  for (let v = 0; v < count; v++) {
    if (!inRegion[v]) continue
    local[v] = vertices.length
    vertices.push(v)
  }
  const n = vertices.length
  const rest = new Float32Array(n * 3)
  const reach = new Float32Array(n)
  let topY = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    const v = vertices[i]!
    for (let k = 0; k < 3; k++) rest[i * 3 + k] = basemesh[v * 3 + k]!
    const y = basemesh[v * 3 + 1]!
    topY = Math.max(topY, y)
    reach[i] = smoothstep(floor, floor + NECK_BLEND, y)
  }

  const triangles: number[] = []
  for (let t = 0; t < skinTriangles.length; t += 3) {
    const a = local[skinTriangles[t]!]!
    const b = local[skinTriangles[t + 1]!]!
    const c = local[skinTriangles[t + 2]!]!
    if (a >= 0 && b >= 0 && c >= 0) triangles.push(a, b, c)
  }
  const skin = new Uint8Array(n)
  for (let i = 0; i < n; i++) skin[i] = isSkin[vertices[i]!]!
  const normals = vertexNormals(rest, triangles, n)

  // Targets as per-vertex lists, each target's effect faded down the neck.
  const perVertex: { target: number; delta: Vec3 }[][] = Array.from({ length: n }, () => [])
  const targetScale = new Float32Array(used.length)
  used.forEach((target, j) => {
    let sum = 0
    let moved = 0
    for (let i = 0; i < target.vertices.length; i++) {
      const at = local[target.vertices[i]!]!
      if (at < 0) continue
      const w = reach[at]!
      const delta: Vec3 = [
        target.deltas[i * 3]! * w,
        target.deltas[i * 3 + 1]! * w,
        target.deltas[i * 3 + 2]! * w,
      ]
      const length2 = delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2
      if (length2 < 1e-14) continue
      perVertex[at]!.push({ target: j, delta })
      sum += length2
      moved++
    }
    targetScale[j] = moved ? Math.sqrt(sum / moved) : 0
  })
  const basisStart = new Uint32Array(n + 1)
  for (let i = 0; i < n; i++) basisStart[i + 1] = basisStart[i]! + perVertex[i]!.length
  const basisTarget = new Uint16Array(basisStart[n]!)
  const basisDelta = new Float32Array(basisStart[n]! * 3)
  for (let i = 0; i < n; i++) {
    let k = basisStart[i]!
    for (const { target, delta } of perVertex[i]!) {
      basisTarget[k] = target
      basisDelta.set(delta, k * 3)
      k++
    }
  }
  const names = used.map((target) => target.name)
  const mirrored: [number, number][] = []
  names.forEach((name, j) => {
    if (!name.startsWith('l-')) return
    const other = names.indexOf(`r-${name.slice(2)}`)
    if (other >= 0) mirrored.push([j, other])
  })

  const landmarkVertices = new Int32Array(478 * 3).fill(-1)
  const landmarkWeights = new Float32Array(478 * 3)
  for (let l = 0; l < 478; l++) {
    const verts = landmarks.vertices[l]
    const weights = landmarks.weights[l]
    if (!(verts && weights)) continue
    for (let k = 0; k < 3; k++) {
      landmarkVertices[l * 3 + k] = local[verts[k]!] ?? -1
      landmarkWeights[l * 3 + k] = weights[k]!
    }
  }

  // The ears' front: the outline landmarks at the ears (MediaPipe 234 and 454) are on the cheek just ahead of them.
  const at = (l: number): Vec3 => {
    const p: Vec3 = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const v = landmarks.vertices[l]![k]!
      const w = landmarks.weights[l]![k]!
      for (let c = 0; c < 3; c++) p[c] = p[c]! + w * basemesh[v * 3 + c]!
    }
    return p
  }
  const earZ = (at(234)[2] + at(454)[2]) / 2 - 0.01
  const { left, right } = eyeCentres
  return {
    vertices: Uint32Array.from(vertices),
    rest,
    reach,
    triangles: Uint32Array.from(triangles),
    skin,
    normals,
    targetNames: names,
    targetScale,
    basisStart,
    basisTarget,
    basisDelta,
    mirrored,
    landmarkVertices,
    landmarkWeights,
    frame: {
      eyes: [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2],
      eyeDistance: Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]),
      chinY,
      topY,
      earZ,
    },
  }
}

export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Area-weighted unit vertex normals of a triangle list (xyz per vertex). */
export function vertexNormals(
  positions: Float32Array | Float64Array,
  triangles: ArrayLike<number>,
  count: number,
): Float32Array {
  const normals = new Float32Array(count * 3)
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]! * 3
    const b = triangles[t + 1]! * 3
    const c = triangles[t + 2]! * 3
    const ux = positions[b]! - positions[a]!
    const uy = positions[b + 1]! - positions[a + 1]!
    const uz = positions[b + 2]! - positions[a + 2]!
    const vx = positions[c]! - positions[a]!
    const vy = positions[c + 1]! - positions[a + 1]!
    const vz = positions[c + 2]! - positions[a + 2]!
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const at of [a, b, c]) {
      normals[at] = normals[at]! + nx
      normals[at + 1] = normals[at + 1]! + ny
      normals[at + 2] = normals[at + 2]! + nz
    }
  }
  for (let i = 0; i < count; i++) {
    const length = Math.hypot(normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!)
    if (length > 0) for (let k = 0; k < 3; k++) normals[i * 3 + k] = normals[i * 3 + k]! / length
  }
  return normals
}

/** The region's positions for target weights `coefficients` (and a displacement per vertex, xyz, when given). */
export function shapePositions(
  model: HeadModel,
  coefficients: ArrayLike<number>,
  displacement?: Float64Array | Float32Array,
): Float64Array {
  const n = model.vertices.length
  const out = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    let x = model.rest[i * 3]!
    let y = model.rest[i * 3 + 1]!
    let z = model.rest[i * 3 + 2]!
    for (let k = model.basisStart[i]!; k < model.basisStart[i + 1]!; k++) {
      const c = coefficients[model.basisTarget[k]!]!
      if (c === 0) continue
      x += c * model.basisDelta[k * 3]!
      y += c * model.basisDelta[k * 3 + 1]!
      z += c * model.basisDelta[k * 3 + 2]!
    }
    if (displacement) {
      x += displacement[i * 3]!
      y += displacement[i * 3 + 1]!
      z += displacement[i * 3 + 2]!
    }
    out[i * 3] = x
    out[i * 3 + 1] = y
    out[i * 3 + 2] = z
  }
  return out
}

/** Where a landmark sits on positions of the region (null where it has no place on the head). */
export function landmarkPosition(
  model: HeadModel,
  positions: Float64Array,
  landmark: number,
): Vec3 | null {
  const p: Vec3 = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    const v = model.landmarkVertices[landmark * 3 + k]!
    if (v < 0) return null
    const w = model.landmarkWeights[landmark * 3 + k]!
    p[0] += w * positions[v * 3]!
    p[1] += w * positions[v * 3 + 1]!
    p[2] += w * positions[v * 3 + 2]!
  }
  return p
}
