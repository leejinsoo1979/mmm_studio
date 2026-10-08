import { join } from 'node:path'
import type { BaseInput } from './hair-base'
import type { Who } from './hair-groom'

/**
 * Frozen heads for the generated-hair tests: what the hair worker is sent
 * for a character (its BaseInput), its body cut to the neck and shoulders,
 * and the head as hair-base.ts flattened it when the fixture was made, so
 * the grow tests stand on one surface while the flatten changes. Written by
 * scripts/characters/freeze-hair-heads.ts from the shipped GLBs; the arrays
 * are kept as those files quantise them (positions and UVs as 16-bit
 * fractions, normals and weights as 8-bit), so nothing is lost.
 */
export type HairHead = {
  input: BaseInput
  who: Who
  /** The head flattened: its points and the triangles kept, as frozen. */
  flat: { points: Float32Array; index: Uint32Array }
}

/** How a fixture keeps an array: base64 of a little-endian typed array, scaled to a fraction where `scale` is set. */
type Packed = { type: 'i16' | 'u16' | 'i8' | 'u8' | 'u32'; scale?: number; data: string }

export type StoredHairHead = {
  version: 1
  avatar: string
  material: string
  metresPerUnit: number
  who: Who
  head: Record<keyof BaseInput['head'], Packed>
  body: Record<keyof BaseInput['body'], Packed>
  cards: Packed | null
  lashes: BaseInput['lashes']
  faceBones: BaseInput['faceBones']
  bones: BaseInput['bones']
  boneIndex: BaseInput['boneIndex']
  marks: BaseInput['marks']
  ears: Packed | null
  /** The flattened head: the points it moved (index, then x y z), and the triangles it dropped. */
  flat: { moved: Packed; points: Packed; dropped: Packed }
}

const ARRAYS = {
  i16: Int16Array,
  u16: Uint16Array,
  i8: Int8Array,
  u8: Uint8Array,
  u32: Uint32Array,
} as const

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'))

/** Packs values as `type`, each divided by `scale` and rounded (whole numbers as they are). */
export function pack(values: ArrayLike<number>, type: Packed['type'], scale?: number): Packed {
  const array = new ARRAYS[type](values.length)
  for (let i = 0; i < values.length; i++) {
    array[i] = scale ? Math.round(values[i]! / scale) : values[i]!
  }
  return { type, ...(scale ? { scale } : {}), data: toBase64(new Uint8Array(array.buffer)) }
}

function unpack(packed: Packed): ArrayLike<number> & Iterable<number> {
  const bytes = fromBase64(packed.data)
  const Kind = ARRAYS[packed.type]
  const raw = new Kind(bytes.buffer, bytes.byteOffset, bytes.byteLength / Kind.BYTES_PER_ELEMENT)
  return packed.scale ? Float32Array.from(raw, (v) => v * packed.scale!) : raw
}

const floats = (packed: Packed) => Float32Array.from(unpack(packed))

/** Unit normals from packed ones (8-bit, renormalised as the loader does). */
function normals(packed: Packed) {
  const out = floats(packed)
  for (let i = 0; i < out.length; i += 3) {
    const length = Math.sqrt(out[i]! ** 2 + out[i + 1]! ** 2 + out[i + 2]! ** 2) || 1
    out[i]! /= length
    out[i + 1]! /= length
    out[i + 2]! /= length
  }
  return out
}

export function readHairHead(stored: StoredHairHead): HairHead {
  const points = floats(stored.head.points)
  const index = Uint32Array.from(unpack(stored.head.index))
  const input: BaseInput = {
    avatar: stored.avatar,
    material: stored.material,
    metresPerUnit: stored.metresPerUnit,
    head: {
      points,
      normals: normals(stored.head.normals),
      uvs: floats(stored.head.uvs),
      index,
      skinIndex: Uint16Array.from(unpack(stored.head.skinIndex)),
      skinWeight: floats(stored.head.skinWeight),
    },
    body: {
      points: floats(stored.body.points),
      uvs: floats(stored.body.uvs),
      index: Uint32Array.from(unpack(stored.body.index)),
    },
    cards: stored.cards ? floats(stored.cards) : null,
    lashes: stored.lashes,
    faceBones: stored.faceBones,
    bones: stored.bones,
    boneIndex: stored.boneIndex,
    marks: stored.marks,
    ears: stored.ears ? Uint8Array.from(unpack(stored.ears)) : null,
  }
  const flatPoints = Float32Array.from(points)
  const moved = unpack(stored.flat.moved)
  const at = floats(stored.flat.points)
  for (let k = 0; k < moved.length; k++)
    flatPoints.set(at.subarray(k * 3, k * 3 + 3), moved[k]! * 3)
  const dropped = new Set(unpack(stored.flat.dropped))
  const kept: number[] = []
  for (let t = 0; t < index.length / 3; t++) {
    if (!dropped.has(t)) kept.push(index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!)
  }
  return { input, who: stored.who, flat: { points: flatPoints, index: Uint32Array.from(kept) } }
}

/** The heads frozen for the tests. */
export const HAIR_HEADS = ['Female_Adult_01', 'Male_Adult_01'] as const

export const hairHeadFile = (id: string) => join(import.meta.dir, 'hair-fixtures', `${id}.json`)

/** A frozen head (bun only: the tests and scripts read it from disk). */
export async function loadHairHead(id: (typeof HAIR_HEADS)[number]): Promise<HairHead> {
  return readHairHead((await Bun.file(hairHeadFile(id)).json()) as StoredHairHead)
}
