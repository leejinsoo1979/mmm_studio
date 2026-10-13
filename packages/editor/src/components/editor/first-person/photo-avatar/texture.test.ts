import { describe, expect, test } from 'bun:test'
import { cameraLookingAt, headRotation } from './camera'
import { fillVertexColors, pushPull } from './fill'
import {
  depthBuffer,
  projectView,
  rasterizeUv,
  TEXEL_EYE,
  TEXEL_FEATURE,
  TEXEL_SKIN,
  type UvMesh,
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

  test('finds the texels on the mesh, and their place on it', () => {
    const i = texel(0.25, 0.5)
    expect(texels.triangle[i]).toBeGreaterThanOrEqual(0)
    // The middle of the near square's island is the middle of the square.
    expect(texels.position[i * 3]!).toBeCloseTo(0, 2)
    expect(texels.position[i * 3 + 2]!).toBeCloseTo(0.02, 6)
  })

  test('trusts what faces the camera and leaves out what is hidden or turned away', () => {
    const kind = new Uint8Array(size * size).fill(TEXEL_SKIN)
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
    const kind = new Uint8Array(size * size).fill(TEXEL_SKIN)
    const feature = texel(0.2, 0.5)
    const eye = texel(0.3, 0.5)
    kind[feature] = TEXEL_FEATURE
    kind[eye] = TEXEL_EYE
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
})
