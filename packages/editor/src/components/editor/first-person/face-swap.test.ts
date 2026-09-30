import { describe, expect, test } from 'bun:test'
import { FACE_PARTS, FACE_POINT_COUNT, type Point, packPoints } from './face-points'
import { composeFace, FRONT, photoFace, warpFace } from './face-swap'
import type { FrontImage } from './front-render'
import { luminance, type Pixels, type Rgb } from './look-pixels'

/**
 * A face's points (fractions of the image): outline, brows, eyes, nose,
 * lips and irises where a face has them; the rest spread inside the face,
 * all apart.
 */
function facePoints(): Point[] {
  const points: Point[] = Array.from({ length: FACE_POINT_COUNT }, (_, i) => {
    const angle = i * 2.399963
    const r = 0.02 + 0.12 * Math.sqrt(i / FACE_POINT_COUNT)
    return [0.5 + Math.cos(angle) * r, 0.62 + Math.sin(angle) * r * 0.8]
  })
  const ring = (indices: readonly number[], cx: number, cy: number, rx: number, ry: number) =>
    indices.forEach((i, k) => {
      const angle = (k / indices.length) * Math.PI * 2 - Math.PI / 2
      points[i] = [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
    })
  ring(FACE_PARTS.oval, 0.5, 0.58, 0.34, 0.4)
  const half = FACE_PARTS.brows.length / 2
  ring(FACE_PARTS.brows.slice(0, half), 0.62, 0.4, 0.07, 0.012)
  ring(FACE_PARTS.brows.slice(half), 0.38, 0.4, 0.07, 0.012)
  ring(FACE_PARTS.leftEye, 0.62, 0.46, 0.05, 0.018)
  ring(FACE_PARTS.rightEye, 0.38, 0.46, 0.05, 0.018)
  ring(FACE_PARTS.nose, 0.5, 0.56, 0.04, 0.07)
  ring(FACE_PARTS.lips, 0.5, 0.72, 0.08, 0.025)
  ring(FACE_PARTS.leftIris, 0.62, 0.46, 0.012, 0.012)
  ring(FACE_PARTS.rightIris, 0.38, 0.46, 0.012, 0.012)
  return points
}

const SKIN: Rgb = [220, 180, 160]
const HAIR: Rgb = [40, 30, 25]
const BROW: Rgb = [90, 60, 45]

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1

/** A strand of hair down the forehead's side, by the temple, clear of the brow. */
const onStrand = (x: number, y: number) => x > 0.72 && x < 0.78 && y > 0.28 && y < 0.46

/** A mole on the cheek: dark as hair, but no hair. */
const onMole = (x: number, y: number) => Math.hypot(x - 0.66, y - 0.62) < 0.008

/**
 * A photo (the front view's size, so the warp is one to one) of a face with
 * a mole on its cheek and, unless `hair` is null, that hair over its top and
 * a strand of it by the temple.
 */
function photo(hair: Rgb | null = HAIR): Pixels {
  const data = new Uint8ClampedArray(FRONT * FRONT * 4)
  for (let py = 0; py < FRONT; py++) {
    for (let px = 0; px < FRONT; px++) {
      const x = (px + 0.5) / FRONT
      const y = (py + 0.5) / FRONT
      let colour: Rgb = [245, 245, 245]
      if (inEllipse(x, y, 0.5, 0.58, 0.34, 0.4)) colour = SKIN
      if (inEllipse(x, y, 0.62, 0.4, 0.07, 0.012) || inEllipse(x, y, 0.38, 0.4, 0.07, 0.012)) {
        colour = BROW
      }
      if (onMole(x, y)) colour = HAIR
      if (hair && (y < 0.3 || onStrand(x, y))) colour = hair
      data.set([...colour, 255], (py * FRONT + px) * 4)
    }
  }
  return { data, width: FRONT, height: FRONT }
}

const at = (image: Pixels, x: number, y: number): Rgb => {
  const p = (Math.floor(y * FRONT) * FRONT + Math.floor(x * FRONT)) * 4
  return [image.data[p]!, image.data[p + 1]!, image.data[p + 2]!]
}

const near = (a: Rgb, b: Rgb, within: number) => a.every((c, i) => Math.abs(c - b[i]!) <= within)

describe('face swap', () => {
  const points = packPoints(facePoints())
  const warp = warpFace(photo(), points, points)

  test('the photo’s face keeps its features but loses its hair', () => {
    const face = photoFace(warp, 0.5)
    // The strand by the temple is skin now; so is the hair over the top of the face.
    expect(near(at(face, 0.75, 0.4), SKIN, 30)).toBe(true)
    expect(near(at(face, 0.5, 0.285), SKIN, 30)).toBe(true)
    // The brow, dark as the hair nearly, stays; so does the mole, hair-dark but apart from it.
    expect(luminance(...at(face, 0.62, 0.4))).toBeLessThan(luminance(...SKIN) * 0.6)
    expect(luminance(...at(face, 0.66, 0.62))).toBeLessThan(luminance(...SKIN) * 0.6)
    // The cheek is untouched.
    expect(near(at(face, 0.36, 0.62), SKIN, 6)).toBe(true)
  })

  test('leaves a face be when past its top is nothing clearly unlike its skin', () => {
    // A short haircut against a beige wall: the band past the face is near the skin.
    const wall: Rgb = [200, 170, 150]
    const walled = photoFace(warpFace(photo(wall), points, points), 0.5)
    expect(near(at(walled, 0.36, 0.62), SKIN, 6)).toBe(true)
    expect(luminance(...at(walled, 0.66, 0.62))).toBeLessThan(luminance(...SKIN) * 0.6)
    const bare = photoFace(warpFace(photo(null), points, points), 0.5)
    expect(near(at(bare, 0.5, 0.33), SKIN, 6)).toBe(true)
    expect(near(at(bare, 0.75, 0.4), SKIN, 6)).toBe(true)
    expect(luminance(...at(bare, 0.66, 0.62))).toBeLessThan(luminance(...SKIN) * 0.6)
  })

  /** The character's front view: its own skin, hair over its forehead, and its own brow. */
  function character(): { front: FrontImage; hair: Float32Array } {
    const own: Rgb = [170, 120, 95]
    const data = new Uint8ClampedArray(FRONT * FRONT * 4)
    const hair = new Float32Array(FRONT * FRONT)
    for (let py = 0; py < FRONT; py++) {
      for (let px = 0; px < FRONT; px++) {
        const x = (px + 0.5) / FRONT
        const y = (py + 0.5) / FRONT
        const i = py * FRONT + px
        const fringe = y < 0.34
        const brow = inEllipse(x, y, 0.38, 0.4, 0.07, 0.012)
        hair[i] = fringe || brow ? 1 : 0
        data.set([...(fringe ? HAIR : brow ? BROW : own), 255], i * 4)
      }
    }
    return {
      front: {
        image: { data, width: FRONT, height: FRONT },
        depth: new Float32Array(FRONT * FRONT),
      },
      hair,
    }
  }

  test('meets the character’s skin tone, under its fringe, taking over its brows', () => {
    const { front, hair } = character()
    const face = photoFace(warp, 0.5)
    const { image, weight } = composeFace(front, hair, warp, face, 1)
    // The cheek takes the character's tone, not the photo's.
    expect(near(at(image, 0.36, 0.62), [170, 120, 95], 20)).toBe(true)
    // The fringe over the forehead stays the character's...
    expect(weight[Math.floor(0.31 * FRONT) * FRONT + Math.floor(0.5 * FRONT)]).toBe(0)
    // ...its own brow, apart from it, gives way to the photo's.
    expect(weight[Math.floor(0.4 * FRONT) * FRONT + Math.floor(0.38 * FRONT)]).toBeGreaterThan(0.9)
    // The photo's brow is darker than the skin around it on the character too.
    expect(luminance(...at(image, 0.62, 0.4))).toBeLessThan(luminance(...at(image, 0.62, 0.52)))
  })

  test('less than a full blend brings the photo’s own colours back', () => {
    const { front, hair } = character()
    const face = photoFace(warp, 0.5)
    const none = at(composeFace(front, hair, warp, face, 0).image, 0.36, 0.62)
    const half = at(composeFace(front, hair, warp, face, 0.5).image, 0.36, 0.62)
    const full = at(composeFace(front, hair, warp, face, 1).image, 0.36, 0.62)
    expect(near(none, at(face, 0.36, 0.62), 4)).toBe(true)
    for (let c = 0; c < 3; c++) expect(half[c]).toBeCloseTo((none[c]! + full[c]!) / 2, -1)
  })
})
