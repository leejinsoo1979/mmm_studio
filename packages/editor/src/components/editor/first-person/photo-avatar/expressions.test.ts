import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBaseForTests } from './__bench__/base-for-tests'
import { type BaseBody, baseMeshMoves, buildAvatarGlb } from './base-body'
import {
  type Expression,
  type ExpressionIndex,
  readExpressions,
  transferExpressions,
} from './expressions'
import { bufferViewBytes, parseGlb, readAccessor, readPrimitives } from './glb'
import { shapePositions } from './head-model'
import { apply3, type Mat3, rotation } from './linalg'

const PUBLIC = join(import.meta.dir, '../../../../../../../apps/editor/public/characters/photoreal')

let base: BaseBody
let expressions: Expression[]

beforeAll(async () => {
  base = await loadBaseForTests('male')
  const bytes = readFileSync(join(PUBLIC, 'mpfb-face-expressions.bin'))
  expressions = readExpressions(
    JSON.parse(readFileSync(join(PUBLIC, 'mpfb-face-expressions.json'), 'utf8')) as ExpressionIndex,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
})

const named = (name: string) => expressions.find((e) => e.name === name)!

/** An expression's deltas on every base mesh vertex. */
function dense(expression: Expression, count: number) {
  const out = new Float32Array(count)
  expression.vertices.forEach((v, i) => {
    for (let k = 0; k < 3; k++) out[v * 3 + k] = expression.deltas[i * 3 + k]!
  })
  return out
}

describe('face expressions', () => {
  test('ship the face’s motion under ARKit’s names', () => {
    const names = expressions.map((e) => e.name)
    for (const name of [
      'jawOpen',
      'mouthSmileLeft',
      'mouthSmileRight',
      'mouthFrownLeft',
      'browInnerUp',
      'browDownLeft',
      'browDownRight',
      'eyeBlinkLeft',
      'eyeBlinkRight',
      'eyeSquintLeft',
    ])
      expect(names).toContain(name)
  })

  test('their blinks are the base body’s own', async () => {
    const views = await bufferViewBytes(base.glb)
    const head = base.primitives[base.headSkin.primitive]!
    const mesh = base.glb.json.meshes[head.mesh]
    const m = base.packing
    for (const name of ['eyeBlinkLeft', 'eyeBlinkRight']) {
      const target = mesh.primitives[head.primitive].targets[mesh.extras.targetNames.indexOf(name)]
      const shipped = readAccessor(base.glb, views, target.POSITION).values
      const ours = dense(named(name), base.basemesh.length)
      const mh = head.attributes._MHVERT!.values
      let worst = 0
      for (let i = 0; i < mh.length; i++) {
        const [x, y, z] = [shipped[i * 3]!, shipped[i * 3 + 1]!, shipped[i * 3 + 2]!]
        const metres = [
          m[0]! * x + m[4]! * y + m[8]! * z,
          m[1]! * x + m[5]! * y + m[9]! * z,
          m[2]! * x + m[6]! * y + m[10]! * z,
        ]
        const v = mh[i]!
        worst = Math.max(
          worst,
          Math.hypot(
            metres[0]! - ours[v * 3]!,
            metres[1]! - ours[v * 3 + 1]!,
            metres[2]! - ours[v * 3 + 2]!,
          ),
        )
      }
      expect(worst * 1000).toBeLessThan(0.1)
    }
  })

  test('a smile on one side moves that side’s corner only (the subject’s left is +x)', () => {
    const side = (expression: Expression) => {
      let left = 0
      let right = 0
      expression.vertices.forEach((v, i) => {
        const x = base.basemesh[v * 3]!
        const move = Math.hypot(...expression.deltas.subarray(i * 3, i * 3 + 3))
        if (x > 0.01) left = Math.max(left, move)
        if (x < -0.01) right = Math.max(right, move)
      })
      return { left: left * 1000, right: right * 1000 }
    }
    const smileLeft = side(named('mouthSmileLeft'))
    expect(smileLeft.left).toBeGreaterThan(5)
    expect(smileLeft.right).toBeLessThan(0.5)
    const smileRight = side(named('mouthSmileRight'))
    expect(smileRight.right).toBeGreaterThan(5)
    expect(smileRight.left).toBeLessThan(0.5)
  })

  test('on an unchanged head they are carried over as they are', () => {
    const carried = transferExpressions(base, new Float64Array(base.basemesh.length), expressions)
    carried.forEach((expression, k) => {
      for (let i = 0; i < expression.deltas.length; i++)
        expect(Math.abs(expression.deltas[i]! - expressions[k]!.deltas[i]!)).toBeLessThan(1e-7)
    })
  })

  test('on a head turned and grown they turn and grow with it', () => {
    const turn: Mat3 = rotation([0.15, -0.3, 0.1])
    const scale = 1.08
    const rest = base.basemesh
    const moves = new Float64Array(rest.length)
    for (let v = 0; v < rest.length / 3; v++) {
      const p = apply3(turn, [rest[v * 3]!, rest[v * 3 + 1]!, rest[v * 3 + 2]!])
      for (let k = 0; k < 3; k++) moves[v * 3 + k] = scale * p[k]! - rest[v * 3 + k]!
    }
    const [jaw] = transferExpressions(base, moves, [named('jawOpen')])
    const source = named('jawOpen')
    let worst = 0
    let largest = 0
    for (let i = 0; i < source.vertices.length; i++) {
      const want = apply3(turn, [
        source.deltas[i * 3]!,
        source.deltas[i * 3 + 1]!,
        source.deltas[i * 3 + 2]!,
      ])
      for (let k = 0; k < 3; k++) {
        worst = Math.max(worst, Math.abs(jaw!.deltas[i * 3 + k]! - scale * want[k]!))
        largest = Math.max(largest, Math.abs(want[k]!))
      }
    }
    expect(largest * 1000).toBeGreaterThan(20)
    expect(worst * 1000).toBeLessThan(0.01)
  })

  test('a fitted avatar’s file carries them on its skin, lashes, teeth and tongue, not its eyeballs', async () => {
    const coefficients = new Float64Array(base.head.targetNames.length)
    coefficients[base.head.targetNames.indexOf('chin-prominent-incr')] = 1
    coefficients[base.head.targetNames.indexOf('nose-scale-depth-incr')] = 1
    const moves = baseMeshMoves(base, shapePositions(base.head, coefficients))
    const carried = transferExpressions(base, moves, expressions)
    const out = parseGlb(
      buildAvatarGlb(base, moves, new Map(), { dropBrows: true, expressions: carried }),
    )
    const views = await bufferViewBytes(out)
    const primitives = await readPrimitives(out)
    const names = carried.map((e) => e.name)
    const jaw = names.indexOf('jawOpen')
    const withTargets = new Set<string>()
    for (const mesh of out.json.meshes) {
      const counts = mesh.primitives.map((p: { targets?: unknown[] }) => p.targets?.length ?? 0)
      // Every primitive of a mesh has the same targets (glTF's rule), named on the mesh.
      expect(new Set(counts).size).toBe(1)
      if (!counts[0]) continue
      withTargets.add(mesh.name)
      expect(mesh.extras.targetNames).toEqual(names)
      expect(mesh.weights).toEqual(names.map(() => 0))
      for (const p of mesh.primitives)
        for (const target of p.targets) {
          const accessor = out.json.accessors[target.POSITION]
          expect(accessor.min).toHaveLength(3)
          expect(accessor.max).toHaveLength(3)
        }
    }
    for (const mesh of ['Body', 'Eyebrows', 'Eyelashes', 'Teeth', 'Tongue'])
      expect(withTargets).toContain(mesh)
    expect(withTargets).not.toContain('Eyes')
    for (const mesh of withTargets) expect(mesh).not.toStartWith('Outfit_')

    // The skin's jaw target is the carried one, packed.
    const head = primitives[base.headSkin.primitive]!
    const target = out.json.meshes[head.mesh].primitives[head.primitive].targets[jaw]
    const packedJaw = readAccessor(out, views, target.POSITION).values
    const want = dense(carried[jaw]!, base.basemesh.length)
    const mh = head.attributes._MHVERT!.values
    const m = base.packing
    let worst = 0
    for (let i = 0; i < mh.length; i++) {
      const [x, y, z] = [packedJaw[i * 3]!, packedJaw[i * 3 + 1]!, packedJaw[i * 3 + 2]!]
      const metres = [
        m[0]! * x + m[4]! * y + m[8]! * z,
        m[1]! * x + m[5]! * y + m[9]! * z,
        m[2]! * x + m[6]! * y + m[10]! * z,
      ]
      for (let k = 0; k < 3; k++)
        worst = Math.max(worst, Math.abs(metres[k]! - want[mh[i]! * 3 + k]!))
    }
    expect(worst * 1000).toBeLessThan(0.001)

    // The lower teeth go down with the jaw, the upper ones stay.
    const teeth = primitives.find((p) => p.meshName === 'Teeth')!
    const teethJaw = readAccessor(
      out,
      views,
      out.json.meshes[teeth.mesh].primitives[teeth.primitive].targets[jaw].POSITION,
    ).values
    let down = 0
    let still = 0
    const count = teethJaw.length / 3
    for (let i = 0; i < count; i++) {
      const y =
        m[1]! * teethJaw[i * 3]! + m[5]! * teethJaw[i * 3 + 1]! + m[9]! * teethJaw[i * 3 + 2]!
      if (y < -0.01) down++
      if (Math.abs(y) < 0.0005) still++
    }
    expect(down / count).toBeGreaterThan(0.3)
    expect(still / count).toBeGreaterThan(0.3)
  })
})
