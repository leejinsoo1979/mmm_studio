import { describe, expect, test } from 'bun:test'
import {
  type BodyBind,
  CLOTH_SNAP,
  carryFoot,
  clip,
  colourDistance,
  type DonorFoot,
  donorFeet,
  type FootFrame,
  fitFoot,
  fitToRing,
  footFrame,
  footSide,
  fromFoot,
  mixSkin,
  type Piece,
  planFeet,
  remapBones,
  shoesOf,
  TUCK_ABOVE,
  toFoot,
} from './bare-feet'
import { medianColour, paintBare, SOCK_TOP, type Texel } from './bare-feet-paint'
import { type FeetBody, type FeetDonor, paintFeet, type WornFeet, wornFeet } from './feet-job'
import { deltaE, hexToRgb, luminance, type Pixels, type Rgb } from './look-pixels'

const BONES = [
  'Bip01 Pelvis',
  'Bip01 L Calf',
  'Bip01 L Foot',
  'Bip01 L Toe0',
  'Bip01 R Calf',
  'Bip01 R Foot',
  'Bip01 R Toe0',
]
const [CALF, FOOT] = [1, 2]
/** The left ankle and ball, in the bind pose: the foot points along +z. */
const ANKLE = [0.1, 0.08, 0]
const BALL = [0.1, 0.01, 0.14]
const LENGTH = 0.14
/** The leg and the shoe meet this high, all round the ankle. */
const HEM = 0.1
const SIDES = 8

type Built = {
  positions: number[]
  uvs: number[]
  joints: number[]
  weights: number[]
  index: number[]
}

/**
 * A ring-stacked tube round the left ankle's line from `bottom` to `top`,
 * its points skinned wholly to `bone`: its own points (a texture island of
 * its own, though its rings may sit where another's do).
 */
function tube(
  into: Built,
  radius: number | number[],
  heights: number[],
  bone: number,
  uv: readonly [number, number] = [0.5, 0.5],
) {
  const first = into.positions.length / 3
  for (const [row, y] of heights.entries()) {
    const r = typeof radius === 'number' ? radius : radius[row]!
    for (let k = 0; k < SIDES; k++) {
      const angle = (2 * Math.PI * k) / SIDES
      into.positions.push(ANKLE[0]! + r * Math.cos(angle), y, r * Math.sin(angle))
      into.uvs.push(uv[0], uv[1])
      into.joints.push(bone, 0, 0, 0)
      into.weights.push(1, 0, 0, 0)
    }
  }
  for (let r = 0; r + 1 < heights.length; r++) {
    for (let k = 0; k < SIDES; k++) {
      const a = first + r * SIDES + k
      const b = first + r * SIDES + ((k + 1) % SIDES)
      into.index.push(a, b, a + SIDES, b, b + SIDES, a + SIDES)
    }
  }
}

/**
 * A left leg (its calf's skin) standing in a shoe (its foot's), the two
 * meeting at `hem`; or, given a `flare`, the leg that wide at the hem (a
 * pump's opening), narrowing to an ankle's girth by `hem` + 0.06.
 */
function shodLeg(hem = HEM, flare?: number): BodyBind {
  const built: Built = { positions: [], uvs: [], joints: [], weights: [], index: [] }
  if (flare === undefined) tube(built, 0.04, [hem, 0.2, 0.3, 0.45], CALF)
  else {
    tube(
      built,
      [flare, (flare + 0.04) / 2, 0.04, 0.04, 0.04],
      [hem, hem + 0.03, hem + 0.06, 0.3, 0.45],
      CALF,
    )
  }
  tube(built, flare ?? 0.04, [0, 0.05, hem], FOOT)
  const bonePlaces = new Float32Array(BONES.length * 3)
  bonePlaces.set(ANKLE, FOOT * 3)
  bonePlaces.set(BALL, 3 * 3)
  bonePlaces.set([0.1, 0.45, 0], CALF * 3)
  bonePlaces.set([-0.1, 0.08, 0], 5 * 3)
  bonePlaces.set([-0.1, 0.01, 0.14], 6 * 3)
  const count = built.positions.length / 3
  return {
    positions: Float32Array.from(built.positions),
    normals: new Float32Array(count * 3),
    uvs: Float32Array.from(built.uvs),
    joints: Uint16Array.from(built.joints),
    weights: Float32Array.from(built.weights),
    index: Uint32Array.from(built.index),
    bones: BONES,
    bonePlaces,
  }
}

