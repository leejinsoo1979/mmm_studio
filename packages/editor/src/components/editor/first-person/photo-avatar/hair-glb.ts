import type { AvatarGender } from '../avatar-catalog'
import type { BaseBody } from './base-body'
import { GlbWriter, type GltfJson, parseGlb } from './glb'
import { fitHairPart, type HairPart, type HairStyle, partsFor } from './hair-library'
import type { Rgb } from './hair-paint'
import { vertexNormals } from './head-model'
import { transformPoint4 } from './mat4'
import { linearToSrgb } from './texture'

/**
 * The avatar's file given its hair (see hair-library.ts): the base body's
 * own hair cards replaced by the chosen style's, fitted to the fitted head,
 * on the body's skin and bones — or none at all for a bald head. Pictures
 * come encoded, by the style's file names.
 */

export type DressedPicture = { bytes: Uint8Array; mimeType: string }

/**
 * The material extra (three.js: `material.userData`) naming the colour a
 * photo avatar's hair pictures were toned to (sRGB hex), which a dye is
 * taken against.
 */
export const HAIR_COLOUR = 'hairColour'

const hexOf = (colour: Rgb) =>
  `#${colour.map((c) => Math.round(linearToSrgb(c)).toString(16).padStart(2, '0')).join('')}`

/**
 * Cards within CLOTHES_REACH (m) of the clothes are kept at least
 * OVER_CLOTHES out of them (MakeHuman's long hair lies on the skin, inside a
 * jacket's back), and those lying on them move as the clothes do — fully
 * within CLOTHES_HOLD, not at all past CLOTHES_LET_GO — so a jacket's back
 * and shoulders never come through the hair in any pose. Never as an arm
 * does, though: a raised arm would drag the hair up with it.
 */
const CLOTHES_REACH = 0.03
const OVER_CLOTHES = 0.006
const CLOTHES_PASSES = 6
const CLOTHES_HOLD = 0.012
const CLOTHES_LET_GO = 0.025
const ARM = /Arm|Hand|Thumb|Index|Middle|Ring|Pinky/

/** How a cap under the cards is drawn: cut out of its picture's alpha, from the outside only. */
const CAP_MATERIAL = {
  alphaMode: 'MASK',
  alphaCutoff: 0.35,
  pbrMetallicRoughness: { roughnessFactor: 0.7, metallicFactor: 0 },
}

