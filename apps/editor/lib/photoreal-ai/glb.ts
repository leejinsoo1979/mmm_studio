/**
 * The avatar service's GLB, checked and made lighter before it is stored:
 * one self-contained glTF 2.0 binary (nothing fetched from elsewhere), a
 * humanoid skin, and only the blend shapes the game plays kept (the blink,
 * as `scripts/characters/build-photoreal-character.mjs` keeps them), with
 * the buffer repacked around what is left. A GLB whose data is compressed
 * by an extension (meshopt, Draco) or split over several buffers is checked
 * but kept as it is.
 */

type Json = Record<string, unknown>

type Accessor = Json & { bufferView?: number; sparse?: Json }
type BufferView = Json & { buffer: number; byteOffset?: number; byteLength: number }
type Primitive = Json & {
  attributes: Record<string, number>
  indices?: number
  targets?: Record<string, number>[]
  mode?: number
}
type Mesh = Json & { primitives: Primitive[]; weights?: number[]; extras?: Json }

export type GltfJson = Json & {
  asset?: { version?: unknown }
  buffers?: (Json & { uri?: unknown; byteLength: number })[]
  bufferViews?: BufferView[]
  accessors?: Accessor[]
  images?: (Json & { uri?: unknown; bufferView?: number; mimeType?: unknown })[]
  meshes?: Mesh[]
  nodes?: (Json & { name?: unknown })[]
  skins?: (Json & { joints: number[]; inverseBindMatrices?: number })[]
  animations?: (Json & { samplers: (Json & { input: number; output: number })[] })[]
  materials?: (Json & { name?: unknown; alphaMode?: unknown })[]
  scenes?: (Json & { nodes?: number[] })[]
  extensionsUsed?: string[]
}

export type GlbProblem =
  | 'not_glb'
  | 'unsupported_version'
  | 'damaged'
  | 'external_resource'
  | 'too_large'
  | 'not_rigged'

export type GlbInfo = {
  bytes: number
  meshes: number
  triangles: number
  joints: string[]
  /** Every blend shape name, once. */
  morphTargets: string[]
  materials: { name: string; alphaMode: string }[]
  images: { mimeType: string; bytes: number }[]
  extensions: string[]
  rootNodes: string[]
}

/** The blend shapes kept: the game blinks with them (photoreal-body.ts). */
export const KEPT_MORPH_TARGETS: ReadonlySet<string> = new Set(['eyeBlinkLeft', 'eyeBlinkRight'])
export const MAX_GLB_BYTES = 64 * 1024 * 1024

const MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
}
/** Element types whose elements have no column padding, so `count × size` is their extent. */
const ELEMENT_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
}
/** Extensions that never point into the buffer themselves, so a repack leaves them whole. */
const REPACK_SAFE = [
  /^KHR_materials_/,
  /^KHR_texture_transform$/,
  /^KHR_texture_basisu$/,
  /^EXT_texture_webp$/,
  /^KHR_mesh_quantization$/,
  /^KHR_lights_punctual$/,
]

type Glb = { json: GltfJson; bin: Uint8Array | null }

export function isGlb(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === MAGIC
  )
}

export function readGlb(
  bytes: Uint8Array,
): ({ ok: true } & Glb) | { ok: false; problem: GlbProblem } {
  if (bytes.length > MAX_GLB_BYTES) return { ok: false, problem: 'too_large' }
  if (!isGlb(bytes)) return { ok: false, problem: 'not_glb' }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4, true) !== 2) return { ok: false, problem: 'unsupported_version' }
  const length = view.getUint32(8, true)
  if (length > bytes.length || length < 20) return { ok: false, problem: 'damaged' }
  let json: GltfJson | null = null
  let bin: Uint8Array | null = null
  for (let at = 12; at + 8 <= length; ) {
    const size = view.getUint32(at, true)
    const type = view.getUint32(at + 4, true)
    const data = bytes.subarray(at + 8, at + 8 + size)
    if (data.length !== size) return { ok: false, problem: 'damaged' }
    if (type === JSON_CHUNK && !json) {
      try {
        json = JSON.parse(new TextDecoder().decode(data)) as GltfJson
      } catch {
        return { ok: false, problem: 'damaged' }
      }
    } else if (type === BIN_CHUNK && !bin) bin = data
    at += 8 + size + ((4 - (size % 4)) % 4)
  }
  if (!json || typeof json !== 'object' || json.asset?.version !== '2.0') {
    return { ok: false, problem: json ? 'unsupported_version' : 'damaged' }
  }
  return { ok: true, json, bin }
}

