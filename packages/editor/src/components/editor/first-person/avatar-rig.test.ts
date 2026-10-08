import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  type InterleavedBufferAttribute,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { takeOffFeet, wearFeet } from './avatar-feet'
import { wearHair } from './avatar-hair'
import { prepareModel, withPlainVertices } from './avatar-rig'
import { applyShape, faceShaper, headOf, type Shaper } from './avatar-shape'
import { bodyShaper } from './body-shape'
import { earShaper } from './ear-shape'
import { DEFAULT_FACE_SHAPE, faceShapeField } from './face-shape'
import type { FittedFeet } from './feet-job'
import { type HairLibrary, loadHairLibrary } from './hair-styles'
import { headFrame } from './head-geometry'

const ROCKETBOX = join(import.meta.dir, '../../../../../../apps/editor/public/characters/rocketbox')

/** A character's scene as shipped, without its pictures (no decoder for them here). */
async function loadCharacter(id: string): Promise<Object3D> {
  const file = new Uint8Array(await Bun.file(join(ROCKETBOX, `${id}.glb`)).arrayBuffer())
  const view = new DataView(file.buffer)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + jsonLength)))
  for (const key of ['textures', 'images', 'samplers']) delete json[key]
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e: string) => e !== 'EXT_texture_webp')
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(
    (e: string) => e !== 'EXT_texture_webp',
  )
  for (const material of json.materials ?? []) {
    for (const key of Object.keys(material)) if (key.endsWith('Texture')) delete material[key]
    if (material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture
      delete material.pbrMetallicRoughness.metallicRoughnessTexture
    }
    delete material.extensions
  }
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const jsonBytes = new TextEncoder().encode(text)
  const rest = file.subarray(20 + jsonLength)
  const out = new Uint8Array(20 + jsonBytes.length + rest.length)
  const o = new DataView(out.buffer)
  o.setUint32(0, 0x46546c67, true)
  o.setUint32(4, 2, true)
  o.setUint32(8, out.length, true)
  o.setUint32(12, jsonBytes.length, true)
  o.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  out.set(rest, 20 + jsonBytes.length)
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(out.buffer, '')
  gltf.scene.updateMatrixWorld(true)
  return gltf.scene
}

async function library(): Promise<HairLibrary> {
  const real = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(Bun.file(join(ROCKETBOX, 'hair-styles.json')))) as unknown as typeof fetch
  try {
    return await loadHairLibrary()
  } finally {
    globalThis.fetch = real
  }
}

/**
 * How the WebGPU renderer reads an attribute: its format (integers that
 * aren't normalized are widened to 32 bits as they go up) and, interleaved,
 * where it sits in its stride (bytes).
 */
function formatOf(attribute: BufferAttribute | InterleavedBufferAttribute) {
  const array = attribute.array
  const bits = array.BYTES_PER_ELEMENT * 8
  const unsigned =
    array instanceof Uint8Array || array instanceof Uint16Array || array instanceof Uint32Array
  const format =
    array instanceof Float32Array
      ? 'float32'
      : attribute.normalized
        ? `${unsigned ? 'unorm' : 'snorm'}${bits}`
        : unsigned
          ? 'uint32'
          : 'sint32'
  const interleaved = attribute as InterleavedBufferAttribute
  const at = interleaved.isInterleavedBufferAttribute
    ? `@${interleaved.data.stride * array.BYTES_PER_ELEMENT}+${interleaved.offset * array.BYTES_PER_ELEMENT}`
    : ''
  return `${format}x${attribute.itemSize}${at}`
}

/** A geometry's vertex layout as a render pipeline is built for it. */
const layoutOf = (geometry: BufferGeometry) =>
  Object.keys(geometry.attributes)
    .sort()
    .map((name) => `${name}:${formatOf(geometry.attributes[name]!)}`)
    .join(' ')

/** What would draw as shards: points off the bounds, bones it hasn't, weights that don't add up, corners past its points. */
function flaws(mesh: Mesh): string[] {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const found: string[] = []
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (attribute.count !== position.count)
      found.push(`${name} has ${attribute.count} of ${position.count}`)
  }
  for (let i = 0; i < position.count; i++) {
    for (let c = 0; c < 3; c++) {
      const value = position.getComponent(i, c)
      if (!Number.isFinite(value) || Math.abs(value) > 10) {
        found.push(`point ${i} at ${value}`)
        break
      }
    }
  }
  const index = geometry.index
  if (index) {
    for (let i = 0; i < index.count; i++) {
      if (index.getX(i) >= position.count) {
        found.push(`corner ${i} past the points`)
        break
      }
    }
  }
  const skinned = mesh as SkinnedMesh
  const joints = geometry.getAttribute('skinIndex')
  const weights = geometry.getAttribute('skinWeight')
  if (skinned.isSkinnedMesh && joints && weights) {
    const bones = skinned.skeleton.bones.length
    for (let i = 0; i < joints.count; i++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        if (joints.getComponent(i, k) >= bones && weights.getComponent(i, k) > 0) {
          found.push(`point ${i} on bone ${joints.getComponent(i, k)} of ${bones}`)
        }
        sum += weights.getComponent(i, k)
      }
      if (Math.abs(sum - 1) > 0.02) found.push(`point ${i}'s weights add up to ${sum}`)
      if (found.length > 3) break
    }
  }
  return found
}

