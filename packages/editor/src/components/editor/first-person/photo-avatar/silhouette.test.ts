import { describe, expect, test } from 'bun:test'
import { cameraCentre, cameraLookingAt, headRotation, project } from './camera'
import {
  edgeList,
  fillTriangles,
  outerContour,
  sampleField,
  signedDistanceField,
} from './silhouette'

/** A disc of radius `r` about (cx, cy) as a 0/255 mask. */
function disc(width: number, height: number, cx: number, cy: number, r: number) {
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) mask[y * width + x] = 255
    }
  }
  return mask
}

/** A closed sphere (outward triangles) of `radius` about the origin. */
function sphere(radius: number, rings = 24, segments = 48) {
  const positions: number[] = []
  const triangles: number[] = []
  for (let i = 0; i <= rings; i++) {
    const theta = (i / rings) * Math.PI
    for (let j = 0; j < segments; j++) {
      const phi = (j / segments) * 2 * Math.PI
      positions.push(
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(theta),
        radius * Math.sin(theta) * Math.cos(phi),
      )
    }
  }
  const at = (i: number, j: number) => i * segments + (j % segments)
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      triangles.push(at(i, j), at(i + 1, j), at(i + 1, j + 1))
      triangles.push(at(i, j), at(i + 1, j + 1), at(i, j + 1))
    }
  }
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles) }
}

describe('signedDistanceField', () => {
  test('measures the distance to a disc’s edge, negative inside', () => {
    const field = signedDistanceField(disc(100, 100, 50, 50, 20), 100, 100)
    const at = (x: number, y: number) => sampleField(field, 100, 100, x, y)
    // Pixel centres' distances: within a pixel of the true ones.
    expect(Math.abs(at(50, 50)[0] + 20)).toBeLessThan(1.5)
    expect(Math.abs(at(80, 50)[0] - 10)).toBeLessThan(1)
    expect(Math.abs(at(70, 50)[0])).toBeLessThan(1)
    // The gradient points away from the disc.
    const [, gx, gy] = at(80, 50)
    expect(gx).toBeGreaterThan(0.9)
    expect(Math.abs(gy)).toBeLessThan(0.1)
  })

  test('keeps growing past the image', () => {
    const field = signedDistanceField(disc(40, 40, 20, 20, 10), 40, 40)
    expect(sampleField(field, 40, 40, 45, 20)[0]).toBeGreaterThan(
      sampleField(field, 40, 40, 39.5, 20)[0],
    )
  })
})

describe('fillTriangles', () => {
  test('covers the pixels whose centres lie inside', () => {
    const out = new Uint8Array(10 * 10)
    fillTriangles([0, 0, 10, 0, 0, 10], [0, 1, 2], 10, 10, out)
    let count = 0
    for (const v of out) if (v) count++
    // Half the square, give or take its diagonal.
    expect(count).toBeGreaterThanOrEqual(45)
    expect(count).toBeLessThanOrEqual(55)
    expect(out[0]).toBe(255)
    expect(out[99]).toBe(0)
  })
})

describe('outerContour', () => {
  test('finds a sphere’s outline where the camera sees it', () => {
    const radius = 0.1
    const { positions, triangles } = sphere(radius)
    const camera = cameraLookingAt({
      width: 400,
      height: 400,
      rotation: headRotation(0.3),
      target: [0, 0, 0],
      distance: 0.6,
    })
    const n = positions.length / 3
    const xy = new Float64Array(n * 2)
    for (let i = 0; i < n; i++) {
      const [u, v] = project(camera, [
        positions[i * 3]!,
        positions[i * 3 + 1]!,
        positions[i * 3 + 2]!,
      ])
      xy[i * 2] = u
      xy[i * 2 + 1] = v
    }
    const { points } = outerContour(
      positions,
      xy,
      triangles,
      edgeList(triangles),
      cameraCentre(camera),
      400,
      400,
    )
    expect(points.length).toBeGreaterThan(40)
    // A sphere at distance d looks like a disc of radius f r / √(d² − r²).
    const expected = (camera.focal * radius) / Math.sqrt(0.6 ** 2 - radius ** 2)
    for (const p of points) {
      const dx = p.x - 200
      const dy = p.y - 200
      expect(Math.abs(Math.hypot(dx, dy) - expected)).toBeLessThan(2)
      // The normal points outwards.
      expect((p.nx * dx + p.ny * dy) / Math.hypot(dx, dy)).toBeGreaterThan(0.9)
    }
  })
})
