import type { CaptureSlot, CaptureView } from '../avatar-job'
import type { Vec3 } from '../linalg'
import type { Outline, SideProfile, TruthHead } from './measure'

/**
 * The bench's fixtures: what its browser run read from a truth head's photos
 * (each view as the job takes it) and the truth's summary, compact enough to
 * keep in the repo, so the geometry gates can be checked by `bun test`
 * without a browser. Lengths are int16 and arrays base64'd.
 *
 * Of a view's maps the fit reads only which side of 127 each pixel is on
 * (the mask through its distance field, skin and strands by sampling), so
 * that is all a fixture keeps of them: one bit a pixel, brotli-compressed by
 * the bench. The photo itself and the segmenter's class planes, which only
 * the texture reads, are left out.
 */

export type FixtureView = {
  slot: CaptureSlot
  width: number
  height: number
  yaw: number
  pitch?: number
  roll?: number
  guessedYaw?: boolean
  mouthOpen?: number
  blink?: number
  /** MediaPipe's landmarks: 478 × (x, y) float32, base64. */
  landmarks: string | null
  /** The person's mask, skin and strands, each where it is over 127 (`packMap`), compressed, base64. */
  mask: string | null
  skin: string | null
  covered: string | null
  /** How the bench photographed it (degrees; focal in pixels). */
  truth: { yaw: number; pitch: number; roll: number; focal: number; light: string }
}

type PackedSide = {
  box: SideProfile['box']
  points: SideProfile['points']
  submental: { z: string; y: string }
  line: string
}

export type FixtureTruth = {
  origin: Vec3
  /** 478 × xyz (`packLengths` from `origin`). */
  landmarks: string
  /** Cloud points int16 (0.02 mm from `origin`) and normals int8 (/127). */
  cloud: { points: string; normals: string }
  /** The side profile's lines, `packLengths` from `origin`'s z (depths) and y (heights). */
  side: PackedSide
  /** Each ¾ outline's x per row, `packLengths` from `origin`'s x. */
  outlines: (Omit<Outline, 'x'> & { x: string })[]
  widths: TruthHead['widths']
  absoluteScale: boolean
}

export type HeadFixture = {
  id: string
  gender: 'male' | 'female'
  source: string
  licence: string
  truth: FixtureTruth
  /** Five clean photos (G1; three and one are its front and ¾ views, G4), and five perturbed (G2). */
  views: { five: FixtureView[]; perturbed: FixtureView[] }
  /** What the browser bench measured from the same views, for comparison (mm). */
  bench: Record<string, unknown>
}

export function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const NONE = -32768
/** Lengths in a fixture: 0.01 mm steps, ±327 mm from their origin. */
const STEPS_PER_METRE = 1e5

/** Lengths (m) as int16 from `origin` (cycled over the values: x, y, z…), NaN as none; base64. */
export function packLengths(values: ArrayLike<number>, origin: readonly number[]): string {
  const out = new Int16Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    out[i] = Number.isFinite(v)
      ? Math.round((v - origin[i % origin.length]!) * STEPS_PER_METRE)
      : NONE
  }
  return toBase64(new Uint8Array(out.buffer))
}

export function unpackLengths(text: string, origin: readonly number[]): number[] {
  const raw = int16(text)
  return Array.from(raw, (v, i) =>
    v === NONE ? Number.NaN : origin[i % origin.length]! + v / STEPS_PER_METRE,
  )
}

/** A map's pixels over 127, one bit each. */
export function packMap(map: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.ceil(map.length / 8))
  for (let i = 0; i < map.length; i++)
    if (map[i]! > 127) out[i >> 3] = out[i >> 3]! | (1 << (i & 7))
  return out
}

export function unpackMap(bits: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) if (bits[i >> 3]! & (1 << (i & 7))) out[i] = 255
  return out
}

const int16 = (text: string) => {
  const bytes = fromBase64(text)
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
}

