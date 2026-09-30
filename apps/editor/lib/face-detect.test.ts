import { describe, expect, test } from 'bun:test'
import {
  FACE_PARTS,
  FACE_POINT_COUNT,
  FACE_POINT_INDICES,
  type FacePoint,
} from '@pascal-app/editor'
import {
  cropBox,
  type DetectedFace,
  facePointsIn,
  irisAlbedo,
  poseFromMatrix,
  poseMessage,
  sampleFaceColors,
  sampleIrisColor,
  sampleSkinColor,
  skinAlbedo,
} from './face-detect'

type Rgb = [number, number, number]

function image(width: number, height: number, paint: (x: number, y: number) => Rgb) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      data.set([...paint(x + 0.5, y + 0.5), 255], p)
    }
  }
  return { data, width, height }
}

/** MediaPipe's 478 landmarks, all unknown (as a stored face's are, but for its subset) unless set. */
const landmarks = (set: Record<number, FacePoint> = {}): FacePoint[] =>
  Array.from({ length: 478 }, (_, i) => set[i] ?? [Number.NaN, Number.NaN])

const cheekIndices = FACE_PARTS.cheeks.map((i) => FACE_POINT_INDICES[i]!)

/** MediaPipe's eye openings, round the lids' edges: the subject's right eye, then left. */
const OPENINGS = [
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
] as const

/** A seeded generator, so the random cases are the same every run. */
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

/** Every channel random, alpha too (the samplers read colour only). */
function noise(width: number, height: number, random: () => number) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 256)
  return { data, width, height }
}

function evenOdd(polygon: readonly FacePoint[], x: number, y: number) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > y !== yj > y && x < xi + ((xj - xi) * (y - yi)) / (yj - yi)) inside = !inside
  }
  return inside
}

/**
 * The slow way: every pixel, scanned over a generous square, whose centre lies in the ring
 * (and the polygon), read at its coordinates clamped to the image.
 */
function slowRing(
  { data, width, height }: ReturnType<typeof noise>,
  [cx, cy]: FacePoint,
  inner: number,
  outer: number,
  within?: readonly FacePoint[],
): Rgb[] {
  const found: Rgb[] = []
  for (let y = Math.floor(cy - outer) - 3; y <= cy + outer + 3; y++) {
    for (let x = Math.floor(cx - outer) - 3; x <= cx + outer + 3; x++) {
      const distanceSq = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
      if (distanceSq < inner * inner || distanceSq > outer * outer) continue
      if (within && !evenOdd(within, x + 0.5, y + 0.5)) continue
      const p =
        (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4
      found.push([data[p]!, data[p + 1]!, data[p + 2]!])
    }
  }
  return found
}

describe('crop box', () => {
  // Landmarks spanning 200 × 260 px, from (400, 300).
  const face: FacePoint[] = [
    [400, 300],
    [600, 560],
    [500, 430],
  ]

  test('a square 1.7× the face, raised a little for the forehead', () => {
    const box = cropBox(face, 1000, 1000)
    expect(box.size).toBeCloseTo(1.7 * 260)
    expect(box.x + box.size / 2).toBeCloseTo(500)
    expect(box.y + box.size / 2).toBeCloseTo(430 - 0.08 * 260)
  })

  test('slides into the photo when the face is near its edge', () => {
    const box = cropBox(
      face.map(([x, y]) => [x - 380, y]),
      1000,
      1000,
    )
    expect(box.x).toBe(0)
    expect(box.size).toBeCloseTo(1.7 * 260)
  })

  test('overhangs a photo the face fills, covering all of it', () => {
    // The face (now 100–300 × 80–340) in a photo smaller than its 442 px square.
    const box = cropBox(
      face.map(([x, y]) => [x - 300, y - 220]),
      380,
      400,
    )
    expect(box.size).toBeCloseTo(1.7 * 260)
    expect(box.x).toBeLessThanOrEqual(0)
    expect(box.x + box.size).toBeGreaterThanOrEqual(380)
    expect(box.y).toBeLessThanOrEqual(0)
    expect(box.y + box.size).toBeGreaterThanOrEqual(400)
  })

  test('inside the photo when it fits, over all of it when not, and always round the whole face', () => {
    const random = seeded(5)
    for (let trial = 0; trial < 400; trial++) {
      const width = 100 + random() * 1500
      const height = 100 + random() * 1500
      // A face anywhere in the photo, from a sliver of it to all of it.
      const faceWidth = (0.05 + 0.95 * random()) * width
      const faceHeight = Math.min(height, faceWidth * (0.8 + 0.8 * random()))
      const left = random() * (width - faceWidth)
      const top = random() * (height - faceHeight)
      const points = Array.from(
        { length: 478 },
        (_, i): FacePoint =>
          i < 2
            ? [left + i * faceWidth, top + i * faceHeight]
            : [left + random() * faceWidth, top + random() * faceHeight],
      )
      const box = cropBox(points, width, height)
      for (const [start, extent] of [
        [box.x, width],
        [box.y, height],
      ] as const) {
        if (box.size <= extent) {
          expect(start).toBeGreaterThanOrEqual(0)
          expect(start + box.size).toBeLessThanOrEqual(extent + 1e-9)
        } else {
          expect(start).toBeLessThanOrEqual(0)
          expect(start + box.size).toBeGreaterThanOrEqual(extent - 1e-9)
        }
      }
      const fractions = facePointsIn(points, box)
      expect(Math.min(...fractions)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...fractions)).toBeLessThanOrEqual(1)
    }
  })
})

