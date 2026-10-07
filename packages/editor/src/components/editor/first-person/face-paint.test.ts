import { describe, expect, test } from 'bun:test'
import { type FacePaint, hasFacePaint, NO_PAINT, paintFace, readFacePaint } from './face-paint'
import { FACE_PARTS, facePointOf, type Point, unpackPoints } from './face-points'
import { SHOD } from './footwear'
import type { HeadGeometry } from './head-geometry'
import { analyseBody, dressBody } from './look-job'
import { luminance, type Pixels, type Rgb } from './look-pixels'

/** A real character's face landmarks (Male_Adult_10's, rounded): the paint is laid out by them. */
const FACE = [
  0.505, 0.272, 0.565, 0.272, 0.617, 0.28, 0.665, 0.295, 0.698, 0.32, 0.72, 0.353, 0.731, 0.391,
  0.736, 0.438, 0.735, 0.484, 0.731, 0.532, 0.723, 0.584, 0.71, 0.639, 0.69, 0.682, 0.666, 0.714,
  0.635, 0.741, 0.608, 0.759, 0.58, 0.774, 0.549, 0.784, 0.508, 0.787, 0.468, 0.785, 0.436, 0.775,
  0.407, 0.76, 0.38, 0.743, 0.349, 0.717, 0.324, 0.686, 0.303, 0.642, 0.29, 0.587, 0.281, 0.535,
  0.277, 0.487, 0.275, 0.441, 0.28, 0.393, 0.292, 0.355, 0.313, 0.322, 0.346, 0.297, 0.394, 0.281,
  0.445, 0.273, 0.677, 0.401, 0.658, 0.39, 0.631, 0.385, 0.593, 0.388, 0.544, 0.404, 0.69, 0.391,
  0.669, 0.377, 0.638, 0.368, 0.597, 0.371, 0.55, 0.379, 0.335, 0.405, 0.354, 0.393, 0.38, 0.387,
  0.417, 0.39, 0.466, 0.405, 0.323, 0.395, 0.343, 0.38, 0.373, 0.371, 0.413, 0.373, 0.459, 0.379,
  0.642, 0.432, 0.635, 0.438, 0.628, 0.441, 0.619, 0.444, 0.604, 0.446, 0.588, 0.445, 0.573, 0.443,
  0.563, 0.443, 0.558, 0.442, 0.638, 0.429, 0.632, 0.426, 0.623, 0.421, 0.609, 0.419, 0.592, 0.42,
  0.575, 0.427, 0.563, 0.436, 0.37, 0.433, 0.377, 0.438, 0.383, 0.441, 0.393, 0.444, 0.408, 0.446,
  0.423, 0.445, 0.438, 0.443, 0.448, 0.443, 0.453, 0.442, 0.374, 0.429, 0.379, 0.426, 0.387, 0.422,
  0.402, 0.419, 0.418, 0.42, 0.435, 0.427, 0.447, 0.436, 0.432, 0.658, 0.44, 0.666, 0.45, 0.673,
  0.465, 0.682, 0.485, 0.688, 0.507, 0.689, 0.529, 0.687, 0.549, 0.681, 0.564, 0.672, 0.575, 0.664,
  0.582, 0.657, 0.574, 0.652, 0.564, 0.647, 0.549, 0.641, 0.529, 0.635, 0.507, 0.64, 0.485, 0.635,
  0.464, 0.642, 0.45, 0.648, 0.44, 0.653, 0.438, 0.658, 0.449, 0.659, 0.459, 0.659, 0.473, 0.659,
  0.489, 0.659, 0.507, 0.66, 0.525, 0.659, 0.541, 0.658, 0.554, 0.657, 0.565, 0.657, 0.576, 0.657,
  0.564, 0.657, 0.554, 0.657, 0.541, 0.658, 0.525, 0.659, 0.507, 0.66, 0.489, 0.659, 0.473, 0.658,
  0.46, 0.658, 0.45, 0.658, 0.505, 0.432, 0.505, 0.457, 0.505, 0.481, 0.505, 0.503, 0.505, 0.526,
  0.505, 0.553, 0.505, 0.572, 0.505, 0.582, 0.505, 0.586, 0.506, 0.59, 0.456, 0.584, 0.555, 0.584,
  0.45, 0.573, 0.562, 0.572, 0.444, 0.562, 0.568, 0.561, 0.449, 0.553, 0.563, 0.553, 0.45, 0.564,
  0.562, 0.564, 0.459, 0.557, 0.552, 0.557, 0.472, 0.554, 0.538, 0.553, 0.487, 0.552, 0.523, 0.553,
  0.488, 0.527, 0.522, 0.527, 0.489, 0.505, 0.521, 0.505, 0.353, 0.545, 0.661, 0.543, 0.382, 0.573,
  0.632, 0.571, 0.339, 0.589, 0.676, 0.587, 0.308, 0.534, 0.706, 0.531, 0.303, 0.489, 0.711, 0.486,
  0.339, 0.491, 0.674, 0.489, 0.365, 0.499, 0.649, 0.498, 0.399, 0.521, 0.614, 0.52, 0.412, 0.549,
  0.601, 0.548, 0.437, 0.533, 0.576, 0.533, 0.428, 0.577, 0.585, 0.576, 0.409, 0.597, 0.605, 0.596,
  0.394, 0.623, 0.619, 0.622, 0.366, 0.605, 0.649, 0.603, 0.362, 0.661, 0.653, 0.659, 0.387, 0.659,
  0.627, 0.657, 0.403, 0.684, 0.612, 0.682, 0.423, 0.705, 0.592, 0.704, 0.41, 0.722, 0.605, 0.72,
  0.436, 0.741, 0.579, 0.739, 0.507, 0.756, 0.508, 0.775, 0.505, 0.324, 0.505, 0.382, 0.505, 0.408,
  0.452, 0.323, 0.557, 0.323, 0.405, 0.324, 0.605, 0.323, 0.36, 0.332, 0.651, 0.33, 0.423, 0.675,
  0.591, 0.674, 0.408, 0.657, 0.605, 0.655, 0.416, 0.639, 0.597, 0.638, 0.43, 0.624, 0.583, 0.623,
  0.449, 0.613, 0.564, 0.612, 0.408, 0.431, 0.428, 0.431, 0.408, 0.414, 0.389, 0.431, 0.408, 0.449,
  0.605, 0.431, 0.624, 0.431, 0.605, 0.414, 0.585, 0.431, 0.604, 0.449,
]

