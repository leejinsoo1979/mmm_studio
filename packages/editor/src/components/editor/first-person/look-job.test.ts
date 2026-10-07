import { describe, expect, test } from 'bun:test'
import type { ScalpPaint } from './bald-head'
import { NO_PAINT } from './face-paint'
import { SHOD } from './footwear'
import type { HeadGeometry } from './head-geometry'
import { analyseBody, dressBody, type LookJob, sameLookJob } from './look-job'
import {
  type HeadTriangle,
  hexToRgb,
  type Pixels,
  packTriangles,
  type Rgb,
  toneSkin,
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
  scalp: null,
  stubble: null,
  wig: null,
  feet: SHOD,
  feetBind: null,
  feetDonor: null,
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
  // The paint with the landmarks is face-paint.test.ts's.
  /** A bald head's paint: the crown's quad painted wholly, the tone read off the cheek's. */
  const corner = (u: number, v: number) => [u, v, 1, -1, 0, 1, 0, 0, 0, 0, 1]
  const scalp: ScalpPaint = {
    paint: Float32Array.from([
      ...corner(0.1, 0.02),
      ...corner(0.9, 0.02),
      ...corner(0.9, 0.23),
      ...corner(0.1, 0.02),
      ...corner(0.9, 0.23),
      ...corner(0.1, 0.23),
    ]),
    scalp: new Float32Array(),
    kept: Float32Array.from([0.1, 0.02, 0.9, 0.02, 0.9, 0.23, 0.1, 0.02, 0.9, 0.23, 0.1, 0.23]),
    taken: new Float32Array(),
    tone: [Float32Array.from([0.1, 0.27, 0.9, 0.27, 0.9, 0.48, 0.1, 0.27, 0.9, 0.48, 0.1, 0.48])],
    skin: new Float32Array(),
    shadow: new Float32Array(),
  }
  const near = (colour: Rgb, to: Rgb) =>
    colour.forEach((value, c) => {
      expect(Math.abs(value - to[c]!)).toBeLessThan(to[c]! * 0.12)
    })

  /** How light a colour is. */
  const lightness = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b
  /** The forehead's tone, shadowed by its hair's stubble where the hair was painted: nearer the skin than the hair. */
  const stubbled = (colour: Rgb) => {
    expect(lightness(colour)).toBeLessThan(lightness(SKIN))
    expect(lightness(colour)).toBeGreaterThan((lightness(SKIN) + lightness(HAIR)) / 2)
  }

  test('a bald head’s skin is painted round the cut to the forehead’s tone, without landmarks', () => {
    const { pixels, geometry } = head(HAIR)
    const analysis = analyseBody(pixels, body(), null, geometry)
    const bald = dressBody(analysis, look('unplaced', { scalp }), null).head!
    stubbled(rows(bald, 0.04, 0.2))
    // The jaw, as dark as the hair but not painted, stays.
    expect(rows(bald, 0.52, 0.73)).toEqual(rows(pixels, 0.52, 0.73))
  })

  test('a bald head’s hair is painted over, not dyed; the same body with its own hair again is', () => {
    const { pixels, geometry } = head(HAIR)
    const analysis = analyseBody(pixels, body(), null, geometry)
    const bald = dressBody(analysis, look('dyed', { scalp, hair: '#c03020' }), null).head!
    stubbled(rows(bald, 0.04, 0.2))
    // Its stubble is the hair's own colour, grown back undyed.
    const [br, bg] = rows(bald, 0.04, 0.2)
    expect(br).toBeLessThan(bg * 1.6)
    const own = dressBody(analysis, look('dyed', { hair: '#c03020' }), null).head!
    const [r, g] = rows(own, 0.02, 0.2)
    expect(r).toBeGreaterThan(g * 2)
  })

  test('a bald head’s scalp is toned as its face is, though the skin under its hairline takes the tone partly', () => {
    // The forehead under the hairline, shaded by the hair over it: barely
    // the skin's colour, so the tone takes there only in part.
    const SHADED: Rgb = [150, 105, 85]
    const { pixels, geometry } = head(SKIN)
    for (let y = Math.floor(0.25 * SIZE); y < 0.33 * SIZE; y++) {
      for (let x = 0; x < SIZE; x++) pixels.data.set(SHADED, (y * SIZE + x) * 4)
    }
    const shaded = {
      ...scalp,
      tone: [Float32Array.from([0.1, 0.26, 0.9, 0.26, 0.9, 0.31, 0.1, 0.26, 0.9, 0.31, 0.1, 0.31])],
    }
    const analysis = analyseBody(pixels, body(), null, geometry)
    const dressed = dressBody(analysis, look('toned', { scalp: shaded, skin: '#8a5a3c' }), null)
      .head!
    const toned: Pixels = { data: new Uint8ClampedArray([...SHADED, 255]), width: 1, height: 1 }
    toneSkin(toned, hexToRgb('#8a5a3c'), analysis.skin, Float32Array.of(1))
    near(rows(dressed, 0.04, 0.2), [toned.data[0]!, toned.data[1]!, toned.data[2]!])
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

  test('dyed hair cards carry the dye under their cut-away texels, alpha untouched', () => {
    const { pixels, geometry } = head(HAIR)
    const cards = texture([[0.25, 0.5, HAIR]])
    for (let y = 0; y < SIZE; y++) {
      if (y / SIZE < 0.25 || y / SIZE >= 0.5) {
        for (let x = 0; x < SIZE; x++) cards.data[(y * SIZE + x) * 4 + 3] = 0
      }
    }
    const analysis = analyseBody(pixels, body(), cards, geometry)
    const dyed = dressBody(analysis, look('cards', { hair: '#c03020' }), null).opacity!
    const strand = rows(dyed, 0.3, 0.45)
    expect(strand[0]).toBeGreaterThan(strand[1] * 2)
    // Beside the strands, where only filtering reaches, their dyed colour, not black.
    expect(rows(dyed, 0.5, 0.56)).toEqual(strand)
    expect(rows(dyed, 0.9, 1)).toEqual(strand)
    for (let i = 0; i < SIZE * SIZE; i++) expect(dyed.data[i * 4 + 3]).toBe(cards.data[i * 4 + 3]!)
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

describe('the same look', () => {
  // Only its key tells a body apart.
  const body = { key: 'm002' } as LookJob['body']
  const scalp = {} as ScalpPaint
  const target = [0.5, 0.5]
  const wig = new Float32Array(3)
  const job = (patch: Partial<LookJob> = {}): LookJob =>
    ({
      body,
      avatar: 'Male_Adult_01',
      hair: '#c0392b',
      skin: null,
      face: {
        photo: 'data:image/jpeg;base64,AA',
        points: [0.1, 0.2],
        blend: 1,
        light: 0.5,
        eyes: null,
      },
      paint: { ...NO_PAINT, lips: '#aa3344' },
      scalp,
      stubble: [40, 30, 25],
      wig,
      feet: SHOD,
      feetBind: null,
      feetDonor: null,
      target,
      ...patch,
    }) as LookJob

  test('is the same body in settings alike by value, even read again from a save', () => {
    const saved = JSON.parse(JSON.stringify({ face: job().face, paint: job().paint, feet: SHOD }))
    expect(sameLookJob(job(), job(saved))).toBe(true)
    // Another texture showing the same picture names the same body.
    expect(sameLookJob(job(), job({ body: { ...body } }))).toBe(true)
  })

  test('is not another body, nor any setting of the look changed', () => {
    expect(sameLookJob(job(), job({ body: { ...body, key: 'f001' } }))).toBe(false)
    expect(sameLookJob(job(), job({ hair: '#000000' }))).toBe(false)
    expect(sameLookJob(job(), job({ paint: { ...NO_PAINT, lips: '#aa3345' } }))).toBe(false)
    expect(sameLookJob(job(), job({ face: { ...job().face!, light: 0.6 } }))).toBe(false)
    expect(sameLookJob(job(), job({ feet: { wear: 'bare', color: null } }))).toBe(false)
    expect(sameLookJob(job(), job({ scalp: null }))).toBe(false)
    expect(sameLookJob(job(), job({ stubble: [41, 30, 25] }))).toBe(false)
  })

  test('tells what is worked out once apart by being the same, not by value', () => {
    expect(sameLookJob(job(), job({ scalp: {} as ScalpPaint }))).toBe(false)
    expect(sameLookJob(job(), job({ target: [...target] }))).toBe(false)
    expect(sameLookJob(job(), job({ wig: new Float32Array(3) }))).toBe(false)
  })
})