/** Feet that hide a few of the body's triangles, with a weld and a mesh of their own (a triangle on the root bone). */
function someFeet(body: SkinnedMesh): FittedFeet {
  const hidden = new Int8Array(body.geometry.index!.count / 3).fill(-1)
  hidden.fill(0, 0, 12)
  return {
    key: 'test-feet',
    hidden,
    seam: {
      points: Uint32Array.from([0, 1, 2]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    },
    mesh: {
      positions: new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0, 0.1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      uvs: new Float32Array(6),
      joints: new Uint16Array(12),
      weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
      index: Uint32Array.from([0, 1, 2]),
    },
  }
}

describe('a character’s meshes, as a look changes them', () => {
  test('are given geometries laid out as the one each first showed, and sound', async () => {
    const basis = await library()
    const id = 'Female_Adult_08'
    const model = prepareModel(await loadCharacter(id))
    const head = headOf(model)!
    const targets = (await Bun.file(join(ROCKETBOX, 'face-points.json')).json()) as {
      avatars: Record<string, number[]>
    }
    const shape = {
      ...DEFAULT_FACE_SHAPE,
      sliders: { faceWidth: 0.3, jawWidth: -0.2, earSize: 0.5, earAngle: 0.4 },
    }
    const field = faceShapeField(targets.avatars[id]!, shape, null)!
    const shapers: Shaper[] = [
      faceShaper(field, headFrame(head)),
      bodyShaper({ height: 0.3, sliders: { weight: 0.3, headSize: 0.2, shoulders: 0.2 } })!,
    ]
    // As useAvatarShape makes them: the ears' anew once the head is bald, they follow its skull.
    const withEars = () => [...shapers, earShaper(head, shape)].filter((shaper) => shaper !== null)

    const first = new Map<Mesh, string>()
    const check = (step: string) => {
      model.traverse((object) => {
        const mesh = object as Mesh
        if (!mesh.isMesh) return
        const layout = layoutOf(mesh.geometry)
        if (!first.has(mesh)) first.set(mesh, layout)
        expect(`${step}: ${mesh.name} ${layout}`).toBe(`${step}: ${mesh.name} ${first.get(mesh)}`)
        expect(`${step}: ${mesh.name} ${flaws(mesh).join(', ')}`).toBe(`${step}: ${mesh.name} `)
      })
    }

    check('as loaded')
    let unshape = applyShape(model, withEars())
    check('shaped')
    const hair = wearHair(model, null, basis)
    check('made bald')
    unshape()
    unshape = applyShape(model, withEars())
    check('bald, shaped again')
    const body = model.getObjectByName('Mesh') as SkinnedMesh
    wearFeet(model, body, someFeet(body), null, 'bare')
    check('bare feet')
    unshape()
    unshape = applyShape(model, withEars())
    check('bare feet, shaped again')
    takeOffFeet(model)
    unshape()
    hair.takeOff()
    check('all taken off')
  }, 60000)
})

describe('a loaded geometry with plain vertices', () => {
  test('reads as loaded, is made once, and is the geometry itself when already plain', async () => {
    const scene = await loadCharacter('Male_Adult_02')
    const loaded = (scene.getObjectByName('Mesh') as Mesh).geometry
    const plain = withPlainVertices(loaded)
    expect(plain).not.toBe(loaded)
    expect(withPlainVertices(loaded)).toBe(plain)
    expect(withPlainVertices(plain)).toBe(plain)
    expect(plain.index).toBe(loaded.index)
    for (const name of ['position', 'normal']) {
      const was = loaded.getAttribute(name)
      const now = plain.getAttribute(name)
      expect(formatOf(now)).toBe('float32x3')
      for (let i = 0; i < was.count; i += 97) {
        for (let c = 0; c < 3; c++)
          expect(now.getComponent(i, c)).toBe(Math.fround(was.getComponent(i, c)))
      }
    }
    expect(plain.getAttribute('uv')).toBe(loaded.getAttribute('uv'))
    expect(plain.getAttribute('skinIndex')).toBe(loaded.getAttribute('skinIndex'))
  }, 30000)

  test('keeps the blend shapes', () => {
    const loaded = new BufferGeometry()
    loaded.setAttribute('position', new BufferAttribute(new Int16Array(9), 3, true))
    const smile = new Float32BufferAttribute(new Float32Array(9), 3)
    loaded.morphAttributes.position = [smile]
    loaded.morphTargetsRelative = true
    const plain = withPlainVertices(loaded)
    expect(plain).not.toBe(loaded)
    expect(plain.morphAttributes.position).toEqual([smile])
    expect(plain.morphTargetsRelative).toBe(true)
  })
})