const points = unpackPoints(FACE)
const at = (landmark: number) => points[facePointOf(landmark)]!
const between = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
]

const SIZE = 512
const SKIN: Rgb = [200, 150, 120]
const BROW: Rgb = [60, 42, 32]
const LIPS: Rgb = [190, 110, 105]
const BEARD: Rgb = [40, 30, 25]

/**
 * A head whose texture is its own front view: `cells` × `cells` squares
 * facing the front, the texture across them (a fine grid for analyseBody,
 * which samples triangles' centres).
 */
function flatHead(cells: number): HeadGeometry {
  const triangles = []
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const square = [
        [i / cells, j / cells],
        [(i + 1) / cells, j / cells],
        [(i + 1) / cells, (j + 1) / cells],
        [i / cells, (j + 1) / cells],
      ]
      for (const corners of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        triangles.push({
          u: corners.map((k) => square[k]![0]!),
          v: corners.map((k) => square[k]![1]!),
          x: corners.map((k) => square[k]![0]!),
          y: corners.map((k) => square[k]![1]!),
          z: [0, 0, 0],
          n: [1, 1, 1],
        })
      }
    }
  }
  return { all: triangles, skin: triangles, eyes: [] }
}

const FLAT = flatHead(1)

function inside(outline: readonly Point[], x: number, y: number) {
  let crossings = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, ay] = outline[j]!
    const [bx, by] = outline[i]!
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) crossings = !crossings
  }
  return crossings
}

/** Each brow's hairs: between its landmarks' rows, a little in from each. */
const BROW_HAIRS = [
  [
    [70, 63, 105, 66, 107],
    [46, 53, 52, 65, 55],
  ],
  [
    [300, 293, 334, 296, 336],
    [276, 283, 282, 295, 285],
  ],
].map(([upper, lower]) => [
  ...upper!.map((landmark, i) => between(at(landmark), at(lower![i]!), 0.3)),
  ...lower!.map((landmark, i) => between(at(landmark), at(upper![i]!), 0.3)).reverse(),
])

const LIP_OUTLINE = FACE_PARTS.lips.map((i) => points[i]!)

const onBrow = (x: number, y: number) => BROW_HAIRS.some((brow) => inside(brow, x, y))