export function dressHair(
  glb: Uint8Array,
  base: BaseBody,
  {
    style,
    gender,
    basemesh,
    pictures,
    colour,
  }: {
    /** null: bald. */
    style: HairStyle | null
    gender: AvatarGender
    /** Every base mesh vertex where the fitted body has it (metres). */
    basemesh: ArrayLike<number>
    pictures: Map<string, DressedPicture>
    /** The colour (linear) the style's own picture was toned to: kept on its materials, for a dye. */
    colour: Rgb
  },
): Uint8Array {
  const writer = new GlbWriter(parseGlb(glb))
  const json = writer.json
  const hairMesh = json.meshes.findIndex((mesh: GltfJson) => mesh.name === 'Hair')
  if (hairMesh < 0) throw new Error('base body without Hair')
  if (!style) {
    for (const node of json.nodes) {
      if (node.mesh === hairMesh) {
        delete node.mesh
        delete node.skin
      }
    }
    return writer.finish()
  }
  const hairMaterial = json.materials.findIndex((m: GltfJson) => m.name === 'Hair')
  // A style's cards carry no normal map of their own.
  delete json.materials[hairMaterial].normalTexture
  const jointOf = jointIndices(json, style.bones)
  const skinned = skinWeights(base)
  const clothes = clothesOf(base)
  const skinJoints: number[] = json.skins[0].joints
  const arm = skinJoints.map((node) => ARM.test(json.nodes[node].name ?? ''))
  const materials = new Map<string, number>()
  const primitives = partsFor(style, gender).map((part) => {
    const metres = fitHairPart(style, part, basemesh)
    const lying = part.name === 'cards' ? overClothes(metres, clothes) : null
    const count = metres.length / 3
    const normals = vertexNormals(metres, part.indices, count)
    const packed = new Float32Array(metres.length)
    const packedNormals = new Float32Array(metres.length)
    for (let i = 0; i < count; i++) {
      const [x, y, z] = transformPoint4(
        base.unpacking,
        metres[i * 3]!,
        metres[i * 3 + 1]!,
        metres[i * 3 + 2]!,
      )
      packed.set([x, y, z], i * 3)
      // Normals into the packed volume: the packing's linear part, transposed.
      const m = base.packing
      const n = [normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!]
      const nx = m[0]! * n[0]! + m[1]! * n[1]! + m[2]! * n[2]!
      const ny = m[4]! * n[0]! + m[5]! * n[1]! + m[6]! * n[2]!
      const nz = m[8]! * n[0]! + m[9]! * n[1]! + m[10]! * n[2]!
      const length = Math.hypot(nx, ny, nz) || 1
      packedNormals.set([nx / length, ny / length, nz / length], i * 3)
    }
    const { joints, weights } = hairWeights(
      part,
      skinned,
      jointOf,
      lying && { lying, clothes, arm },
    )
    let material = materials.get(part.material)
    if (material === undefined) {
      material = materialFor(writer, part, hairMaterial, pictures.get(part.texture))
      materials.set(part.material, material)
    }
    const thinning = part.alpha ? new Uint8Array(count * 4).fill(255) : null
    if (thinning && part.alpha) for (let i = 0; i < count; i++) thinning[i * 4 + 3] = part.alpha[i]!
    return {
      attributes: {
        ...(thinning ? { COLOR_0: addAccessor(writer, thinning, 'VEC4', 5121, true, 34962) } : {}),
        POSITION: writer.addFloatAccessor(packed, 'VEC3', true),
        NORMAL: writer.addFloatAccessor(packedNormals, 'VEC3', false),
        TEXCOORD_0: addAccessor(writer, part.uvs, 'VEC2', 5126, false, 34962),
        JOINTS_0: addAccessor(writer, joints, 'VEC4', 5121, false, 34962),
        WEIGHTS_0: addAccessor(writer, weights, 'VEC4', 5121, true, 34962),
      },
      indices: addAccessor(
        writer,
        part.indices,
        'SCALAR',
        part.indices instanceof Uint32Array ? 5125 : 5123,
        false,
        34963,
      ),
      material,
    }
  })
  json.meshes[hairMesh] = { name: 'Hair', primitives }
  for (const index of materials.values())
    json.materials[index].extras = { ...json.materials[index].extras, [HAIR_COLOUR]: hexOf(colour) }
  fixWebpSources(json)
  return writer.finish()
}

/** Clothes at rest (metres), with the skin's joints and weights (4 a vertex) where known. */
type Surface = {
  positions: Float32Array
  triangles: Uint32Array
  joints?: ArrayLike<number>
  weights?: ArrayLike<number>
}

/** Where a point lies over the clothes: the nearest triangle, the point's weights on its corners, how far. */
type Lying = { triangle: number; corners: [number, number, number]; distance: number } | null

/** The body's clothes at rest. */
function clothesOf(base: BaseBody): Surface {
  const positions: number[] = []
  const triangles: number[] = []
  const joints: number[] = []
  const weights: number[] = []
  for (const p of base.primitives) {
    if (!p.material.startsWith('Outfit_')) continue
    const offset = positions.length / 3
    const values = p.attributes.POSITION!.values
    for (let i = 0; i < values.length; i += 3)
      positions.push(...transformPoint4(base.packing, values[i]!, values[i + 1]!, values[i + 2]!))
    for (const i of p.indices) triangles.push(offset + i)
    for (const j of p.attributes.JOINTS_0!.values) joints.push(j)
    for (const w of p.attributes.WEIGHTS_0!.values) weights.push(w)
  }
  return {
    positions: Float32Array.from(positions),
    triangles: Uint32Array.from(triangles),
    joints,
    weights,
  }
}

/**
 * Points lying in the clothes, or on them, moved out along the nearest
 * clothes triangle's face (glTF's front faces face out) to OVER_CLOTHES
 * above it; points farther than CLOTHES_REACH from any clothes stay put.
 * Near a fold or a hem a point pushed off one face can land under another,
 * so it is pushed again, a few times over. Returns where each point then
 * lies over the clothes (null: farther than CLOTHES_REACH).
 */