const SKIN: Rgb = [200, 150, 120]
const skinTexture = (size = 4): Pixels => {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) data.set([...SKIN, 255], i * 4)
  return { data, width: size, height: size }
}

/** A body's texture coordinates unwrapped round the ankle's line and up it (so its leg covers texels to paint). */
function unwrap(bind: BodyBind) {
  for (let i = 0; i < bind.positions.length / 3; i++) {
    const angle = Math.atan2(bind.positions[i * 3 + 2]!, bind.positions[i * 3]! - ANKLE[0]!)
    bind.uvs[i * 2] = 0.05 + (0.9 * (angle + Math.PI)) / (2 * Math.PI)
    bind.uvs[i * 2 + 1] = 0.05 + (0.9 * bind.positions[i * 3 + 1]!) / 0.5
  }
  return bind
}

/** A donor's foot as carried (DonorFoot): a tube `radius` round the ankle's line up to `top` (foot lengths), its lower half on the foot, its upper on the calf. */
function donorTube(radius: number, top = 4, bones = [0, 1]): DonorFoot {
  const local: number[] = []
  const normals: number[] = []
  const joints: number[] = []
  const weights: number[] = []
  const index: number[] = []
  const rounds = 9
  const sides = 12
  for (let r = 0; r < rounds; r++) {
    const u = (top * r) / (rounds - 1)
    for (let k = 0; k < sides; k++) {
      const angle = (2 * Math.PI * k) / sides + 0.13
      local.push(radius * Math.sin(angle), radius * Math.cos(angle), u)
      normals.push(Math.sin(angle), Math.cos(angle), 0)
      joints.push(u < top / 2 ? bones[0]! : bones[1]!, 0, 0, 0)
      weights.push(1, 0, 0, 0)
    }
  }
  for (let r = 0; r + 1 < rounds; r++) {
    for (let k = 0; k < sides; k++) {
      const a = r * sides + k
      const b = r * sides + ((k + 1) % sides)
      index.push(a, b, a + sides, b, b + sides, a + sides)
    }
  }
  return {
    local: Float32Array.from(local),
    normals: Float32Array.from(normals),
    uvs: new Float32Array((local.length / 3) * 2).fill(0.5),
    joints: Uint16Array.from(joints),
    weights: Float32Array.from(weights),
    index: Uint32Array.from(index),
  }
}
const DONOR_BONES = ['Bip01 L Foot', 'Bip01 L Calf']

const leftFrame = (bind: BodyBind) => footFrame(bind, 0, shoesOf(bind))!

const footCoordinates = (piece: Piece, frame: FootFrame) =>
  Array.from({ length: piece.open.length }, (_, i) =>
    toFoot(
      frame,
      piece.positions[i * 3]!,
      piece.positions[i * 3 + 1]!,
      piece.positions[i * 3 + 2]!,
    ),
  )

describe('a foot’s bones and frame', () => {
  test('feet and toes are told apart by side, whatever their names’ spacing', () => {
    expect(footSide('Bip01 L Foot')).toBe(0)
    expect(footSide('Bip01_R_Toe0')).toBe(1)
    expect(footSide('Bip01 L Calf')).toBeNull()
  })

  test('a shoe is the island skinned to the foot; the leg above it is not', () => {
    const bind = shodLeg()
    const footOf = shoesOf(bind)
    expect([...footOf.slice(0, 4 * SIDES)].every((side) => side === -1)).toBe(true)
    expect([...footOf.slice(4 * SIDES)].every((side) => side === 0)).toBe(true)
  })

  test('the frame stands under the ankle on the shoe’s sole, pointing at the ball and out from the body', () => {
    const frame = leftFrame(shodLeg())
    frame.origin.forEach((value, k) => {
      expect(value).toBeCloseTo([0.1, 0, 0][k]!)
    })
    expect(frame.forward[2]).toBeCloseTo(1)
    expect(frame.outward[0]).toBeCloseTo(1)
    expect(frame.length).toBeCloseTo(LENGTH)
    const at = toFoot(frame, ...(BALL as [number, number, number]))
    expect(at[0]).toBeCloseTo(1)
    const back = fromFoot(frame, at[0]!, at[1]!, at[2]!)
    back.forEach((value, k) => {
      expect(value).toBeCloseTo(BALL[k]!)
    })
  })

  test('a body without a shoe on a side has no frame there', () => {
    const bind = shodLeg()
    expect(footFrame(bind, 1, shoesOf(bind))).toBeNull()
  })
})