/** Whether a point lies within `margin` of some points' box. */
const nearBox = (box: readonly Point[], margin: number) => (x: number, y: number) =>
  x >= Math.min(...box.map(([bx]) => bx)) - margin &&
  x <= Math.max(...box.map(([bx]) => bx)) + margin &&
  y >= Math.min(...box.map(([, by]) => by)) - margin &&
  y <= Math.max(...box.map(([, by]) => by)) + margin

/** What the face is drawn with; `over` draws something on top of it (null where it doesn't). */
type Drawing = {
  skin?: Rgb
  brow?: Rgb
  /** How far above their landmarks the lips' colour reaches (a fraction of the view). */
  lipsUp?: number
  over?: (x: number, y: number) => Rgb | null
}

/** The face drawn on its front view: skin, brows and lips. */
function drawFace({ skin = SKIN, brow = BROW, lipsUp = 0, over }: Drawing = {}): Pixels {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = (px + 0.5) / SIZE
      const y = (py + 0.5) / SIZE
      const lips =
        inside(LIP_OUTLINE, x, y) || (y < at(13)[1] && inside(LIP_OUTLINE, x, y + lipsUp))
      const colour = over?.(x, y) ?? (onBrow(x, y) ? brow : lips ? LIPS : skin)
      data.set([...colour, 255], (py * SIZE + px) * 4)
    }
  }
  return { data, width: SIZE, height: SIZE }
}

const copy = (image: Pixels): Pixels => ({
  data: new Uint8ClampedArray(image.data),
  width: image.width,
  height: image.height,
})

/** The plain face, drawn once (the tests paint copies of it). */
const FACE_TEXTURE = drawFace()

function painted(
  paint: Partial<FacePaint>,
  hair: Float32Array | null = null,
  beard: Rgb | null = BEARD,
  face: Pixels = FACE_TEXTURE,
): Pixels {
  const head = copy(face)
  paintFace(head, FLAT, FACE, { ...NO_PAINT, ...paint }, { beard, hair })
  return head
}

const colourAt = (image: Pixels, [x, y]: Point): Rgb => {
  const p = (Math.floor(y * SIZE) * SIZE + Math.floor(x * SIZE)) * 4
  return [image.data[p]!, image.data[p + 1]!, image.data[p + 2]!]
}
const lightAt = (image: Pixels, point: Point) => luminance(...colourAt(image, point))
const redness = ([r, g]: Rgb) => r - g

/** The mean lightness along a short row of pixels centred on a point. */
function meanLight(image: Pixels, [x, y]: Point) {
  let sum = 0
  for (let k = -8; k <= 8; k++) sum += lightAt(image, [x + k / SIZE, y])
  return sum / 17
}

/** The pixels a paint changed from `original` where `allowed` doesn't hold. */
function strayChanges(
  image: Pixels,
  allowed: (x: number, y: number) => boolean,
  original: Pixels = FACE_TEXTURE,
) {
  let stray = 0
  for (let i = 0; i < SIZE * SIZE; i++) {
    const x = ((i % SIZE) + 0.5) / SIZE
    const y = (Math.floor(i / SIZE) + 0.5) / SIZE
    if (allowed(x, y)) continue
    for (let c = 0; c < 3; c++) if (image.data[i * 4 + c] !== original.data[i * 4 + c]) stray++
  }
  return stray
}

/** The share of a box's pixels as dark as a brow's hair (nearer the brow's lightness than the skin's). */
function darkShare(image: Pixels, box: readonly Point[]) {
  const within = nearBox(box, 0.02)
  const middle = (luminance(...SKIN) + luminance(...BROW)) / 2
  let dark = 0
  let total = 0
  for (let i = 0; i < SIZE * SIZE; i++) {
    const x = ((i % SIZE) + 0.5) / SIZE
    const y = (Math.floor(i / SIZE) + 0.5) / SIZE
    if (!within(x, y)) continue
    total++
    if (luminance(image.data[i * 4]!, image.data[i * 4 + 1]!, image.data[i * 4 + 2]!) < middle)
      dark++
  }
  return dark / total
}

/** The mean colour of the pixels within `reach` of a point. */
function patchColour(image: Pixels, [x, y]: Point, reach = 6): Rgb {
  const sum = [0, 0, 0]
  let count = 0
  for (let j = -reach; j <= reach; j++) {
    for (let i = -reach; i <= reach; i++) {
      const colour = colourAt(image, [x + i / SIZE, y + j / SIZE])
      for (let c = 0; c < 3; c++) sum[c]! += colour[c]!
      count++
    }
  }
  return sum.map((c) => c / count) as Rgb
}