export function overClothes(points: Float32Array, clothes: Surface): Lying[] {
  const cell = CLOTHES_REACH * 1.5
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
  const { positions: p, triangles } = clothes
  const grid = new Map<string, number[]>()
  for (let t = 0; t < triangles.length; t += 3) {
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let k = 0; k < 3; k++)
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a]!, p[triangles[t + k]! * 3 + a]! - CLOTHES_REACH)
        hi[a] = Math.max(hi[a]!, p[triangles[t + k]! * 3 + a]! + CLOTHES_REACH)
      }
    for (let x = Math.floor(lo[0]! / cell); x <= Math.floor(hi[0]! / cell); x++)
      for (let y = Math.floor(lo[1]! / cell); y <= Math.floor(hi[1]! / cell); y++)
        for (let z = Math.floor(lo[2]! / cell); z <= Math.floor(hi[2]! / cell); z++) {
          const k = `${x},${y},${z}`
          const list = grid.get(k)
          if (list) list.push(t)
          else grid.set(k, [t])
        }
  }
  const at = (v: number): [number, number, number] => [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!]
  /** The clothes triangle nearest q within reach: which, q's corner weights on it, its face and the gap. */
  const nearest = (q: [number, number, number]) => {
    let found: {
      triangle: number
      corners: [number, number, number]
      normal: number[]
      gap: number[]
    } | null = null
    let best = CLOTHES_REACH
    for (const t of grid.get(key(...q)) ?? []) {
      const a = at(triangles[t]!)
      const b = at(triangles[t + 1]!)
      const c = at(triangles[t + 2]!)
      const corners = closestOnTriangle(q, a, b, c)
      const gap = [0, 1, 2].map(
        (k) => q[k]! - (corners[0] * a[k]! + corners[1] * b[k]! + corners[2] * c[k]!),
      )
      const distance = Math.hypot(gap[0]!, gap[1]!, gap[2]!)
      if (distance >= best) continue
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const n = [
        u[1]! * w[2]! - u[2]! * w[1]!,
        u[2]! * w[0]! - u[0]! * w[2]!,
        u[0]! * w[1]! - u[1]! * w[0]!,
      ]
      const length = Math.hypot(n[0]!, n[1]!, n[2]!)
      if (length < 1e-12) continue
      best = distance
      found = { triangle: t, corners, normal: n.map((x) => x / length), gap }
    }
    return found
  }
  const point = (i: number): [number, number, number] => [
    points[i]!,
    points[i + 1]!,
    points[i + 2]!,
  ]
  let pending = Array.from({ length: points.length / 3 }, (_, i) => i * 3)
  for (let pass = 0; pass < CLOTHES_PASSES && pending.length; pass++)
    pending = pending.filter((i) => {
      const on = nearest(point(i))
      if (!on) return false
      const { normal, gap } = on
      const lift =
        OVER_CLOTHES - (gap[0]! * normal[0]! + gap[1]! * normal[1]! + gap[2]! * normal[2]!)
      if (lift <= 1e-6) return false
      for (let k = 0; k < 3; k++) points[i + k] = points[i + k]! + normal[k]! * lift
      return true
    })
  return Array.from({ length: points.length / 3 }, (_, i) => {
    const on = nearest(point(i * 3))
    return on && { triangle: on.triangle, corners: on.corners, distance: Math.hypot(...on.gap) }
  })
}

/**
 * The point of triangle abc nearest p, as its weights on a, b and c
 * (Ericson, Real-Time Collision Detection 5.1.5).
 */
function closestOnTriangle(
  p: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): [number, number, number] {
  const sub = (x: number[], y: number[]) => [x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!]
  const dot = (x: number[], y: number[]) => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!
  const ab = sub(b, a)
  const ac = sub(c, a)
  const ap = sub(p, a)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0]
  const bp = sub(p, b)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0]
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3)
    return [1 - t, t, 0]
  }
  const cp = sub(p, c)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1]
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6)
    return [1 - t, 0, t]
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return [0, 1 - t, t]
  }
  const denominator = 1 / (va + vb + vc)
  const v = vb * denominator
  const w = vc * denominator
  return [1 - v - w, v, w]
}

type Bound = { joints: number[]; weights: number[] }

