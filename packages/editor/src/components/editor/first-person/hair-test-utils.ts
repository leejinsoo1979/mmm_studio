import { join } from 'node:path'
import type { Object3D } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type HAIR_HEADS, type HairHead, readHairHead, type StoredHairHead } from './hair-fixtures'

/** Where a frozen head is kept (see hair-fixtures.ts). Bun only: for the tests and the script that writes them. */
export const hairHeadFile = (id: string) => join(import.meta.dir, 'hair-fixtures', `${id}.json`)

export async function loadHairHead(id: (typeof HAIR_HEADS)[number]): Promise<HairHead> {
  return readHairHead((await Bun.file(hairHeadFile(id)).json()) as StoredHairHead)
}

const ROCKETBOX = join(import.meta.dir, '../../../../../../apps/editor/public/characters/rocketbox')

/** A character's scene as shipped, without its pictures (bun has no decoder for them). */
export async function loadCharacterScene(id: string): Promise<Object3D> {
  const file = new Uint8Array(await Bun.file(join(ROCKETBOX, `${id}.glb`)).arrayBuffer())
  const view = new DataView(file.buffer)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + jsonLength)))
  for (const key of ['textures', 'images', 'samplers']) delete json[key]
  const bare = (list: string[] | undefined) => (list ?? []).filter((e) => e !== 'EXT_texture_webp')
  json.extensionsUsed = bare(json.extensionsUsed)
  json.extensionsRequired = bare(json.extensionsRequired)
  for (const material of json.materials ?? []) {
    for (const key of Object.keys(material)) if (key.endsWith('Texture')) delete material[key]
    delete material.pbrMetallicRoughness?.baseColorTexture
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture
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
