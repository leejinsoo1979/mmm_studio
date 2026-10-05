import { describe, expect, test } from 'bun:test'
import {
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

  test('keeps the sculpted shell whatever its colour', () => {
    const cap = capPixels(head, hairRgb, skinRgb, whole(true))
    expect(alpha(cap, 3, 8)).toBe(255)
    expect(alpha(cap, 12, 8)).toBe(255)
  })

  test('round it, keeps what is hair-coloured and cuts the skin away', () => {
    const cap = capPixels(head, hairRgb, skinRgb, whole(false))
    expect(alpha(cap, 3, 8)).toBe(255)
    expect(alpha(cap, 12, 8)).toBe(0)
  })

  test('grows the shell’s rim a texel into hair or past the triangles, never into skin they show', () => {
    // Solid over columns 4–5 (hair) or 10–11 (skin) of the texture.
    const band = (from: number, to: number) => [
      { u: [from, to, to], v: [0, 0, 1], solid: true },
      { u: [from, to, from], v: [0, 1, 1], solid: true },
    ]
    const hairSide = capPixels(head, hairRgb, skinRgb, band(4 / 16, 6 / 16))
    expect(alpha(hairSide, 6, 8)).toBe(255)
    expect(alpha(hairSide, 2, 8)).toBe(0)
    // Round it nothing: the rim grows a texel over the island's edge.
    const alone = capPixels(head, hairRgb, skinRgb, band(10 / 16, 12 / 16))
    expect(alpha(alone, 10, 8)).toBe(255)
    expect(alpha(alone, 9, 8)).toBe(255)
    expect(alpha(alone, 8, 8)).toBe(0)
    // Skin shown round it: cut away.
    const shown = capPixels(head, hairRgb, skinRgb, [...band(10 / 16, 12 / 16), ...whole(false)])
    expect(alpha(shown, 10, 8)).toBe(255)
    expect(alpha(shown, 9, 8)).toBe(0)
    expect(alpha(shown, 12, 8)).toBe(0)
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
