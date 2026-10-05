import { describe, expect, test } from 'bun:test'
import { type ScalpPaint, SHADED } from './bald-head'
import type { Pixels, Rgb } from './look-pixels'
import { relightBody, scalpPainter } from './scalp-paint'

const SIZE = 16

function image(fill: (x: number, y: number) => Rgb, size = SIZE): Pixels {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) data.set([...fill(x, y), 255], (y * size + x) * 4)
  }
  return { data, width: size, height: size }
}

const at = (pixels: Pixels, x: number, y: number) => [
  ...pixels.data.slice((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 3),
]

const NONE = new Float32Array()

/** The whole texture as two kept triangles (READ each). */
const ALL_KEPT = Float32Array.from([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])

/** The plan with nothing in it but what `plan` says. */
const planned = (plan: Partial<ScalpPaint>): Omit<ScalpPaint, 'shadow'> => ({
  paint: NONE,
  scalp: NONE,
  kept: NONE,
  taken: NONE,
  tone: [],
  skin: NONE,
  ...plan,
})

/** Two triangles over x from `from` to `to` (0–1) of the texture, top then bottom corners each `top` and `bottom` per corner. */
function band(from: number, to: number, top: number[], bottom: number[]) {
  const corner = (u: number, v: number, rest: number[]) => [u, v, ...rest]
  return Float32Array.from([
    ...corner(from, 0, top),
    ...corner(to, 0, top),
    ...corner(to, 1, bottom),
    ...corner(from, 0, top),
    ...corner(to, 1, bottom),
    ...corner(from, 1, bottom),
  ])
}

/** The left half packed for painting (see PAINTED): how much at the top and the bottom, no skin round it, the hair painted over where `hair`. */
const leftHalf = (top: number, bottom: number, hair = 1) =>
  band(0, 0.5, [top, -1, 0, hair], [bottom, -1, 0, hair])

const paintScalp = (
  head: Pixels,
  plan: Partial<ScalpPaint>,
  tone: Rgb,
  hair: Float32Array | null = null,
) => scalpPainter(head.width, head.height, planned(plan), hair, null).paint(head, tone)

const scalpTone = (
  head: Pixels,
  tone: Float32Array[],
  hair: Float32Array | null,
  skin: Float32Array | null,
) => scalpPainter(SIZE, SIZE, planned({ tone }), hair, skin).tone(head)

const SKIN: Rgb = [200, 150, 120]
const HAIR: Rgb = [60, 40, 30]
const TONE: Rgb = [180, 130, 100]

const near = (value: number[], wanted: readonly number[], share = 0.1) =>
  value.every((v, c) => Math.abs(v - wanted[c]!) <= wanted[c]! * share)

describe('painting a bald head’s skin round the cut', () => {
  test('paints each texel as much as its corners say, grained, and leaves the rest', () => {
    const head = image(() => SKIN)
    paintScalp(head, { paint: leftHalf(1, 0), kept: ALL_KEPT }, TONE)
    // Fully at the top of the painted half, within the grain.
    expect(near(at(head, 3, 0), TONE)).toBe(true)
    // Hardly at its bottom, and not at all past it.
    expect(Math.abs(at(head, 3, SIZE - 1)[0]! - SKIN[0])).toBeLessThan(5)
    expect(at(head, 12, 4)).toEqual(SKIN)
  })

  test('paints the hair’s colour over wholly, wherever the triangles reach', () => {
    const head = image((x) => (x === 2 ? HAIR : SKIN))
    const hair = Float32Array.from({ length: SIZE * SIZE }, (_, i) => (i % SIZE === 2 ? 1 : 0))
    paintScalp(head, { paint: leftHalf(0, 0), kept: ALL_KEPT }, TONE, hair)
    expect(near(at(head, 2, 8), TONE)).toBe(true)
    expect(at(head, 4, 8)).toEqual(SKIN)
  })

  test('leaves the hair’s colour where the face is: brows, a beard', () => {
    const head = image((x) => (x === 2 ? HAIR : SKIN))
    const hair = Float32Array.from({ length: SIZE * SIZE }, (_, i) => (i % SIZE === 2 ? 1 : 0))
    paintScalp(head, { paint: leftHalf(0, 0, 0), kept: ALL_KEPT }, TONE, hair)
    expect(at(head, 2, 8)).toEqual(HAIR)
  })

  test('paints in the colour of the skin round a corner, as much as it says', () => {
    // The skin read at the right half's middle: a darker neck.
    const NECK: Rgb = [140, 100, 80]
    const head = image((x) => (x < 8 ? HAIR : NECK))
    paintScalp(
      head,
      {
        paint: band(0, 0.5, [1, 0, 1, 1], [1, 0, 1, 1]),
        skin: Float32Array.from([0.75, 0.5, 0, 0, 0]),
      },
      TONE,
    )
    expect(near(at(head, 3, 8), NECK)).toBe(true)
  })
})

describe('painting the bald surface', () => {
  test('paints its texels wholly, but those kept skin shows', () => {
    const head = image(() => HAIR)
    paintScalp(
      head,
      {
        scalp: band(0, 0.5, [-1, 0], [-1, 0]),
        kept: Float32Array.from([0, 0.5, 0.25, 0.5, 0.25, 1, 0, 0.5, 0.25, 1, 0, 1]),
      },
      TONE,
    )
    expect(near(at(head, 6, 3), TONE)).toBe(true)
    // Under the kept skin's quarter: left be.
    expect(at(head, 1, 12)).toEqual(HAIR)
  })

  test('paints the rest of what the hair showed the tone, and the texels round it on no triangle alike', () => {
    const head = image(() => HAIR)
    const leftQuarter = Float32Array.from([0, 0, 0.25, 0, 0.25, 1, 0, 0, 0.25, 1, 0, 1])
    paintScalp(head, { taken: leftQuarter }, TONE)
    expect(near(at(head, 1, 8), TONE)).toBe(true)
    // Past it, padded a few texels.
    expect(near(at(head, 6, 8), TONE)).toBe(true)
    expect(at(head, 12, 8)).toEqual(HAIR)
  })
})

describe('the scalp’s tone', () => {
  const whole = Float32Array.from([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])
  const left = Float32Array.from([0, 0, 0.5, 0, 0.5, 1, 0, 0, 0.5, 1, 0, 1])

  test('is the median of the skin the triangles cover, not its hair nor what isn’t skin', () => {
    // Skin in a few shades, hair down one column, a blue strap down another.
    const head = image((x, y) =>
      x === 3 ? HAIR : x === 5 ? [40, 60, 200] : [190 + (y % 3) * 10, 140, 110],
    )
    const hair = Float32Array.from({ length: SIZE * SIZE }, (_, i) => (i % SIZE === 3 ? 1 : 0))
    const skin = Float32Array.from({ length: SIZE * SIZE }, (_, i) => (i % SIZE === 5 ? 0 : 1))
    expect(scalpTone(head, [whole], hair, skin)).toEqual([200, 140, 110])
  })

  test('falls back to the next triangles where the first show too little skin, else none', () => {
    const head = image((x) => (x < 8 ? HAIR : SKIN))
    const hair = Float32Array.from({ length: SIZE * SIZE }, (_, i) => (i % SIZE < 8 ? 1 : 0))
    expect(scalpTone(head, [left, whole], hair, null)).toEqual(SKIN)
    expect(scalpTone(head, [left], hair, null)).toBeNull()
  })
})

describe('a scalp painter', () => {
  test('paints and reads any number of heads alike', () => {
    const left = Float32Array.from([0, 0, 0.5, 0, 0.5, 1, 0, 0, 0.5, 1, 0, 1])
    const plan = { paint: leftHalf(1, 0.5), kept: ALL_KEPT, tone: [left] }
    const painter = scalpPainter(SIZE, SIZE, planned(plan), null, null)
    for (const fill of [SKIN, TONE]) {
      const head = image((x, y) => [fill[0] - y, fill[1], fill[2] + x])
      const fresh = image((x, y) => [fill[0] - y, fill[1], fill[2] + x])
      const tone = painter.tone(head)!
      expect(tone).toEqual(scalpTone(fresh, [left], null, null)!)
      painter.paint(head, tone)
      paintScalp(fresh, plan, tone)
      expect([...head.data]).toEqual([...fresh.data])
    }
  })
})

describe('the body lit again under the hair taken off', () => {
  // A shirt lit on the right, shaded where the hair hung on the left; a
  // strap of another colour down the middle.
  const SHIRT: Rgb = [120, 120, 160]
  const SHADED_SHIRT: Rgb = [60, 60, 80]
  const STRAP: Rgb = [200, 40, 40]
  const SIDE = 64
  /** The left quarter, wholly in the shadow. */
  const leftQuarter = Float32Array.from([
    0, 0, 1, 0.25, 0, 1, 0.25, 1, 1, 0, 0, 1, 0.25, 1, 1, 0, 1, 1,
  ])

  test('lights the shadow as bright as the same cloth out of it', () => {
    const body = image((x) => (x < 16 ? SHADED_SHIRT : SHIRT), SIDE)
    expect(leftQuarter.length).toBe(SHADED * 2)
    relightBody(body, leftQuarter)
    expect(near(at(body, 5, 30), SHIRT)).toBe(true)
    expect(at(body, 40, 30)).toEqual(SHIRT)
  })

  test('leaves it be where no cloth of its colour is out of it', () => {
    const body = image((x) => (x < 16 ? SHADED_SHIRT : STRAP), SIDE)
    relightBody(body, leftQuarter)
    expect(at(body, 5, 30)).toEqual(SHADED_SHIRT)
  })
})
