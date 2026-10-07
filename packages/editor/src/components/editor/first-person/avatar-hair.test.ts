import { describe, expect, test } from 'bun:test'
import {
  capFade,
  capPixels,
  cardKinds,
  carryPoints,
  foldTwins,
  GEAR,
  HAIR,
  LASH,
  remapBones,
} from './avatar-hair'
import { BALD, packFlags, readHairStyle, unpackFlags } from './hair-styles'
import type { Pixels } from './look-pixels'

/** A quad's two triangles: corners (x, y, z each) in order round it. */
function quads(corners: number[][][]) {
  const positions: number[] = []
  const index: number[] = []
  for (const quad of corners) {
    const at = positions.length / 3
    for (const corner of quad) positions.push(...corner)
    index.push(at, at + 1, at + 2, at, at + 2, at + 3)
  }
  return { positions, index }
}

describe('an opacity mesh’s pieces', () => {
  // Eyes 3.4 cm either side of the middle, the face looking along +z.
  const eyes = [0.034, 1.6, 0.09, -0.034, 1.6, 0.09]
  const { positions, index } = quads([
    // A lash under the left eye.
    [
      [0.02, 1.59, 0.1],
      [0.05, 1.59, 0.1],
      [0.05, 1.595, 0.1],
      [0.02, 1.595, 0.1],
    ],
    // A hair card over the crown.
    [
      [-0.05, 1.72, 0],
      [0.05, 1.72, 0],
      [0.05, 1.74, -0.05],
      [-0.05, 1.74, -0.05],
    ],
    // A visor far out in front of the face.
    [
      [-0.08, 1.55, 0.18],
      [0.08, 1.55, 0.18],
      [0.08, 1.66, 0.19],
      [-0.08, 1.66, 0.19],
    ],
    // A hoop earring seen edge on, by the right ear, below the eyes.
    [
      [-0.075, 1.5, -0.03],
      [-0.075, 1.5, 0.01],
      [-0.075, 1.56, 0.01],
      [-0.075, 1.56, -0.03],
    ],
    // A lock of hair by the left ear, lying across the face.
    [
      [0.06, 1.5, 0],
      [0.09, 1.5, 0],
      [0.09, 1.56, 0.002],
      [0.06, 1.56, 0.002],
    ],
  ])

  test('tells lashes, hair and gear apart', () => {
    const kinds = cardKinds(positions, index, eyes)
    expect([...kinds]).toEqual([LASH, LASH, HAIR, HAIR, GEAR, GEAR, GEAR, GEAR, HAIR, HAIR])
  })

  test('takes triangles joined only at a spot (a texture seam) for one piece', () => {
    // A card split in two at a seam, its halves' corners there at one spot
    // but points of their own: one half all round the left eye, which alone
    // would be a lash; the other reaching well away from it.
    const halves = (gap: number) =>
      quads([
        [
          [0.02, 1.59, 0.1],
          [0.05, 1.59, 0.1],
          [0.05, 1.61, 0.1],
          [0.02, 1.61, 0.1],
        ],
        [
          [0.05 + gap, 1.59, 0.1],
          [0.12, 1.59, 0.1],
          [0.12, 1.61, 0.1],
          [0.05 + gap, 1.61, 0.1],
        ],
      ])
    const joined = halves(0)
    expect([...cardKinds(joined.positions, joined.index, eyes)]).toEqual([HAIR, HAIR, HAIR, HAIR])
    const apart = halves(0.01)
    expect([...cardKinds(apart.positions, apart.index, eyes)]).toEqual([LASH, LASH, HAIR, HAIR])
  })
})

describe('folding two-sided cards', () => {
  // A square card twice over (points 0–3, and 4–7 at the same spots).
  const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]
  const positions = [...square, ...square]
  const facing = (front: number, back: number) => [
    ...[0, 1, 2, 3].flatMap(() => [0, 0, front]),
    ...[0, 1, 2, 3].flatMap(() => [0, 0, back]),
  ]
  // Wound towards +z, and its copy towards −z.
  const front = [0, 1, 2, 0, 2, 3]
  const back = [4, 6, 5, 4, 7, 6]

  test('keeps the front where the back copy’s normals are the front’s', () => {
    expect(foldTwins(positions, facing(1, 1), [...front, ...back])).toEqual(front)
  })

  test('keeps the copy whose normals agree with its winding, whichever comes first', () => {
    expect(foldTwins(positions, facing(-1, -1), [...front, ...back])).toEqual(back)
    expect(foldTwins(positions, facing(1, -1), [...back, ...front])).toEqual(back)
  })

  test('leaves a triangle with no twin, and copies wound the same way, be', () => {
    const index = [0, 1, 2, 4, 5, 6, 0, 2, 3]
    expect(foldTwins(positions, facing(1, 1), index)).toEqual(index)
  })
})

