import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/**
 * Reading and writing binary glTF without three.js: the photo avatar is the
 * base body's file with new positions and normals for the head and its
 * parts, and new pictures for the skin and eyes, the rest of it (the
 * compressed body, its rig and blinks) carried over byte for byte.
 */

export type GltfJson = Record<string, any>

export type Glb = { json: GltfJson; bin: Uint8Array<ArrayBufferLike> }

const MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

export function parseGlb(bytes: ArrayBuffer | Uint8Array): Glb {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (view.getUint32(0, true) !== MAGIC) throw new Error('not a GLB file')
  let offset = 12
  let json: GltfJson | null = null
  let bin: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  while (offset + 8 <= data.byteLength) {
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    const chunk = data.subarray(offset + 8, offset + 8 + length)
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(chunk))
    else if (type === BIN_CHUNK) bin = chunk
    offset += 8 + length
  }
  if (!json) throw new Error('GLB without JSON')
  return { json, bin }
}

export function writeGlb(json: GltfJson, bin: Uint8Array): Uint8Array {
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const jsonBytes = new TextEncoder().encode(text)
  const binLength = Math.ceil(bin.byteLength / 4) * 4
  const total = 12 + 8 + jsonBytes.byteLength + 8 + binLength
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonBytes.byteLength, true)
  view.setUint32(16, JSON_CHUNK, true)
  out.set(jsonBytes, 20)
  const at = 20 + jsonBytes.byteLength
  view.setUint32(at, binLength, true)
  view.setUint32(at + 4, BIN_CHUNK, true)
  out.set(bin, at + 8)
  return out
}

/** A GLB with some of its materials changed (each by its name); everything else kept byte for byte. */
export function editMaterials(
  bytes: Uint8Array,
  edits: Record<string, (material: GltfJson) => void>,
): Uint8Array {
  const glb = parseGlb(bytes)
  for (const material of glb.json.materials ?? []) edits[material.name]?.(material)
  return writeGlb(glb.json, glb.bin)
}

/** Every buffer view's bytes, meshopt-compressed ones decoded. */
export async function bufferViewBytes(glb: Glb): Promise<Uint8Array[]> {
  const views = glb.json.bufferViews ?? []
  const out: Uint8Array[] = []
  let decoderReady = false
  for (const view of views) {
    const compressed = view.extensions?.EXT_meshopt_compression
    if (compressed) {
      if (!decoderReady) {
        await MeshoptDecoder.ready
        decoderReady = true
      }
      const source = glb.bin.subarray(
        compressed.byteOffset ?? 0,
        (compressed.byteOffset ?? 0) + compressed.byteLength,
      )
      const target = new Uint8Array(compressed.count * compressed.byteStride)
      MeshoptDecoder.decodeGltfBuffer(
        target,
        compressed.count,
        compressed.byteStride,
        source,
        compressed.mode,
        compressed.filter ?? 'NONE',
      )
      out.push(target)
    } else {
      const start = view.byteOffset ?? 0
      out.push(glb.bin.subarray(start, start + view.byteLength))
    }
  }
  return out
}

const COMPONENT: Record<number, { size: number; read: (v: DataView, at: number) => number }> = {
  5120: { size: 1, read: (v, at) => v.getInt8(at) },
  5121: { size: 1, read: (v, at) => v.getUint8(at) },
  5122: { size: 2, read: (v, at) => v.getInt16(at, true) },
  5123: { size: 2, read: (v, at) => v.getUint16(at, true) },
  5125: { size: 4, read: (v, at) => v.getUint32(at, true) },
  5126: { size: 4, read: (v, at) => v.getFloat32(at, true) },
}

const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

/** Normalised integers as the fractions they stand for (glTF's rules). */
function normalise(value: number, type: number): number {
  switch (type) {
    case 5120:
      return Math.max(value / 127, -1)
    case 5121:
      return value / 255
    case 5122:
      return Math.max(value / 32767, -1)
    case 5123:
      return value / 65535
    default:
      return value
  }
}

