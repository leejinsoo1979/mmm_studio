import { describe, expect, test } from 'bun:test'
import {
  type AxisFit,
  capPixels,
  cardKinds,
  carryPoints,
  composeFits,
  crossing,
  deflation,
  faceFit,
  fitAxes,
  fitSkull,
  foldTwins,
  GEAR,
  HAIR,
  invertFit,
  ironed,
  LASH,
  PointGrid,
  pushOut,
  remapBones,
  type Surface,
} from './avatar-hair'
import { BALD, packFlags, readHairStyle, type SkullData, unpackFlags } from './hair-styles'
import type { Pixels } from './look-pixels'

/** Points spread evenly over a sphere (a Fibonacci lattice), with their outward normals. */
function sphere(radius: number, count: number, centre = [0, 0, 0]) {
  const points: number[] = []
  const normals: number[] = []
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count
    const ring = Math.sqrt(1 - y * y)
    const turn = i * Math.PI * (3 - Math.sqrt(5))
    const n = [Math.cos(turn) * ring, y, Math.sin(turn) * ring]
    normals.push(...n)
    points.push(...n.map((value, axis) => centre[axis]! + value * radius))
  }
  return { points: Float32Array.from(points), normals: Float32Array.from(normals) }
}

const surfaceOf = (points: Float32Array, normals: Float32Array): Surface => ({
  points,
  normals,
  grid: new PointGrid(points, 0.02),
})

const IDENTITY: AxisFit = { scale: [1, 1, 1], shift: [0, 0, 0] }

describe('the point grid', () => {
  test('finds the nearest points as a search of them all would, nearest first', () => {
    const { points } = sphere(0.1, 300)
    const grid = new PointGrid(points, 0.02)
    const found: number[] = []
    const distances: number[] = []
    for (const query of [
      [0, 0, 0],
      [0.05, 0.12, -0.03],
      [0.4, -0.3, 0.2],
    ]) {
      const all = Array.from({ length: points.length / 3 }, (_, i) =>
        Math.hypot(
          points[i * 3]! - query[0]!,
          points[i * 3 + 1]! - query[1]!,
          points[i * 3 + 2]! - query[2]!,
        ),
      )
      const best = [...all.keys()].sort((a, b) => all[a]! - all[b]!).slice(0, 4)
      expect(grid.nearest(query[0]!, query[1]!, query[2]!, 4, found, distances)).toBe(4)
      expect(found.slice(0, 4)).toEqual(best)
      expect(Math.sqrt(distances[0]!)).toBeCloseTo(all[best[0]!]!, 6)
    }
  })

  test('finds none in an empty grid, and as many as there are in a small one', () => {
    const found: number[] = []
    const distances: number[] = []
    expect(new PointGrid([], 0.02).nearest(0, 0, 0, 4, found, distances)).toBe(0)
    expect(new PointGrid([0, 0, 0, 1, 1, 1], 0.02).nearest(0, 0, 0, 4, found, distances)).toBe(2)
  })
})

describe('fitting axis by axis', () => {
  test('finds the scale and shift that took points somewhere', () => {
    const from = [0, 0, 0, 1, 2, 3, -1, 4, 2, 2, -1, 1]
    const to = from.map((value, i) => value * [1.1, 0.9, 1.2][i % 3]! + [0.5, -0.2, 0.1][i % 3]!)
    const fit = fitAxes(from, to)
    expect(fit.scale.map((value) => value.toFixed(9))).toEqual([
      '1.100000000',
      '0.900000000',
      '1.200000000',
    ])
    expect(fit.shift.map((value) => value.toFixed(9))).toEqual([
      '0.500000000',
      '-0.200000000',
      '0.100000000',
    ])
  })

  test('undoes itself, and composes one fit after another', () => {
    const fit: AxisFit = { scale: [2, 0.5, 1.5], shift: [1, -1, 0.25] }
    const round = composeFits(invertFit(fit), fit)
    for (const value of round.scale) expect(value).toBeCloseTo(1, 12)
    for (const value of round.shift) expect(value).toBeCloseTo(0, 12)
    const twice = composeFits(fit, fit)
    // x: 2·(2x + 1) + 1 = 4x + 3
    expect(twice.scale[0]).toBe(4)
    expect(twice.shift[0]).toBe(3)
  })

  test('fits the skull by the face bones a character has, and only with enough of them', () => {
    const names = Array.from({ length: 10 }, (_, i) => `Bip01_Face${i}`)
    const bones = Object.fromEntries(
      names.map((name, i) => [name, [i * 0.01, (i % 3) * 0.02, (i % 4) * 0.015]]),
    ) as SkullData['bones']
    const skull: SkullData = {
      bones,
      points: new Float32Array(),
      normals: new Float32Array(),
      zone: new Float32Array(),
    }
    const moved = new Map(
      Object.entries(bones).map(([name, place]) => [
        name,
        [place[0] * 0.98 + 0.01, place[1] * 0.98 + 0.7, place[2] * 0.98 - 0.02],
      ]),
    )
    const fit = faceFit(skull, moved)!
    expect(fit.scale[1]).toBeCloseTo(0.98, 9)
    expect(fit.shift[1]).toBeCloseTo(0.7, 9)
    expect(faceFit(skull, new Map([...moved].slice(0, 3)))).toBeNull()
  })
})

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

