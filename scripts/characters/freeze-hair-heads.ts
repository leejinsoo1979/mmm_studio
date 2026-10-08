// Freezes the heads the generated-hair tests stand on (see
// packages/editor/src/components/editor/first-person/hair-fixtures.ts):
// for each, what the hair worker is sent (the head, the body cut to the
// neck and shoulders, the bones, the lashes and ears, the own hair cards)
// and the head as hair-base.ts flattens it now.
//
//   bun scripts/characters/freeze-hair-heads.ts
//
// Run it again when the flatten changes on purpose, and look at what moved.
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type BufferAttribute, type Material, Matrix3, type Object3D, type SkinnedMesh, Vector3 } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { avatarGender } from '../../packages/editor/src/components/editor/first-person/avatar-catalog'
import { cardKinds, HAIR, LASH } from '../../packages/editor/src/components/editor/first-person/avatar-hair'
import { earsOf } from '../../packages/editor/src/components/editor/first-person/ear-shape'
import { type BaseInput, flattenHead } from '../../packages/editor/src/components/editor/first-person/hair-base'
import {
  HAIR_HEADS,
  hairHeadFile,
  pack,
  type StoredHairHead,
} from '../../packages/editor/src/components/editor/first-person/hair-fixtures'
import { loadHairLibrary } from '../../packages/editor/src/components/editor/first-person/hair-styles'

const root = resolve(import.meta.dir, '../..')
const charactersDir = join(root, 'apps/editor/public/characters/rocketbox')

/** How far under the head bone (bind units) the body is kept: the neck, the collar and the shoulders' tops. */
const BODY_BELOW = 0.4