export function encodeTruth(truth: TruthHead): FixtureTruth {
  const origin = truth.landmarks[168] ?? truth.landmarks[1]!
  const flat: number[] = []
  for (const p of truth.landmarks) flat.push(...(p ?? [Number.NaN, Number.NaN, Number.NaN]))
  const n = truth.cloud.points.length / 3
  const points = new Int16Array(n * 3)
  const normals = new Int8Array(n * 3)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      points[i * 3 + k] = Math.round((truth.cloud.points[i * 3 + k]! - origin[k]!) * 5e4)
      normals[i * 3 + k] = Math.round(truth.cloud.normals[i * 3 + k]! * 127)
    }
  }
  const { side } = truth
  return {
    origin,
    landmarks: packLengths(flat, origin),
    cloud: {
      points: toBase64(new Uint8Array(points.buffer)),
      normals: toBase64(new Uint8Array(normals.buffer)),
    },
    side: {
      box: side.box,
      points: side.points,
      submental: {
        z: packLengths(side.submental.z, [origin[2]]),
        y: packLengths(side.submental.y, [origin[1]]),
      },
      line: packLengths(side.line, [origin[2], origin[1]]),
    },
    outlines: truth.outlines.map((o) => ({ ...o, x: packLengths(o.x, [origin[0]]) })),
    widths: truth.widths,
    absoluteScale: truth.absoluteScale,
  }
}

export function decodeTruth(truth: FixtureTruth): TruthHead {
  const { origin } = truth
  const flat = unpackLengths(truth.landmarks, origin)
  const landmarks: (Vec3 | null)[] = []
  for (let l = 0; l < flat.length / 3; l++) {
    const p: Vec3 = [flat[l * 3]!, flat[l * 3 + 1]!, flat[l * 3 + 2]!]
    landmarks.push(Number.isNaN(p[0]) ? null : p)
  }
  const p = int16(truth.cloud.points)
  const nb = fromBase64(truth.cloud.normals)
  const normalBytes = new Int8Array(nb.buffer, nb.byteOffset, nb.byteLength)
  const points = new Float32Array(p.length)
  const normals = new Float32Array(p.length)
  for (let i = 0; i < p.length; i++) {
    points[i] = origin[i % 3]! + p[i]! / 5e4
    normals[i] = normalBytes[i]! / 127
  }
  const { side } = truth
  return {
    landmarks,
    cloud: { points, normals },
    side: {
      box: side.box,
      points: side.points,
      submental: {
        z: unpackLengths(side.submental.z, [origin[2]]),
        y: unpackLengths(side.submental.y, [origin[1]]),
      },
      line: unpackLengths(side.line, [origin[2], origin[1]]),
    },
    outlines: truth.outlines.map((o) => ({ ...o, x: unpackLengths(o.x, [origin[0]]) })),
    widths: truth.widths,
    absoluteScale: truth.absoluteScale,
  }
}

/** A fixture's view as the job takes it (a blank photo); `decompress` undoes the bench's brotli. */
export function decodeView(
  view: FixtureView,
  decompress: (bytes: Uint8Array) => Uint8Array,
): CaptureView {
  const pixels = view.width * view.height
  const map = (text: string | null) =>
    text ? unpackMap(decompress(fromBase64(text)), pixels) : null
  const landmarks = view.landmarks ? fromBase64(view.landmarks) : null
  return {
    slot: view.slot,
    width: view.width,
    height: view.height,
    rgba: new Uint8Array(pixels * 4),
    landmarks: landmarks
      ? new Float32Array(landmarks.buffer, landmarks.byteOffset, landmarks.byteLength / 4)
      : null,
    mask: map(view.mask),
    skin: map(view.skin),
    covered: map(view.covered),
    classes: null,
    blendshapes: null,
    yaw: view.yaw,
    pitch: view.pitch,
    roll: view.roll,
    guessedYaw: view.guessedYaw,
    mouthOpen: view.mouthOpen,
    blink: view.blink,
  }
}