describe('keeping hair off the wearer', () => {
  const head = sphere(0.1, 800)
  const surface = surfaceOf(head.points, head.normals)

  test('lifts points inside, or too near, out to the clearance along the normal', () => {
    const points = Float32Array.from([0, 0.095, 0, 0.1005, 0, 0, 0, 0, 0.15])
    pushOut(points, surface, 0.003, 0.03)
    expect(Math.hypot(points[0]!, points[1]!, points[2]!)).toBeCloseTo(0.103, 3)
    expect(Math.hypot(points[3]!, points[4]!, points[5]!)).toBeCloseTo(0.103, 3)
    // Well clear already: left be.
    expect([...points.slice(6)]).toEqual([0, 0, 0.15].map(Math.fround))
  })

  test('leaves a point deeper in than its reach be', () => {
    const points = Float32Array.from([0, 0.05, 0])
    pushOut(points, surface, 0.003, 0.03)
    expect(points[1]).toBeCloseTo(0.05, 6)
  })
})

describe('taking a head’s own hair in', () => {
  // The skull: a sphere, hair zone over its top half.
  const skullPoints = sphere(0.1, 1500)
  const skull = fitSkull(
    {
      bones: {},
      points: skullPoints.points,
      normals: skullPoints.normals,
      zone: Float32Array.from({ length: 1500 }, (_, i) =>
        skullPoints.points[i * 3 + 1]! > 0 ? 1 : 0,
      ),
    },
    IDENTITY,
  )
  // The body: a floor of points facing up, 0.2 down.
  const floor: number[] = []
  for (let x = -0.2; x <= 0.2; x += 0.01)
    for (let z = -0.2; z <= 0.2; z += 0.01) floor.push(x, -0.2, z)
  const body = surfaceOf(
    Float32Array.from(floor),
    Float32Array.from(floor, (_, i) => (i % 3 === 1 ? 1 : 0)),
  )
  // The head's own skin: the front of the skull's lower half, and a neck
  // thinner than the skull's all round below the top of the neck.
  const face = sphere(0.1, 1500)
  const neckSkin = sphere(0.085, 1500)
  const skinPoints: number[] = []
  const skinNormals: number[] = []
  for (let i = 0; i < 1500; i++) {
    if (face.points[i * 3 + 1]! < 0 && face.points[i * 3 + 2]! > 0.04) {
      skinPoints.push(...face.points.slice(i * 3, i * 3 + 3))
      skinNormals.push(...face.normals.slice(i * 3, i * 3 + 3))
    }
    if (neckSkin.points[i * 3 + 1]! < -0.06 && neckSkin.points[i * 3 + 2]! < 0) {
      skinPoints.push(...neckSkin.points.slice(i * 3, i * 3 + 3))
      skinNormals.push(...neckSkin.normals.slice(i * 3, i * 3 + 3))
    }
  }
  const skin = surfaceOf(Float32Array.from(skinPoints), Float32Array.from(skinNormals))
  const around = { skin, body, neck: -0.05 }

  // A crown 0.02 thick, a point of the face, a drape lying on the body, one
  // more point on the crown that isn't shell, and a ponytail's end hanging
  // over the nape.
  const points = [0, 0.12, 0, 0, -0.06, 0.08, 0.05, -0.195, -0.1, 0.02, 0.118, 0, 0, -0.075, -0.14]
  const shell = [1, 1, 1, 0, 1]
  const { moves, pressed } = deflation(points, skull, shell, around)
  const moved = (i: number) =>
    points.slice(i * 3, i * 3 + 3).map((value, axis) => value + moves[i * 3 + axis]!)

  test('takes the crown’s volume in to just under the skull', () => {
    const [x, y, z] = moved(0)
    expect(Math.hypot(x!, y!, z!)).toBeGreaterThan(0.095)
    expect(Math.hypot(x!, y!, z!)).toBeLessThan(0.1)
  })

  test('presses the crown flat onto the skull, all the way', () => {
    // Along the skull's normal there (straight up), as long as all of it.
    expect(Math.hypot(pressed[0]!, pressed[1]!, pressed[2]!)).toBeCloseTo(1, 6)
    expect(pressed[1]).toBeGreaterThan(0.99)
  })

  test('leaves the face, and what isn’t shell, be', () => {
    for (const move of [...moves.slice(3, 6), ...moves.slice(9, 12)]) expect(Math.abs(move)).toBe(0)
    for (const press of [...pressed.slice(3, 6), ...pressed.slice(9, 12)]) expect(press).toBe(0)
  })

  test('takes a drape lying on the body into it', () => {
    expect(moved(2)[1]).toBeLessThan(-0.2)
  })

  test('takes a ponytail over the nape under the neck’s own skin', () => {
    const [x, y, z] = moved(4)
    expect(Math.hypot(x!, y!, z!)).toBeLessThan(0.085)
  })
})