describe('carrying a donor’s hair', () => {
  test('matches bone slots by name, anything unknown going on the head', () => {
    const slots = remapBones(
      ['Bip01_Head', 'Bip01_Spine2', 'Bip01_Ponytail'],
      ['Bip01_Pelvis', 'Bip01_Spine2', 'Bip01_Head'],
      2,
    )
    expect([...slots]).toEqual([2, 1, 2])
  })

  test('keeps hair over the skull by the skull fit, and hair on the back by its bone', () => {
    // Slot 0 is the head (anchored at the origin, carried to the fit's
    // shift); slot 1 a spine bone that sits lower on the wearer.
    const anchors = { from: [0, 0, 0, 0, 1.2, -0.1], to: [0, 0.05, 0, 0, 1.1, -0.12] }
    const scale = [0.9, 1, 1.1]
    const points = [0.1, 1.7, 0, 0, 1.0, -0.2, 0, 1.4, -0.1]
    const skinIndex = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]
    const skinWeight = [1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]
    const carried = carryPoints(points, skinIndex, skinWeight, anchors, scale)
    // On the head: the skull fit.
    expect(carried[0]).toBeCloseTo(0.09, 6)
    expect(carried[1]).toBeCloseTo(1.75, 6)
    // On the back: its offset from the spine bone, scaled.
    expect(carried[4]).toBeCloseTo(1.1 - 0.2, 6)
    expect(carried[5]).toBeCloseTo(-0.12 - 0.1 * 1.1, 6)
    // Half each: half way between.
    expect(carried[7]).toBeCloseTo((1.45 + (1.1 + 0.2)) / 2, 6)
  })
})

function image(width: number, height: number, fill: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([...fill(x, y), 255], (y * width + x) * 4)
  }
  return { data, width, height }
}

describe('the cap’s texture', () => {
  const HAIR_COLOUR = [70, 45, 30]
  const SKIN_COLOUR = [210, 165, 140]
  const alpha = (pixels: Pixels, x: number, y: number) =>
    pixels.data[(y * pixels.width + x) * 4 + 3]!
  // Over the whole texture: the left half hair-coloured, the right skin.
  const head = image(16, 16, (x) => (x < 8 ? HAIR_COLOUR : SKIN_COLOUR))
  const whole = (solid: boolean) => [
    { u: [0, 1, 1], v: [0, 0, 1], solid },
    { u: [0, 1, 0], v: [0, 1, 1], solid },
  ]
  const hairRgb = HAIR_COLOUR as [number, number, number]
  const skinRgb = SKIN_COLOUR as [number, number, number]

  test('keeps the sculpted shell but where it is plainly skin', () => {
    const cap = capPixels(head, hairRgb, skinRgb, whole(true))
    expect(alpha(cap, 3, 8)).toBe(255)
    expect(alpha(cap, 12, 8)).toBe(0)
  })

  test('keeps a highlight on the shell that is near the skin’s colour, not at it', () => {
    const HIGHLIGHT = [205, 170, 80]
    const lit = image(16, 16, (x) => (x < 8 ? HAIR_COLOUR : x < 12 ? HIGHLIGHT : SKIN_COLOUR))
    const cap = capPixels(lit, hairRgb, skinRgb, whole(true))
    expect(alpha(cap, 9, 8)).toBe(255)
    expect(alpha(cap, 15, 8)).toBe(0)
  })

  test('round it, keeps what is hair-coloured and cuts the skin away', () => {
    const cap = capPixels(head, hairRgb, skinRgb, whole(false))
    expect(alpha(cap, 3, 8)).toBe(255)
    expect(alpha(cap, 12, 8)).toBe(0)
  })
})

