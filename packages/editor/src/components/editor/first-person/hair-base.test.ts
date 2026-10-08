import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { PAINTED, READ, SCALP, SHADED, SKIN_REF } from './bald-head'
import {
  type BaseResult,
  BUMP_MASK,
  earSide,
  flattenHead,
  headFits,
  inUndercutBand,
  newHoles,
  templateAngles,
} from './hair-base'
import { HAIR_HEADS, type HairHead, loadHairHead } from './hair-fixtures'
import { unionHairline } from './hair-groom'
import { hairlineAt, templateFrame } from './hair-scalp'
import { type HairLibrary, loadHairLibrary } from './hair-styles'
import { fitBald, fitSkull, standingOver, standOn } from './head-skull'

const ROCKETBOX = join(import.meta.dir, '../../../../../../apps/editor/public/characters/rocketbox')

export async function hairLibrary(): Promise<HairLibrary> {
  const real = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(Bun.file(join(ROCKETBOX, 'hair-styles.json')))) as unknown as typeof fetch
  try {
    return await loadHairLibrary()
  } finally {
    globalThis.fetch = real
  }
}

let library: HairLibrary
const heads = new Map<string, { head: HairHead; base: BaseResult }>()

beforeAll(async () => {
  library = await hairLibrary()
  for (const id of HAIR_HEADS) {
    const head = await loadHairHead(id)
    heads.set(id, { head, base: flattenHead(head.input, library) })
  }
})

/** Which points flattening may move: those of the head's taken triangles alone. */
function movedPoints(head: HairHead, base: BaseResult) {
  const { points } = head.input.head
  const moved: number[] = []
  for (let i = 0; i < points.length / 3; i++) {
    if ([0, 1, 2].some((axis) => base.head.points[i * 3 + axis] !== points[i * 3 + axis]))
      moved.push(i)
  }
  return moved
}

