import type { BaseBody } from './base-body'
import type { GlbWriter } from './glb'
import { apply3, type Mat3, similarity, type Vec3 } from './linalg'
import { transformDirection4 } from './mat4'

/**
 * The face's expressions on a photo avatar: MakeHuman's expression units
 * (`mpfb-face-expressions.*`, built by scripts/characters/build-mpfb-expressions.py)
 * named as ARKit's blend shapes — jawOpen, mouthSmileLeft, browInnerUp… —
 * carried onto the fitted head, and written into its file as every moved
 * mesh's morph targets: the skin, and through their bindings the lashes,
 * brows, teeth and tongue, so the lower teeth go down with the jaw.
 */

/** `mpfb-face-expressions.json` as shipped (the deltas are in `mpfb-face-expressions.bin`). */
export type ExpressionIndex = {
  step: number
  expressions: { name: string; offset: number; count: number }[]
}

/** One expression on the base mesh: the vertices it moves and their deltas (xyz, metres). */
export type Expression = { name: string; vertices: Uint16Array; deltas: Float32Array }

export function readExpressions(index: ExpressionIndex, data: ArrayBuffer): Expression[] {
  return index.expressions.map(({ name, offset, count }) => {
    const vertices = new Uint16Array(data.slice(offset, offset + 2 * count))
    const raw = new Int16Array(data.slice(offset + 2 * count, offset + 8 * count))
    const deltas = new Float32Array(raw.length)
    for (let i = 0; i < raw.length; i++) deltas[i] = raw[i]! * index.step
    return { name, vertices, deltas }
  })
}

/** The skin about a vertex (m) whose change of shape its moves follow, and how fast it counts less. */
const NEIGHBOURHOOD = 0.012
const FALLOFF = 0.006
/** Fewer skin points than this about a vertex (the teeth, deep in the mouth) and it looks further. */
const MIN_NEIGHBOURS = 12

/**
 * The expressions carried onto a fitted head (the base mesh moved by
 * `moves`): each moved vertex's delta turned and scaled as the skin about
 * it was by the fit (the similarity that best carries its neighbourhood at
 * rest onto the fitted one), so a jaw that drops on the base drops along
 * the fitted jaw, by the fitted face's size.
 */
