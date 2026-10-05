/**
 * Borrowed feet as a look puts them on (in the look worker): the body's
 * feet planned once from its own texture, the donor's fitted once per
 * donor and kind (bare or socked: a sock's foot is another shape), and
 * both painted for each look — the leg's skin made whole round the weld,
 * the skin tone, a sock's cuff up a bare leg, and the feet's own texture.
 */

import {
  type BodyBind,
  carryFoot,
  carryHeight,
  colourDistance,
  type DonorFoot,
  type FeetPlan,
  type Fitted,
  type FootFrame,
  type FootPlan,
  fitFoot,
  isSkin,
  planFeet,
  remapBones,
  skinHued,
  sockify,
  toFoot,
} from './bare-feet'
import {
  byAngle,
  DEFAULT_SOCK,
  handsColour,
  medianColour,
  paintBare,
  paintSock,
  SOCK_TOP,
  type Surface,
  type Texel,
  texelsOf,
  tonedColour,
} from './bare-feet-paint'
import type { AvatarFeet } from './footwear'
import { colorDistance, hexToRgb, luminance, type Pixels, type Rgb, toneSkin } from './look-pixels'

/**
 * A barefoot donor as the worker needs it: its feet (see DonorFoot; left,
 * right), their texture coordinates on `atlas` (their part of its texture,
 * cut out), and its skeleton's bone names.
 */
export type FeetDonor = {
  id: string
  bones: string[]
  feet: (DonorFoot | null)[]
  atlas: Pixels
}

/** What of a body's own texture a look's feet need. */
export type FeetBody = {
  bind: BodyBind
  texture: Pixels
  /** The face's skin colour (the look's analysis has it). */
  face: Rgb
  /** The body texture's usual skin colour, which the skin tone is toned from. */
  bodySkin: Rgb
  bodySkinMask: Float32Array
}

/**
 * A bare leg at a weld (see legsOf): texels of the leg near it, the leg's
 * colour just above it (`colour`, from `near`), and what makes its skin
 * whole round it — texels toned with the skin wholly or in part though the
 * body's skin mask leaves them out (`whole`), and texels by the ring
 * recoloured to the leg's skin (`fixes`: a shoe's lining or collar bled
 * onto it).
 */
type Leg = {
  texels: Texel[]
  near: Texel[]
  colour: Rgb
  whole: Map<number, number>
  fixes: Map<number, Rgb>
}

/** A body's feet planned, with what their paint needs of its own texture. */
type Planned = {
  plan: FeetPlan
  hands: Rgb | null
  face: Rgb | null
  legs: (Leg | null)[]
}

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** How unlike the face's skin the hands' may be and still be skin (a glove's leather can have a skin's hue). */
const HANDS_LIKE_FACE = 0.3

/** How far above a ring (in the foot's lengths) the leg is looked at, and how far out from its middle (rings' radii). */
const LEG_ABOVE = 0.5
const LEG_OUT = 1.6

/**
 * A body's leg near a ring as a surface: its shown triangles reaching below
 * `top` and not below the ring, within LEG_OUT of its middle, and any of
 * the islands carrying on from it (`adjoining`).
 */
function legSurface(
  bind: BodyBind,
  plan: FeetPlan,
  foot: FootPlan,
  frame: FootFrame,
  top: number,
): Surface {
  const { ring } = foot
  const inLeg = new Uint8Array(bind.positions.length / 3)
  for (const point of foot.adjoining) inLeg[point] = 1
  const index: number[] = []
  const local = [0, 0, 0]
  for (let t = 0; t < bind.index.length / 3; t++) {
    if (plan.hidden[t]! >= 0) continue
    const tri = [bind.index[t * 3]!, bind.index[t * 3 + 1]!, bind.index[t * 3 + 2]!]
    let reaches = false
    let within = true
    for (const i of tri) {
      toFoot(
        frame,
        bind.positions[i * 3]!,
        bind.positions[i * 3 + 1]!,
        bind.positions[i * 3 + 2]!,
        local,
      )
      if (local[2]! < top) reaches = true
      if (
        local[2]! <= ring.low - 0.05 ||
        Math.hypot(local[0]! - ring.centre[0], local[1]! - ring.centre[1]) >= ring.radius * LEG_OUT
      ) {
        within = false
      }
    }
    if ((reaches && within) || tri.every((i) => inLeg[i])) index.push(...tri)
  }
  return { positions: bind.positions, uvs: bind.uvs, index }
}

