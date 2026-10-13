import type { AvatarGender } from '../avatar-catalog'

/**
 * The hair a photo avatar can be given (scripts/characters/build-photo-hair.py):
 * MakeHuman's CC0 hair cards and a buzz cut, each bound to MakeHuman's base
 * mesh as MakeHuman binds a proxy — every hair vertex three base mesh
 * vertices, weights and an offset — so it sits on whichever body and fitted
 * face it is put on, with a cap under the cards and a hairline tint for the
 * scalp. Served beside the base bodies, in `hair/`.
 */

export type HairLength = 'bald' | 'buzz' | 'short' | 'medium' | 'long'

export type HairStyleFacts = {
  length: Exclude<HairLength, 'bald'>
  /** Long hair gathered back (a ponytail). */
  tied: boolean
  /** How far the hair stands off the head. */
  volume: 'flat' | 'normal' | 'big'
  /** Hair over the forehead. */
  fringe: boolean
}

/** The styles built, by name (`styles.json`). */
export const HAIR_STYLES = {
  buzz: { length: 'buzz', tied: false, volume: 'flat', fringe: false },
  short02: { length: 'short', tied: false, volume: 'normal', fringe: false },
  short03: { length: 'short', tied: false, volume: 'normal', fringe: true },
  bob02: { length: 'medium', tied: false, volume: 'normal', fringe: true },
  'long01-bob': { length: 'medium', tied: false, volume: 'normal', fringe: false },
  'long01-shoulder': { length: 'long', tied: false, volume: 'normal', fringe: false },
  long01: { length: 'long', tied: false, volume: 'normal', fringe: false },
  ponytail01: { length: 'long', tied: true, volume: 'normal', fringe: false },
  afro01: { length: 'medium', tied: false, volume: 'big', fringe: false },
} as const satisfies Record<string, HairStyleFacts>

export type HairStyleName = keyof typeof HAIR_STYLES

/** A part of a style as drawn: its cards, or its cap for one body. */
export type HairPart = {
  name: string
  /** The material it is drawn with in the avatar ('Hair' or 'Hair_Cap'). */
  material: string
  /** Its picture's file, beside the style's. */
  texture: string
  /** Per vertex: three base mesh vertices, their weights and an offset (MakeHuman's decimetres). */
  refs: Uint16Array
  weights: Float32Array
  offsets: Float32Array
  uvs: Float32Array
  /** Per vertex: four of the style's bones and their weights (bytes summing to 255). */
  joints: Uint8Array
  jointWeights: Uint8Array
  /** Per vertex, how much of its picture's alpha it keeps (255: all), where a style thins out (a tapered nape). */
  alpha: Uint8Array | null
  indices: Uint16Array | Uint32Array
}

export type HairStyle = HairStyleFacts & {
  name: HairStyleName
  /** The bones `joints` index (the base bodies' bone names). */
  bones: string[]
  /** Base mesh vertex pairs (and their distance in MakeHuman's units) the offsets scale by, per axis. */
  scales: Partial<Record<'x' | 'y' | 'z', [number, number, number]>>
  parts: HairPart[]
  /** Per body: how densely hair grows on each scalp vertex (0–1), for the skin's hairline tint. */
  scalp: Record<AvatarGender, { vertices: Uint16Array; density: Float32Array }>
}

type ArrayRef = { offset: number; count: number }

/** A style's file (`<style>.bin`): "PHR1", the header's length, the header (JSON), the arrays. */
export function readHairStyle(bytes: ArrayBuffer): HairStyle {
  const view = new DataView(bytes)
  const magic = new TextDecoder().decode(new Uint8Array(bytes, 0, 4))
  if (magic !== 'PHR1') throw new Error('not a hair style file')
  const length = view.getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 8, length)))
  const start = 8 + length
  const array = <T>(make: new (b: ArrayBuffer, o: number, n: number) => T, ref: ArrayRef) =>
    new make(bytes, start + ref.offset, ref.count)
  const parts: HairPart[] = header.parts.map(
    (part: Record<string, ArrayRef & { type?: string }>) => ({
      name: part.name as unknown as string,
      material: part.material as unknown as string,
      texture: part.texture as unknown as string,
      refs: array(Uint16Array, part.refs!),
      weights: array(Float32Array, part.weights!),
      offsets: array(Float32Array, part.offsets!),
      uvs: array(Float32Array, part.uvs!),
      joints: array(Uint8Array, part.joints!),
      jointWeights: array(Uint8Array, part.jointWeights!),
      alpha: part.alpha ? array(Uint8Array, part.alpha) : null,
      indices:
        part.indices!.type === 'u32'
          ? array(Uint32Array, part.indices!)
          : array(Uint16Array, part.indices!),
    }),
  )
  const scalp = {} as HairStyle['scalp']
  for (const gender of ['male', 'female'] as const) {
    const s = header.scalp[gender]
    scalp[gender] = {
      vertices: s ? array(Uint16Array, s.vertices) : new Uint16Array(0),
      density: s ? array(Float32Array, s.density) : new Float32Array(0),
    }
  }
  return {
    name: header.style,
    length: header.length,
    tied: header.tied,
    volume: header.volume,
    fringe: header.fringe,
    bones: header.bones,
    scales: header.scales,
    parts,
    scalp,
  }
}

/** The parts a body wears: the cards, and the cap made for that body. */
export function partsFor(style: HairStyle, gender: AvatarGender): HairPart[] {
  return style.parts.filter((part) => part.name === 'cards' || part.name === `cap-${gender}`)
}

/**
 * Where each vertex of a part sits on a base mesh (metres): its three base
 * mesh vertices weighted, plus its offset scaled as the base mesh's head is
 * (MakeHuman's proxy fitting, as MPFB does it).
 */
export function fitHairPart(
  style: HairStyle,
  part: HairPart,
  basemesh: ArrayLike<number>,
): Float32Array {
  const size = [1, 1, 1]
  ;(['x', 'y', 'z'] as const).forEach((axis, k) => {
    const scale = style.scales[axis]
    if (!scale) return
    const [a, b, reference] = scale
    size[k] = Math.abs(basemesh[a * 3 + k]! - basemesh[b * 3 + k]!) / reference
  })
  const count = part.refs.length / 3
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      let p = part.offsets[i * 3 + k]! * size[k]!
      for (let j = 0; j < 3; j++)
        p += part.weights[i * 3 + j]! * basemesh[part.refs[i * 3 + j]! * 3 + k]!
      out[i * 3 + k] = p
    }
  }
  return out
}

const loaded = new Map<string, Promise<{ style: HairStyle; pictures: Map<string, Uint8Array> }>>()

/** A style and its pictures (bytes as served), fetched once per page or worker. */
export function loadHairStyle(
  name: HairStyleName,
  root: string,
  fetcher: typeof fetch = fetch,
): Promise<{ style: HairStyle; pictures: Map<string, Uint8Array> }> {
  const key = `${root}|${name}`
  let found = loaded.get(key)
  if (!found) {
    const get = async (file: string) => {
      const response = await fetcher(`${root}/hair/${file}`)
      if (!response.ok) throw new Error(`${file}: ${response.status}`)
      return response.arrayBuffer()
    }
    found = (async () => {
      const style = readHairStyle(await get(`${name}.bin`))
      const files = [...new Set(style.parts.map((part) => part.texture))]
      const pictures = new Map<string, Uint8Array>()
      await Promise.all(
        files.map(async (file) => pictures.set(file, new Uint8Array(await get(file)))),
      )
      return { style, pictures }
    })()
    found.catch(() => loaded.delete(key))
    loaded.set(key, found)
  }
  return found
}