describe('skin carried from the donor’s bones to the wearer’s', () => {
  test('bones go by name; one the wearer lacks has its weight shared among the rest', () => {
    const bind = shodLeg()
    const frame = leftFrame(bind)
    const bones = remapBones(['Bip01 L Foot', 'Bip01 L Calf', 'Donor Only'], bind.bones)
    expect(bones).toEqual([FOOT, CALF, -1])
    const donor = donorTube(0.3)
    // Every point on the foot (3/4) and on a bone the wearer hasn't (1/4).
    for (let i = 0; i < donor.weights.length / 4; i++) {
      donor.joints.set([0, 2, 0, 0], i * 4)
      donor.weights.set([0.75, 0.25, 0, 0], i * 4)
    }
    const piece = carryFoot(donor, bones, frame, 10)
    for (let i = 0; i < piece.open.length; i++) {
      expect(piece.joints[i * 4]).toBe(FOOT)
      expect(piece.weights[i * 4]).toBeCloseTo(1)
    }
  })

  test('a point on none of the wearer’s bones goes on its foot', () => {
    const bind = shodLeg()
    const frame = leftFrame(bind)
    const piece = carryFoot(donorTube(0.3), [-1, -1], frame, 10)
    expect(piece.joints.filter((_, k) => k % 4 === 0).every((joint) => joint === FOOT)).toBe(true)
  })

  test('points are placed by the wearer’s frame, in its foot’s lengths', () => {
    const bind = shodLeg()
    const frame = leftFrame(bind)
    const piece = carryFoot(donorTube(0.3), [FOOT, CALF], frame, 10)
    const c = footCoordinates(piece, frame)
    for (const point of c) expect(Math.hypot(point[0]!, point[1]!)).toBeCloseTo(0.3)
    // Only below the height asked for.
    const low = carryFoot(donorTube(0.3), [FOOT, CALF], frame, 2)
    expect(Math.max(...footCoordinates(low, frame).map((point) => point[2]!))).toBeLessThan(2)
  })

  test('mixed skins blend their bones’ weights and keep the four heaviest', () => {
    const mixed = mixSkin([1, 2, 0, 0], [0.5, 0.5, 0, 0], [3, 4, 5, 6], [0.4, 0.3, 0.2, 0.1], 0.5)
    expect(mixed.weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1)
    expect(mixed.joints.slice(0, 2).sort()).toEqual([1, 2])
    expect(mixed.joints).toContain(3)
    expect(mixed.joints).not.toContain(6)
  })
})