describe('face points in a crop', () => {
  test('the subset, in order, as fractions of the box', () => {
    const points = Array.from({ length: 478 }, (_, i): FacePoint => [i, 2 * i])
    const flat = facePointsIn(points, { x: 10, y: 20, size: 1000 })
    expect(flat).toHaveLength(FACE_POINT_COUNT * 2)
    FACE_POINT_INDICES.forEach((index, i) => {
      expect(flat[2 * i]).toBeCloseTo((index - 10) / 1000, 4)
      expect(flat[2 * i + 1]).toBeCloseTo((2 * index - 20) / 1000, 4)
    })
  })

  test('a face lies well inside its own crop box', () => {
    const points = Array.from(
      { length: 478 },
      (_, i): FacePoint => [300 + 150 * Math.cos(i), 400 + 200 * Math.sin(i)],
    )
    const flat = facePointsIn(points, cropBox(points, 1200, 1200))
    for (const value of flat) {
      expect(value).toBeGreaterThan(0.1)
      expect(value).toBeLessThan(0.9)
    }
  })
})

const hexOf = (rgb: Rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
const lightness = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b

describe('skin albedo', () => {
  test('sets lightness against the whites of the eyes, whatever the exposure', () => {
    const bright = skinAlbedo([220, 180, 160], [240, 240, 240])
    const dim = skinAlbedo([143, 117, 104], [156, 156, 156])
    expect(lightness(bright)).toBeCloseTo(lightness(dim), 0)
    // Darker skin against the same whites comes out darker.
    expect(lightness(skinAlbedo([120, 80, 60], [240, 240, 240]))).toBeLessThan(
      lightness(bright) * 0.6,
    )
  })

  test('lifts a dark photo only so far on its whites', () => {
    // Whites reading as dark as mid-grey: in shade, or a very dark photo.
    const usual = lightness(skinAlbedo([100, 70, 56], null))
    const lifted = lightness(skinAlbedo([100, 70, 56], [110, 110, 110]))
    expect(lifted).toBeGreaterThan(usual * 1.5)
    expect(lifted).toBeLessThanOrEqual(usual * 1.8 + 0.5)
  })

  test('keeps within the textures’ range of lightness', () => {
    expect(lightness(skinAlbedo([255, 250, 245], [200, 200, 200]))).toBeLessThanOrEqual(155.5)
    expect(lightness(skinAlbedo([20, 12, 10], null))).toBeGreaterThanOrEqual(39.5)
  })

  test('ignores “whites” not clearly lighter than the skin: they were lid or shadow', () => {
    const skin: Rgb = [200, 150, 120]
    expect(skinAlbedo(skin, [129, 102, 90])).toEqual(skinAlbedo(skin, null))
    // Only 5 % lighter than the skin, then 14 %.
    expect(skinAlbedo(skin, [166, 166, 166])).toEqual(skinAlbedo(skin, null))
    expect(skinAlbedo(skin, [180, 180, 180])).not.toEqual(skinAlbedo(skin, null))
  })

  test('keeps the tint’s direction, strengthening a washed-out one', () => {
    const [r, g, b] = skinAlbedo([235, 215, 205], null)
    const l = lightness([r, g, b])
    expect((r - g) / l).toBeGreaterThan((235 - 215) / 220)
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    // Pinker in, pinker out.
    const pink = skinAlbedo([220, 170, 170], null)
    const yellow = skinAlbedo([220, 190, 140], null)
    expect(pink[0] - pink[1]).toBeGreaterThan(yellow[0] - yellow[1])
    expect(yellow[1] - yellow[2]).toBeGreaterThan(pink[1] - pink[2])
  })
})

describe('iris albedo', () => {
  test('sets lightness against the whites of the eyes, whatever the exposure', () => {
    const bright = irisAlbedo([110, 62, 47], [230, 228, 225])
    const dim = irisAlbedo([77, 43, 33], [161, 160, 158])
    expect(lightness(bright)).toBeCloseTo(lightness(dim), 0)
    // A brown iris comes out as dark as a texture's: well under the photo's.
    expect(lightness(bright)).toBeLessThan(lightness([110, 62, 47]))
  })

  test('keeps the tint’s direction, a little softer', () => {
    const [r, g, b] = irisAlbedo([110, 62, 47], null)
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    expect((r - g) / lightness([r, g, b])).toBeLessThan((110 - 62) / lightness([110, 62, 47]))
    const [br, bg, bb] = irisAlbedo([70, 110, 150], null)
    expect(bb).toBeGreaterThan(bg)
    expect(bg).toBeGreaterThan(br)
  })
})

describe('skin colour', () => {
  const skin: Rgb = [200, 150, 120]
  // Irises 200 px apart: disks of 5 px around each cheek point.
  const points = landmarks({
    468: [100, 150],
    473: [300, 150],
    ...Object.fromEntries(cheekIndices.map((index, k) => [index, [40 + 35 * k, 260]])),
  })
  const onCheek = (x: number, y: number) =>
    cheekIndices.some((index) => Math.hypot(x - points[index]![0], y - points[index]![1]) < 8)

  test('reads the cheeks only', () => {
    const pixels = image(400, 400, (x, y) => (onCheek(x, y) ? skin : [40, 30, 20]))
    expect(sampleSkinColor(pixels, points)).toBe(hexOf(skinAlbedo(skin, null)))
  })

  test('drops the darkest and brightest fifth (stubble, freckles, shine)', () => {
    const pixels = image(400, 400, (x, y) => {
      const n = (Math.floor(x) * 7 + Math.floor(y) * 3) % 10
      if (n === 0) return [10, 5, 5]
      if (n === 5) return [255, 250, 245]
      return onCheek(x, y) ? skin : [40, 30, 20]
    })
    expect(sampleSkinColor(pixels, points)).toBe(hexOf(skinAlbedo(skin, null)))
  })

  test('matches the slow way, disks over the photo’s edges and centred on pixel corners too', () => {
    const random = seeded(7)
    for (let trial = 0; trial < 60; trial++) {
      const pixels = noise(40 + Math.floor(random() * 60), 40 + Math.floor(random() * 60), random)
      const set: Record<number, FacePoint> = { 468: [random() * 90, random() * 90] }
      const eyes = 20 + random() * 300
      const angle = random() * 2 * Math.PI
      set[473] = [set[468]![0] + eyes * Math.cos(angle), set[468]![1] + eyes * Math.sin(angle)]
      for (const index of cheekIndices) {
        const x = -5 + random() * (pixels.width + 10)
        const y = -5 + random() * (pixels.height + 10)
        set[index] = trial % 3 ? [x, y] : [Math.round(x), Math.round(y)]
      }
      const cheeks = landmarks(set)
      const radius = Math.max(1, 0.025 * eyes)
      const colours = cheekIndices
        .flatMap((index) => slowRing(pixels, cheeks[index]!, 0, radius))
        .sort((a, b) => lightness(a) - lightness(b))
      const drop = Math.floor(colours.length * 0.2)
      const kept = colours.slice(drop, colours.length - drop)
      const mean = [0, 1, 2].map(
        (c) => kept.reduce((sum, colour) => sum + colour[c]!, 0) / kept.length,
      )
      expect(sampleSkinColor(pixels, cheeks)).toBe(hexOf(skinAlbedo(mean as Rgb, null)))
    }
  })

  test('reads the colour, whatever the alpha', () => {
    const pixels = image(400, 400, (x, y) => (onCheek(x, y) ? skin : [40, 30, 20]))
    for (let p = 3; p < pixels.data.length; p += 4) pixels.data[p] = (p * 37) % 256
    expect(sampleSkinColor(pixels, points)).toBe(hexOf(skinAlbedo(skin, null)))
  })

  describe('against the whites of the eyes', () => {
    const white: Rgb = [228, 222, 218]
    const irisRadius = 12
    const centres: FacePoint[] = [
      [100, 150],
      [300, 150],
    ]
    const set: Record<number, FacePoint> = {
      ...Object.fromEntries(cheekIndices.map((index, k) => [index, [40 + 35 * k, 260]])),
    }
    const lids = centres.map(([cx, cy], side) => {
      const first = side ? 473 : 468
      set[first] = [cx, cy]
      set[first + 1] = [cx + irisRadius, cy]
      set[first + 2] = [cx, cy - irisRadius]
      set[first + 3] = [cx - irisRadius, cy]
      set[first + 4] = [cx, cy + irisRadius]
      return OPENINGS[side]!.map((index, k): FacePoint => {
        const angle = (2 * Math.PI * k) / OPENINGS[side]!.length
        set[index] = [cx + 2.6 * irisRadius * Math.cos(angle), cy + 11 * Math.sin(angle)]
        return set[index]!
      })
    })
    /** Skin all round; between the lids, the iris and around it `opening(dx)`, `dx` from its centre. */
    const face = (opening: (dx: number) => Rgb) =>
      image(400, 400, (x, y) => {
        const side = lids.findIndex((outline) => evenOdd(outline, x, y))
        if (side < 0) return skin
        const [cx, cy] = centres[side]!
        return Math.hypot(x - cx, y - cy) < irisRadius ? [70, 110, 150] : opening(x - cx)
      })

    test('sets the lightness against them where they show', () => {
      // The whites shadowed in the corners: their lighter half is what counts.
      const pixels = face((dx) => (Math.abs(dx) > 2.1 * irisRadius ? [150, 140, 136] : white))
      expect(sampleSkinColor(pixels, landmarks(set))).toBe(hexOf(skinAlbedo(skin, white)))
      // Shut eyes show none: the photo's exposure is guessed instead.
      const shut = landmarks({
        ...set,
        ...Object.fromEntries(
          OPENINGS.flatMap((opening, side) =>
            opening.map((index) => [index, [set[index]![0], centres[side]![1]]]),
          ),
        ),
      })
      expect(sampleSkinColor(pixels, shut)).toBe(hexOf(skinAlbedo(skin, null)))
    })

    test('does not take a squint’s lids, or the sliver of white it leaves, for them', () => {
      const lid: Rgb = [235, 185, 160]
      // Narrowed eyes: lid skin (lit brighter than the cheeks) all that shows round the irises…
      expect(
        sampleSkinColor(
          face(() => lid),
          landmarks(set),
        ),
      ).toBe(hexOf(skinAlbedo(skin, null)))
      // …or but for the whites' far corners.
      const sliver = face((dx) => (Math.abs(dx) > 2.4 * irisRadius ? white : lid))
      expect(sampleSkinColor(sliver, landmarks(set))).toBe(hexOf(skinAlbedo(skin, null)))
    })
  })
})

describe('iris colour', () => {
  const iris: Rgb = [70, 110, 150]
  const lid: Rgb = [205, 160, 135]
  const RADIUS = 20
  const CENTRES: FacePoint[] = [
    [100, 100],
    [200, 100],
  ]

  /**
   * Both eyes' landmarks: each iris (its centre and four rim points) and its opening, an
   * almond reaching `open` px above and below the iris's centre.
   */
  function eyes(open: number, radius = RADIUS) {
    const set: Record<number, FacePoint> = {}
    CENTRES.forEach(([cx, cy], side) => {
      const first = side ? 473 : 468
      set[first] = [cx, cy]
      set[first + 1] = [cx + radius, cy]
      set[first + 2] = [cx, cy - radius]
      set[first + 3] = [cx - radius, cy]
      set[first + 4] = [cx, cy + radius]
      OPENINGS[side]!.forEach((index, k) => {
        const angle = (2 * Math.PI * k) / OPENINGS[side]!.length
        set[index] = [cx + 2 * RADIUS * Math.cos(angle), cy + open * Math.sin(angle)]
      })
    })
    return landmarks(set)
  }

  /** The eyes as `eyes(open)` places them: black pupils, a catch light each, lids past the opening. */
  const paint =
    (open: number, over: (x: number, y: number) => Rgb | null = () => null) =>
    (x: number, y: number): Rgb => {
      const covered = over(x, y)
      if (covered) return covered
      for (const [cx, cy] of CENTRES) {
        const d = Math.hypot(x - cx, y - cy)
        if (d > RADIUS) continue
        if ((x - cx) ** 2 / (2 * RADIUS) ** 2 + (y - cy) ** 2 / open ** 2 > 1) return lid
        if (d < 6) return [5, 5, 5]
        if (Math.hypot(x - (cx + 8), y - (cy - 8)) < 3) return [255, 255, 255]
        return iris
      }
      return [235, 232, 228]
    }

  test('the ring between pupil and white, less its catch light', () => {
    expect(sampleIrisColor(image(300, 200, paint(24)), eyes(24))).toBe('#466e96')
  })

  test('only where it shows between the lids', () => {
    // A smile: the lids hide three fifths of the ring.
    expect(sampleIrisColor(image(300, 200, paint(7)), eyes(7))).toBe('#466e96')
  })

  test('shrugs off a lash across it and a lid the landmarks miss', () => {
    const pixels = image(
      300,
      200,
      paint(24, (_, y) => {
        if (y < 88) return lid
        if (Math.abs(y - 106) < 1) return [8, 6, 6]
        return null
      }),
    )
    expect(sampleIrisColor(pixels, eyes(24))).toBe('#466e96')
  })

  test('as a texture holds it, against the whites around it', () => {
    const { eyes: found } = sampleFaceColors(image(300, 200, paint(24)), eyes(24))
    expect(found).toBe(hexOf(irisAlbedo(iris, [235, 232, 228])))
  })

  test('none from irises too small to read, or from shut eyes', () => {
    expect(sampleIrisColor(image(300, 200, paint(24)), eyes(24, 2))).toBeNull()
    expect(sampleIrisColor(image(300, 200, paint(0.3)), eyes(0.3))).toBeNull()
  })

  test('the one eye big enough to read, when the other is not', () => {
    const points = eyes(24)
    // The subject's left iris, a 2 px radius.
    for (let k = 1; k <= 4; k++) {
      const [x, y] = points[473 + k]!
      points[473 + k] = [200 + (x - 200) / 10, 100 + (y - 100) / 10]
    }
    expect(sampleIrisColor(image(300, 200, paint(24)), points)).toBe('#466e96')
  })

  test('matches the slow way, on random eyes and lids', () => {
    const random = seeded(11)
    for (let trial = 0; trial < 80; trial++) {
      const pixels = noise(60 + Math.floor(random() * 60), 60 + Math.floor(random() * 60), random)
      const set: Record<number, FacePoint> = {}
      const kept: Rgb[] = []
      for (const side of [0, 1]) {
        const first = side ? 473 : 468
        const cx = random() * pixels.width
        const cy = random() * pixels.height
        const centre: FacePoint = trial % 4 ? [cx, cy] : [Math.round(cx), Math.round(cy)]
        const rims = [0, 1, 2, 3].map(() => 1 + random() * 15)
        set[first] = centre
        set[first + 1] = [centre[0] + rims[0]!, centre[1]]
        set[first + 2] = [centre[0], centre[1] - rims[1]!]
        set[first + 3] = [centre[0] - rims[2]!, centre[1]]
        set[first + 4] = [centre[0], centre[1] + rims[3]!]
        const radius = rims.reduce((sum, r) => sum + r, 0) / 4
        // A ragged opening, which may cross itself.
        const open = 0.3 + random() * 1.5
        const lids = OPENINGS[side]!.map((index, k): FacePoint => {
          const angle = (2 * Math.PI * k) / OPENINGS[side]!.length
          set[index] = [
            centre[0] + 2.2 * radius * Math.cos(angle) * (0.7 + 0.6 * random()),
            centre[1] + open * radius * Math.sin(angle) * (0.7 + 0.6 * random()),
          ]
          return set[index]!
        })
        if (radius < 3) continue
        const ring = slowRing(pixels, centre, 0.35 * radius, 0.85 * radius, lids)
        const brightest = Math.max(0, ...ring.map(lightness))
        kept.push(...ring.filter((c) => lightness(c) <= 0.9 * brightest && lightness(c) >= 20))
      }
      const median = (c: number) =>
        kept.map((colour) => colour[c]!).sort((a, b) => a - b)[Math.floor(kept.length / 2)]!
      const expected = kept.length ? hexOf([median(0), median(1), median(2)]) : null
      expect(sampleIrisColor(pixels, landmarks(set))).toBe(expected)
    }
  })
})

describe('sampling speed', () => {
  test('a close-up selfie from a 12-megapixel phone, eyes 1000 px apart', () => {
    const width = 4032
    const height = 3024
    const data = new Uint8ClampedArray(width * height * 4)
    const words = new Uint32Array(data.buffer)
    let state = 12345
    for (let i = 0; i < words.length; i++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      words[i] = state
    }
    const pixels = { data, width, height }
    const [cx, cy, eyes, radius] = [2000, 1400, 1000, 93]
    const set: Record<number, FacePoint> = {}
    ;[cx - eyes / 2, cx + eyes / 2].forEach((x, side) => {
      const first = side ? 473 : 468
      set[first] = [x, cy]
      set[first + 1] = [x + radius, cy]
      set[first + 2] = [x, cy - radius]
      set[first + 3] = [x - radius, cy]
      set[first + 4] = [x, cy + radius]
      OPENINGS[side]!.forEach((index, k) => {
        const angle = (2 * Math.PI * k) / OPENINGS[side]!.length
        set[index] = [x + 2.6 * radius * Math.cos(angle), cy + 0.9 * radius * Math.sin(angle)]
      })
    })
    cheekIndices.forEach((index, k) => {
      set[index] = [cx - 0.6 * eyes + (k * 1.2 * eyes) / 9, cy + 0.5 * eyes]
    })
    const points = landmarks(set)
    sampleSkinColor(pixels, points)
    sampleIrisColor(pixels, points)
    const start = performance.now()
    for (let k = 0; k < 4; k++) {
      sampleSkinColor(pixels, points)
      sampleIrisColor(pixels, points)
    }
    // It took 130 ms when every pixel of the ring round each iris was tested against the lids.
    expect((performance.now() - start) / 4).toBeLessThan(60)
  })
})

describe('head pose', () => {
  const degrees = Math.PI / 180
  type Matrix3 = number[][]
  const multiply = (a: Matrix3, b: Matrix3): Matrix3 =>
    a.map((row) => [0, 1, 2].map((j) => row.reduce((sum, v, k) => sum + v * b[k]![j]!, 0)))
  const aboutX = (t: number): Matrix3 => [
    [1, 0, 0],
    [0, Math.cos(t), -Math.sin(t)],
    [0, Math.sin(t), Math.cos(t)],
  ]
  const aboutY = (t: number): Matrix3 => [
    [Math.cos(t), 0, Math.sin(t)],
    [0, 1, 0],
    [-Math.sin(t), 0, Math.cos(t)],
  ]
  const aboutZ = (t: number): Matrix3 => [
    [Math.cos(t), -Math.sin(t), 0],
    [Math.sin(t), Math.cos(t), 0],
    [0, 0, 1],
  ]
  /**
   * MediaPipe's column-major 4×4: the head leaned, nodded and turned (roll, then pitch, then
   * yaw about its own axes), scaled, then carried by `view` and set at `position`.
   */
  function transform(
    [yaw, pitch, roll]: readonly [number, number, number],
    { scale = 1, view = aboutX(0), position = [0, 0, -45] } = {},
  ): number[] {
    const turn = multiply(
      aboutZ(roll * degrees),
      multiply(aboutX(-pitch * degrees), aboutY(yaw * degrees)),
    )
    const r = multiply(view, turn)
    return [0, 1, 2, 3].flatMap((column) =>
      column < 3 ? [...r.map((row) => row[column]! * scale), 0] : [...position, 1],
    )
  }
  const expectPose = (data: number[], [yaw, pitch, roll]: readonly [number, number, number]) => {
    const pose = poseFromMatrix(data)
    expect(pose.yaw).toBeCloseTo(yaw)
    expect(pose.pitch).toBeCloseTo(pitch)
    expect(pose.roll).toBeCloseTo(roll)
  }

  test('a face straight at the camera', () => {
    expectPose(transform([0, 0, 0]), [0, 0, 0])
  })

  test('turn, nod and lean come back apart, whatever the fit’s scale', () => {
    for (const angles of [
      [25, -10, 15],
      [-40, 20, -70],
      [5, 30, 170],
    ] as const) {
      expectPose(transform(angles, { scale: 1.35 }), angles)
    }
  })

  test('a positive yaw points the face to the image’s right (the subject’s left)', () => {
    const turned = transform([30, 0, 0])
    // The face's forward axis (third column) leans towards +x.
    expect(turned[8]).toBeGreaterThan(0)
    expectPose(turned, [30, 0, 0])
  })

  test('a face looking into the lens off the camera’s axis is head-on', () => {
    // Above the axis, so the camera sees it from below (its forward axis tipped down to the lens)…
    expectPose(
      transform([0, 0, 0], { view: aboutX(Math.atan2(20, 60)), position: [0, 20, -60] }),
      [0, 0, 0],
    )
    // …and to the right, turned back towards the lens.
    expectPose(
      transform([0, 0, 0], { view: aboutY(-Math.atan2(25, 60)), position: [25, 0, -60] }),
      [0, 0, 0],
    )
    // Off the axis and turned, nodded and leaning against the line of sight.
    expectPose(
      transform([20, 5, 10], { view: aboutX(Math.atan2(20, 60)), position: [0, 20, -60] }),
      [20, 5, 10],
    )
  })

  test('a photo turned a quarter clockwise leans −90° and nothing else', () => {
    // The face's up (second column) along the image's right, its left (first) down it.
    expectPose([0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, -50, 1], [0, 0, -90])
  })

  test('any turn, nod and lean, anywhere in the frame, comes back apart', () => {
    const random = seeded(3)
    for (let trial = 0; trial < 300; trial++) {
      const position = [60 * random() - 30, 60 * random() - 30, -40 - 40 * random()]
      // The camera turned to look at the face, keeping its x level: yaw about y, then pitch about x.
      const [x, y, z] = position.map((v) => -v / Math.hypot(...position)) as [
        number,
        number,
        number,
      ]
      const view = multiply(aboutY(Math.atan2(x, z)), aboutX(-Math.asin(y)))
      const angles = [178 * random() - 89, 178 * random() - 89, 358 * random() - 179] as const
      expectPose(transform(angles, { scale: 0.8 + random(), view, position }), angles)
    }
  })

  test('no line of sight (a face at or behind the camera) reads against the camera’s axis', () => {
    expectPose(new Array(16).fill(0), [0, 0, 0])
    expectPose(transform([30, -10, 5], { position: [0, 0, 0] }), [30, -10, 5])
    expectPose(transform([30, -10, 5], { position: [5, 5, 10] }), [30, -10, 5])
  })
})

describe('pose hint', () => {
  const face = (yaw: number, pitch: number, roll: number): DetectedFace => ({
    points: [],
    yaw,
    pitch,
    roll,
  })

  test('none for a face near enough head-on', () => {
    expect(poseMessage(face(10, -12, 18))).toBeNull()
    expect(poseMessage(face(-15, 15, -20))).toBeNull()
    expect(poseMessage(face(15.01, 0, 0))).toContain('옆으로 돌아가')
    expect(poseMessage(face(0, -15.01, 0))).toContain('위나 아래로')
    expect(poseMessage(face(0, 0, 20.01))).toContain('똑바로 선 사진')
  })

  test('the turn first, then the nod, then the lean', () => {
    expect(poseMessage(face(-20, 25, 40))).toContain('옆으로 돌아가')
    expect(poseMessage(face(3, -16, 40))).toContain('위나 아래로')
    expect(poseMessage(face(3, 4, -25))).toContain('똑바로 선 사진')
  })
})