export function transferExpressions(
  base: BaseBody,
  moves: Float64Array,
  expressions: readonly Expression[],
): Expression[] {
  const rest = base.basemesh
  const skin = new Uint8Array(rest.length / 3)
  for (const p of base.primitives) {
    const mh = p.attributes._MHVERT?.values
    if (mh) for (const v of mh) skin[v] = 1
  }
  const cell = NEIGHBOURHOOD
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  const grid = new Map<string, number[]>()
  for (let v = 0; v < skin.length; v++) {
    if (!skin[v]) continue
    const k = key(
      Math.floor(rest[v * 3]! / cell),
      Math.floor(rest[v * 3 + 1]! / cell),
      Math.floor(rest[v * 3 + 2]! / cell),
    )
    const list = grid.get(k)
    if (list) list.push(v)
    else grid.set(k, [v])
  }
  const point = (v: number, moved: boolean): Vec3 => [
    rest[v * 3]! + (moved ? moves[v * 3]! : 0),
    rest[v * 3 + 1]! + (moved ? moves[v * 3 + 1]! : 0),
    rest[v * 3 + 2]! + (moved ? moves[v * 3 + 2]! : 0),
  ]
  const linearOf = new Map<number, Mat3>()
  const linear = (v: number): Mat3 => {
    const known = linearOf.get(v)
    if (known) return known
    const centre = point(v, false)
    let reach = NEIGHBOURHOOD
    let from: Vec3[] = []
    let to: Vec3[] = []
    let weights: number[] = []
    while (from.length < MIN_NEIGHBOURS && reach <= 8 * NEIGHBOURHOOD) {
      from = []
      to = []
      weights = []
      const span = Math.ceil(reach / cell)
      const [cx, cy, cz] = centre.map((c) => Math.floor(c / cell))
      for (let dx = -span; dx <= span; dx++)
        for (let dy = -span; dy <= span; dy++)
          for (let dz = -span; dz <= span; dz++) {
            for (const u of grid.get(key(cx! + dx, cy! + dy, cz! + dz)) ?? []) {
              const p = point(u, false)
              const d2 = (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2 + (p[2] - centre[2]) ** 2
              if (d2 > reach * reach) continue
              from.push(p)
              to.push(point(u, true))
              weights.push(Math.exp(-d2 / (2 * (FALLOFF * reach / NEIGHBOURHOOD) ** 2)))
            }
          }
      reach *= 2
    }
    let out: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    if (from.length >= 3) {
      const { scale, rotation } = similarity(from, to, weights)
      out = rotation.map((value) => value * scale) as Mat3
    }
    linearOf.set(v, out)
    return out
  }
  return expressions.map(({ name, vertices, deltas }) => {
    const carried = new Float32Array(deltas.length)
    vertices.forEach((v, i) => {
      const d = apply3(linear(v), [deltas[i * 3]!, deltas[i * 3 + 1]!, deltas[i * 3 + 2]!])
      carried[i * 3] = d[0]
      carried[i * 3 + 1] = d[1]
      carried[i * 3 + 2] = d[2]
    })
    return { name, vertices, deltas: carried }
  })
}

/** Moves smaller than this (m) are left out of a morph target. */
const STILL = 1e-5

/** The eyeballs turn on their bones and never take a face's expression. */
const NO_EXPRESSION = /^Eye_/

/**
 * Writes `expressions` (on the base mesh, metres) as morph targets of every
 * mesh they move: each vertex moving as its base mesh vertex does (the
 * skin) or as its three bound ones do (everything else). The targets are
 * sparse (only the vertices that move are stored) and named in each mesh's
 * `extras.targetNames`; any targets the base carried are replaced.
 */
export function writeExpressionTargets(
  writer: GlbWriter,
  base: BaseBody,
  expressions: readonly Expression[],
) {
  const json = writer.json
  const dense = expressions.map(({ vertices, deltas }) => {
    const out = new Float32Array(base.basemesh.length)
    vertices.forEach((v, i) => {
      out[v * 3] = deltas[i * 3]!
      out[v * 3 + 1] = deltas[i * 3 + 1]!
      out[v * 3 + 2] = deltas[i * 3 + 2]!
    })
    return out
  })
  const byMesh = new Map<number, typeof base.primitives>()
  for (const p of base.primitives) {
    const list = byMesh.get(p.mesh)
    if (list) list.push(p)
    else byMesh.set(p.mesh, [p])
  }
  for (const [mesh, primitives] of byMesh) {
    if (primitives.some((p) => NO_EXPRESSION.test(p.material))) continue
    const targets = primitives.map((p) => dense.map((delta) => primitiveDeltas(p, delta)))
    if (!targets.some((perPrimitive) => perPrimitive.some((t) => t.indices.length))) continue
    primitives.forEach((p, k) => {
      json.meshes[mesh].primitives[p.primitive].targets = targets[k]!.map((t) => ({
        POSITION: writer.addSparseVec3(
          p.attributes.POSITION!.values.length / 3,
          t.indices,
          packed(base, t.values),
        ),
      }))
    })
    json.meshes[mesh].weights = expressions.map(() => 0)
    json.meshes[mesh].extras = {
      ...json.meshes[mesh].extras,
      targetNames: expressions.map((e) => e.name),
    }
  }
}

/** A primitive's vertices that a base mesh delta moves, and by how much (metres). */
function primitiveDeltas(p: BaseBody['primitives'][number], delta: Float32Array) {
  const count = p.attributes.POSITION!.values.length / 3
  const mh = p.attributes._MHVERT?.values
  const ref = p.attributes._MHREF?.values
  const weight = p.attributes._MHW?.values
  const indices: number[] = []
  const values: number[] = []
  for (let i = 0; i < count; i++) {
    let x = 0
    let y = 0
    let z = 0
    if (mh) {
      const v = mh[i]!
      x = delta[v * 3]!
      y = delta[v * 3 + 1]!
      z = delta[v * 3 + 2]!
    } else if (ref && weight) {
      for (let j = 0; j < 3; j++) {
        const v = ref[i * 3 + j]!
        const w = weight[i * 3 + j]!
        x += w * delta[v * 3]!
        y += w * delta[v * 3 + 1]!
        z += w * delta[v * 3 + 2]!
      }
    }
    if (Math.hypot(x, y, z) < STILL) continue
    indices.push(i)
    values.push(x, y, z)
  }
  return { indices: Uint32Array.from(indices), values: Float32Array.from(values) }
}

/** Metres to the file's packed positions (a delta: the packing's linear part only). */
function packed(base: BaseBody, values: Float32Array): Float32Array {
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i += 3) {
    const [x, y, z] = transformDirection4(base.unpacking, values[i]!, values[i + 1]!, values[i + 2]!)
    out[i] = x
    out[i + 1] = y
    out[i + 2] = z
  }
  return out
}
