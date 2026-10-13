import { type Expression, writeExpressionTargets } from './expressions'
import {
  bufferViewBytes,
  type Glb,
  GlbWriter,
  parseGlb,
  type ReadPrimitive,
  readAccessor,
  readPrimitives,
} from './glb'
import {
  buildHeadModel,
  type FaceTarget,
  type HeadModel,
  type LandmarkMap,
  vertexNormals,
} from './head-model'
import type { Vec3 } from './linalg'
import {
  invert4,
  type Mat4,
  multiply4,
  nodeWorlds,
  transformDirection4,
  transformPoint4,
} from './mat4'
import type { UvMesh } from './texture'

/**
 * A base body (scripts/characters/build-mpfb-base.py) as the photo fit
 * reads and rewrites it: every mesh's vertices tied to MakeHuman's base
 * mesh (the skin by vertex, everything else — eyes, teeth, hair, clothes —
 * by three weighted vertices), so reshaping the base mesh reshapes them all.
 * Positions are packed in one volume for every mesh; `packing` takes them to
 * metres at rest.
 */

/** `mpfb-base-<gender>.json`, the parts the fit reads. */
export type BaseMeta = {
  gender: 'male' | 'female'
  eyeCentres: { Left: Vec3; Right: Vec3 }
  headUV: { textureSize: number; boxes: Record<string, [number, number, number, number]> }
}

export type BaseBody = {
  glb: Glb
  meta: BaseMeta
  primitives: ReadPrimitive[]
  /** Packed position → metres (column-major 4×4), and back. */
  packing: Mat4
  unpacking: Mat4
  /** Every base mesh vertex at rest (xyz, metres). */
  basemesh: Float32Array
  head: HeadModel
  /** The head's skin (Head_Skin) at rest in metres, with its UVs and each vertex's base mesh vertex. */
  headSkin: { primitive: number; mesh: UvMesh; weld: Uint32Array }
}

export type BaseFiles = {
  glb: ArrayBuffer
  basemesh: ArrayBuffer
  meta: BaseMeta
  targets: FaceTarget[]
  landmarks: LandmarkMap
}

export async function readBaseBody(files: BaseFiles): Promise<BaseBody> {
  const glb = parseGlb(files.glb)
  const primitives = await readPrimitives(glb)
  const packing = packingOf(glb, await bufferViewBytes(glb))
  const unpacking = invert4(packing)
  const basemesh = new Float32Array(files.basemesh)
  const skinTriangles: number[] = []
  for (const p of primitives) {
    const mh = p.attributes._MHVERT?.values
    if (!mh) continue
    for (const i of p.indices) skinTriangles.push(mh[i]!)
  }
  const head = buildHeadModel({
    basemesh,
    skinTriangles: Uint32Array.from(skinTriangles),
    targets: files.targets,
    landmarks: files.landmarks,
    eyeCentres: { left: files.meta.eyeCentres.Left, right: files.meta.eyeCentres.Right },
  })
  const index = primitives.findIndex((p) => p.material === 'Head_Skin')
  if (index < 0) throw new Error('base body without Head_Skin')
  const p = primitives[index]!
  const count = p.attributes.POSITION!.values.length / 3
  const positions = unpack(packing, p.attributes.POSITION!.values)
  const uvs = Float32Array.from(p.attributes.TEXCOORD_0!.values)
  const weld = Uint32Array.from(p.attributes._MHVERT!.values)
  const normals = vertexNormals(positions, p.indices, count)
  return {
    glb,
    meta: files.meta,
    primitives,
    packing,
    unpacking,
    basemesh,
    head,
    headSkin: { primitive: index, mesh: { positions, normals, uvs, triangles: p.indices }, weld },
  }
}

/** The matrix taking packed positions to metres at rest: any joint's world matrix × its inverse bind. */
function packingOf(glb: Glb, views: Uint8Array[]): Mat4 {
  const skin = glb.json.skins[0]
  const worlds = nodeWorlds(glb.json.nodes)
  const ibm = readAccessor(glb, views, skin.inverseBindMatrices).values
  return multiply4(worlds[skin.joints[0]]!, ibm.subarray(0, 16))
}