describe.each([...HAIR_HEADS])('%s flattened', (id) => {
  test('keeps every point, and the kept skin byte for byte', () => {
    const { head, base } = heads.get(id)!
    const { points, index } = head.input.head
    expect(base.head.points.length).toBe(points.length)
    expect(base.head.normals.length).toBe(points.length)
    const flags = library.bald.get(head.input.material)!
    // Points of triangles the own hair never took stay where they were.
    const onSkin = new Uint8Array(points.length / 3)
    for (let t = 0; t < index.length / 3; t++) {
      if (!flags[t]) for (let k = 0; k < 3; k++) onSkin[index[t * 3 + k]!] = 1
    }
    const moved = movedPoints(head, base)
    expect(moved.length).toBeGreaterThan(50)
    // The cut may take a little more than the flags (rims, islands), never
    // move a point the flags left on skin that the cut kept.
    const keptPoint = new Uint8Array(points.length / 3)
    const keptTriangles = new Set<string>()
    for (let t = 0; t < base.head.index.length; t += 3) {
      keptTriangles.add([0, 1, 2].map((k) => base.head.index[t + k]).join())
    }
    for (let t = 0; t < index.length / 3; t++) {
      const corners = [0, 1, 2].map((k) => index[t * 3 + k]!)
      if (!flags[t] && keptTriangles.has(corners.join())) for (const i of corners) keptPoint[i] = 1
    }
    const movedKept = moved.filter((i) => keptPoint[i] && onSkin[i])
    expect(movedKept.length).toBeLessThan(moved.length * 0.2)
  })

  test('stands no more than 6 mm over the cranium, 1.5 mm in the undercut band', () => {
    const { head, base } = heads.get(id)!
    const mm = 0.001 / head.input.metresPerUnit
    const { cranium } = headFits(head.input, library)
    const fitted = fitBald(library.skull, cranium)
    const origin = templateFrame(library.skull).origin
    const moved = movedPoints(head, base)
    const at = Float32Array.from(
      moved.flatMap((i) => [...base.head.points.subarray(i * 3, i * 3 + 3)]),
    )
    const { height } = standingOver(at, fitted)
    let worst = 0
    let worstBand = 0
    moved.forEach((i, k) => {
      const [x, y, z] = base.head.points.subarray(i * 3, i * 3 + 3)
      const [a, e] = templateAngles(cranium, origin, x!, y!, z!)
      if (inUndercutBand(a, e)) worstBand = Math.max(worstBand, height[k]! / mm)
      else worst = Math.max(worst, height[k]! / mm)
    })
    // Heights read off the cranium's nearest points, to a hundredth of a millimetre.
    expect(worst).toBeLessThanOrEqual(6.02)
    expect(worstBand).toBeLessThanOrEqual(1.52)
  })

  test('opens no hole over 2 cm round', () => {
    const { head, base } = heads.get(id)!
    const cm = 0.01 / head.input.metresPerUnit
    const holes = newHoles(head.input.head.points, head.input.head.index, base.head.index)
    expect(Math.max(0, ...holes) / cm).toBeLessThan(2)
  })

  test('leaves no folded triangle off the ears', () => {
    const { head, base } = heads.get(id)!
    const { face, cranium } = headFits(head.input, library)
    const byEar = earSide(
      head.input,
      standingOver(head.input.head.points, fitSkull(library.skull, face)).zone,
    )
    const fitted = fitBald(library.skull, cranium)
    const moved = new Set(movedPoints(head, base))
    const p = base.head.points
    const idx = base.head.index
    const stand = [0, 0, 0, 0, 0]
    let folded = 0
    for (let t = 0; t < idx.length; t += 3) {
      if (![0, 1, 2].some((k) => moved.has(idx[t + k]!))) continue
      if ([0, 1, 2].some((k) => byEar[idx[t + k]!])) continue
      const [a, b, c] = [idx[t]! * 3, idx[t + 1]! * 3, idx[t + 2]! * 3]
      const u = [0, 1, 2].map((k) => p[b + k]! - p[a + k]!)
      const v = [0, 1, 2].map((k) => p[c + k]! - p[a + k]!)
      const n = [
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ]
      const centre = [0, 1, 2].map((k) => (p[a + k]! + p[b + k]! + p[c + k]!) / 3)
      standOn(fitted, centre[0]!, centre[1]!, centre[2]!, stand)
      const facing =
        (n[0]! * stand[1]! + n[1]! * stand[2]! + n[2]! * stand[3]!) / (Math.hypot(...n) || 1)
      if (facing < 0.2) folded++
    }
    expect(folded).toBe(0)
  })

  test('copies each root-layer point its head point skinning exactly', () => {
    const { head, base } = heads.get(id)!
    const { roots } = base
    const n = roots.srcVertex.length
    expect(roots.position.length).toBe(n * 3)
    expect(roots.scalpDir.length).toBe(n * 4)
    expect(roots.comb.length).toBe(n * 3)
    expect(roots.index.length % 3).toBe(0)
    expect(roots.shellStart % 3).toBe(0)
    expect(roots.shellStart).toBeGreaterThan(0)
    expect(roots.index.length).toBeGreaterThan(roots.shellStart)
    for (let v = 0; v < n; v++) {
      const i = roots.srcVertex[v]!
      for (let c = 0; c < 4; c++) {
        expect(roots.skinIndex[v * 4 + c]).toBe(head.input.head.skinIndex[i * 4 + c]!)
        expect(roots.skinWeight[v * 4 + c]).toBe(head.input.head.skinWeight[i * 4 + c]!)
      }
    }
  })

  test('paints well-formed skin only', () => {
    const { base } = heads.get(id)!
    const { paint } = base
    expect(paint.paint.length % PAINTED).toBe(0)
    expect(paint.scalp.length % SCALP).toBe(0)
    expect(paint.kept.length % READ).toBe(0)
    expect(paint.taken.length % READ).toBe(0)
    expect(paint.skin.length % SKIN_REF).toBe(0)
    expect(paint.shadow.length % SHADED).toBe(0)
    expect(paint.scalp.length).toBeGreaterThan(0)
    for (const array of [
      paint.paint,
      paint.scalp,
      paint.kept,
      paint.taken,
      paint.skin,
      paint.shadow,
    ]) {
      expect(array.every(Number.isFinite)).toBe(true)
    }
  })

  test('is the same every time', () => {
    const { head, base } = heads.get(id)!
    const again = flattenHead(head.input, library)
    expect(again.head.points).toEqual(base.head.points)
    expect(again.head.index).toEqual(base.head.index)
    expect(again.roots.position).toEqual(base.roots.position)
  })
})

