import { describe, expect, test } from 'bun:test'
import { BufferGeometry, Float32BufferAttribute, Mesh } from 'three'
import { headGeometry } from './head-geometry'

/** A quad facing the viewer (+Z), centred at (x, y), `half` across, at depth z, with its own texture island. */
function quad(x: number, y: number, z: number, half: number, uv: [number, number]) {
  const corners = [
    [x - half, y - half],
    [x + half, y - half],
    [x + half, y + half],
    [x - half, y + half],
  ]
  const order = [0, 1, 2, 0, 2, 3]
  return {
    position: order.flatMap((i) => [corners[i]![0]!, corners[i]![1]!, z]),
    normal: order.flatMap(() => [0, 0, 1]),
    uv: order.flatMap((i) => [uv[0] + (i === 1 || i === 2 ? 0.1 : 0), uv[1] + (i >= 2 ? 0.1 : 0)]),
  }
}

function head() {
  const parts = [
    // The face's skin, the eyeballs a little in front of it, and the mouth's inside.
    quad(0, 1.65, 0.1, 0.1, [0.2, 0.2]),
    quad(-0.035, 1.68, 0.105, 0.012, [0.0, 0.8]),
    quad(0.035, 1.68, 0.105, 0.012, [0.1, 0.8]),
    quad(0, 1.6, 0.09, 0.015, [0.5, 0.8]),
  ]
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      parts.flatMap((p) => p.position),
      3,
    ),
  )
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute(
      parts.flatMap((p) => p.normal),
      3,
    ),
  )
  geometry.setAttribute(
    'uv',
    new Float32BufferAttribute(
      parts.flatMap((p) => p.uv),
      2,
    ),
  )
  return new Mesh(geometry)
}

describe('a head’s geometry', () => {
  test('frames the head in a square front view, y down', () => {
    const { all } = headGeometry(head())
    const xs = all.flatMap((tri) => tri.x)
    const ys = all.flatMap((tri) => tri.y)
    expect(Math.min(...xs)).toBeGreaterThan(0)
    expect(Math.max(...xs)).toBeLessThan(1)
    expect(Math.min(...ys)).toBeGreaterThan(0)
    // The skin's top edge (y 1.75) sits above its bottom edge (1.55): smaller y.
    const skin = all.slice(0, 2).flatMap((tri) => tri.y)
    expect(Math.min(...skin)).toBeLessThan(Math.max(...skin))
    // Centred left to right.
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0.5, 5)
  })

  test('tells the skin from the eyeballs, the image’s left eye first', () => {
    const { all, skin, eyes } = headGeometry(head())
    expect(all).toHaveLength(8)
    expect(skin).toHaveLength(2)
    expect(skin.every((tri) => tri.u[0]! >= 0.2 && tri.u[0]! <= 0.3)).toBe(true)
    expect(eyes).toHaveLength(2)
    const centre = (tris: typeof all) => tris.flatMap((tri) => tri.x).reduce((a, b) => a + b) / 6
    expect(centre(eyes[0]!)).toBeLessThan(0.5)
    expect(centre(eyes[1]!)).toBeGreaterThan(0.5)
  })
})