const names = (list: { name?: unknown }[] | undefined, indices: number[]) =>
  indices.map((index) => {
    const name = list?.[index]?.name
    return typeof name === 'string' ? name : ''
  })

function targetNamesOf(mesh: Mesh): string[] | null {
  const raw = mesh.extras?.targetNames
  return Array.isArray(raw) && raw.every((name) => typeof name === 'string') ? raw : null
}

export function inspectGlb({ json }: Glb, bytes: number): GlbInfo {
  const accessors = json.accessors ?? []
  let triangles = 0
  const morphs = new Set<string>()
  for (const mesh of json.meshes ?? []) {
    for (const name of targetNamesOf(mesh) ?? []) morphs.add(name)
    for (const primitive of mesh.primitives ?? []) {
      const counted = primitive.indices ?? primitive.attributes?.POSITION
      const count = counted === undefined ? 0 : Number(accessors[counted]?.count ?? 0)
      if ((primitive.mode ?? 4) === 4) triangles += Math.floor(count / 3)
    }
  }
  const joints = new Set<string>()
  for (const skin of json.skins ?? []) {
    for (const name of names(json.nodes, skin.joints ?? [])) if (name) joints.add(name)
  }
  const bufferViews = json.bufferViews ?? []
  return {
    bytes,
    meshes: json.meshes?.length ?? 0,
    triangles,
    joints: [...joints],
    morphTargets: [...morphs],
    materials: (json.materials ?? []).map((material) => ({
      name: typeof material.name === 'string' ? material.name : '',
      alphaMode: typeof material.alphaMode === 'string' ? material.alphaMode : 'OPAQUE',
    })),
    images: (json.images ?? []).map((image) => ({
      mimeType: typeof image.mimeType === 'string' ? image.mimeType : '',
      bytes: image.bufferView === undefined ? 0 : (bufferViews[image.bufferView]?.byteLength ?? 0),
    })),
    extensions: json.extensionsUsed ?? [],
    rootNodes: names(json.nodes, json.scenes?.[0]?.nodes ?? []),
  }
}

/** A skin with a hip (or pelvis) joint and a head joint: something the shared clips can move. */
export function isHumanoidRig(joints: readonly string[]): boolean {
  const plain = joints.map((name) => name.toLowerCase().replace(/^.*[:|]/, ''))
  return (
    plain.some((name) => /(hips|pelvis)$/.test(name)) && plain.some((name) => /head$/.test(name))
  )
}

/** Self-contained: no buffer or image read from a URI (another site, a file, or inline data). */
function selfContained(json: GltfJson): boolean {
  return (
    (json.buffers ?? []).every((buffer) => buffer.uri === undefined) &&
    (json.images ?? []).every((image) => image.uri === undefined)
  )
}