/** Texels of the leg this near its ring (in the foot's lengths, above it) give its colour there. */
const NEAR_RING: readonly [number, number] = [-0.02, 0.15]
/** Fewer texels than this by the ring, and it tells nothing of the leg's colour. */
const LEAST_NEAR = 30

/**
 * A welded bare leg's paint (see Leg), or null when the leg at the ring
 * isn't the character's skin. The body's skin mask goes by likeness to the
 * body's usual skin, so it leaves out a leg's shaded stretches (under a
 * shoe's collar, a boot's rim): by the ring, the leg's own colour there
 * picks out its skin instead.
 */
function legOf(
  bind: BodyBind,
  texture: Pixels,
  plan: FeetPlan,
  foot: FootPlan,
  frame: FootFrame,
  skins: readonly Rgb[],
): Leg | null {
  const { ring } = foot
  const top = Math.max(ring.high + LEG_ABOVE, SOCK_TOP + 0.2)
  const texels = texelsOf(
    texture.width,
    texture.height,
    legSurface(bind, plan, foot, frame, top),
    frame,
    ring,
    1,
  )
  const near = texels.filter((texel) => texel.rise > NEAR_RING[0] && texel.rise < NEAR_RING[1])
  const colour = medianColour(
    texture,
    near.map((texel) => texel.texel),
  )
  if (!colour || near.length < LEAST_NEAR || !isSkin(colour, skins)) return null
  const lum = luminance(...colour)
  const whole = new Map<number, number>()
  const fixes = new Map<number, Rgb>()
  for (const texel of texels) {
    const p = texel.texel * 4
    const was: Rgb = [texture.data[p]!, texture.data[p + 1]!, texture.data[p + 2]!]
    let alike = 1 - smoothstep(0.2, 0.45, colorDistance(was[0], was[1], was[2], colour, lum))
    // Right by the ring the leg is skin whatever its texture holds there:
    // it takes the leg's colour, at its own lightness.
    const byRing = 1 - smoothstep(ring.high + 0.3, ring.high + 0.5, texel.u)
    if (byRing > 0 && alike < 1) {
      const light = Math.min(1.1, Math.max(0.75, luminance(...was) / Math.max(lum, 1)))
      const share = byRing * (1 - alike)
      fixes.set(
        texel.texel,
        [0, 1, 2].map((c) => was[c]! + (colour[c]! * light - was[c]!) * share) as Rgb,
      )
      alike = Math.max(alike, byRing)
    }
    // And any skin's hue near it: the collar's shadow too.
    const shadow = skinHued(was) ? 1 - smoothstep(ring.high + 0.4, ring.high + 0.7, texel.u) : 0
    const weight = Math.max(alike, shadow)
    if (weight > 0) whole.set(texel.texel, Math.max(whole.get(texel.texel) ?? 0, weight))
  }
  return { texels, near, colour, whole, fixes }
}

const planned = new WeakMap<BodyBind, Planned | null>()

/**
 * A body's feet planned (see planFeet), and the paint its welded bare legs
 * need; worked out once per body. Null for a body without shoes.
 */
function plannedOf(body: FeetBody): Planned | null {
  let found = planned.get(body.bind)
  if (found !== undefined) return found
  const { bind, texture } = body
  const face = skinHued(body.face) ? body.face : null
  const ownHands = handsColour(bind, texture)
  const hands =
    ownHands && (!face || colourDistance(ownHands, face) < HANDS_LIKE_FACE) ? ownHands : null
  const skins = [hands, face].filter((colour): colour is Rgb => colour !== null)
  const plan = planFeet(bind, texture, skins)
  found = plan && {
    plan,
    hands,
    face,
    legs: [0, 1].map((side) => {
      const foot = plan.feet.find((each) => each.side === side)
      const frame = plan.frames[side]
      return foot && frame && foot.mode === 'weld' && foot.skin
        ? legOf(bind, texture, plan, foot, frame, skins)
        : null
    }),
  }
  planned.set(bind, found)
  return found
}

