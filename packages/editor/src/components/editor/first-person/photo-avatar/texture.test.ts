import { describe, expect, test } from 'bun:test'
import { cameraLookingAt, FACING, headRotation } from './camera'
import type { TexelFeatures } from './features'
import { bleed, composite, edgeColour, fillVertexColors, pushPull, surfaceGraph } from './fill'
import {
  blendViews,
  cameraNormal,
  delight,
  delightTogether,
  depthBuffer,
  featherWeights,
  linearToSrgb,
  projectView,
  rasterizeUv,
  type Texels,
  type UvMesh,
  untoneNeutral,
} from './texture'

/**
 * Two squares facing the camera (+z): a near one on the left half of the
 * texture, and a far one behind it on the right half, partly hidden.
 */
function scene(): UvMesh {
  const near = [
    [-0.05, -0.05, 0.02],
    [0.05, -0.05, 0.02],
    [0.05, 0.05, 0.02],
    [-0.05, 0.05, 0.02],
  ]
  const far = [
    [-0.02, -0.05, -0.05],
    [0.12, -0.05, -0.05],
    [0.12, 0.05, -0.05],
    [-0.02, 0.05, -0.05],
  ]
  const uv = (i: number, half: number) => [
    half * 0.5 + (i === 1 || i === 2 ? 0.5 : 0),
    i >= 2 ? 0 : 1,
  ]
  const positions = [...near, ...far].flat()
  const normals = Array.from({ length: 8 }, () => [0, 0, 1]).flat()
  const uvs = [0, 1, 2, 3].flatMap((i) => uv(i, 0)).concat([0, 1, 2, 3].flatMap((i) => uv(i, 1)))
  // Squares two triangles each, wound towards +z.
  const triangles = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]
  return {
    positions: Float64Array.from(positions),
    normals: Float64Array.from(normals),
    uvs: Float64Array.from(uvs),
    triangles: Uint32Array.from(triangles),
  }
}

describe('projecting a photo onto the texture', () => {
  const mesh = scene()
  const size = 64
  const texels = rasterizeUv(mesh, size)
  const width = 200
  const height = 200
  const photo = { width, height, rgb: new Float32Array(width * height * 3).fill(0.5) }
  const texel = (u: number, v: number) => Math.floor(v * size) * size + Math.floor(u * size)
  const plain = (): TexelFeatures => ({
    size,
    eye: new Float32Array(size * size),
    feature: new Float32Array(size * size),
    lips: new Float32Array(size * size),
    brows: new Float32Array(size * size),
    mouth: new Float32Array(size * size),
    around: new Float32Array(size * size),
  })

  test('finds the texels on the mesh, and their place on it', () => {
    const i = texel(0.25, 0.5)
    expect(texels.triangle[i]).toBeGreaterThanOrEqual(0)
    // The middle of the near square's island is the middle of the square.
    expect(texels.position[i * 3]!).toBeCloseTo(0, 2)
    expect(texels.position[i * 3 + 2]!).toBeCloseTo(0.02, 6)
  })

  test('trusts what faces the camera and leaves out what is hidden or turned away', () => {
    const kind = plain()
    const front = cameraLookingAt({
      width,
      height,
      rotation: headRotation(0),
      target: [0, 0, 0],
      distance: 0.5,
    })
    const seen = projectView(texels, kind, photo, front, depthBuffer(mesh, front))
    // The near square, square on: full weight.
    expect(seen.weight[texel(0.25, 0.5)]!).toBeGreaterThan(0.99)
    // The far square behind the near one: hidden.
    expect(seen.weight[texel(0.5 + 0.1, 0.5)]!).toBe(0)
    // Its part past the near one's edge: seen.
    expect(seen.weight[texel(0.95, 0.5)]!).toBeGreaterThan(0.9)

    // Turned 70°: the squares lean away, so they count for less; turned past 90°, not at all.
    const turned = cameraLookingAt({
      width,
      height,
      rotation: headRotation((70 * Math.PI) / 180),
      target: [0, 0, 0],
      distance: 0.5,
    })
    const less = projectView(texels, kind, photo, turned, depthBuffer(mesh, turned))
    expect(less.weight[texel(0.25, 0.5)]!).toBeGreaterThan(0)
    expect(less.weight[texel(0.25, 0.5)]!).toBeLessThan(seen.weight[texel(0.25, 0.5)]!)
    const behind = cameraLookingAt({
      width,
      height,
      rotation: headRotation(Math.PI),
      target: [0, 0, 0],
      distance: 0.5,
    })
    const none = projectView(texels, kind, photo, behind, depthBuffer(mesh, behind))
    expect(none.weight.every((w) => w === 0)).toBe(true)
  })

  test('takes skin only where the photo shows skin, features wherever the person is, eyes never', () => {
    const front = cameraLookingAt({
      width,
      height,
      rotation: headRotation(0),
      target: [0, 0, 0],
      distance: 0.5,
    })
    const depth = depthBuffer(mesh, front)
    const kind = plain()
    const feature = texel(0.2, 0.5)
    const eye = texel(0.3, 0.5)
    kind.feature[feature] = 1
    kind.eye[eye] = 1
    const mask = new Uint8Array(width * height).fill(255)
    const skin = new Uint8Array(width * height)
    const result = projectView(texels, kind, { ...photo, mask, skin }, front, depth)
    expect(result.weight[texel(0.25, 0.25)]!).toBe(0)
    expect(result.weight[feature]!).toBeGreaterThan(0.9)
    expect(result.weight[eye]!).toBe(0)
  })
})