/** Each base mesh vertex the body's skin keeps, with the skin's joints and weights there. */
function skinWeights(base: BaseBody): Map<number, Bound> {
  const out = new Map<number, Bound>()
  for (const p of base.primitives) {
    const mh = p.attributes._MHVERT?.values
    const joints = p.attributes.JOINTS_0?.values
    const weights = p.attributes.WEIGHTS_0?.values
    if (!(mh && joints && weights)) continue
    for (let i = 0; i < mh.length; i++) {
      out.set(mh[i]!, {
        joints: [joints[i * 4]!, joints[i * 4 + 1]!, joints[i * 4 + 2]!, joints[i * 4 + 3]!],
        weights: [weights[i * 4]!, weights[i * 4 + 1]!, weights[i * 4 + 2]!, weights[i * 4 + 3]!],
      })
    }
  }
  return out
}

/**
 * A part's bones: where all a vertex's base mesh vertices are on the body's
 * skin, the skin's own joints and weights blended as the vertex is bound
 * (so hair on the scalp moves exactly as the scalp does and never sinks into
 * it, in any pose); elsewhere (long hair over clothed shoulders) the style's
 * own, from the rig's weights, turning into the clothes' own where the hair
 * lies on them (see CLOTHES_HOLD).
 */
function hairWeights(
  part: HairPart,
  skinned: Map<number, Bound>,
  jointOf: number[],
  over: { lying: Lying[]; clothes: Surface; arm: boolean[] } | null,
) {
  const count = part.refs.length / 3
  const joints = new Uint8Array(count * 4)
  const weights = new Uint8Array(count * 4)
  const write = (i: number, sum: Map<number, number>) => {
    const top = [...sum].sort((a, b) => b[1] - a[1]).slice(0, 4)
    const kept = top.reduce((s, [, w]) => s + w, 0)
    let left = 255
    top.forEach(([joint, w], j) => {
      const q = j === top.length - 1 ? left : Math.round((255 * w) / kept)
      joints[i * 4 + j] = joint
      weights[i * 4 + j] = q
      left -= q
    })
  }
  for (let i = 0; i < count; i++) {
    const sum = new Map<number, number>()
    const add = (joint: number, w: number) => sum.set(joint, (sum.get(joint) ?? 0) + w)
    let found = true
    let total = 0
    for (let k = 0; k < 3 && found; k++) {
      const w = Math.max(0, part.weights[i * 3 + k]!)
      if (w < 1e-3) continue
      const bound = skinned.get(part.refs[i * 3 + k]!)
      if (!bound) found = false
      else
        bound.joints.forEach((joint, j) => {
          add(joint, w * bound.weights[j]!)
          total += w * bound.weights[j]!
        })
    }
    if (found && total > 0) {
      write(i, sum)
      continue
    }
    sum.clear()
    for (let j = 0; j < 4; j++)
      add(jointOf[part.joints[i * 4 + j]!]!, part.jointWeights[i * 4 + j]! / 255)
    const on = over?.lying[i]
    const share = on
      ? Math.min(1, Math.max(0, (CLOTHES_LET_GO - on.distance) / (CLOTHES_LET_GO - CLOTHES_HOLD)))
      : 0
    const { clothes, arm } = over ?? {}
    if (on && share > 0 && clothes?.joints && clothes.weights && arm) {
      const held = new Map<number, number>()
      let heldTotal = 0
      on.corners.forEach((corner, k) => {
        const v = clothes.triangles[on.triangle + k]!
        for (let j = 0; j < 4; j++) {
          const joint = clothes.joints![v * 4 + j]!
          const w = corner * clothes.weights![v * 4 + j]!
          if (w <= 0 || arm[joint]) continue
          held.set(joint, (held.get(joint) ?? 0) + w)
          heldTotal += w
        }
      })
      if (heldTotal > 0) {
        for (const [joint, w] of sum) sum.set(joint, w * (1 - share))
        for (const [joint, w] of held) add(joint, (w / heldTotal) * share)
      }
    }
    write(i, sum)
  }
  return { joints, weights }
}

/** Each of the style's bones as the body's skin indexes its joints (by node name). */
function jointIndices(json: GltfJson, bones: string[]): number[] {
  const joints: number[] = json.skins[0].joints
  return bones.map((bone) => {
    const index = joints.findIndex((node) => json.nodes[node].name === bone)
    if (index < 0) throw new Error(`base body without the ${bone} bone`)
    return index
  })
}