describe('a carried foot cut and fitted to the leg', () => {
  test('a cut keeps the part below it, its new points (one per edge cut) open', () => {
    const piece = carryFoot(donorTube(0.3), [FOOT, CALF], leftFrame(shodLeg()), 10)
    const frame = leftFrame(shodLeg())
    const cut = clip(
      piece,
      (i) =>
        toFoot(
          frame,
          piece.positions[i * 3]!,
          piece.positions[i * 3 + 1]!,
          piece.positions[i * 3 + 2]!,
        )[2]! - 1.25,
    )
    const c = footCoordinates(cut, frame)
    expect(Math.max(...c.map((point) => point[2]!))).toBeCloseTo(1.25)
    const open = c.filter((_, i) => cut.open[i])
    // A side's two triangles: each quad's upright and diagonal edges are cut.
    expect(open.length).toBe(24)
    for (const point of open) expect(point[2]).toBeCloseTo(1.25)
  })

  test('a bare leg is welded to: the foot’s top snapped onto its ring, skinned as the leg is there', () => {
    const bind = shodLeg()
    const plan = planFeet(bind, skinTexture(), [SKIN])!
    expect(plan.feet).toHaveLength(1)
    const [foot] = plan.feet
    expect(foot!.mode).toBe('weld')
    expect(foot!.skin).toBe(true)
    // The shoe's triangles hidden, the leg's shown.
    expect([...plan.hidden.slice(0, 3 * SIDES * 2)].every((side) => side === -1)).toBe(true)
    expect([...plan.hidden.slice(3 * SIDES * 2)].every((side) => side === 0)).toBe(true)
    const frame = plan.frames[0]!
    const fitted = fitToRing(
      carryFoot(donorTube(0.3), [FOOT, CALF], frame, 3),
      foot!.ring,
      bind,
      frame,
      'weld',
    )
    const { piece } = fitted
    const rim = foot!.ring.places
    expect(rim).toHaveLength(SIDES)
    const open = Array.from({ length: piece.open.length }, (_, i) => i).filter((i) => piece.open[i])
    const near = (i: number, place: number[]) =>
      Math.hypot(...place.map((value, k) => value - piece.positions[i * 3 + k]!))
    // Every open point on a ring corner, and every corner taken.
    for (const i of open) expect(Math.min(...rim.map((place) => near(i, place)))).toBeLessThan(1e-6)
    for (const place of rim) expect(Math.min(...open.map((i) => near(i, place)))).toBeLessThan(1e-6)
    for (const i of open) {
      expect(piece.joints[i * 4]).toBe(CALF)
      expect(piece.weights[i * 4]).toBeCloseTo(1)
    }
    // Nothing above the ring; the furthest move is a cut point between two
    // corners collapsed onto the nearer (about half a side of the ring).
    const top = Math.max(...footCoordinates(piece, frame).map((point) => point[2]!))
    expect(top).toBeCloseTo(HEM / LENGTH)
    expect(fitted.snap * LENGTH).toBeLessThan(0.02)
    expect(fitted.depth).not.toBeNull()
  })

  test('tucked, the foot’s leg is cut off flat inside what covers it', () => {
    const bind = shodLeg()
    const plan = planFeet(bind, skinTexture(), [SKIN])!
    const frame = plan.frames[0]!
    const ring = plan.feet[0]!.ring
    const fitted = fitToRing(
      carryFoot(donorTube(0.3), [FOOT, CALF], frame, 3),
      ring,
      bind,
      frame,
      'tuck',
    )
    const top = Math.max(...footCoordinates(fitted.piece, frame).map((point) => point[2]!))
    expect(top).toBeCloseTo(ring.high + TUCK_ABOVE)
    expect(fitted.depth).toBeNull()
  })

  test('cloth a weld would stretch the foot too far to reach is tucked into instead; skin never is', () => {
    const bind = shodLeg()
    const plan = planFeet(bind, skinTexture(), [SKIN])!
    const frame = plan.frames[0]!
    const foot = plan.feet[0]!
    // A thin donor leg: its top must move 0.19 foot lengths out to the ring.
    const carried = () => carryFoot(donorTube(0.1), [FOOT, CALF], frame, 3)
    expect(fitToRing(carried(), foot.ring, bind, frame, 'weld').snap).toBeGreaterThan(CLOTH_SNAP)
    expect(fitFoot(carried(), { ...foot, skin: false }, bind, frame).mode).toBe('tuck')
    expect(fitFoot(carried(), foot, bind, frame).mode).toBe('weld')
  })

  test('a ring folded back on itself round the leg (a strap’s saw-tooth) loses its tooth: the donor’s top can follow it', () => {
    // A leg in short rows (5 of them) over the shoe.
    const bind = shodLeg(HEM, 0.04)
    // The leg's lowest corner at 90° hung lower and turned past the one at
    // 135°: round the leg, its open edge steps back there.
    const tooth = [
      ANKLE[0]! + 0.04 * Math.cos((5 * Math.PI) / 6),
      HEM - 0.01,
      0.04 * Math.sin((5 * Math.PI) / 6),
    ]
    bind.positions.set(tooth, 2 * 3)
    bind.positions.set(tooth, (5 * SIDES + 2 * SIDES + 2) * 3)
    const plan = planFeet(bind, skinTexture(), [SKIN])!
    const [foot] = plan.feet
    expect(foot!.mode).toBe('weld')
    for (let t = 0; t < 4 * SIDES * 2; t++) {
      if ([0, 1, 2].some((k) => bind.index[t * 3 + k] === 2)) expect(plan.hidden[t]).toBe(0)
    }
    expect(foot!.ring.low).toBeGreaterThan(HEM / LENGTH - 1e-6)
    const frame = plan.frames[0]!
    const { piece } = fitToRing(
      carryFoot(donorTube(0.3), [FOOT, CALF], frame, 3),
      foot!.ring,
      bind,
      frame,
      'weld',
    )
    const open = Array.from({ length: piece.open.length }, (_, i) => i).filter((i) => piece.open[i])
    for (const place of foot!.ring.places) {
      const nearest = Math.min(
        ...open.map((i) =>
          Math.hypot(...place.map((value, k) => value - piece.positions[i * 3 + k]!)),
        ),
      )
      expect(nearest).toBeLessThan(1e-6)
    }
  })

  test('a boot’s shaft, the boot’s colour, is hidden with what it hid; a trouser’s banded hem is not, a long sock over bare skin is', () => {
    // A 2×2 texture: the boot, its shaft or a hem, the trouser.
    const texture = (shaft: Rgb, above: Rgb = [40, 60, 120]): Pixels => {
      const data = new Uint8ClampedArray(2 * 2 * 4)
      for (const [texel, colour] of [
        [0, [35, 33, 30]],
        [1, shaft],
        [2, above],
        [3, above],
      ] as const)
        data.set([...colour, 255], texel * 4)
      return { data, width: 2, height: 2 }
    }
    const built: Built = { positions: [], uvs: [], joints: [], weights: [], index: [] }
    tube(built, 0.04, [0, 0.05, HEM], FOOT, [0.25, 0.25])
    tube(built, 0.04, [HEM, 0.2, 0.3], CALF, [0.75, 0.25])
    // A strap round the shaft, an island of its own.
    tube(built, 0.045, [0.15, 0.18], CALF, [0.75, 0.25])
    tube(built, 0.04, [0.3, 0.6, 0.9], CALF, [0.25, 0.75])
    const bind: BodyBind = {
      ...shodLeg(),
      positions: Float32Array.from(built.positions),
      normals: new Float32Array(built.positions.length),
      uvs: Float32Array.from(built.uvs),
      joints: Uint16Array.from(built.joints),
      weights: Float32Array.from(built.weights),
      index: Uint32Array.from(built.index),
    }
    const shown = (plan: ReturnType<typeof planFeet>, from: number, to: number) =>
      Array.from(plan!.hidden.subarray(from / 3, to / 3)).every((side) => side < 0)
    const quads = SIDES * 6
    const [shoe, shaft, strap] = [2 * quads, 2 * quads, quads]

    const boot = planFeet(bind, texture([40, 34, 28]), [SKIN])!
    expect(boot.feet[0]!.shaft).toBe(true)
    expect(Array.from(boot.hidden.subarray(0, (shoe + shaft + strap) / 3))).toEqual(
      new Array((shoe + shaft + strap) / 3).fill(0),
    )
    expect(shown(boot, shoe + shaft + strap, bind.index.length)).toBe(true)

    const hem = planFeet(bind, texture([122, 116, 95]), [SKIN])!
    expect(hem.feet[0]!.shaft).toBe(false)
    expect(shown(hem, shoe, bind.index.length)).toBe(true)

    const sock = planFeet(bind, texture([122, 116, 95], SKIN), [SKIN])!
    expect(sock.feet[0]!.shaft).toBe(true)
    expect(sock.feet[0]!.skin).toBe(true)
    expect(shown(sock, shoe + shaft + strap, bind.index.length)).toBe(true)
  })

  test('a leg that isn’t skin above a shoe is cloth: a trouser leg round both legs is tucked into', () => {
    const bind = shodLeg()
    // The leg's island skinned half to the other leg: a skirt's lining.
    for (let i = 0; i < 4 * SIDES; i++) {
      bind.joints.set([CALF, 4, 0, 0], i * 4)
      bind.weights.set([0.5, 0.5, 0, 0], i * 4)
    }
    const plan = planFeet(bind, skinTexture(), [SKIN])!
    expect(plan.feet[0]!.mode).toBe('tuck')
  })
})