describe('face paint as saved', () => {
  test('anything unknown or out of range is made safe', () => {
    expect(readFacePaint(null)).toEqual(NO_PAINT)
    expect(readFacePaint('lipstick')).toEqual(NO_PAINT)
    const paint = readFacePaint({
      eyes: '#3070E0',
      lips: 'red',
      browThickness: 4,
      browDarkness: -9,
      lipAmount: Number.NaN,
      beard: 'handlebar',
      freckles: -1,
    })
    expect(paint.eyes).toBe('#3070E0')
    expect(paint.lips).toBeNull()
    expect(paint.browThickness).toBe(1)
    expect(paint.browDarkness).toBe(-1)
    expect(paint.lipAmount).toBe(NO_PAINT.lipAmount)
    expect(paint.beard).toBe('none')
    expect(paint.freckles).toBe(0)
  })

  test('changes the face only when something is painted', () => {
    expect(hasFacePaint(NO_PAINT)).toBe(false)
    expect(hasFacePaint(null)).toBe(false)
    // A colour at no amount paints nothing.
    expect(hasFacePaint({ ...NO_PAINT, lips: '#aa2233', lipAmount: 0 })).toBe(false)
    expect(hasFacePaint({ ...NO_PAINT, beard: 'full', beardAmount: 0 })).toBe(false)
    for (const change of [
      { eyes: '#3070e0' },
      { browColor: '#c8a060' },
      { browThickness: -0.5 },
      { lips: '#aa2233' },
      { beard: 'goatee' as const },
      { freckles: 0.2 },
      { liner: 0.4 },
    ]) {
      expect(hasFacePaint({ ...NO_PAINT, ...change })).toBe(true)
    }
  })
})