/**
 * The material a part is drawn with: the body's own Hair material with its
 * picture replaced by the style's, or a cap material made beside it.
 */
function materialFor(
  writer: GlbWriter,
  part: HairPart,
  hairMaterial: number,
  picture: DressedPicture | undefined,
): number {
  const json = writer.json
  const name = part.material
  if (!picture) throw new Error(`no picture for ${name}`)
  // A cap's picture runs across its edge in v: repeated, its edge would take the dense rows'.
  const cap = part.name.startsWith('cap')
  if (name === 'Hair') {
    const texture = json.materials[hairMaterial].pbrMetallicRoughness.baseColorTexture.index
    const image = imageOf(json.textures[texture])
    writer.replaceImage(image, picture.bytes, picture.mimeType)
    if (cap) json.textures[texture].sampler = edgeSampler(json)
    return hairMaterial
  }
  json.images.push({ name: `${name.toLowerCase()}_color`, mimeType: picture.mimeType })
  writer.replaceImage(json.images.length - 1, picture.bytes, picture.mimeType)
  json.textures.push({
    sampler: cap ? edgeSampler(json) : (json.textures[0]?.sampler ?? 0),
    source: json.images.length - 1,
  })
  json.materials.push({
    name,
    ...structuredClone(CAP_MATERIAL),
    pbrMetallicRoughness: {
      ...CAP_MATERIAL.pbrMetallicRoughness,
      baseColorTexture: { index: json.textures.length - 1 },
    },
  })
  return json.materials.length - 1
}

/** A sampler repeating across u (round the head) and clamped in v; its index (made once). */
function edgeSampler(json: GltfJson): number {
  const sampler = { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 33071 }
  json.samplers ??= []
  const found = json.samplers.findIndex(
    (s: GltfJson) => JSON.stringify(s) === JSON.stringify(sampler),
  )
  if (found >= 0) return found
  json.samplers.push(sampler)
  return json.samplers.length - 1
}

const imageOf = (texture: GltfJson): number =>
  texture.extensions?.EXT_texture_webp?.source ?? texture.source

/**
 * Textures naming a picture through EXT_texture_webp that is not WebP (a
 * browser that can't write WebP, as Safari's canvas can't) name it plainly
 * instead, so the file stays valid glTF; the extension stays required only
 * while some texture still uses it.
 */
function fixWebpSources(json: GltfJson) {
  let webp = false
  for (const texture of json.textures ?? []) {
    const source = texture.extensions?.EXT_texture_webp?.source
    if (source === undefined) continue
    if (json.images[source]?.mimeType === 'image/webp') {
      webp = true
      continue
    }
    texture.source = source
    delete texture.extensions.EXT_texture_webp
    if (Object.keys(texture.extensions).length === 0) delete texture.extensions
  }
  if (!webp) {
    json.extensionsRequired = (json.extensionsRequired ?? []).filter(
      (name: string) => name !== 'EXT_texture_webp',
    )
    json.extensionsUsed = (json.extensionsUsed ?? []).filter(
      (name: string) => name !== 'EXT_texture_webp',
    )
  }
}

/** Appends an accessor over `values` as they are typed; its index. */
function addAccessor(
  writer: GlbWriter,
  values: Float32Array | Uint8Array | Uint16Array | Uint32Array,
  type: 'SCALAR' | 'VEC2' | 'VEC4',
  componentType: number,
  normalized: boolean,
  target: number,
): number {
  const width = { SCALAR: 1, VEC2: 2, VEC4: 4 }[type]
  const view = writer.addView(
    new Uint8Array(values.buffer, values.byteOffset, values.byteLength).slice(),
    target,
  )
  const accessor: GltfJson = { bufferView: view, componentType, count: values.length / width, type }
  if (normalized) accessor.normalized = true
  if (type === 'SCALAR') {
    let max = 0
    for (let i = 0; i < values.length; i++) max = Math.max(max, values[i]!)
    accessor.min = [0]
    accessor.max = [max]
  }
  writer.json.accessors.push(accessor)
  return writer.json.accessors.length - 1
}