async function loadCharacter(id: string): Promise<Object3D> {
  const file = new Uint8Array(await Bun.file(join(charactersDir, `${id}.glb`)).arrayBuffer())
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

function meshOf(scene: Object3D, part: string): SkinnedMesh {
  let found: SkinnedMesh | null = null
  scene.traverse((object) => {
    const mesh = object as SkinnedMesh
    if (mesh.isSkinnedMesh && (mesh.material as Material).name.endsWith(`_${part}`)) found = mesh
  })
  if (!found) throw new Error(`no ${part} mesh`)
  return found
}

function bindArray(mesh: SkinnedMesh, name: 'position' | 'normal') {
  const attribute = mesh.geometry.getAttribute(name)
  const normalMatrix = new Matrix3().getNormalMatrix(mesh.bindMatrix)
  const out = new Float32Array(attribute.count * 3)
  const v = new Vector3()
  for (let i = 0; i < attribute.count; i++) {
    v.fromBufferAttribute(attribute, i)
    if (name === 'position') v.applyMatrix4(mesh.bindMatrix)
    else v.applyMatrix3(normalMatrix)
    v.toArray(out, i * 3)
  }
  return out
}

const flatOf = (attribute: BufferAttribute) =>
  Float32Array.from({ length: attribute.count * attribute.itemSize }, (_, j) =>
    attribute.getComponent(Math.floor(j / attribute.itemSize), j % attribute.itemSize),
  )

/** As the GLB quantised it: 16-bit fractions for positions and UVs, 8-bit for normals and weights. */
const POINT = 1 / 32767
const UV = 1 / 65535
const NORMAL = 1 / 127
const WEIGHT = 1 / 255

const realFetch = globalThis.fetch
globalThis.fetch = (async () =>
  new Response(Bun.file(join(charactersDir, 'hair-styles.json')))) as unknown as typeof fetch
const library = await loadHairLibrary()
globalThis.fetch = realFetch

for (const id of HAIR_HEADS) {
  const scene = await loadCharacter(id)
  const head = meshOf(scene, 'head')
  const body = meshOf(scene, 'body')
  const cards = meshOf(scene, 'opacity')
  const bones = new Map<string, [number, number, number]>()
  head.skeleton.bones.forEach((bone, i) => {
    const p = new Vector3().setFromMatrixPosition(head.skeleton.boneInverses[i]!.clone().invert())
    bones.set(bone.name, [p.x, p.y, p.z])
  })
  const bone = (name: string) => {
    const place = bones.get(`Bip01_${name}`)
    if (!place) throw new Error(`${id}: no ${name}`)
    return place
  }
  const slot = (name: string) => head.skeleton.bones.findIndex((b) => b.name === `Bip01_${name}`)
  const points = bindArray(head, 'position')
  const index = Uint32Array.from(head.geometry.index!.array)

  // The body round the neck, its points renumbered.
  const bodyPoints = bindArray(body, 'position')
  const bodyUv = flatOf(body.geometry.getAttribute('uv') as BufferAttribute)
  const bodyIndex = body.geometry.index!.array
  const lowest = bone('Head')[1] - BODY_BELOW
  const renumber = new Map<number, number>()
  const keptCorners: number[] = []
  for (let t = 0; t < bodyIndex.length; t += 3) {
    const corners = [bodyIndex[t]!, bodyIndex[t + 1]!, bodyIndex[t + 2]!]
    if (!corners.every((i) => bodyPoints[i * 3 + 1]! > lowest)) continue
    for (const i of corners) {
      if (!renumber.has(i)) renumber.set(i, renumber.size)
      keptCorners.push(renumber.get(i)!)
    }
  }
  const olds = [...renumber.keys()]
  const trimmedPoints = Float32Array.from(olds.flatMap((i) => [...bodyPoints.subarray(i * 3, i * 3 + 3)]))
  const trimmedUvs = Float32Array.from(olds.flatMap((i) => [bodyUv[i * 2]!, bodyUv[i * 2 + 1]!]))

  // The lashes' box, and points over the hair cards.
  const cardPoints = bindArray(cards, 'position')
  const cardIndex = cards.geometry.index!.array
  const eyes = [...bone('LEye'), ...bone('REye')]
  const kinds = cardKinds(cardPoints, cardIndex, eyes)
  const lashMin: [number, number, number] = [Infinity, Infinity, Infinity]
  const lashMax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const hairPoints: number[] = []
  let lashes = 0
  for (let t = 0; t < kinds.length; t++) {
    const corners = [0, 1, 2].map((k) => cardIndex[t * 3 + k]!)
    if (kinds[t] === LASH) {
      lashes++
      for (const i of corners) {
        for (let axis = 0; axis < 3; axis++) {
          lashMin[axis] = Math.min(lashMin[axis]!, cardPoints[i * 3 + axis]!)
          lashMax[axis] = Math.max(lashMax[axis]!, cardPoints[i * 3 + axis]!)
        }
      }
    } else if (kinds[t] === HAIR) {
      for (let axis = 0; axis < 3; axis++) {
        hairPoints.push(corners.reduce((sum, i) => sum + cardPoints[i * 3 + axis]!, 0) / 3)
      }
      for (const i of corners) hairPoints.push(...cardPoints.subarray(i * 3, i * 3 + 3))
    }
  }

  // The ears' own points (see ear-shape.ts).
  const earPoints = earsOf(head).flatMap((ear) => ear.points)
  const ears = new Uint8Array(points.length / 3)
  for (let i = 0; i < ears.length; i++) {
    const p = new Vector3().fromArray(points, i * 3)
    ears[i] = earPoints.some((q) => q.distanceToSquared(p) < 1e-8) ? 1 : 0
  }

  const metresPerUnit = (() => {
    const headBone = head.skeleton.bones[slot('Head')]!
    headBone.updateWorldMatrix(true, false)
    const world = headBone.matrixWorld.clone().multiply(head.skeleton.boneInverses[slot('Head')]!)
    return new Vector3().setFromMatrixScale(world).x
  })()

  const skinIndex = flatOf(head.geometry.getAttribute('skinIndex') as BufferAttribute)
  const skinWeight = flatOf(head.geometry.getAttribute('skinWeight') as BufferAttribute)
  const uvs = flatOf(head.geometry.getAttribute('uv') as BufferAttribute)
  const normals = bindArray(head, 'normal')
  const input: BaseInput = {
    avatar: id,
    material: (head.material as Material).name,
    metresPerUnit,
    head: {
      points,
      normals,
      uvs,
      index,
      skinIndex: Uint16Array.from(skinIndex),
      skinWeight,
    },
    body: { points: trimmedPoints, uvs: trimmedUvs, index: Uint32Array.from(keptCorners) },
    cards: hairPoints.length > 0 ? Float32Array.from(hairPoints) : null,
    lashes: lashes > 0 ? { min: lashMin, max: lashMax } : null,
    faceBones: Object.fromEntries(bones),
    bones: {
      head: bone('Head'),
      neck: bone('Neck'),
      spine: bone('Spine'),
      spine2: bone('Spine2'),
      clavicleL: bone('L_Clavicle'),
      clavicleR: bone('R_Clavicle'),
      upperArmL: bone('L_UpperArm'),
      upperArmR: bone('R_UpperArm'),
    },
    boneIndex: {
      head: slot('Head'),
      neck: slot('Neck'),
      spine2: slot('Spine2'),
      clavicleL: slot('L_Clavicle'),
      clavicleR: slot('R_Clavicle'),
    },
    marks: { eyes: [bone('LEye'), bone('REye')], neck: bone('Head')[1], nape: bone('Head')[2] },
    ears: ears.includes(1) ? ears : null,
  }
  const started = performance.now()
  const base = flattenHead(input, library)
  const ms = performance.now() - started
  const moved: number[] = []
  const movedPoints: number[] = []
  for (let i = 0; i < points.length / 3; i++) {
    const p = base.head.points.subarray(i * 3, i * 3 + 3)
    if (p.some((v, axis) => v !== points[i * 3 + axis])) {
      moved.push(i)
      movedPoints.push(...p)
    }
  }
  const keptTriangles = new Set<string>()
  for (let t = 0; t < base.head.index.length; t += 3) {
    keptTriangles.add(`${base.head.index[t]},${base.head.index[t + 1]},${base.head.index[t + 2]}`)
  }
  const dropped: number[] = []
  for (let t = 0; t < index.length / 3; t++) {
    if (!keptTriangles.has(`${index[t * 3]},${index[t * 3 + 1]},${index[t * 3 + 2]}`)) dropped.push(t)
  }
  const stored: StoredHairHead = {
    version: 1,
    avatar: id,
    material: input.material,
    metresPerUnit,
    who: { sex: avatarGender(id) === 'female' ? 'female' : 'male', child: id.includes('Child') },
    head: {
      points: pack(points, 'i16', POINT),
      normals: pack(normals, 'i8', NORMAL),
      uvs: pack(uvs, 'u16', UV),
      index: pack(index, 'u16'),
      skinIndex: pack(skinIndex, 'u8'),
      skinWeight: pack(skinWeight, 'u8', WEIGHT),
    },
    body: {
      points: pack(trimmedPoints, 'i16', POINT),
      uvs: pack(trimmedUvs, 'u16', UV),
      index: pack(keptCorners, 'u16'),
    },
    cards: input.cards && pack(input.cards, 'i16', POINT),
    lashes: input.lashes,
    faceBones: input.faceBones,
    bones: input.bones,
    boneIndex: input.boneIndex,
    marks: input.marks,
    ears: input.ears && pack(input.ears, 'u8'),
    flat: {
      moved: pack(moved, 'u16'),
      points: pack(movedPoints, 'i16', POINT),
      dropped: pack(dropped, 'u16'),
    },
  }
  writeFileSync(hairHeadFile(id), `${JSON.stringify(stored, null, 2)}\n`)
  console.log(
    `${id}: ${points.length / 3} points, ${index.length / 3} triangles; flattened ${moved.length} points, dropped ${dropped.length} triangles in ${ms.toFixed(0)} ms; body ${trimmedPoints.length / 3} points`,
  )
}