describe('painting a face', () => {
  test('no paint leaves the head as it was, nor does an iris colour (tintIris’s to put on)', () => {
    expect(strayChanges(painted({}), () => false)).toBe(0)
    expect(strayChanges(painted({ eyes: '#3070e0' }), () => false)).toBe(0)
  })

  test('lipstick tints the lips alone, more the more of it', () => {
    const middle = between(at(13), at(14), 0.5)
    const light = painted({ lips: '#d01020', lipAmount: 0.3 })
    const heavy = painted({ lips: '#d01020', lipAmount: 1 })
    expect(redness(colourAt(light, middle))).toBeGreaterThan(redness(LIPS))
    expect(redness(colourAt(heavy, middle))).toBeGreaterThan(redness(colourAt(light, middle)) + 20)
    expect(strayChanges(heavy, nearBox(LIP_OUTLINE, 0.01))).toBe(0)
  })

  test('lipstick reaches the lips’ own edge where it lies above their landmarks', () => {
    const face = drawFace({ lipsUp: 0.008 })
    const heavy = painted({ lips: '#d01020', lipAmount: 1 }, null, BEARD, face)
    // Inside the lips as drawn, past the landmarks' outline and its feather.
    expect(redness(colourAt(heavy, [at(0)[0], at(0)[1] - 0.006]))).toBeGreaterThan(
      redness(LIPS) + 20,
    )
    expect(strayChanges(heavy, nearBox(LIP_OUTLINE, 0.015), face)).toBe(0)
  })

  test('brows grow and thin, darken and fade, and nothing else changes', () => {
    const brows = BROW_HAIRS.flat()
    const around = nearBox(brows, 0.04)
    const as = darkShare(FACE_TEXTURE, brows)
    const thick = painted({ browThickness: 1 })
    const thin = painted({ browThickness: -1 })
    expect(darkShare(thick, brows)).toBeGreaterThan(as * 1.3)
    expect(darkShare(thin, brows)).toBeLessThan(as * 0.75)
    expect(strayChanges(thick, around)).toBe(0)
    expect(strayChanges(thin, around)).toBe(0)

    const spine = between(at(105), at(52), 0.5)
    expect(lightAt(painted({ browDarkness: 1 }), spine)).toBeLessThan(luminance(...BROW) * 0.7)
    const faded = lightAt(painted({ browDarkness: -1 }), spine)
    expect(faded).toBeGreaterThan(luminance(...BROW) * 2)
    // Into the skin round the brow, not a patch paler than it.
    expect(faded).toBeLessThan(luminance(...SKIN) * 1.02)
    // A new colour for the brow hairs, the skin round them as it was.
    const blonde = painted({ browColor: '#c8a060' })
    expect(colourAt(blonde, spine)[0]).toBeGreaterThan(150)
    expect(colourAt(blonde, between(at(105), at(52), -1.2))).toEqual(SKIN)
  })

  test('a new colour keeps to the brows, not a fringe lying over one', () => {
    const [x0] = between(at(334), at(282), 0.5)
    const strip = (x: number, y: number) => Math.abs(x - x0) < 0.012 && y < at(282)[1] + 0.01
    const face = drawFace({ over: (x, y) => (strip(x, y) ? BEARD : null) })
    const hair = new Float32Array(SIZE * SIZE)
    for (let i = 0; i < hair.length; i++) {
      if (strip(((i % SIZE) + 0.5) / SIZE, (Math.floor(i / SIZE) + 0.5) / SIZE)) hair[i] = 1
    }
    const blonde = painted({ browColor: '#c8a060' }, hair, BEARD, face)
    // Its middle, clear of its tip (where it thins, it is partly the brow's).
    const core = (x: number, y: number) =>
      strip(x, y) && Math.abs(x - x0) < 0.006 && y < at(282)[1] - 0.005
    expect(strayChanges(blonde, (x, y) => !core(x, y), face)).toBe(0)
    expect(colourAt(blonde, between(at(105), at(52), 0.5))[0]).toBeGreaterThan(150)
  })

  test('each beard covers its own part of the face, thicker the more of it', () => {
    const lip = between(at(2), at(0), 0.5)
    const chin = at(199)
    const cheek = at(214)
    const forehead = at(151)
    const darker = (image: Pixels, point: Point) => lightAt(image, point) < luminance(...SKIN) * 0.7
    const mustache = painted({ beard: 'mustache', beardAmount: 1 })
    expect(darker(mustache, lip)).toBe(true)
    expect(colourAt(mustache, chin)).toEqual(SKIN)
    expect(colourAt(mustache, cheek)).toEqual(SKIN)
    const goatee = painted({ beard: 'goatee', beardAmount: 1 })
    expect(darker(goatee, lip) && darker(goatee, chin)).toBe(true)
    expect(colourAt(goatee, cheek)).toEqual(SKIN)
    const full = painted({ beard: 'full', beardAmount: 1 })
    expect(darker(full, lip) && darker(full, chin) && darker(full, cheek)).toBe(true)
    for (const beard of [mustache, goatee, full]) expect(colourAt(beard, forehead)).toEqual(SKIN)

    // Over the cheek, on average: sparser at a lower amount, and stubble lighter still.
    const sparse = painted({ beard: 'full', beardAmount: 0.2 })
    const stubble = painted({ beard: 'stubble', beardAmount: 0.5 })
    expect(meanLight(sparse, cheek)).toBeGreaterThan(meanLight(full, cheek) + 10)
    expect(meanLight(stubble, cheek)).toBeGreaterThan(meanLight(sparse, cheek))
    expect(meanLight(stubble, cheek)).toBeLessThan(luminance(...SKIN) - 10)
  })

  test('a mustache hangs over the top of the upper lip', () => {
    const top = between(at(0), at(13), 0.2)
    const mustache = painted({ beard: 'mustache', beardAmount: 1 })
    expect(meanLight(mustache, top)).toBeLessThan(luminance(...LIPS) * 0.7)
  })

  test('a beard grows in the character’s own brows’ colour, unless it is dyed', () => {
    const cheek = at(214)
    const own = patchColour(painted({ beard: 'full', beardAmount: 1 }, null, null), cheek)
    // Brown, as the brows are, and well darker than the skin.
    expect(own[0]).toBeGreaterThan(own[2] + 5)
    expect(luminance(...own)).toBeLessThan(luminance(...SKIN) * 0.7)
    const dyed = patchColour(painted({ beard: 'full', beardAmount: 1 }, null, [40, 80, 200]), cheek)
    expect(dyed[2]).toBeGreaterThan(dyed[0] + 20)
  })

  test('on dark skin, brows hardly apart from it, a beard is still much darker than the skin', () => {
    const skin: Rgb = [90, 58, 42]
    const face = drawFace({ skin, brow: [82, 52, 38] })
    const beard = painted({ beard: 'full', beardAmount: 1 }, null, null, face)
    expect(luminance(...patchColour(beard, at(214)))).toBeLessThan(luminance(...skin) * 0.6)
  })

  test('the character’s hair lies over the beard, blush and freckles, not the lipstick', () => {
    const hair = new Float32Array(SIZE * SIZE).fill(1)
    const paint = { beard: 'full', blush: '#e06070', freckles: 1 } as const
    expect(strayChanges(painted(paint, hair), () => false)).toBe(0)
    expect(strayChanges(painted({ lips: '#d01020' }, hair), () => false)).toBeGreaterThan(0)
  })

  test('make-up keeps to its place', () => {
    const lid = at(159)
    const above = between(lid, at(105), 0.2)
    const cheek = between(at(50), at(33), 0.3)
    const blush = painted({ blush: '#e06070', blushAmount: 1 })
    expect(redness(colourAt(blush, cheek))).toBeGreaterThan(redness(SKIN) + 10)
    expect(colourAt(blush, at(151))).toEqual(SKIN)
    const shadow = painted({ shadow: '#6a4a9a', shadowAmount: 1 })
    const [r, , b] = colourAt(shadow, above)
    expect(b).toBeGreaterThan(r)
    expect(colourAt(shadow, at(145))).toEqual(SKIN)
    expect(strayChanges(shadow, nearBox([...BROW_HAIRS.flat(), at(33), at(263)], 0.05))).toBe(0)
    const liner = painted({ liner: 1 })
    expect(lightAt(liner, [lid[0], lid[1] - 1.5 / SIZE])).toBeLessThan(60)
    expect(colourAt(liner, above)).toEqual(SKIN)
  })

  test('freckles dot the nose and cheeks, the same every time', () => {
    const freckled = painted({ freckles: 1 })
    expect(freckled.data).toEqual(painted({ freckles: 1 }).data)
    const spots = strayChanges(freckled, () => false)
    expect(spots).toBeGreaterThan(0)
    const fewer = strayChanges(painted({ freckles: 0.3 }), () => false)
    expect(fewer).toBeLessThan(spots)
    // None on the forehead or the chin.
    const belowEyes = at(145)[1]
    expect(strayChanges(freckled, (_, y) => y > belowEyes - 0.02 && y < at(0)[1])).toBe(0)
  })
})

