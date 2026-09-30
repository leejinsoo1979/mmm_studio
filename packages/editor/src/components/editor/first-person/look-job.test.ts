import { describe, expect, test } from 'bun:test'
import type { HeadGeometry } from './head-geometry'
import { analyseBody, dressBody } from './look-job'
import {
  type HeadTriangle,
  type Pixels,
  packTriangles,
  type Rgb,
  unpackTriangles,
} from './look-pixels'

const SIZE = 64

/** A texture of bands down it, each a colour: rows [from, to) as fractions. */
function texture(bands: [number, number, Rgb][]): Pixels {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    const band = bands.find(([from, to]) => y / SIZE >= from && y / SIZE < to)
    for (let x = 0; x < SIZE; x++) data.set([...(band?.[2] ?? [0, 0, 0]), 255], (y * SIZE + x) * 4)
  }
  return { data, width: SIZE, height: SIZE }
}

/**
 * A quad (two triangles) of the head: texture rows `v0`–`v1` shown at a spot
 * on the front view (`x`, `y`), facing the front by `n`.
 */
function quad(v0: number, v1: number, x: number, y: number, n = 1): HeadTriangle[] {
  const corner = (u: number, v: number, dx: number, dy: number) => ({ u, v, x: x + dx, y: y + dy })
  const corners = [
    corner(0.1, v0, -0.02, -0.02),
    corner(0.9, v0, 0.02, -0.02),
    corner(0.9, v1, 0.02, 0.02),
    corner(0.1, v1, -0.02, 0.02),
  ]
  return [
    [0, 1, 2],
    [0, 2, 3],
  ].map((tri) => ({
    u: tri.map((i) => corners[i]!.u),
    v: tri.map((i) => corners[i]!.v),
    x: tri.map((i) => corners[i]!.x),
    y: tri.map((i) => corners[i]!.y),
    z: [0, 0, 0],
    n: [n, n, n],
  }))
}

const SKIN: Rgb = [200, 150, 120]
const HAIR: Rgb = [40, 30, 25]
const IRIS: Rgb = [60, 40, 30]

/**
 * A head texture: the crown's rows (hair, or skin when bald), the cheek's
 * (skin), a jaw painted hair-dark (a shadow), and an eyeball's (iris).
 */
function head(crown: Rgb) {
  const pixels = texture([
    [0, 0.25, crown],
    [0.25, 0.5, SKIN],
    [0.5, 0.75, HAIR],
    [0.75, 1, IRIS],
  ])
  const crownQuad = quad(0.02, 0.23, 0.5, 0.07)
  const cheek = quad(0.27, 0.48, 0.5, 0.62)
  const jaw = quad(0.52, 0.73, 0.4, 0.7)
  const eye = quad(0.77, 0.98, 0.4, 0.42)
  const geometry: HeadGeometry = {
    all: [...crownQuad, ...cheek, ...jaw, ...eye],
    skin: [...crownQuad, ...cheek, ...jaw],
    eyes: [eye, []],
  }
  return { pixels, geometry }
}

const body = () => texture([[0, 1, SKIN]])
const at = (mask: Float32Array, v: number) => mask[Math.floor(v * SIZE) * SIZE + SIZE / 2]!

describe('a body’s analysis', () => {
  test('a head painted with hair: the crown is hair, not the face below the eyes nor the eyeball', () => {
    const { pixels, geometry } = head(HAIR)
    const analysis = analyseBody(pixels, body(), null, geometry)
    expect(at(analysis.hairMask, 0.12)).toBeGreaterThan(0.9)
    expect(at(analysis.hairMask, 0.37)).toBe(0)
    // The jaw, as dark as the hair, is still no hair: it lies below the eyes.
    expect(at(analysis.hairMask, 0.62)).toBe(0)
    expect(at(analysis.hairMask, 0.87)).toBe(0)
  })

  test('a bald head has no hair to dye', () => {
    const { pixels, geometry } = head([205, 152, 124])
    const analysis = analyseBody(pixels, body(), null, geometry)
    expect(analysis.hairMask.every((value) => value === 0)).toBe(true)
    const dressed = dressBody(
      analysis,
      { key: 'bald', avatar: 'bald', hair: '#3050e0', skin: null, face: null },
      null,
    )
    // Dyeing the hair blue leaves the head as it was.
    expect([...dressed.head!.data]).toEqual([...pixels.data])
  })
})

describe('packed triangles', () => {
  test('come back as they went', () => {
    const triangles = [...quad(0.1, 0.4, 0.3, 0.6, 0.8), ...quad(0.5, 0.9, 0.7, 0.2, -0.3)]
    const back = unpackTriangles(packTriangles(triangles))
    expect(back).toHaveLength(triangles.length)
    back.forEach((tri, t) => {
      for (const field of ['u', 'v', 'x', 'y', 'z', 'n'] as const) {
        tri[field].forEach((value, c) => expect(value).toBeCloseTo(triangles[t]![field][c]!, 5))
      }
    })
  })
})