function unpack(packing: Mat4, values: ArrayLike<number>): Float32Array {
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i += 3) {
    const [x, y, z] = transformPoint4(packing, values[i]!, values[i + 1]!, values[i + 2]!)
    out[i] = x
    out[i + 1] = y
    out[i + 2] = z
  }
  return out
}

/**
 * Every base mesh vertex's move (metres) for a fitted head: the region's
 * new positions against its rest, the rest of the body staying put.
 */
export function baseMeshMoves(base: BaseBody, regionPositions: Float64Array): Float64Array {
  const moves = new Float64Array(base.basemesh.length)
  const { vertices, rest } = base.head
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i]!
    for (let k = 0; k < 3; k++) moves[v * 3 + k] = regionPositions[i * 3 + k]! - rest[i * 3 + k]!
  }
  return moves
}

/** How far each vertex of a primitive moves (metres) when the base mesh moves by `moves`. */
export function primitiveMoves(p: ReadPrimitive, moves: Float64Array): Float64Array {
  const count = p.attributes.POSITION!.values.length / 3
  const out = new Float64Array(count * 3)
  const mh = p.attributes._MHVERT?.values
  const ref = p.attributes._MHREF?.values
  const weight = p.attributes._MHW?.values
  for (let i = 0; i < count; i++) {
    if (mh) {
      const v = mh[i]!
      for (let k = 0; k < 3; k++) out[i * 3 + k] = moves[v * 3 + k]!
    } else if (ref && weight) {
      for (let j = 0; j < 3; j++) {
        const v = ref[i * 3 + j]!
        const w = weight[i * 3 + j]!
        for (let k = 0; k < 3; k++) out[i * 3 + k] = out[i * 3 + k]! + w * moves[v * 3 + k]!
      }
    }
  }
  return out
}

/** A primitive's positions at rest (metres) after `moves`. */
export function movedPositions(base: BaseBody, index: number, moves: Float64Array): Float32Array {
  const p = base.primitives[index]!
  const rest = unpack(base.packing, p.attributes.POSITION!.values)
  const delta = primitiveMoves(p, moves)
  for (let i = 0; i < rest.length; i++) rest[i] = rest[i]! + delta[i]!
  return rest
}

export type AvatarImages = Map<string, { bytes: Uint8Array; mimeType: string }>

/**
 * The avatar's GLB: the base body's, with the moved meshes' positions (and
 * the skin's normals) written new, the eyes' bones following the eyes, the
 * pictures in `images` (by image name) replaced, the brow cards dropped
 * when the photos' brows are painted on the skin instead, and, when given,
 * `expressions` (carried onto this head) as its morph targets in place of
 * the base's.
 */
export function buildAvatarGlb(
  base: BaseBody,
  moves: Float64Array,
  images: AvatarImages,
  { dropBrows, expressions }: { dropBrows: boolean; expressions?: readonly Expression[] },
): Uint8Array {
  const writer = new GlbWriter(base.glb)
  const json = writer.json
  // Skin normals from the moved base mesh, so they stay smooth across the UV seams.
  const skinNormals = movedSkinNormals(base, moves)
  const linear = base.unpacking
  const eyeShift: Record<'left' | 'right', { sum: [number, number, number]; count: number }> = {
    left: { sum: [0, 0, 0], count: 0 },
    right: { sum: [0, 0, 0], count: 0 },
  }
  base.primitives.forEach((p, index) => {
    const delta = primitiveMoves(p, moves)
    let moved = false
    for (let i = 0; i < delta.length && !moved; i++) moved = Math.abs(delta[i]!) > 1e-6
    if (!moved) return
    const old = p.attributes.POSITION!.values
    const positions = new Float32Array(old.length)
    for (let i = 0; i < old.length; i += 3) {
      const [dx, dy, dz] = transformDirection4(linear, delta[i]!, delta[i + 1]!, delta[i + 2]!)
      positions[i] = old[i]! + dx
      positions[i + 1] = old[i + 1]! + dy
      positions[i + 2] = old[i + 2]! + dz
    }
    const primitive = json.meshes[p.mesh].primitives[p.primitive]
    primitive.attributes.POSITION = writer.addFloatAccessor(positions, 'VEC3', true)
    const mh = p.attributes._MHVERT?.values
    if (mh) {
      const normals = new Float32Array(old.length)
      for (let i = 0; i < mh.length; i++) {
        const v = mh[i]!
        // Packed space: the inverse of the packing's linear part, on a normal, is its transpose.
        const [x, y, z] = transposeDirection(
          base.packing,
          skinNormals[v * 3]!,
          skinNormals[v * 3 + 1]!,
          skinNormals[v * 3 + 2]!,
        )
        const length = Math.hypot(x, y, z) || 1
        normals[i * 3] = x / length
        normals[i * 3 + 1] = y / length
        normals[i * 3 + 2] = z / length
      }
      primitive.attributes.NORMAL = writer.addFloatAccessor(normals, 'VEC3', false)
    }
    if (p.meshName === 'Eyes') {
      const rest = unpack(base.packing, old)
      for (let i = 0; i < rest.length; i += 3) {
        const side = rest[i]! > 0 ? eyeShift.left : eyeShift.right
        for (let k = 0; k < 3; k++) side.sum[k] = side.sum[k]! + delta[i + k]!
        side.count++
      }
    }
  })
  moveEyeBones(base, writer, eyeShift)
  if (expressions) writeExpressionTargets(writer, base, expressions)
  if (dropBrows) {
    for (const node of json.nodes) {
      if (node.mesh !== undefined && json.meshes[node.mesh].name === 'Eyebrows') {
        delete node.mesh
        delete node.skin
      }
    }
  }
  json.images.forEach((image: { name?: string }, i: number) => {
    const replaced = image.name ? images.get(image.name) : undefined
    if (replaced) writer.replaceImage(i, replaced.bytes, replaced.mimeType)
  })
  return writer.finish()
}