describe.each([...HAIR_HEADS])('%s flattened, its own hair', (id) => {
  test('stands no more than 6 mm over the cranium anywhere over the hairline, moved or not', () => {
    const { head, base } = heads.get(id)!
    const mm = 0.001 / head.input.metresPerUnit
    const { cranium } = headFits(head.input, library)
    const fitted = fitBald(library.skull, cranium)
    const origin = templateFrame(library.skull).origin
    const flags = library.bald.get(head.input.material)!
    const { index } = head.input.head
    const kept = new Set<string>()
    for (let t = 0; t < base.head.index.length; t += 3) {
      kept.add([0, 1, 2].map((k) => base.head.index[t + k]).join())
    }
    const union = unionHairline()
    const ids = new Set<number>()
    for (let t = 0; t < index.length / 3; t++) {
      const corners = [0, 1, 2].map((k) => index[t * 3 + k]!)
      if (!flags[t] || !kept.has(corners.join())) continue
      for (const i of corners) {
        const [x, y, z] = base.head.points.subarray(i * 3, i * 3 + 3)
        const [a, e] = templateAngles(cranium, origin, x!, y!, z!)
        if (e > hairlineAt(union, a)) ids.add(i)
      }
    }
    expect(ids.size).toBeGreaterThan(100)
    const at = Float32Array.from(
      [...ids].flatMap((i) => [...base.head.points.subarray(i * 3, i * 3 + 3)]),
    )
    const { height } = standingOver(at, fitted)
    expect(Math.max(...height) / mm).toBeLessThanOrEqual(6.02)
  })

  test('grows its root layer up to the ears, fading out over their last millimetres', () => {
    const { head, base } = heads.get(id)!
    const mm = 0.001 / head.input.metresPerUnit
    const { points } = head.input.head
    const ears = head.input.ears!
    const earPoints: number[][] = []
    for (let i = 0; i < ears.length; i++) {
      if (ears[i]) earPoints.push([...points.subarray(i * 3, i * 3 + 3)])
    }
    const { roots } = base
    let reaching = 0
    for (let v = 0; v < roots.shellStart / 3; v++) {
      const i = roots.srcVertex[v]!
      const [x, y, z] = base.head.points.subarray(i * 3, i * 3 + 3)
      const near =
        Math.min(...earPoints.map((q) => Math.hypot(q[0]! - x!, q[1]! - y!, q[2]! - z!))) / mm
      const grows = Math.hypot(...roots.scalpDir.subarray(v * 4, v * 4 + 3))
      expect(grows).toBeLessThanOrEqual(1 + 1e-6)
      if (near < 2) expect(grows).toBeLessThan(2e-3)
      if (near < 10 && grows > 0.05) reaching++
    }
    // Not a bald ring round the ear: roots grow within a centimetre of it.
    expect(reaching).toBeGreaterThan(3)
  })

  test('masks the texels of every flattened and hole-closing triangle for the bumps', () => {
    const { head, base } = heads.get(id)!
    const mask = base.bumpMask!
    expect(mask.length).toBe(BUMP_MASK * BUMP_MASK)
    const { uvs, index } = head.input.head
    const original = new Set<string>()
    for (let t = 0; t < index.length; t += 3)
      original.add([0, 1, 2].map((k) => index[t + k]).join())
    let masked = 0
    let checked = 0
    for (let t = 0; t < base.head.index.length; t += 3) {
      const corners = [0, 1, 2].map((k) => base.head.index[t + k]!)
      const filled = !original.has(corners.join())
      if (!filled) continue
      const u = corners.reduce((sum, i) => sum + uvs[i * 2]!, 0) / 3
      const v = corners.reduce((sum, i) => sum + uvs[i * 2 + 1]!, 0) / 3
      checked++
      if (mask[Math.floor(v * BUMP_MASK) * BUMP_MASK + Math.floor(u * BUMP_MASK)]) masked++
    }
    expect(masked).toBe(checked)
    let set = 0
    for (const texel of mask) set += texel
    // Some, never the whole texture (the face keeps its bumps).
    expect(set).toBeGreaterThan(1000)
    expect(set).toBeLessThan(mask.length / 2)
  })
})
