import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SOCK,
  type FootFrame,
  type FootPart,
  type FootTriangle,
  packFeet,
  paintFeet,
  unpackFeet,
} from './feet-paint'
import { luminance, type Pixels, type Rgb } from './look-pixels'

/** The test's texture's side (texels). */
const SIZE = 64

/** A left foot's frame (only its side and knee matter to the paint). */
const frame = (): FootFrame => ({
  side: 'left',
  ankle: [0.13, -0.886, -0.03],
  heel: [0.13, -1, -0.1],
  toe: [0.13, -1, 0.2],
  forward: [0, 0, 1],
  outward: [1, 0, 0],
  up: [0, 1, 0],
  length: 0.15,
  knee: 3.5,
})

/**
 * A rectangle of a foot as two triangles: texture coordinates from
 * `uv[0]`, `uv[1]` to `uv[2]`, `uv[3]`, and its corners on the foot
 * (`[along, out, up]`) in the same order: at the texture's first corner,
 * then along u, then along v, then at its far corner.
 */
function quad(
  part: FootPart,
  uv: readonly [number, number, number, number],
  corners: readonly (readonly [number, number, number])[],
): FootTriangle[] {
  const [u0, v0, u1, v1] = uv
  const us = [u0, u1, u0, u1]
  const vs = [v0, v0, v1, v1]
  const tri = (a: number, b: number, c: number): FootTriangle => ({
    side: 'left',
    part,
    u: [us[a]!, us[b]!, us[c]!],
    v: [vs[a]!, vs[b]!, vs[c]!],
    along: [corners[a]![0], corners[b]![0], corners[c]![0]],
    out: [corners[a]![1], corners[b]![1], corners[c]![1]],
    up: [corners[a]![2], corners[b]![2], corners[c]![2]],
  })
  return [tri(0, 1, 2), tri(1, 3, 2)]
}

/**
 * The top of a forefoot (texture's top-left quarter: along 0.7–1.45 across
 * u, out −0.34–0.34 down v, 0.22 up) and its sole under it (top-right
 * quarter: along −0.4–1.4, out −0.3–0.3, on the ground).
 */
type Region = { uv: readonly [number, number, number, number]; along: readonly [number, number] }
const TOP: Region = { uv: [0, 0, 0.5, 0.5], along: [0.7, 1.45] }
const SOLE: Region = { uv: [0.5, 0, 1, 0.5], along: [-0.4, 1.4] }
const forefoot = (): FootTriangle[] => [
  ...quad('shoe', TOP.uv, [
    [TOP.along[0], -0.34, 0.22],
    [TOP.along[1], -0.34, 0.22],
    [TOP.along[0], 0.34, 0.22],
    [TOP.along[1], 0.34, 0.22],
  ]),
  ...quad('shoe', SOLE.uv, [
    [SOLE.along[0], -0.3, 0],
    [SOLE.along[1], -0.3, 0],
    [SOLE.along[0], 0.3, 0],
    [SOLE.along[1], 0.3, 0],
  ]),
]

/** A texture filled with `fill`, then coloured by `paint(x, y)` where it gives a colour. */
function texture(fill: Rgb, paint: (x: number, y: number) => Rgb | null = () => null): Pixels {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const color = paint(x, y) ?? fill
      data.set([...color, 255], (y * SIZE + x) * 4)
    }
  }
  return { data, width: SIZE, height: SIZE }
}

const at = (pixels: Pixels, x: number, y: number): Rgb => {
  const p = (y * SIZE + x) * 4
  return [pixels.data[p]!, pixels.data[p + 1]!, pixels.data[p + 2]!]
}

/** Where along a quad's foot a texel column is. */
const alongAt = (x: number, uv: readonly number[], along: readonly [number, number]) =>
  along[0] + (((x + 0.5) / SIZE - uv[0]!) / (uv[2]! - uv[0]!)) * (along[1] - along[0])

const GREEN: Rgb = [0, 255, 0]
const LEATHER: Rgb = [70, 45, 30]
const SKIN: Rgb = [205, 150, 120]
/** The texels of the texture's top half, where the test's shoe is. */
const onShoe = (_x: number, y: number) => y < SIZE / 2

const copy = (pixels: Pixels): Pixels => ({ ...pixels, data: new Uint8ClampedArray(pixels.data) })

const mean = (colors: readonly Rgb[]) =>
  colors.reduce((sum, c) => sum + luminance(...c), 0) / Math.max(1, colors.length)