/** A foot fitted: its plan, frame and fit, its texels on the donor's atlas, and its toe's front (foot lengths). */
type FootFit = {
  plan: FootPlan
  frame: FootFrame
  fitted: Fitted
  texels: Texel[]
  front: number
}

/** A mesh of borrowed feet, in the wearer's bind pose, skinned to its bones (see Piece). */
export type FeetMesh = {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  joints: Uint16Array
  weights: Float32Array
  index: Uint32Array
}

/**
 * Fitted feet as the main thread wears them (see avatar-feet.ts): `key`
 * names the fit (the body, the donor and the kind); the body's triangles
 * to hide (by side, −1 shown); the feet's mesh in the body's bind pose.
 */
export type FittedFeet = { key: string; hidden: Int8Array; mesh: FeetMesh }

/**
 * Borrowed feet fitted to a body: `kind` names the fit (the donor, bare or
 * socked); the body's triangles hidden for them (by side, −1 shown); the
 * feet's mesh; and each foot.
 */
export type WornFeet = {
  kind: string
  hidden: Int8Array
  mesh: FeetMesh
  feet: FootFit[]
  planned: Planned
}

const fits = new WeakMap<BodyBind, Map<string, WornFeet | null>>()

/**
 * A donor's feet fitted to a body for `wear` (bare or socks), kept per
 * body; null for a body without shoes, or shod.
 */
export function wornFeet(
  body: FeetBody,
  donor: FeetDonor,
  wear: AvatarFeet['wear'],
): WornFeet | null {
  if (wear === 'shoes') return null
  const kind = `${donor.id}|${wear}`
  let kept = fits.get(body.bind)
  if (!kept) {
    kept = new Map()
    fits.set(body.bind, kept)
  }
  if (kept.has(kind)) return kept.get(kind)!
  const found = plannedOf(body)
  const worn = found && fitFeet(body.bind, found, donor, wear, kind)
  kept.set(kind, worn)
  return worn
}

function fitFeet(
  bind: BodyBind,
  found: Planned,
  donor: FeetDonor,
  wear: 'socks' | 'bare',
  kind: string,
): WornFeet | null {
  const { plan } = found
  const bones = remapBones(donor.bones, bind.bones)
  const feet: FootFit[] = []
  for (const foot of plan.feet) {
    const frame = plan.frames[foot.side]
    const donorFoot = donor.feet[foot.side]
    if (!(frame && donorFoot)) continue
    const fitted = fitFoot(carryFoot(donorFoot, bones, frame, carryHeight(foot)), foot, bind, frame)
    if (fitted.piece.index.length === 0) continue
    if (wear === 'socks') sockify(fitted.piece, frame, fitted.depth)
    const texels = texelsOf(
      donor.atlas.width,
      donor.atlas.height,
      fitted.piece,
      frame,
      fitted.mode === 'weld' ? foot.ring : null,
    )
    let front = Number.NEGATIVE_INFINITY
    for (const texel of texels) front = Math.max(front, texel.a)
    feet.push({ plan: foot, frame, fitted, texels, front })
  }
  if (feet.length === 0) return null
  // A shoe no foot could be fitted to stays on.
  const hidden = plan.hidden.map((side) =>
    feet.some((each) => each.plan.side === side) ? side : -1,
  )
  return { kind, hidden: Int8Array.from(hidden), mesh: meshOf(feet), feet, planned: found }
}

/** The feet's pieces as one mesh. */
function meshOf(feet: readonly FootFit[]): FeetMesh {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const joints: number[] = []
  const weights: number[] = []
  const index: number[] = []
  for (const { fitted } of feet) {
    const { piece } = fitted
    const first = positions.length / 3
    positions.push(...piece.positions)
    normals.push(...piece.normals)
    uvs.push(...piece.uvs)
    joints.push(...piece.joints)
    weights.push(...piece.weights)
    for (const corner of piece.index) index.push(first + corner)
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    joints: Uint16Array.from(joints),
    weights: Float32Array.from(weights),
    index: Uint32Array.from(index),
  }
}

/** Whether a foot is welded to a bare leg low enough for a sock's cuff to carry on up it. */
const cuffedLeg = (foot: FootFit) =>
  foot.fitted.mode === 'weld' && !foot.plan.shaft && foot.plan.ring.low < SOCK_TOP

