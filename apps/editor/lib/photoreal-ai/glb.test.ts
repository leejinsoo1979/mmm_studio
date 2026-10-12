import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Mesh, Object3D, SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { isHumanoidRig, prepareAvatarGlb, readGlb, writeGlb } from './glb'
import { TEST_HEAD_TARGETS, TEST_IMAGE, testAvatarGlb } from './test-glb'

const SHIPPED = join(import.meta.dir, '../../public/characters/photoreal/makehuman-female-01.glb')

async function load(bytes: Uint8Array): Promise<Object3D> {
  const copy = new Uint8Array(bytes)
  const gltf = await new GLTFLoader().parseAsync(copy.buffer, '')
  return gltf.scene
}

describe('prepareAvatarGlb', () => {
  test('keeps only the blink, repacks the buffer, and still loads as a skinned avatar', async () => {
    const input = testAvatarGlb()
    const result = prepareAvatarGlb(input)
    if (!result.ok) throw new Error(result.problem)
    expect(result.trimmed).toBe(true)
    expect(result.before.morphTargets).toEqual([...TEST_HEAD_TARGETS, 'CH', 'DD'])
    expect(result.after.morphTargets).toEqual(['eyeBlinkLeft', 'eyeBlinkRight'])
    expect(result.after.joints).toEqual(['Hips', 'Spine', 'Head'])
    expect(result.bytes.byteLength).toBeLessThan(input.byteLength)

    const read = readGlb(result.bytes)
    if (!read.ok) throw new Error(read.problem)
    const { json, bin } = read
    // 4 + 4 head and teeth attributes (position, joints, weights, indices), 2 kept targets, the matrices.
    expect(json.accessors).toHaveLength(11)
    expect(json.bufferViews).toHaveLength(12)
    expect(json.buffers?.[0]?.byteLength).toBe(bin?.length)
    const image = json.bufferViews![json.images![0]!.bufferView!]!
    expect([...bin!.subarray(image.byteOffset!, image.byteOffset! + image.byteLength)]).toEqual([
      ...TEST_IMAGE,
    ])
    expect(json.meshes?.[1]?.extras).toBeUndefined()
    expect(json.meshes?.[1]?.weights).toBeUndefined()

    const scene = await load(result.bytes)
    const head = scene.getObjectByName('AvatarHead') as SkinnedMesh
    expect(head.isSkinnedMesh).toBe(true)
    expect(Object.keys(head.morphTargetDictionary ?? {})).toEqual(['eyeBlinkLeft', 'eyeBlinkRight'])
    expect(head.geometry.morphAttributes.position).toHaveLength(2)
    // The kept targets are the right ones: eyeBlinkRight was the 4th (z offset 0.03).
    expect(head.geometry.morphAttributes.position![1]!.getZ(0)).toBeCloseTo(0.03)
    const teeth = scene.getObjectByName('AvatarTeethLower') as Mesh
    expect(teeth.morphTargetDictionary).toBeUndefined()
    expect(head.skeleton.bones.map((bone) => bone.name)).toEqual(['Hips', 'Spine', 'Head'])
  })

  test('refuses what is not a self-contained humanoid glTF 2.0 binary', () => {
    expect(prepareAvatarGlb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toEqual({
      ok: false,
      problem: 'not_glb',
    })
    const external = testAvatarGlb({
      edit: (json) => {
        json.images = [{ uri: 'https://example.com/skin.png' }]
      },
    })
    expect(prepareAvatarGlb(external)).toEqual({ ok: false, problem: 'external_resource' })
    const inline = testAvatarGlb({
      edit: (json) => {
        json.buffers![0]!.uri = 'data:application/octet-stream;base64,AAAA'
      },
    })
    expect(prepareAvatarGlb(inline)).toEqual({ ok: false, problem: 'external_resource' })
    const prop = testAvatarGlb({ joints: ['Root', 'Lid', 'Handle'] })
    expect(prepareAvatarGlb(prop)).toEqual({ ok: false, problem: 'not_rigged' })
    const v1 = testAvatarGlb({
      edit: (json) => {
        json.asset = { version: '1.0' }
      },
    })
    expect(prepareAvatarGlb(v1)).toEqual({ ok: false, problem: 'unsupported_version' })
    const cut = testAvatarGlb().subarray(0, 100)
    expect(prepareAvatarGlb(new Uint8Array(cut))).toMatchObject({ ok: false })
  })

  test('keeps a compressed GLB as it came (the shipped meshopt character)', () => {
    const shipped = new Uint8Array(readFileSync(SHIPPED))
    const result = prepareAvatarGlb(shipped)
    if (!result.ok) throw new Error(result.problem)
    expect(result.trimmed).toBe(false)
    expect(result.bytes).toBe(shipped)
    expect(result.before.extensions).toContain('EXT_meshopt_compression')
    expect(isHumanoidRig(result.before.joints)).toBe(true)
  })

  test('a GLB with no blend shapes to drop still repacks cleanly', async () => {
    const plain = testAvatarGlb({ targets: [[], []] })
    const result = prepareAvatarGlb(plain)
    if (!result.ok) throw new Error(result.problem)
    expect(result.after.morphTargets).toEqual([])
    expect(result.bytes.byteLength).toBe(plain.byteLength)
    expect((await load(result.bytes)).getObjectByName('Head')).toBeDefined()
  })
})

describe('isHumanoidRig', () => {
  test('knows the rigs the 실사 set moves', () => {
    expect(isHumanoidRig(['Hips', 'Spine', 'Head'])).toBe(true)
    expect(isHumanoidRig(['mixamorig:Hips', 'mixamorig:Head'])).toBe(true)
    expect(isHumanoidRig(['CC_Base_Hip', 'CC_Base_Pelvis', 'CC_Base_Head'])).toBe(true)
    expect(isHumanoidRig(['pelvis', 'spine_01', 'head'])).toBe(true)
    expect(isHumanoidRig(['Bip01 Pelvis', 'Bip01 Head'])).toBe(true)
    expect(isHumanoidRig(['Root', 'Bone'])).toBe(false)
  })
})

describe('writeGlb', () => {
  test('pads both chunks to four bytes', () => {
    const out = writeGlb({ asset: { version: '2.0' } }, new Uint8Array([1, 2, 3]))
    expect(out.byteLength % 4).toBe(0)
    const read = readGlb(out)
    expect(read.ok && [...read.bin!]).toEqual([1, 2, 3, 0])
  })
})
