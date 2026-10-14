import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type BaseBody,
  baseMeshMoves,
  buildAvatarGlb,
  movedPositions,
  readBaseBody,
} from './base-body'
import { bufferViewBytes, parseGlb, readAccessor, readPrimitives } from './glb'
import { landmarkPosition, readFaceTargets, shapePositions } from './head-model'
import { transformPoint4 } from './mat4'

const PUBLIC = join(import.meta.dir, '../../../../../../../apps/editor/public/characters/photoreal')
const read = (name: string) => readFileSync(join(PUBLIC, name))
const buffer = (name: string) => {
  const bytes = read(name)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

let base: BaseBody

beforeAll(async () => {
  base = await readBaseBody({
    glb: buffer('mpfb-base-male.glb'),
    basemesh: buffer('mpfb-base-male.basemesh.bin'),
    meta: JSON.parse(read('mpfb-base-male.json').toString()),
    landmarks: JSON.parse(read('mpfb-base-male.landmarks.json').toString()),
    targets: readFaceTargets(
      JSON.parse(read('mpfb-face-targets.json').toString()),
      buffer('mpfb-face-targets.bin'),
    ),
  })
})

/** The positions (metres at rest) of a primitive of a GLB as written. */
async function writtenPositions(bytes: Uint8Array, index: number) {
  const glb = parseGlb(bytes)
  const primitives = await readPrimitives(glb)
  const p = primitives[index]!
  const values = p.attributes.POSITION!.values
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i += 3) {
    const [x, y, z] = transformPoint4(base.packing, values[i]!, values[i + 1]!, values[i + 2]!)
    out[i] = x
    out[i + 1] = y
    out[i + 2] = z
  }
  return { glb, primitives, positions: out }
}