describe('filling what no photo saw', () => {
  /** A strip of quads along x, every vertex its own (no UV seams). */
  function strip(count: number, step: number): UvMesh {
    const positions: number[] = []
    const triangles: number[] = []
    for (let i = 0; i <= count; i++) positions.push(i * step, 0, 0, i * step, step, 0)
    for (let i = 0; i < count; i++) {
      const a = i * 2
      triangles.push(a, a + 2, a + 3, a, a + 3, a + 1)
    }
    const n = positions.length / 3
    return {
      positions: Float64Array.from(positions),
      normals: new Float64Array(n * 3),
      uvs: new Float64Array(n * 2),
      triangles: Uint32Array.from(triangles),
    }
  }

  test('carries the seen colour on, fading to the mean skin with distance', () => {
    const mesh = strip(40, 0.005)
    const n = mesh.positions.length / 3
    const weld = Uint32Array.from({ length: n }, (_, i) => i)
    const color = new Float32Array(n * 3)
    const weight = new Float32Array(n)
    // The first five columns seen, red.
    for (let v = 0; v < 10; v++) {
      weight[v] = 1
      color[v * 3] = 1
    }
    const mean: [number, number, number] = [0.2, 0.2, 0.2]
    const out = fillVertexColors(mesh, weld, color, weight, mean, 0.035)
    // Seen vertices keep their colour.
    expect(out[0]).toBeCloseTo(1, 6)
    expect(out[1]).toBeCloseTo(0, 6)
    // Next to them, nearly the seen colour; far off (20 cm), the mean.
    const at = (column: number) => out[column * 2 * 3]!
    expect(at(6)).toBeGreaterThan(0.6)
    expect(Math.abs(at(40) - 0.2)).toBeLessThan(0.02)
    // Fading all the way.
    for (let c = 6; c < 40; c++) expect(at(c + 1)).toBeLessThanOrEqual(at(c) + 1e-6)
  })

  test("an island's edge colour carries on past its edge, the island kept", () => {
    const size = 32
    const image = new Float32Array(size * size)
    const valid = new Uint8Array(size * size)
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) {
        valid[y * size + x] = 1
        image[y * size + x] = x < 16 ? 1 : 3
      }
    }
    bleed(image, valid, size, 1, 4)
    // Inside: untouched; just outside its left and right edges: their own colours, not a blend.
    expect(image[16 * size + 10]).toBe(1)
    expect(image[16 * size + 20]).toBe(3)
    for (let x = 4; x < 8; x++) expect(image[16 * size + x]).toBeCloseTo(1, 6)
    for (let x = 24; x < 28; x++) expect(image[16 * size + x]).toBeCloseTo(3, 6)
    // Far out, still something between them (push-pull), never empty.
    expect(image[0]!).toBeGreaterThanOrEqual(1)
    expect(image[0]!).toBeLessThanOrEqual(3)
  })

  test('push-pull fills holes from the pixels around them and keeps the rest', () => {
    const size = 8
    const image = new Float32Array(size * size)
    const valid = new Uint8Array(size * size)
    for (let i = 0; i < size * size; i++) {
      const x = i % size
      if (x < 3) {
        valid[i] = 1
        image[i] = 1
      } else if (x > 5) {
        valid[i] = 1
        image[i] = 3
      }
    }
    pushPull(image, valid, size, 1)
    for (let i = 0; i < size * size; i++) {
      const x = i % size
      if (x < 3) expect(image[i]).toBe(1)
      else if (x > 5) expect(image[i]).toBe(3)
      else {
        expect(image[i]).toBeGreaterThanOrEqual(1)
        expect(image[i]).toBeLessThanOrEqual(3)
      }
    }
  })

  test('push-pull fills a wide hole with a smooth ramp, not blocks', () => {
    const size = 64
    const image = new Float32Array(size * size)
    const valid = new Uint8Array(size * size)
    for (let i = 0; i < size * size; i++) {
      const x = i % size
      if (x < 8 || x >= 56) {
        valid[i] = 1
        image[i] = x < 8 ? 0 : 1
      }
    }
    pushPull(image, valid, size, 1)
    const row = 32 * size
    for (let x = 8; x < 56; x++) {
      expect(image[row + x + 1]! - image[row + x]!).toBeGreaterThan(-0.02)
      expect(Math.abs(image[row + x + 1]! - image[row + x]!)).toBeLessThan(0.12)
    }
  })

  test('the skin the photos saw at its edge is the colour the unseen skin carries on from', () => {
    const side = 30
    const positions: number[] = []
    const triangles: number[] = []
    for (let r = 0; r < side; r++)
      for (let c = 0; c < side; c++) positions.push(c * 0.005, r * 0.005, 0)
    for (let r = 0; r < side - 1; r++) {
      for (let c = 0; c < side - 1; c++) {
        const a = r * side + c
        triangles.push(a, a + 1, a + side + 1, a, a + side + 1, a + side)
      }
    }
    const n = side * side
    const mesh: UvMesh = {
      positions: Float64Array.from(positions),
      normals: new Float64Array(n * 3),
      uvs: new Float64Array(n * 2),
      triangles: Uint32Array.from(triangles),
    }
    const graph = surfaceGraph(
      mesh,
      Uint32Array.from({ length: n }, (_, i) => i),
    )
    const color = new Float32Array(n * 3)
    const weight = new Float32Array(n)
    // Seen on the left half: a red middle, a paler border beside what was not seen.
    for (let v = 0; v < n; v++) {
      const c = v % side
      if (c >= 15) continue
      weight[v] = 1
      color.set(c === 14 ? [0.6, 0.4, 0.3] : [0.5, 0.2, 0.15], v * 3)
    }
    const edge = edgeColour(graph, color, weight)
    expect(edge).not.toBeNull()
    expect(edge![0]).toBeCloseTo(0.6, 5)
    expect(edge![1]).toBeCloseTo(0.4, 5)
    expect(edgeColour(graph, color, new Float32Array(n).fill(1))).toBeNull()
  })

  test('the gutter between islands carries their edges on, no darker', () => {
    const size = 32
    const base = new Uint8Array(size * size * 4)
    const islands = new Uint8Array(size * size)
    for (let i = 0; i < size * size; i++) {
      base[i * 4 + 3] = 255
      if (i % size >= 16) continue
      islands[i] = 1
      base.fill(150, i * 4, i * 4 + 3)
    }
    const fill = new Float32Array(size * size * 3).fill(0.3)
    const out = composite({
      base,
      size,
      gains: [1, 1, 1],
      photo: new Float32Array(size * size * 3),
      coverage: new Float32Array(size * size),
      fill,
      working: size,
      inner: null,
      plain: null,
      islands,
    })
    const expected = linearToSrgb(0.3)
    for (const x of [10, 15, 16, 17, 20, 30])
      expect(Math.abs(out[(16 * size + x) * 4]! - expected)).toBeLessThanOrEqual(1)
  })
})

