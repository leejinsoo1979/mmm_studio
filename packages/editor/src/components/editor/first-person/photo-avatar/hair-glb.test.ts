import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBaseForTests } from './__bench__/base-for-tests'
import { buildAvatarGlb } from './base-body'
import { parseGlb, readPrimitives } from './glb'
import { dressHair, overClothes } from './hair-glb'
import { fitHairPart, type HairStyleName, partsFor, readHairStyle } from './hair-library'
import { transformPoint4 } from './mat4'

const HAIR = join(
  import.meta.dir,
  '../../../../../../../apps/editor/public/characters/photoreal/hair',
)
const file = (name: string) => {
  const bytes = readFileSync(join(HAIR, name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function dressed(
  name: HairStyleName | null,
  gender: 'male' | 'female',
  mimeType = 'image/webp',
) {
  const base = await loadBaseForTests(gender)
  const glb = buildAvatarGlb(base, new Float64Array(base.basemesh.length), new Map(), {
    dropBrows: true,
  })
  const style = name ? readHairStyle(file(`${name}.bin`)) : null
  const pictures = new Map(
    [...new Set(style?.parts.map((p) => p.texture) ?? [])].map((f) => [
      f,
      { bytes: new Uint8Array(file(f)), mimeType },
    ]),
  )
  const out = dressHair(glb, base, {
    style,
    gender,
    basemesh: base.basemesh,
    pictures,
    colour: [0.05, 0.03, 0.02],
  })
  return { base, style, out: parseGlb(out) }
}

describe('dressing an avatar in a hair style', () => {
  test('the Hair mesh becomes the style’s cards and cap, on the body’s bones', async () => {
    const { base, style, out } = await dressed('short02', 'male')
    const json = out.json
    const mesh = json.meshes.find((m: { name: string }) => m.name === 'Hair')
    expect(mesh.primitives).toHaveLength(2)
    const materials = mesh.primitives.map(
      (p: { material: number }) => json.materials[p.material].name,
    )
    expect(materials).toEqual(['Hair', 'Hair_Cap'])
    expect(
      json.materials.find((m: { name: string }) => m.name === 'Hair').normalTexture,
    ).toBeUndefined()
    const primitives = (await readPrimitives(out)).filter((p) => p.meshName === 'Hair')
    const parts = partsFor(style!, 'male')
    const joints = json.skins[0].joints.length
    primitives.forEach((p, k) => {
      const want = fitHairPart(style!, parts[k]!, base.basemesh)
      const got = p.attributes.POSITION!.values
      for (let i = 0; i < got.length; i += 3) {
        const at = transformPoint4(base.packing, got[i]!, got[i + 1]!, got[i + 2]!)
        expect(
          Math.hypot(at[0] - want[i]!, at[1] - want[i + 1]!, at[2] - want[i + 2]!),
        ).toBeLessThan(1e-5)
      }
      for (const j of p.attributes.JOINTS_0!.values) expect(j).toBeLessThan(joints)
      // Every vertex's weights sum to one (as bytes, 255), none of them wrapped past a byte.
      const weights = p.attributes.WEIGHTS_0!.values
      for (let i = 0; i < weights.length; i += 4)
        expect(weights[i]! + weights[i + 1]! + weights[i + 2]! + weights[i + 3]!).toBeCloseTo(1, 5)
      const head = json.skins[0].joints.findIndex((n: number) => json.nodes[n].name === 'Head')
      // Hair on the crown follows the head bone.
      let top = 0
      for (let i = 1; i < got.length / 3; i++) if (got[i * 3 + 1]! > got[top * 3 + 1]!) top = i
      expect(p.attributes.JOINTS_0!.values[top * 4]).toBe(head)
    })
    // The pictures are the style's: the hair's own, and the cap's beside it.
    const names = json.images.map((i: { name?: string }) => i.name)
    expect(names).toContain('hair_color')
    expect(names).toContain('hair_cap_color')
    // The cap's picture is clamped across its edge (v), repeated round the head (u).
    const cap = json.materials.find((m: { name: string }) => m.name === 'Hair_Cap')
    const sampler =
      json.samplers[json.textures[cap.pbrMetallicRoughness.baseColorTexture.index].sampler]
    expect([sampler.wrapS, sampler.wrapT]).toEqual([10497, 33071])
    // The short cut's strands thin out down its tapered nape.
    const alpha = primitives[0]!.attributes.COLOR_0!.values
    let least = 1
    for (let i = 3; i < alpha.length; i += 4) least = Math.min(least, alpha[i]!)
    expect(least).toBeLessThan(0.5)
  })

  test('long hair down a jacket’s back lies on it, not in it', async () => {
    const { base, out } = await dressed('long01', 'male')
    const cards = (await readPrimitives(out)).find(
      (p) => p.meshName === 'Hair' && p.material === 'Hair',
    )!
    const values = cards.attributes.POSITION!.values
    const placed = new Float32Array(values.length)
    for (let i = 0; i < values.length; i += 3)
      placed.set(transformPoint4(base.packing, values[i]!, values[i + 1]!, values[i + 2]!), i)
    const positions: number[] = []
    const triangles: number[] = []
    for (const p of base.primitives) {
      if (!p.material.startsWith('Outfit_')) continue
      const offset = positions.length / 3
      const v = p.attributes.POSITION!.values
      for (let i = 0; i < v.length; i += 3)
        positions.push(...transformPoint4(base.packing, v[i]!, v[i + 1]!, v[i + 2]!))
      for (const i of p.indices) triangles.push(offset + i)
    }
    const again = Float32Array.from(placed)
    overClothes(again, {
      positions: Float32Array.from(positions),
      triangles: Uint32Array.from(triangles),
    })
    let moved = 0
    for (let i = 0; i < again.length; i++) moved = Math.max(moved, Math.abs(again[i]! - placed[i]!))
    expect(moved).toBeLessThan(1e-4)
    // Lying on the jacket it moves as the jacket does (its shoulders too), never as an arm.
    const names = out.json.skins[0].joints.map((n: number) => out.json.nodes[n].name as string)
    const used = new Set<string>()
    const joints = cards.attributes.JOINTS_0!.values
    const weights = cards.attributes.WEIGHTS_0!.values
    for (let i = 0; i < joints.length; i++) if (weights[i]! > 0) used.add(names[joints[i]!]!)
    expect([...used].some((name) => /Shoulder/.test(name))).toBe(true)
    expect([...used].filter((name) => /Arm|Hand/.test(name))).toEqual([])
    for (let i = 0; i < weights.length; i += 4)
      expect(weights[i]! + weights[i + 1]! + weights[i + 2]! + weights[i + 3]!).toBeCloseTo(1, 5)
  })

  test('a bald head has no hair mesh drawn', async () => {
    const { out } = await dressed(null, 'female')
    const hair = out.json.meshes.findIndex((m: { name: string }) => m.name === 'Hair')
    expect(out.json.nodes.some((n: { mesh?: number }) => n.mesh === hair)).toBe(false)
  })

  test('pictures a browser could not write as WebP are named plainly (valid glTF for Safari)', async () => {
    const { out } = await dressed('ponytail01', 'female', 'image/png')
    const json = out.json
    for (const texture of json.textures) {
      const webp = texture.extensions?.EXT_texture_webp?.source
      if (webp !== undefined) expect(json.images[webp].mimeType).toBe('image/webp')
      else expect(json.images[texture.source]).toBeDefined()
    }
    const hair = json.images.findIndex((i: { name?: string }) => i.name === 'hair_color')
    expect(json.images[hair].mimeType).toBe('image/png')
    expect(json.textures.some((t: { source?: number }) => t.source === hair)).toBe(true)
  })

  test('hair lying in the clothes is lifted out over them, hair clear of them left be', () => {
    // A jacket's back: one square facing up (+y), 40 cm across.
    const clothes = {
      positions: Float32Array.from([-0.2, 0, -0.2, -0.2, 0, 0.2, 0.2, 0, 0.2, 0.2, 0, -0.2]),
      triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    }
    const points = Float32Array.from([
      ...[0.05, -0.01, 0.1], // 1 cm in
      ...[0, 0.003, 0], // on it
      ...[0.1, 0.02, 0], // clear of it
      ...[0.1, -0.05, 0], // out of reach
    ])
    overClothes(points, clothes)
    expect([...points].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([
      0.05, 0.006, 0.1, 0, 0.006, 0, 0.1, 0.02, 0, 0.1, -0.05, 0,
    ])
  })
})