describe('the cap’s texture in the donor’s hair', () => {
  const HAIR_COLOUR = [47, 28, 18]
  const SKIN_COLOUR = [210, 150, 116]
  const alpha = (pixels: Pixels, x: number, y: number) =>
    pixels.data[(y * pixels.width + x) * 4 + 3]!
  const whole = [
    { u: [0, 1, 1], v: [0, 0, 1], solid: false },
    { u: [0, 1, 0], v: [0, 1, 1], solid: false },
  ]
  const hairRgb = HAIR_COLOUR as [number, number, number]
  const skinRgb = SKIN_COLOUR as [number, number, number]
  const SIZE = 256

  test('thins sparse strands out into the skin, as many as there are', () => {
    // Hair to x 100; past it, strands two columns wide one apart to x 120, then skin.
    const head = image(SIZE, SIZE, (x) =>
      x < 100 || (x < 120 && x % 3 !== 0) ? HAIR_COLOUR : SKIN_COLOUR,
    )
    const cap = capPixels(head, hairRgb, skinRgb, whole)
    expect(alpha(cap, 50, 128)).toBe(255)
    // The strands partly there, joined to the hair: neither the hair nor the skin.
    expect(alpha(cap, 110, 128)).toBeGreaterThan(0)
    expect(alpha(cap, 110, 128)).toBeLessThan(255)
    expect(alpha(cap, 200, 128)).toBe(0)
  })

  test('lets short hair’s stubble be as see-through as it is', () => {
    // Hair to x 100; past it, a colour halfway to the skin's (stubble), from x 140 skin.
    const half = HAIR_COLOUR.map((c, k) => (c + SKIN_COLOUR[k]!) / 2)
    const head = image(SIZE, SIZE, (x) => (x < 100 ? HAIR_COLOUR : x < 140 ? half : SKIN_COLOUR))
    const cap = capPixels(head, hairRgb, skinRgb, whole)
    const stubble = alpha(cap, 120, 128)
    expect(stubble).toBeGreaterThan(40)
    expect(stubble).toBeLessThan(215)
    // Coloured as the hair round it, not the skin it was painted over.
    const p = (128 * SIZE + 120) * 4
    expect(cap.data[p]!).toBeLessThan(HAIR_COLOUR[0]! + 20)
  })

  test('fades out to the cap’s rim', () => {
    const head = image(SIZE, SIZE, () => HAIR_COLOUR)
    // Clear along the left edge (u = 0), whole from the right.
    const fading = [
      { u: [0, 1, 1], v: [0, 0, 1], solid: false, fade: [0, 1, 1] },
      { u: [0, 1, 0], v: [0, 1, 1], solid: false, fade: [0, 1, 0] },
    ]
    const cap = capPixels(head, hairRgb, skinRgb, fading)
    expect(alpha(cap, 1, 128)).toBeLessThan(10)
    expect(alpha(cap, 64, 128)).toBeLessThan(alpha(cap, 192, 128))
    expect(alpha(cap, 254, 128)).toBeGreaterThan(245)
  })

  test('cuts away specks of hair’s colour on the skin: a mole, a pore', () => {
    const head = image(SIZE, SIZE, (x, y) =>
      x < 100 || (x >= 180 && x < 182 && y >= 60 && y < 62) ? HAIR_COLOUR : SKIN_COLOUR,
    )
    const cap = capPixels(head, hairRgb, skinRgb, whole)
    expect(alpha(cap, 50, 128)).toBe(255)
    expect(alpha(cap, 180, 60)).toBe(0)
  })

  test('fades the cut-out’s edge', () => {
    const head = image(SIZE, SIZE, (x) => (x < 100 ? HAIR_COLOUR : SKIN_COLOUR))
    const cap = capPixels(head, hairRgb, skinRgb, whole)
    const edge = alpha(cap, 99, 128)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)
    expect(alpha(cap, 100, 128)).toBeLessThan(edge)
  })
})

describe('the cap’s fade to its rim', () => {
  // A 4 × 4 grid of quads 1 cm each, its points numbered row by row.
  const points: number[] = []
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) points.push(x * 0.01, y * 0.01, 0)
  const index: number[] = []
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const a = y * 5 + x
      index.push(a, a + 1, a + 6, a, a + 6, a + 5)
    }
  }
  const spots = Int32Array.from({ length: 25 }, (_, i) => i)
  const triangles = Array.from({ length: 32 }, (_, t) => t)
  const none = new Uint8Array(25)
  const fadeOf = (seeds: Uint8Array, free: Uint8Array) =>
    capFade(points, index, spots, 25, triangles, seeds, free, 0.015)

  test('is clear on the rim, whole clear of it', () => {
    const fade = fadeOf(none, none)
    expect(fade[0]).toBe(0)
    expect(fade[22]).toBe(0)
    expect(fade[12]).toBe(1)
    expect(fade[6]!).toBeGreaterThan(0)
    expect(fade[6]!).toBeLessThan(1)
  })

  test('fades from the spots it is given (an ear), not from a rim standing free', () => {
    const seeds = new Uint8Array(25)
    seeds[12] = 1
    expect(fadeOf(seeds, none)[12]).toBe(0)
    // The left edge stands free: its middle is 2 cm from the rest of the rim.
    const free = Uint8Array.from({ length: 25 }, (_, i) => (i % 5 === 0 ? 1 : 0))
    expect(fadeOf(none, free)[10]).toBe(1)
    expect(fadeOf(none, free)[0]).toBe(0)
  })
})

describe('a hairstyle as saved', () => {
  test('is a known avatar’s id or BALD; anything else keeps the character’s own', () => {
    expect(readHairStyle(BALD)).toBe(BALD)
    expect(readHairStyle('Female_Adult_04')).toBe('Female_Adult_04')
    for (const value of [
      'Nobody_01',
      '',
      'BALD',
      ' bald',
      null,
      undefined,
      3,
      {},
      ['Female_Adult_04'],
    ]) {
      expect(readHairStyle(value)).toBeNull()
    }
  })

  test('packs shell flags eight to a byte and back', () => {
    const flags = [1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1]
    const unpacked = unpackFlags(packFlags(flags))
    expect(unpacked.length).toBe(16)
    expect([...unpacked.slice(0, flags.length)]).toEqual(flags)
    expect([...unpacked.slice(flags.length)]).toEqual([0, 0, 0, 0, 0])
  })
})