/** three's Neutral tone mapping (Khronos PBR Neutral), as the studio draws with it. */
function neutral([r, g, b]: number[]): number[] {
  const start = 0.8 - 0.04
  const low = Math.min(r!, g!, b!)
  const offset = low < 0.08 ? low - 6.25 * low * low : 0.04
  let c = [r! - offset, g! - offset, b! - offset]
  const peak = Math.max(...c)
  if (peak < start) return c
  const d = 1 - start
  const top = 1 - (d * d) / (peak + d - start)
  c = c.map((x) => (x * top) / peak)
  const mixed = 1 - 1 / (0.15 * (peak - top) + 1)
  return c.map((x) => x * (1 - mixed) + top * mixed)
}

describe('taking the light out', () => {
  test('a displayed colour is taken back to the light that made it, dark skin and highlights too', () => {
    for (const colour of [
      [0.05, 0.02, 0.01],
      [0.3, 0.12, 0.06],
      [0.62, 0.35, 0.22],
      [0.95, 0.7, 0.55],
    ]) {
      const shown = Float32Array.from(neutral(colour))
      untoneNeutral(shown)
      for (let k = 0; k < 3; k++) expect(shown[k]!).toBeCloseTo(colour[k]!, 3)
    }
  })

  /** A hemisphere's texels facing the camera (FACING: the head's frame is the camera's). */
  function hemisphere(size: number): Texels {
    const count = size * size
    const normal = new Float32Array(count * 3)
    const triangle = new Int32Array(count).fill(-1)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) / size) * 2 - 1
        const v = ((y + 0.5) / size) * 2 - 1
        if (u * u + v * v > 0.95) continue
        const i = y * size + x
        triangle[i] = 0
        normal.set([u, v, Math.sqrt(1 - u * u - v * v)], i * 3)
      }
    }
    return { size, triangle, position: new Float32Array(count * 3), normal }
  }

  const camera = {
    rotation: FACING,
    translation: [0, 0, 0.5] as [number, number, number],
    focal: 500,
    cx: 100,
    cy: 100,
    width: 200,
    height: 200,
  }

  test('a hard side light is taken out of plain skin, its sharp edge too, its shadow lifted well past 1.7×', () => {
    const size = 64
    const texels = hemisphere(size)
    const features: TexelFeatures = {
      size,
      eye: new Float32Array(size * size),
      feature: new Float32Array(size * size),
      lips: new Float32Array(size * size),
      brows: new Float32Array(size * size),
      mouth: new Float32Array(size * size),
      around: new Float32Array(size * size),
    }
    const albedo = [0.5, 0.3, 0.2]
    const light = [0.8, 0.2, 0.56]
    const color = new Float32Array(size * size * 3)
    const weight = new Float32Array(size * size)
    const lum = (c: Float32Array, i: number) =>
      0.2126 * c[i * 3]! + 0.7152 * c[i * 3 + 1]! + 0.0722 * c[i * 3 + 2]!
    for (let i = 0; i < size * size; i++) {
      if (texels.triangle[i]! < 0) continue
      const n = texels.normal.subarray(i * 3, i * 3 + 3)
      const lit = 0.22 + Math.max(0, n[0]! * light[0]! + n[1]! * light[1]! + n[2]! * light[2]!)
      for (let k = 0; k < 3; k++) color[i * 3 + k] = albedo[k]! * lit
      weight[i] = 1
    }
    const before = Float32Array.from(color)
    const view = { color, weight }
    const { fit } = delight(view, texels, features, camera)
    expect(fit).toBeGreaterThan(0.98)
    const spread = (c: Float32Array) => {
      const values: number[] = []
      for (let i = 0; i < size * size; i++) if (weight[i]) values.push(lum(c, i))
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) / mean
    }
    expect(spread(before)).toBeGreaterThan(0.4)
    expect(spread(color)).toBeLessThan(0.05)
    // The darkest texel (in shadow) was brightened by more than the old 1/0.6 limit.
    let darkest = -1
    for (let i = 0; i < size * size; i++)
      if (weight[i] && (darkest < 0 || lum(before, i) < lum(before, darkest))) darkest = i
    expect(lum(color, darkest) / lum(before, darkest)).toBeGreaterThan(2)
    // The colour's hue is kept.
    expect(color[darkest * 3]! / color[darkest * 3 + 2]!).toBeCloseTo(2.5, 3)
  })

  test('views of one head under one light agree once it is out, whatever their exposure', () => {
    const size = 64
    const texels = hemisphere(size)
    const features: TexelFeatures = {
      size,
      eye: new Float32Array(size * size),
      feature: new Float32Array(size * size),
      lips: new Float32Array(size * size),
      brows: new Float32Array(size * size),
      mouth: new Float32Array(size * size),
      around: new Float32Array(size * size),
    }
    // The head turned 60° for the second photo; the lamp stays where it was beside the camera.
    const c = Math.cos(Math.PI / 3)
    const s = Math.sin(Math.PI / 3)
    const turned = { ...camera, rotation: [c, 0, s, 0, -1, 0, s, 0, -c] as typeof camera.rotation }
    const cameras = [camera, turned]
    const light = [0.7, 0.3, 0.65]
    const exposure = [1, 1.6]
    const albedo = [0.5, 0.3, 0.2]
    const views = cameras.map((one, v) => {
      const color = new Float32Array(size * size * 3)
      const weight = new Float32Array(size * size)
      for (let i = 0; i < size * size; i++) {
        if (texels.triangle[i]! < 0) continue
        const [nx, ny, nz] = cameraNormal(texels, one, i)
        if (nz < 0.3) continue
        const lit = 0.25 + Math.max(0, nx * light[0]! + ny * light[1]! + nz * light[2]!)
        for (let k = 0; k < 3; k++) color[i * 3 + k] = exposure[v]! * albedo[k]! * lit
        weight[i] = 1
      }
      return { color, weight }
    })
    const delit = delightTogether(views, texels, features, cameras)
    expect(delit[1]!.fit).toBeGreaterThan(0.95)
    // Where both saw the skin, they agree; and each is one flat colour.
    const ratios: number[] = []
    const levels: number[][] = [[], []]
    for (let i = 0; i < size * size; i++) {
      for (let v = 0; v < 2; v++) if (views[v]!.weight[i]) levels[v]!.push(views[v]!.color[i * 3]!)
      if (views[0]!.weight[i] && views[1]!.weight[i])
        ratios.push(views[1]!.color[i * 3]! / views[0]!.color[i * 3]!)
    }
    ratios.sort((a, b) => a - b)
    expect(ratios[Math.floor(ratios.length / 2)]!).toBeCloseTo(1, 1)
    for (const list of levels) {
      list.sort((a, b) => a - b)
      expect(
        list[Math.floor(list.length * 0.95)]! / list[Math.floor(list.length * 0.05)]!,
      ).toBeLessThan(1.15)
    }
  })

  test('a view that disagrees with the others counts less in the blend', () => {
    const make = (value: number, w: number) => ({
      color: Float32Array.from([value, value, value]),
      weight: Float32Array.from([w]),
    })
    const blended = blendViews([make(0.5, 1), make(0.52, 1), make(0.15, 1)], 1)
    expect(blended.color[0]!).toBeGreaterThan(0.46)
    expect(blended.weight[0]!).toBe(1)
  })

  test('the squarest view alone does not outvote the others that agree', () => {
    const make = (value: number, w: number) => ({
      color: Float32Array.from([value, value, value]),
      weight: Float32Array.from([w]),
    })
    // A profile sees a brow's tail squarely, past its hairs; three front views see the brow.
    const blended = blendViews(
      [make(0.3, 0.66), make(0.33, 0.67), make(0.25, 0.25), make(1.07, 1)],
      1,
    )
    expect(blended.color[0]!).toBeLessThan(0.4)
    expect(blended.weight[0]!).toBe(1)
  })

  test("a view's weight eases in from its edges, not across the gutter between islands", () => {
    const size = 32
    const triangle = new Int32Array(size * size).fill(-1)
    for (let y = 0; y < size; y++) for (let x = 0; x < 20; x++) triangle[y * size + x] = 0
    const texels: Texels = {
      size,
      triangle,
      position: new Float32Array(size * size * 3),
      normal: new Float32Array(size * size * 3),
    }
    const weight = new Float32Array(size * size)
    // Seen on the island's left part only.
    for (let y = 0; y < size; y++) for (let x = 0; x < 10; x++) weight[y * size + x] = 1
    featherWeights(weight, texels, 3)
    const at = (x: number) => weight[16 * size + x]!
    expect(at(2)).toBe(1)
    expect(at(9)).toBeLessThan(1)
    expect(at(9)).toBeGreaterThan(0.3)
    expect(at(12)).toBe(0)
  })
})