/** Drops every blend shape not in `keep` from each mesh, in place. */
function trimMorphTargets(json: GltfJson, keep: ReadonlySet<string>): void {
  for (const mesh of json.meshes ?? []) {
    if (!mesh.primitives?.some((primitive) => primitive.targets?.length)) continue
    const names = targetNamesOf(mesh)
    const kept = (names ?? []).flatMap((name, index) => (keep.has(name) ? [index] : []))
    for (const primitive of mesh.primitives) {
      const targets = primitive.targets ?? []
      const next = kept.flatMap((index) => (targets[index] ? [targets[index]] : []))
      if (next.length > 0) primitive.targets = next
      else delete primitive.targets
    }
    if (kept.length > 0) {
      mesh.weights = kept.map((index) => mesh.weights?.[index] ?? 0)
      mesh.extras = { ...mesh.extras, targetNames: kept.map((index) => names![index]!) }
    } else {
      delete mesh.weights
      if (mesh.extras) {
        const { targetNames: _dropped, ...rest } = mesh.extras
        if (Object.keys(rest).length > 0) mesh.extras = rest
        else delete mesh.extras
      }
    }
  }
}

/** Keeps only the accessors and buffer views still used, and repacks the one buffer around them. */
function repack(json: GltfJson, bin: Uint8Array): Uint8Array<ArrayBuffer> {
  const accessors = json.accessors ?? []
  const accessorMap = new Map<number, number>()
  const keepAccessor = (index: number | undefined) => {
    if (index === undefined || accessorMap.has(index) || !accessors[index]) return index
    accessorMap.set(index, accessorMap.size)
    return index
  }
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const index of Object.values(primitive.attributes ?? {})) keepAccessor(index)
      keepAccessor(primitive.indices)
      for (const target of primitive.targets ?? []) {
        for (const index of Object.values(target)) keepAccessor(index)
      }
    }
  }
  for (const skin of json.skins ?? []) keepAccessor(skin.inverseBindMatrices)
  for (const animation of json.animations ?? []) {
    for (const sampler of animation.samplers ?? []) {
      keepAccessor(sampler.input)
      keepAccessor(sampler.output)
    }
  }
  const remapAccessor = (index: number) => accessorMap.get(index) ?? index
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const key of Object.keys(primitive.attributes ?? {})) {
        primitive.attributes[key] = remapAccessor(primitive.attributes[key]!)
      }
      if (primitive.indices !== undefined) primitive.indices = remapAccessor(primitive.indices)
      for (const target of primitive.targets ?? []) {
        for (const key of Object.keys(target)) target[key] = remapAccessor(target[key]!)
      }
    }
  }
  for (const skin of json.skins ?? []) {
    if (skin.inverseBindMatrices !== undefined) {
      skin.inverseBindMatrices = remapAccessor(skin.inverseBindMatrices)
    }
  }
  for (const animation of json.animations ?? []) {
    for (const sampler of animation.samplers ?? []) {
      sampler.input = remapAccessor(sampler.input)
      sampler.output = remapAccessor(sampler.output)
    }
  }
  const keptAccessors = [...accessorMap.keys()].map((index) => accessors[index]!)
  json.accessors = keptAccessors

  // Each new view is a byte range of the old buffer. An accessor tightly packed in a view it
  // shares with dropped data (the service packs all of a mesh's blend shapes in one view) gets a
  // view of its own bytes; interleaved, sparse and image data keep their whole view.
  const views = json.bufferViews ?? []
  const nextViews: BufferView[] = []
  const ranges: { start: number; length: number }[] = []
  const wholeViews = new Map<number, number>()
  const addView = (view: BufferView, start: number, length: number) => {
    const end = (view.byteOffset ?? 0) + view.byteLength
    if (start < (view.byteOffset ?? 0) || start + length > end || end > bin.length) {
      throw new Error('accessor outside its buffer view')
    }
    const { byteOffset: _offset, ...rest } = view
    nextViews.push({ ...rest, buffer: 0, byteLength: length })
    ranges.push({ start, length })
    return nextViews.length - 1
  }
  const whole = (index: number | undefined) => {
    if (index === undefined) return undefined
    const view = views[index]
    if (!view) throw new Error('missing buffer view')
    let mapped = wholeViews.get(index)
    if (mapped === undefined) {
      mapped = addView(view, view.byteOffset ?? 0, view.byteLength)
      wholeViews.set(index, mapped)
    }
    return mapped
  }
  for (const accessor of keptAccessors) {
    const sparse = accessor.sparse as
      | { indices?: { bufferView?: number }; values?: { bufferView?: number } }
      | undefined
    if (sparse?.indices) sparse.indices.bufferView = whole(sparse.indices.bufferView)
    if (sparse?.values) sparse.values.bufferView = whole(sparse.values.bufferView)
    if (accessor.bufferView === undefined) continue
    const view = views[accessor.bufferView]
    const element =
      (COMPONENT_BYTES[Number(accessor.componentType)] ?? 0) *
      (ELEMENT_COMPONENTS[String(accessor.type)] ?? 0)
    const packed = element > 0 && (view?.byteStride === undefined || view.byteStride === element)
    if (!view || !packed) {
      accessor.bufferView = whole(accessor.bufferView)
      continue
    }
    const start = (view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0)
    accessor.bufferView = addView(view, start, Number(accessor.count) * element)
    delete accessor.byteOffset
  }
  for (const image of json.images ?? []) image.bufferView = whole(image.bufferView)

  let size = 0
  const offsets = ranges.map(({ length }) => {
    const offset = size
    size += length + ((4 - (length % 4)) % 4)
    return offset
  })
  const out = new Uint8Array(size)
  ranges.forEach(({ start, length }, i) => {
    out.set(bin.subarray(start, start + length), offsets[i]!)
    nextViews[i]!.byteOffset = offsets[i]!
  })
  json.bufferViews = nextViews
  json.buffers = [{ ...json.buffers![0]!, byteLength: size }]
  return out
}