describe('a body dressed in a look, placed by its landmarks', () => {
  const GRID = flatHead(16)
  const BODY: Pixels = { data: new Uint8ClampedArray(16 * 16 * 4).fill(200), width: 16, height: 16 }
  const dress = (face: Pixels, change: Partial<Parameters<typeof dressBody>[1]>) =>
    dressBody(
      analyseBody(face, BODY, null, GRID),
      {
        key: 'look',
        avatar: 'look',
        hair: null,
        skin: null,
        face: null,
        paint: NO_PAINT,
        scalp: null,
        stubble: null,
        wig: null,
        shave: 0.35,
        feet: SHOD,
        feetBind: null,
        feetDonor: null,
        target: FACE,
        ...change,
      },
      null,
    ).head!

  test('a beard takes the hair’s dye, else the character’s own brows’ colour — never a cap’s', () => {
    const capped = drawFace({ over: (_, y) => (y < 0.2 ? [40, 70, 150] : null) })
    const paint = { ...NO_PAINT, beard: 'full' as const, beardAmount: 1 }
    const own = patchColour(dress(capped, { paint }), at(214))
    expect(own[0]).toBeGreaterThan(own[2] + 5)
    const dyed = patchColour(dress(capped, { paint, hair: '#c03020' }), at(214))
    expect(dyed[0]).toBeGreaterThan(dyed[1] * 1.5)
  })

  test('face paint goes on over the skin as dyed', () => {
    const skin = '#8a5a40'
    const plain = dress(FACE_TEXTURE, { skin })
    const blushed = dress(FACE_TEXTURE, { skin, paint: { ...NO_PAINT, blush: '#e06070' } })
    const forehead = at(151)
    expect(luminance(...colourAt(plain, forehead))).toBeLessThan(luminance(...SKIN) - 20)
    expect(colourAt(blushed, forehead)).toEqual(colourAt(plain, forehead))
    const cheek = between(at(50), at(33), 0.3)
    expect(redness(colourAt(blushed, cheek))).toBeGreaterThan(redness(colourAt(plain, cheek)) + 5)
  })
})