const transposeDirection = (m: Mat4, x: number, y: number, z: number): [number, number, number] => [
  m[0]! * x + m[1]! * y + m[2]! * z,
  m[4]! * x + m[5]! * y + m[6]! * z,
  m[8]! * x + m[9]! * y + m[10]! * z,
]

/** Normals (metres space) of every base mesh vertex after `moves`, from the skin's triangles. */
function movedSkinNormals(base: BaseBody, moves: Float64Array): Float32Array {
  const positions = new Float32Array(base.basemesh.length)
  for (let i = 0; i < positions.length; i++) positions[i] = base.basemesh[i]! + moves[i]!
  const triangles: number[] = []
  for (const p of base.primitives) {
    const mh = p.attributes._MHVERT?.values
    if (!mh) continue
    for (const i of p.indices) triangles.push(mh[i]!)
  }
  return vertexNormals(positions, triangles, positions.length / 3)
}

/**
 * Moves the LeftEye and RightEye bones by their eyes' average move, with
 * new inverse binds so the skin stays where it was put: the eyes then turn
 * about their own centres.
 */
function moveEyeBones(
  base: BaseBody,
  writer: GlbWriter,
  shift: Record<'left' | 'right', { sum: [number, number, number]; count: number }>,
) {
  const json = writer.json
  const skin = json.skins[0]
  const worlds = nodeWorlds(base.glb.json.nodes)
  const parentOf = new Map<number, number>()
  json.nodes.forEach((node: { children?: number[] }, i: number) => {
    for (const child of node.children ?? []) parentOf.set(child, i)
  })
  const matrices = new Float32Array(skin.joints.length * 16)
  let changed = false
  skin.joints.forEach((joint: number, j: number) => {
    const name = json.nodes[joint].name as string
    const side = name === 'LeftEye' ? shift.left : name === 'RightEye' ? shift.right : null
    let world = worlds[joint]!
    if (side?.count) {
      const move = side.sum.map((s) => s / side.count) as [number, number, number]
      if (Math.hypot(...move) > 1e-5) {
        changed = true
        world = Float64Array.from(world)
        world[12] = world[12]! + move[0]
        world[13] = world[13]! + move[1]
        world[14] = world[14]! + move[2]
        const parent = parentOf.get(joint)
        const local = parent === undefined ? world : multiply4(invert4(worlds[parent]!), world)
        json.nodes[joint].translation = [local[12], local[13], local[14]]
      }
    }
    matrices.set(multiply4(invert4(world), base.packing), j * 16)
  })
  if (changed) skin.inverseBindMatrices = writer.addFloatAccessor(matrices, 'MAT4', false)
}