describe('a donor’s feet', () => {
  test('their texture coordinates are moved onto an atlas of just their part of the texture', () => {
    const bind = shodLeg()
    // The shoe as a barefoot donor's foot, over a corner of a 64 × 64 texture.
    const count = bind.positions.length / 3
    for (let i = 0; i < count; i++)
      bind.uvs.set([0.1 + 0.2 * (i / count), 0.6 + 0.1 * (i / count)], i * 2)
    const { feet, rects, width, height } = donorFeet(bind, 64, 64)
    expect(feet[0]).not.toBeNull()
    expect(feet[1]).toBeNull()
    expect(rects).toHaveLength(1)
    expect(width).toBeLessThan(64)
    expect(height).toBeLessThan(64)
    const uvs = feet[0]!.uvs
    for (let i = 0; i < uvs.length; i++) {
      expect(uvs[i]).toBeGreaterThan(0)
      expect(uvs[i]).toBeLessThan(1)
    }
    // A point's texel on the atlas is its texel on the texture, moved by its rect.
    const [rect] = rects
    expect(uvs[0]! * width + rect!.x - rect!.at).toBeCloseTo(bind.uvs[0]! * 64, 3)
  })
})

describe('borrowed feet as a look puts them on', () => {
  const DONOR_SKIN: Rgb = [235, 160, 165]
  const donor = (radius = 0.3): FeetDonor => {
    const foot = donorTube(radius)
    // Unwrapped round the tube onto a 32 × 32 atlas.
    for (let i = 0; i < foot.uvs.length / 2; i++) {
      foot.uvs[i * 2] = 0.05 + 0.9 * ((i % 12) / 12)
      foot.uvs[i * 2 + 1] = 0.05 + 0.9 * (Math.floor(i / 12) / 9)
    }
    const data = new Uint8ClampedArray(32 * 32 * 4)
    for (let i = 0; i < 32 * 32; i++) data.set([...DONOR_SKIN.map((c) => c - (i % 7)), 255], i * 4)
    return {
      id: 'donor',
      bones: DONOR_BONES,
      feet: [foot, null],
      atlas: { data, width: 32, height: 32 },
    }
  }
  const body = (): FeetBody => {
    const texture = skinTexture()
    return {
      bind: shodLeg(),
      texture,
      face: SKIN,
      bodySkin: SKIN,
      bodySkinMask: new Float32Array(texture.width * texture.height).fill(1),
    }
  }
  /** The middle colour of the feet's atlas where the feet's texture coordinates fall. */
  const feetColour = (atlas: Pixels, worn: WornFeet) =>
    medianColour(
      atlas,
      worn.feet.flatMap((foot) => foot.texels.map((texel) => texel.texel)),
    )!

  test('they replace the shoe: its triangles hidden, the fitted feet one mesh on the wearer’s bones', () => {
    const feet = body()
    const worn = wornFeet(feet, donor(), 'bare')!
    expect(worn.hidden.filter((side) => side === 0)).toHaveLength(SIDES * 2 * 2)
    expect(worn.mesh.index.length).toBeGreaterThan(0)
    for (const joint of worn.mesh.joints.filter((_, k) => k % 4 === 0))
      expect([FOOT, CALF]).toContain(joint)
    // Fitted once per body and kind.
    expect(wornFeet(feet, donor(), 'bare')).toBe(worn)
    expect(wornFeet(feet, donor(), 'shoes')).toBeNull()
  })

  test('bare feet take the wearer’s skin, and its skin tone when the look gives one', () => {
    const feet = body()
    const given = donor()
    const worn = wornFeet(feet, given, 'bare')!
    const own = paintFeet(skinTexture(), feet, given, worn, { wear: 'bare', color: null }, null)
    const colour = feetColour(own, worn)
    expect(colourDistance(colour, SKIN)).toBeLessThan(colourDistance(DONOR_SKIN, SKIN) / 2)
    const deep = paintFeet(
      skinTexture(),
      feet,
      given,
      worn,
      { wear: 'bare', color: null },
      hexToRgb('#6b4430'),
    )
    expect(luminance(...feetColour(deep, worn))).toBeLessThan(luminance(...colour) * 0.7)
    // The donor's own pixels are left as they were.
    expect([...given.atlas.data.slice(0, 3)]).toEqual(DONOR_SKIN)
  })

  test('socks are knitted over the feet in their colour', () => {
    const feet = body()
    const given = donor()
    const worn = wornFeet(feet, given, 'socks')!
    const navy = hexToRgb('#1f2a4a')
    const socked = paintFeet(
      skinTexture(),
      feet,
      given,
      worn,
      { wear: 'socks', color: '#1f2a4a' },
      null,
    )
    expect(colourDistance(feetColour(socked, worn), navy)).toBeLessThan(0.15)
  })

  const bodyOf = (bind: BodyBind): FeetBody => {
    const texture = skinTexture(64)
    return {
      bind: unwrap(bind),
      texture,
      face: SKIN,
      bodySkin: SKIN,
      bodySkinMask: new Float32Array(texture.width * texture.height).fill(1),
    }
  }

  test('a leg flared wider than the donor’s at a pump’s opening is met higher up, where the two agree', () => {
    const feet = bodyOf(shodLeg(HEM, 0.06))
    const plan = planFeet(feet.bind, feet.texture, [SKIN])!
    expect(plan.feet[0]!.mode).toBe('weld')
    const frame = plan.frames[0]!
    const low = fitToRing(
      carryFoot(donorTube(0.2), [FOOT, CALF], frame, 3),
      plan.feet[0]!.ring,
      feet.bind,
      frame,
      'weld',
    )
    expect(low.snap).toBeGreaterThan(0.15)
    const worn = wornFeet(feet, donor(0.2), 'bare')!
    const [foot] = worn.feet
    expect(foot!.plan.ring.low).toBeGreaterThan(HEM / LENGTH + 0.1)
    expect(foot!.fitted.snap).toBeLessThan(0.15)
    expect(worn.hidden.filter((side) => side === 0).length).toBeGreaterThan(
      plan.hidden.filter((side) => side === 0).length,
    )
    expect(worn.legs[0]).not.toBeNull()
  })

  test('the seam’s normals are the shown leg’s, on the body and on the feet’s tops alike', () => {
    const feet = bodyOf(shodLeg())
    const worn = wornFeet(feet, donor(), 'bare')!
    expect(worn.seam.points.length).toBeGreaterThanOrEqual(SIDES)
    const seam = new Map<string, number[]>()
    const key = (positions: ArrayLike<number>, i: number) =>
      [0, 1, 2].map((k) => Math.round(positions[i * 3 + k]! * 1e5)).join(',')
    worn.seam.points.forEach((point, k) => {
      const n = Array.from(worn.seam.normals.subarray(k * 3, k * 3 + 3))
      // Square to the leg's side (the tube's faces stand upright).
      expect(Math.abs(n[1]!)).toBeLessThan(0.05)
      seam.set(key(feet.bind.positions, point), n)
    })
    let matched = 0
    for (let i = 0; i < worn.mesh.positions.length / 3; i++) {
      const n = seam.get(key(worn.mesh.positions, i))
      if (!n) continue
      matched++
      for (let k = 0; k < 3; k++) expect(worn.mesh.normals[i * 3 + k]!).toBeCloseTo(n[k]!, 4)
    }
    expect(matched).toBeGreaterThanOrEqual(SIDES)
  })

  test('socks welded on a ring above a crew sock’s cuff cover the foot to the ring: no skin between', () => {
    // A heel's lift puts the pump's ring well up the shin.
    const feet = bodyOf(shodLeg(0.2))
    const given = donor()
    const worn = wornFeet(feet, given, 'socks')!
    expect(worn.feet[0]!.plan.ring.low).toBeGreaterThan(SOCK_TOP)
    const navy = hexToRgb('#1f2a4a')
    const socked = paintFeet(
      feet.texture,
      feet,
      given,
      worn,
      { wear: 'socks', color: '#1f2a4a' },
      null,
    )
    for (const texel of worn.feet[0]!.texels) {
      const p = texel.texel * 4
      const colour: Rgb = [socked.data[p]!, socked.data[p + 1]!, socked.data[p + 2]!]
      expect(colourDistance(colour, navy)).toBeLessThan(0.3)
    }
  })
})

describe('bare feet’s paint', () => {
  test('matched to the leg at the weld, two of the donor’s texture islands toned apart meet it alike', () => {
    // Two islands side by side, a gap between: yellower and pinker skin.
    const width = 40
    const height = 4
    const data = new Uint8ClampedArray(width * height * 4)
    const texels: Texel[] = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x >= 10 && x < 30) continue
        const texel = y * width + x
        data.set(x < 10 ? [214, 170, 110, 255] : [226, 150, 150, 255], texel * 4)
        texels.push({ texel, a: 0, o: 0, u: 1, rise: 0, theta: 0, size: 0.01 })
      }
    }
    const pixels: Pixels = { data, width, height }
    const leg: Rgb = [140, 88, 60]
    paintBare(
      pixels,
      texels,
      leg,
      Array.from({ length: 12 }, () => leg),
    )
    for (const { texel } of texels) {
      const p = texel * 4
      expect(deltaE([pixels.data[p]!, pixels.data[p + 1]!, pixels.data[p + 2]!], leg)).toBeLessThan(
        3,
      )
    }
  })
})