export function writeGlb(json: GltfJson, bin: Uint8Array | null): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonSize = text.length + ((4 - (text.length % 4)) % 4)
  const binSize = bin ? bin.length + ((4 - (bin.length % 4)) % 4) : 0
  const total = 12 + 8 + jsonSize + (bin ? 8 + binSize : 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonSize, true)
  view.setUint32(16, JSON_CHUNK, true)
  out.set(text, 20)
  out.fill(0x20, 20 + text.length, 20 + jsonSize)
  if (bin) {
    view.setUint32(20 + jsonSize, binSize, true)
    view.setUint32(24 + jsonSize, BIN_CHUNK, true)
    out.set(bin, 28 + jsonSize)
  }
  return out
}

export type AvatarGlbResult =
  | {
      ok: true
      bytes: Uint8Array<ArrayBuffer>
      before: GlbInfo
      after: GlbInfo
      /** Blend shapes were trimmed and the buffer repacked (false: kept as it came). */
      trimmed: boolean
    }
  | { ok: false; problem: GlbProblem }

/** The service's GLB checked (self-contained, humanoid) and trimmed to what the game uses. */
export function prepareAvatarGlb(
  bytes: Uint8Array<ArrayBuffer>,
  keep: ReadonlySet<string> = KEPT_MORPH_TARGETS,
): AvatarGlbResult {
  const read = readGlb(bytes)
  if (!read.ok) return read
  if (!selfContained(read.json)) return { ok: false, problem: 'external_resource' }
  const before = inspectGlb(read, bytes.length)
  if (!isHumanoidRig(before.joints)) return { ok: false, problem: 'not_rigged' }
  const repackable =
    read.bin !== null &&
    read.json.buffers?.length === 1 &&
    (read.json.extensionsUsed ?? []).every((name) => REPACK_SAFE.some((safe) => safe.test(name)))
  if (!repackable) return { ok: true, bytes, before, after: before, trimmed: false }
  try {
    const json = structuredClone(read.json)
    trimMorphTargets(json, keep)
    const out = writeGlb(json, repack(json, read.bin!))
    return {
      ok: true,
      bytes: out,
      before,
      after: inspectGlb({ json, bin: null }, out.length),
      trimmed: true,
    }
  } catch {
    return { ok: false, problem: 'damaged' }
  }
}