describe('feet painted on a body', () => {
  const geometry = packFeet(forefoot(), [frame()])

  test("crosses to the worker and back as it was, to a float's precision", () => {
    const triangles = forefoot()
    const floats = (tri: FootTriangle): FootTriangle => ({
      ...tri,
      u: tri.u.map(Math.fround),
      v: tri.v.map(Math.fround),
      along: tri.along.map(Math.fround),
      out: tri.out.map(Math.fround),
      up: tri.up.map(Math.fround),
    })
    expect(unpackFeet(packFeet(triangles, [frame()]))).toEqual(triangles.map(floats))
  })

  test('leaves shoes be', () => {
    const shoes = texture(GREEN, (x, y) => (onShoe(x, y) ? LEATHER : null))
    const painted = copy(shoes)
    paintFeet(painted, geometry, { wear: 'shoes', color: null }, SKIN)
    expect(painted.data).toEqual(shoes.data)
  })

  test("paints only the feet's texels (and a texel round them)", () => {
    for (const wear of ['socks', 'bare'] as const) {
      const shoes = texture(GREEN, (x, y) => (onShoe(x, y) ? LEATHER : null))
      const painted = copy(shoes)
      paintFeet(painted, geometry, { wear, color: null }, SKIN)
      for (let y = SIZE / 2 + 1; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) expect(at(painted, x, y)).toEqual(GREEN)
      }
      expect(at(painted, 10, 10)).not.toEqual(LEATHER)
    }
  })

  test("paints socks in their colour, keeping the shoe's folds as light and shade", () => {
    const crease = 12
    const shoes = texture(GREEN, (x, y) =>
      onShoe(x, y) ? (x === crease ? [40, 26, 17] : LEATHER) : null,
    )
    for (const color of [null, '#27324f'] as const) {
      const painted = copy(shoes)
      paintFeet(painted, geometry, { wear: 'socks', color }, SKIN)
      const column = (x: number) => Array.from({ length: 30 }, (_, y) => at(painted, x, y + 1))
      const sock: Rgb = color ? [0x27, 0x32, 0x4f] : DEFAULT_SOCK
      const all = [...column(crease - 2), ...column(crease + 2), ...column(crease)]
      expect(mean(all) / luminance(...sock)).toBeGreaterThan(0.85)
      expect(mean(all) / luminance(...sock)).toBeLessThan(1.1)
      // The sock takes its colour, not the leather's: blue over red.
      const [r, , b] = at(painted, crease + 4, 16)
      if (color) expect(b).toBeGreaterThan(r)
      const beside = mean([...column(crease - 2), ...column(crease + 2)])
      expect(mean(column(crease))).toBeLessThan(beside * 0.97)
    }
  })

  test("paints bare feet in the skin's colour, with toes and nails only on the front of the top", () => {
    const painted = texture(GREEN, (x, y) => (onShoe(x, y) ? LEATHER : null))
    paintFeet(painted, geometry, { wear: 'bare', color: null }, SKIN)
    const texels = (region: Region, from: number, to: number) => {
      const found: Rgb[] = []
      for (let x = 0; x < SIZE; x++) {
        const u = (x + 0.5) / SIZE
        if (u < region.uv[0] || u > region.uv[2]) continue
        const along = alongAt(x, region.uv, region.along)
        if (along < from || along > to) continue
        for (let y = 1; y < SIZE / 2 - 1; y++) found.push(at(painted, x, y))
      }
      return found
    }
    const lums = (colors: Rgb[]) => colors.map((c) => luminance(...c)).sort((a, b) => a - b)
    // Behind the toes, plain skin.
    const instep = lums(texels(TOP, 0.7, 0.9))
    expect(instep[0]! / instep[instep.length - 1]!).toBeGreaterThan(0.9)
    expect(mean(texels(TOP, 0.7, 0.9)) / luminance(...SKIN)).toBeCloseTo(1, 1)
    // Over the toes: the gaps between them darker, their nails paler and less red.
    const toes = texels(TOP, 1.2, 1.45)
    const middle = lums(toes)[toes.length >> 1]!
    expect(lums(toes)[0]!).toBeLessThan(middle * 0.85)
    const nail = (c: Rgb) => luminance(...c) > middle * 1.03 && (c[0] - c[2]) / c[0] < 0.37
    expect(toes.filter(nail).length).toBeGreaterThan(3)
    expect(texels(TOP, 0.7, 1.0).filter(nail).length).toBe(0)
    // Underneath, no nails, and a paler sole.
    expect(texels(SOLE, -0.4, 1.4).filter(nail).length).toBe(0)
    expect(mean(texels(SOLE, -0.2, 0.8))).toBeGreaterThan(mean(texels(TOP, 0.7, 0.9)))
  })

  test('leaves a foot already bare as it is, but puts socks on it', () => {
    const bare = texture(GREEN, (x, y) => (onShoe(x, y) ? SKIN : null))
    const painted = copy(bare)
    paintFeet(painted, geometry, { wear: 'bare', color: null }, SKIN)
    expect(painted.data).toEqual(bare.data)
    paintFeet(painted, geometry, { wear: 'socks', color: null }, SKIN)
    expect(painted.data).not.toEqual(bare.data)
  })
})