/**
 * The body's texture (`body`, the look's copy of its own, changed in place)
 * under borrowed feet: each welded bare leg's skin made whole round the
 * weld (see Leg); the skin tone, when given, over all its skin and those
 * legs wholly; and a sock's cuff up the bare leg above a weld.
 */
export function dressLegs(
  body: Pixels,
  feet: FeetBody,
  worn: WornFeet,
  wear: AvatarFeet,
  skin: Rgb | null,
) {
  const legs = worn.feet.map((foot) =>
    foot.fitted.mode === 'weld' ? worn.planned.legs[foot.plan.side] : null,
  )
  for (const leg of legs) {
    if (!leg) continue
    for (const [texel, rgb] of leg.fixes)
      for (let c = 0; c < 3; c++) body.data[texel * 4 + c] = rgb[c]!
  }
  if (skin) {
    // The legs' whole skin toned from its colour before the tone, as much as
    // it is skin by either measure.
    const whole = new Map<number, number>()
    for (const leg of legs) {
      if (!leg) continue
      for (const [texel, weight] of leg.whole) {
        const own = feet.bodySkinMask[texel]!
        if (weight > own) whole.set(texel, Math.max(whole.get(texel) ?? 0, weight))
      }
    }
    const texels = [...whole.keys()]
    const untoned: Pixels = {
      data: new Uint8ClampedArray(texels.length * 4),
      width: texels.length,
      height: 1,
    }
    texels.forEach((texel, k) => {
      untoned.data.set(body.data.subarray(texel * 4, texel * 4 + 4), k * 4)
    })
    toneSkin(body, skin, feet.bodySkin, feet.bodySkinMask)
    if (texels.length > 0) {
      toneSkin(
        untoned,
        skin,
        feet.bodySkin,
        Float32Array.from(texels, (texel) => whole.get(texel)!),
      )
      texels.forEach((texel, k) => {
        body.data.set(untoned.data.subarray(k * 4, k * 4 + 3), texel * 4)
      })
    }
  }
  if (wear.wear === 'socks') {
    const sock = wear.color ? hexToRgb(wear.color) : DEFAULT_SOCK
    worn.feet.forEach((foot, k) => {
      const leg = legs[k]
      if (leg && cuffedLeg(foot)) paintSock(body, leg.texels, sock, SOCK_TOP, foot.front)
    })
  }
}

/**
 * Bare feet's colour where neither the leg nor the hands nor the face show
 * any skin (gloves and a mask): a light, warm skin tone.
 */
const DEFAULT_SKIN: Rgb = [222, 170, 138]

/**
 * The feet's own texture: the donor's atlas with each foot toned to the
 * wearer's skin — its leg's colour just above a weld to a bare leg (and
 * matched to it angle by angle there), its hands' or face's otherwise
 * (feet and hands alike) — in the look's skin tone when given; socks
 * knitted over them in `wear`'s colour, up to a cuff above the ankle where
 * no bare leg carries the sock on (a tucked foot's: under the clothes).
 * `body` is the body's texture as the look dressed it (see dressLegs).
 */
export function paintFeet(
  body: Pixels,
  feet: FeetBody,
  donor: FeetDonor,
  worn: WornFeet,
  wear: AvatarFeet,
  skin: Rgb | null,
): Pixels {
  const atlas: Pixels = {
    data: new Uint8ClampedArray(donor.atlas.data),
    width: donor.atlas.width,
    height: donor.atlas.height,
  }
  const { hands, face } = worn.planned
  for (const foot of worn.feet) {
    const leg = foot.fitted.mode === 'weld' ? worn.planned.legs[foot.plan.side] : null
    let colour = leg?.colour ?? hands ?? face ?? DEFAULT_SKIN
    if (skin) colour = tonedColour(colour, skin, feet.bodySkin)
    const matched = wear.wear === 'bare' && leg ? byAngle(body, leg.near) : null
    paintBare(atlas, foot.texels, colour, matched)
    if (wear.wear === 'socks') {
      const sock = wear.color ? hexToRgb(wear.color) : DEFAULT_SOCK
      paintSock(atlas, foot.texels, sock, cuffedLeg(foot) ? null : SOCK_TOP, foot.front)
    }
  }
  return atlas
}