describe('a ray into a surface', () => {
  const ball = sphere(0.1, 1500)
  const surface = surfaceOf(ball.points, ball.normals)

  test('goes in where it meets it, and on to a depth under it', () => {
    const along = crossing(surface, 0.2, 0, 0, -1, 0, 0, 0.2, 0.005, 0.03)
    expect(along).toBeGreaterThan(0.103)
    expect(along).toBeLessThan(0.107)
  })

  test('is already in from a point that deep, and never in past the surface', () => {
    expect(crossing(surface, 0.08, 0, 0, -1, 0, 0, 0.08, 0.005, 0.03)).toBe(0)
    expect(crossing(surface, 0.2, 0.3, 0, -1, 0, 0, 0.3, 0.005, 0.03)).toBe(-1)
  })
})

describe('ironing the hair taken in', () => {
  // Two rows of five points 0.01 apart along x, joined by triangles: the
  // ends lie on the skin (not pressed), the middle three were pressed down
  // onto it (along -y, so their normal is +y).
  const points: number[] = []
  for (let column = 0; column < 5; column++)
    points.push(column * 0.01, 0, 0, column * 0.01, 0, 0.01)
  const index: number[] = []
  for (let column = 0; column < 4; column++) {
    const a = column * 2
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const pressed = Float32Array.from({ length: 30 }, (_, i) => {
    const column = Math.floor(i / 6)
    return column > 0 && column < 4 && i % 3 === 1 ? 1 : 0
  })
  // The middle column taken in by `rise` along y, the rest where they are.
  const moves = (rise: number) =>
    Float32Array.from({ length: 30 }, (_, i) => (Math.floor(i / 6) === 2 && i % 3 === 1 ? rise : 0))
  const heights = (moved: Float32Array) =>
    Array.from({ length: 10 }, (_, point) => points[point * 3 + 1]! + moved[point * 3 + 1]!)

  test('draws a fold standing out of the rest back in, holding to what lies on the skin', () => {
    const after = heights(ironed(points, index, { moves: moves(0.02), pressed }))
    expect(after[4]).toBeLessThan(0.01)
    for (const end of [0, 1, 8, 9]) expect(after[end]).toBe(0)
  })

  test('irons a speck the shell missed along with the pressed points round it', () => {
    // A fan: its middle not pressed, standing 0.02 over a ring pressed flat.
    const fan = [0, 0.02, 0]
    const ring: number[] = []
    for (let k = 0; k < 6; k++) {
      const turn = (k / 6) * 2 * Math.PI
      fan.push(Math.cos(turn) * 0.01, 0, Math.sin(turn) * 0.01)
      ring.push(0, 1 + k, 1 + ((k + 1) % 6))
    }
    const flat = Float32Array.from({ length: 21 }, (_, i) => (i >= 3 && i % 3 === 1 ? 1 : 0))
    const after = ironed(fan, ring, { moves: new Float32Array(21), pressed: flat })
    expect(fan[1]! + after[1]!).toBeLessThan(0.01)
  })

  test('never draws a point out along the normal it was pressed onto', () => {
    const after = heights(ironed(points, index, { moves: moves(-0.02), pressed }))
    expect(after[4]).toBeCloseTo(-0.02, 6)
    for (const height of after) expect(height).toBeLessThanOrEqual(0)
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
  const whole = (shell: number[]) => [
    { u: [0, 1, 1], v: [0, 0, 1], shell },
    { u: [0, 1, 0], v: [0, 1, 1], shell },
  ]
  const hairRgb = HAIR_COLOUR as [number, number, number]
  const skinRgb = SKIN_COLOUR as [number, number, number]

  test('keeps the shell whatever its colour', () => {
    const cap = capPixels(head, hairRgb, skinRgb, whole([1, 1, 1]))
    expect(alpha(cap, 3, 8)).toBe(255)
    expect(alpha(cap, 12, 8)).toBe(255)
  })

  test('along the hairline, keeps what is hair-coloured and cuts the skin away', () => {
    const cap = capPixels(head, hairRgb, skinRgb, [
      { u: [0, 1, 1], v: [0, 0, 1], shell: [1, 1, 0] },
    ])
    expect(alpha(cap, 6, 2)).toBeGreaterThan(128)
    expect(alpha(cap, 12, 5)).toBe(0)
    // Hair-coloured, but towards the corner off the shell: fading out.
    expect(alpha(cap, 7, 6)).toBeLessThan(alpha(cap, 6, 2))
  })

  test('keeps nothing where no corner is shell', () => {
    const cap = capPixels(head, hairRgb, skinRgb, whole([0, 0, 0]))
    expect(Math.max(...Array.from({ length: 256 }, (_, i) => cap.data[i * 4 + 3]!))).toBe(0)
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