describe("a boot's shaft painted on the leg", () => {
  /**
   * A shoe's side up to its top edge (0.8 up; texture's top-left quarter,
   * up the v axis) and the leg on from it to below the knee (3.4 up; the
   * texture's bottom-left quarter), sharing the edge's corners.
   */
  const EDGE = 0.8
  const LEG = { v: [0.5, 1] as const, up: [EDGE, 3.4] as const }
  const side = (): FootTriangle[] => [
    ...quad(
      'shoe',
      [0, 0, 0.5, 0.5],
      [
        [-0.3, -0.25, 0],
        [0.3, -0.25, 0],
        [-0.3, -0.25, EDGE],
        [0.3, -0.25, EDGE],
      ],
    ),
    ...quad(
      'leg',
      [0, LEG.v[0], 0.5, LEG.v[1]],
      [
        [-0.3, -0.25, EDGE],
        [0.3, -0.25, EDGE],
        [-0.3, -0.25, LEG.up[1]],
        [0.3, -0.25, LEG.up[1]],
      ],
    ),
  ]
  const upAt = (y: number) =>
    LEG.up[0] + (((y + 0.5) / SIZE - LEG.v[0]) / (LEG.v[1] - LEG.v[0])) * (LEG.up[1] - LEG.up[0])
  /** Leather up to `top` on the leg, skin above. */
  const booted = (top: number) =>
    texture(GREEN, (x, y) => {
      if (x >= SIZE / 2) return null
      if (y < SIZE / 2) return LEATHER
      return upAt(y) < top ? LEATHER : SKIN
    })
  const legRows = (pixels: Pixels, from: number, to: number) => {
    const found: Rgb[] = []
    for (let y = SIZE / 2 + 1; y < SIZE; y++) {
      const up = upAt(y)
      if (up >= from && up <= to)
        for (let x = 1; x < SIZE / 2 - 1; x++) found.push(at(pixels, x, y))
    }
    return found
  }

  test('goes with the boot: a knee sock up to its top, the knee above left be', () => {
    const boots = booted(2.4)
    const painted = copy(boots)
    paintFeet(painted, packFeet(side(), [frame()]), { wear: 'socks', color: null }, SKIN)
    const sock = legRows(painted, EDGE + 0.1, 2.2)
    expect(mean(sock) / luminance(...DEFAULT_SOCK)).toBeGreaterThan(0.85)
    expect(legRows(painted, 2.6, 3.3)).toEqual(legRows(boots, 2.6, 3.3))
  })

  test('takes the skin of the knee over it when bare', () => {
    const painted = booted(2.4)
    paintFeet(painted, packFeet(side(), [frame()]), { wear: 'bare', color: null }, [180, 128, 100])
    const shaft = legRows(painted, EDGE + 0.1, 2.2)
    expect(mean(shaft) / luminance(...SKIN)).toBeCloseTo(1, 1)
  })

  test("but a trouser leg of the shoe's colour to the knee is no boot's", () => {
    const trousers = booted(4)
    const painted = copy(trousers)
    paintFeet(painted, packFeet(side(), [frame()]), { wear: 'socks', color: null }, SKIN)
    expect(legRows(painted, EDGE + 0.05, 3.4)).toEqual(legRows(trousers, EDGE + 0.05, 3.4))
  })

  test("socks go up a bare leg to a crew sock's cuff", () => {
    const bareLeg = texture(GREEN, (x, y) => (x >= SIZE / 2 ? null : y < SIZE / 2 ? LEATHER : SKIN))
    const painted = copy(bareLeg)
    paintFeet(painted, packFeet(side(), [frame()]), { wear: 'socks', color: null }, SKIN)
    expect(mean(legRows(painted, EDGE + 0.05, 1.05)) / luminance(...DEFAULT_SOCK)).toBeGreaterThan(
      0.85,
    )
    expect(legRows(painted, 1.3, 3.3)).toEqual(legRows(bareLeg, 1.3, 3.3))
  })
})