/** An accessor's values as floats (normalised integers as their fractions), `width` per item. */
export function readAccessor(
  glb: Glb,
  views: Uint8Array[],
  index: number,
): { values: Float64Array; width: number; count: number } {
  const accessor = glb.json.accessors[index]
  const width = WIDTH[accessor.type]!
  const count = accessor.count as number
  const values = new Float64Array(count * width)
  if (accessor.bufferView === undefined) return { values, width, count }
  const component = COMPONENT[accessor.componentType]!
  const viewInfo = glb.json.bufferViews[accessor.bufferView]
  const bytes = views[accessor.bufferView]!
  const stride =
    viewInfo.extensions?.EXT_meshopt_compression?.byteStride ??
    viewInfo.byteStride ??
    component.size * width
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const start = accessor.byteOffset ?? 0
  const normalized = Boolean(accessor.normalized)
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < width; k++) {
      const raw = component.read(data, start + i * stride + k * component.size)
      values[i * width + k] = normalized ? normalise(raw, accessor.componentType) : raw
    }
  }
  return { values, width, count }
}

/** A primitive of a mesh as read: its attributes (floats), triangle indices and material name. */
export type ReadPrimitive = {
  mesh: number
  primitive: number
  meshName: string
  material: string
  attributes: Record<string, { values: Float64Array; width: number }>
  indices: Uint32Array
}

export async function readPrimitives(glb: Glb): Promise<ReadPrimitive[]> {
  const views = await bufferViewBytes(glb)
  const out: ReadPrimitive[] = []
  glb.json.meshes.forEach((mesh: GltfJson, m: number) => {
    mesh.primitives.forEach((primitive: GltfJson, p: number) => {
      const attributes: ReadPrimitive['attributes'] = {}
      for (const [name, index] of Object.entries(primitive.attributes as Record<string, number>)) {
        const { values, width } = readAccessor(glb, views, index)
        attributes[name] = { values, width }
      }
      const indices =
        primitive.indices === undefined
          ? new Uint32Array(0)
          : Uint32Array.from(readAccessor(glb, views, primitive.indices).values)
      out.push({
        mesh: m,
        primitive: p,
        meshName: mesh.name ?? '',
        material: glb.json.materials?.[primitive.material]?.name ?? '',
        attributes,
        indices,
      })
    })
  })
  return out
}

/**
 * A GLB under construction from another: new buffer views are appended to
 * its binary chunk (4-byte aligned), and accessors or images can be pointed
 * at them.
 */
export class GlbWriter {
  readonly json: GltfJson
  private readonly parts: Uint8Array[]
  private length: number

  constructor(source: Glb) {
    this.json = structuredClone(source.json)
    this.parts = [source.bin]
    this.length = source.bin.byteLength
  }

  /** Appends bytes as a new buffer view of buffer 0; its index. */
  addView(bytes: Uint8Array, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4
    if (pad) {
      this.parts.push(new Uint8Array(pad))
      this.length += pad
    }
    const view: GltfJson = { buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength }
    if (target !== undefined) view.target = target
    this.parts.push(bytes)
    this.length += bytes.byteLength
    this.json.bufferViews.push(view)
    return this.json.bufferViews.length - 1
  }

  /** Appends a float accessor (VEC3 or MAT4…) with its bounds; its index. */
  addFloatAccessor(values: Float32Array, type: 'VEC3' | 'MAT4', withBounds: boolean): number {
    const width = WIDTH[type]!
    const view = this.addView(
      new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
      type === 'VEC3' ? 34962 : undefined,
    )
    const accessor: GltfJson = {
      bufferView: view,
      componentType: 5126,
      count: values.length / width,
      type,
    }
    if (withBounds) {
      const min = new Array(width).fill(Number.POSITIVE_INFINITY)
      const max = new Array(width).fill(Number.NEGATIVE_INFINITY)
      for (let i = 0; i < values.length; i++) {
        const k = i % width
        min[k] = Math.min(min[k], values[i]!)
        max[k] = Math.max(max[k], values[i]!)
      }
      accessor.min = min
      accessor.max = max
    }
    this.json.accessors.push(accessor)
    return this.json.accessors.length - 1
  }

  /** Points an image at new bytes (`mimeType` as encoded). */
  replaceImage(index: number, bytes: Uint8Array, mimeType: string) {
    const image = this.json.images[index]
    image.bufferView = this.addView(bytes)
    image.mimeType = mimeType
    delete image.uri
  }

  finish(): Uint8Array {
    const bin = new Uint8Array(this.length)
    let at = 0
    for (const part of this.parts) {
      bin.set(part, at)
      at += part.byteLength
    }
    // Buffer 0 is the binary chunk; its length grows with what was appended.
    this.json.buffers[0].byteLength = bin.byteLength
    return writeGlb(this.json, bin)
  }
}
