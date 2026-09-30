import { describe, expect, test } from 'bun:test'
import { NO_PAINT } from './face-paint'
import type { HeadGeometry } from './head-geometry'
import { analyseBody, dressBody, type LookJob } from './look-job'
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

/** Where the eyeball's pupil is on the texture (a square of texels, dark). */
const PUPIL = { x: SIZE / 2, y: Math.floor(0.875 * SIZE), reach: 2 }

/**
 * A head texture: the crown's rows (hair, or skin when bald), the cheek's
 * (skin), a jaw painted hair-dark (a shadow), and an eyeball's (iris, with
 * its pupil).
 */
function head(crown: Rgb) {
  const pixels = texture([
    [0, 0.25, crown],
    [0.25, 0.5, SKIN],
    [0.5, 0.75, HAIR],
    [0.75, 1, IRIS],
  ])
  for (let y = PUPIL.y - PUPIL.reach; y <= PUPIL.y + PUPIL.reach; y++) {
    for (let x = PUPIL.x - PUPIL.reach; x <= PUPIL.x + PUPIL.reach; x++) {
      pixels.data.set([5, 5, 5], (y * SIZE + x) * 4)
    }
  }
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

/** A look with nothing in it but what's given. */
const look = (key: string, change: Partial<Omit<LookJob, 'body'>>) => ({
  key,
  avatar: key,
  hair: null,
  skin: null,
  face: null,
  paint: NO_PAINT,
  bald: false,
  target: null,
  ...change,
})

/** The mean colour of a texture's texels across the middle of some rows (fractions). */
function rows(pixels: Pixels, from: number, to: number): Rgb {
  let [r, g, b, count] = [0, 0, 0, 0]
  for (let y = Math.ceil(from * SIZE); y < to * SIZE; y++) {
    for (let x = Math.ceil(SIZE * 0.2); x < SIZE * 0.8; x++) {
      const p = (y * SIZE + x) * 4
      r += pixels.data[p]!
      g += pixels.data[p + 1]!
      b += pixels.data[p + 2]!
      count++
    }
  }
  return [r / count, g / count, b / count]
}

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
    const dressed = dressBody(analysis, look('bald', { hair: '#3050e0' }), null)
    // Dyeing the hair blue leaves the head as it was.
    expect([...dressed.head!.data]).toEqual([...pixels.data])
  })
})

describe('a body dressed in a look', () => {
  // A shave with the landmarks, and the paint, are face-paint.test.ts's.
  test('a shave waits for the landmarks it is placed by', () => {
    const { pixels, geometry } = head(HAIR)
    const analysis = analyseBody(pixels, body(), null, geometry)
    expect(dressBody(analysis, look('unplaced', { bald: true }), null)).toEqual({})
    // The dyes don't wait.
    const dyed = dressBody(analysis, look('unplaced', { bald: true, hair: '#c03020' }), null).head!
    const [r, g] = rows(dyed, 0.02, 0.2)
    expect(r).toBeGreaterThan(g * 2)
  })

  test('an iris colour goes on without a face photo or landmarks', () => {
    const { pixels, geometry } = head(HAIR)
    const analysis = analyseBody(pixels, body(), null, geometry)
    const blue = dressBody(
      analysis,
      look('iris', { paint: { ...NO_PAINT, eyes: '#3070e0' } }),
      null,
    )
    const p = (PUPIL.y * SIZE + PUPIL.x + PUPIL.reach + 3) * 4
    const [r, , b] = [...blue.head!.data.slice(p, p + 3)]
    expect(b!).toBeGreaterThan(r! * 1.5)
    // The rest of the head is as it was.
    expect(rows(blue.head!, 0.02, 0.73)).toEqual(rows(pixels, 0.02, 0.73))
  })

  test('the paint’s iris colour wins over the face photo’s', () => {
    const { pixels, geometry } = head(HAIR)
    const analysis = analyseBody(pixels, body(), null, geometry)
    const face = { photo: 'photo', points: [], blend: 1, light: 0, eyes: '#20c040' }
    const p = (PUPIL.y * SIZE + PUPIL.x + PUPIL.reach + 3) * 4
    const iris = (paint: typeof NO_PAINT) => {
      const dressed = dressBody(analysis, look('irises', { face, paint }), null).head!
      return [...dressed.data.slice(p, p + 3)] as Rgb
    }
    const [r, g, b] = iris({ ...NO_PAINT, eyes: '#3070e0' })
    expect(b).toBeGreaterThan(Math.max(r, g) * 1.3)
    const [pr, pg, pb] = iris(NO_PAINT)
    expect(pg).toBeGreaterThan(Math.max(pr, pb) * 1.3)
  })

  test('the rest of the paint waits for the landmarks it is placed by', () => {
    const { pixels, geometry } = head(HAIR)
    const analysis = analyseBody(pixels, body(), null, geometry)
    const paint = { ...NO_PAINT, lips: '#c01020', beard: 'full' as const, freckles: 1 }
    expect(dressBody(analysis, look('unplaced', { paint }), null)).toEqual({})
  })
})

describe('packed triangles', () => {
  test('come back as they went', () => {
    const triangles = [...quad(0.1, 0.4, 0.3, 0.6, 0.8), ...quad(0.5, 0.9, 0.7, 0.2, -0.3)]
    const back = unpackTriangles(packTriangles(triangles))
    expect(back).toHaveLength(triangles.length)
    back.forEach((tri, t) => {
      for (const field of ['u', 'v', 'x', 'y', 'z', 'n'] as const) {
        tri[field].forEach((value, c) => {
          expect(value).toBeCloseTo(triangles[t]![field][c]!, 5)
        })
      }
    })
  })
})
