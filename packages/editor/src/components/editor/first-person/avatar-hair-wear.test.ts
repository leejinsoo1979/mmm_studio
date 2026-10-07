import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { BufferGeometry, Mesh, Object3D, SkinnedMesh } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { prepareHair, wearHair } from './avatar-hair'
import { applyShape, headOf, type Shaper } from './avatar-shape'
import { type HairLibrary, loadHairLibrary } from './hair-styles'

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

/** Moves the head's points up a little: a stand-in for the face's sliders. */
const lift: Shaper = (mesh) =>
  /_head$/.test(((mesh.userData.lookOriginal ?? mesh.material) as { name: string }).name)
    ? (_point, _i, move) => move.set(0, 0.001, 0)
    : null

describe('a hairstyle worn with the face reshaped', () => {
  test('in any order, puts the head back as it was loaded', async () => {
    const basis = await library()
    const scene = await loadCharacter('Male_Adult_08')
    const head = headOf(scene) as SkinnedMesh
    const loaded = head.geometry as BufferGeometry
    const triangles = loaded.index!.count
    const asLoaded = () => {
      expect(head.geometry).toBe(loaded)
      expect(head.geometry.index!.count).toBe(triangles)
      expect(head.userData.hairOriginal).toBeUndefined()
      expect(head.userData.shapeOriginal).toBeUndefined()
      expect(scene.getObjectByName('hair:scalp')).toBeUndefined()
    }

    // Shaped, then bald, shaped again over it, the hair off, then the shape.
    let unshape = applyShape(scene, [lift])
    let hair = wearHair(scene, null, basis)
    expect(head.geometry.index!.count).toBeLessThan(triangles)
    unshape()
    unshape = applyShape(scene, [lift])
    expect(scene.getObjectByName('hair:scalp')).toBeDefined()
    hair.takeOff()
    unshape()
    asLoaded()

    // Bald, then shaped; the shape off first, then the hair.
    hair = wearHair(scene, null, basis)
    unshape = applyShape(scene, [lift])
    expect((head as Mesh).geometry.index!.count).toBeLessThan(triangles)
    unshape()
    hair.takeOff()
    asLoaded()

    // One style for another while shaped.
    unshape = applyShape(scene, [lift])
    hair = wearHair(scene, null, basis)
    hair.takeOff()
    hair = wearHair(scene, null, basis)
    hair.takeOff()
    unshape()
    asLoaded()
  }, 30000)
})

describe('a head made bald ahead of wearing', () => {
  test('a step at a time between frames, is the one made at once', async () => {
    const basis = await library()
    const scalpOf = (scene: Object3D) =>
      Array.from(
        (scene.getObjectByName('hair:scalp') as Mesh).geometry.getAttribute('position')
          .array as Float32Array,
      )
    const atOnce = await loadCharacter('Female_Adult_08')
    const ahead = await loadCharacter('Female_Adult_08')
    await prepareHair(ahead, basis)
    // Made already: wearing it does no more than put it on.
    const started = performance.now()
    const worn = wearHair(ahead, null, basis)
    const took = performance.now() - started
    const whole = wearHair(atOnce, null, basis)
    expect(scalpOf(ahead)).toEqual(scalpOf(atOnce))
    expect(took).toBeLessThan(100)
    worn.takeOff()
    whole.takeOff()
  }, 60000)
})