describe('base body', () => {
  test('reads the head’s skin with UVs, tied to the base mesh', () => {
    const { mesh, weld } = base.headSkin
    expect(mesh.positions.length / 3).toBe(weld.length)
    expect(mesh.uvs.length / 2).toBe(weld.length)
    // The skin at rest sits where its base mesh vertices are.
    for (let i = 0; i < weld.length; i += 97) {
      const v = weld[i]!
      for (let k = 0; k < 3; k++)
        expect(Math.abs(mesh.positions[i * 3 + k]! - base.basemesh[v * 3 + k]!)).toBeLessThan(2e-4)
    }
  })

  test('a fitted head moves the head and its parts, and leaves the body', async () => {
    const coefficients = new Float64Array(base.head.targetNames.length)
    coefficients[base.head.targetNames.indexOf('nose-scale-depth-incr')] = 1
    coefficients[base.head.targetNames.indexOf('chin-prominent-incr')] = 1
    const fitted = shapePositions(base.head, coefficients)
    const moves = baseMeshMoves(base, fitted)
    const picture = { bytes: new Uint8Array([1, 2, 3, 4, 5]), mimeType: 'image/webp' }
    const skinImage = 'head_color'
    const out = buildAvatarGlb(base, moves, new Map([[skinImage, picture]]), { dropBrows: true })

    const head = base.headSkin.primitive
    const { glb, positions } = await writtenPositions(out, head)
    const expected = movedPositions(base, head, moves)
    for (let i = 0; i < positions.length; i++)
      expect(Math.abs(positions[i]! - expected[i]!)).toBeLessThan(5e-5)
    // The nose tip came forward.
    const tip = landmarkPosition(base.head, fitted, 1)!
    const restTip = landmarkPosition(base.head, Float64Array.from(base.head.rest), 1)!
    expect((tip[2] - restTip[2]) * 1000).toBeGreaterThan(2)

    // What the head doesn't reach (the shoes) is written byte for byte as before.
    const before = await bufferViewBytes(base.glb)
    const after = await bufferViewBytes(glb)
    const shoes = base.primitives.find((p) => p.meshName === 'Outfit_shoes01')!
    // By name: the file drops the meshes nothing draws, so the others' indices move up.
    const accessor = (g: typeof glb) =>
      g.json.meshes.find((mesh: { name?: string }) => mesh.name === shoes.meshName).primitives[
        shoes.primitive
      ].attributes.POSITION
    expect(Array.from(readAccessor(glb, after, accessor(glb)).values)).toEqual(
      Array.from(readAccessor(base.glb, before, accessor(base.glb)).values),
    )
    // The picture was replaced, the brows' cards dropped.
    const imageIndex = glb.json.images.findIndex(
      (image: { name?: string }) => image.name === skinImage,
    )
    const view = glb.json.bufferViews[glb.json.images[imageIndex].bufferView]
    expect(
      Array.from(glb.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)),
    ).toEqual([1, 2, 3, 4, 5])
    expect(glb.json.images[imageIndex].mimeType).toBe('image/webp')
    for (const node of glb.json.nodes) {
      if (node.mesh !== undefined) expect(glb.json.meshes[node.mesh].name).not.toBe('Eyebrows')
    }
  })

  test('the file holds no bytes nothing reads, and a picture that is not WebP is named plainly', async () => {
    const coefficients = new Float64Array(base.head.targetNames.length)
    coefficients[base.head.targetNames.indexOf('nose-scale-depth-incr')] = 1
    const moves = baseMeshMoves(base, shapePositions(base.head, coefficients))
    // As Safari's canvas writes them: PNG where a picture has alpha, JPEG where not.
    const png = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]), mimeType: 'image/png' }
    const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 7]), mimeType: 'image/jpeg' }
    const out = buildAvatarGlb(
      base,
      moves,
      new Map([
        ['hair_color', png],
        ['head_color', jpeg],
      ]),
      { dropBrows: true },
    )
    const glb = parseGlb(out)
    const { json } = glb

    const drawn = new Set(json.nodes.flatMap((node: { mesh?: number }) => node.mesh ?? []))
    expect(drawn.size).toBe(json.meshes.length)
    expect(json.meshes.some((mesh: { name: string }) => mesh.name === 'Eyebrows')).toBe(false)

    const named = new Set<number>()
    for (const accessor of json.accessors) {
      if (accessor.bufferView !== undefined) named.add(accessor.bufferView)
    }
    for (const image of json.images) named.add(image.bufferView)
    expect(named.size).toBe(json.bufferViews.length)
    let bytes = 0
    for (const view of json.bufferViews) {
      const meshopt = view.extensions?.EXT_meshopt_compression
      bytes += meshopt ? meshopt.byteLength : view.byteLength
    }
    // Only the 4-byte alignment between views is left over.
    expect(glb.bin.byteLength - bytes).toBeLessThan(4 * json.bufferViews.length)
    // The binary chunk is the buffer padded to 4 bytes.
    expect(glb.bin.byteLength - json.buffers[0].byteLength).toBeGreaterThanOrEqual(0)
    expect(glb.bin.byteLength - json.buffers[0].byteLength).toBeLessThan(4)

    const textureOf = (name: string) =>
      json.textures.find(
        (texture: { source?: number; extensions?: { EXT_texture_webp?: { source: number } } }) =>
          json.images[texture.source ?? texture.extensions!.EXT_texture_webp!.source].name === name,
      )
    for (const name of ['hair_color', 'head_color']) {
      const texture = textureOf(name)
      expect(texture.extensions?.EXT_texture_webp).toBeUndefined()
      expect(json.images[texture.source].mimeType).toBe(
        name === 'hair_color' ? 'image/png' : 'image/jpeg',
      )
    }
    const hair = json.images[textureOf('hair_color').source]
    const view = json.bufferViews[hair.bufferView]
    expect(
      Array.from(glb.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)),
    ).toEqual(Array.from(png.bytes))
    // The others are still WebP, so the extension is still needed.
    expect(json.extensionsRequired).toContain('EXT_texture_webp')

    // Every mesh still reads (meshopt and all), the moved head where it was put.
    const primitives = await readPrimitives(glb)
    const kept = base.primitives.filter((p) => p.meshName !== 'Eyebrows')
    expect(primitives.map((p) => `${p.meshName}/${p.material}`)).toEqual(
      kept.map((p) => `${p.meshName}/${p.material}`),
    )
    const head = primitives.find((p) => p.material === 'Head_Skin')!
    const expected = movedPositions(base, base.headSkin.primitive, moves)
    const values = head.attributes.POSITION!.values
    for (let i = 0; i < values.length; i += 3 * 37) {
      const [x, y, z] = transformPoint4(base.packing, values[i]!, values[i + 1]!, values[i + 2]!)
      expect(Math.abs(x - expected[i]!)).toBeLessThan(5e-5)
      expect(Math.abs(y - expected[i + 1]!)).toBeLessThan(5e-5)
      expect(Math.abs(z - expected[i + 2]!)).toBeLessThan(5e-5)
    }
  })

  test('with no WebP picture left, the file needs no WebP', () => {
    const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 7]), mimeType: 'image/jpeg' }
    const names = base.glb.json.images.map((image: { name: string }) => image.name)
    const out = buildAvatarGlb(
      base,
      new Float64Array(base.basemesh.length),
      new Map(names.map((name: string) => [name, jpeg])),
      { dropBrows: false },
    )
    const { json } = parseGlb(out)
    expect(json.extensionsUsed).not.toContain('EXT_texture_webp')
    expect(json.extensionsRequired).not.toContain('EXT_texture_webp')
    for (const texture of json.textures)
      expect(json.images[texture.source].mimeType).toBe('image/jpeg')
  })

  test('no moves write the base body’s shape again', async () => {
    const out = buildAvatarGlb(base, new Float64Array(base.basemesh.length), new Map(), {
      dropBrows: false,
    })
    const { positions } = await writtenPositions(out, base.headSkin.primitive)
    const rest = base.headSkin.mesh.positions
    for (let i = 0; i < positions.length; i++)
      expect(Math.abs(positions[i]! - rest[i]!)).toBeLessThan(1e-6)
  })
})
