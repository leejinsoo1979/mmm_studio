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
  raiseRing,
  remapBones,
  skinHued,
  sockify,
  toFoot,
} from './bare-feet'
import {
  angleColour,
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

/** A body's feet planned, with what their paint needs of its own texture (`skins`: its hands' and face's skin, as found). */
type Planned = {
  plan: FeetPlan
  hands: Rgb | null
  face: Rgb | null
  skins: Rgb[]
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

/**
 * The leg's edge at a weld (in the foot's lengths above its ring): wholly
 * recoloured up to the first, fading out by the second, from its colour
 * between the second and the third.
 */
const EDGE: readonly [number, number, number] = [0.05, 0.1, 0.25]

/** Where above a ring (in the foot's lengths) the leg's skin is read clear of the shoe. */
const CLEAR: readonly [number, number] = [0.6, 0.9]

/** Texels of the leg this near its ring (in the foot's lengths, above it) give its colour there. */
const NEAR_RING: readonly [number, number] = [-0.02, 0.15]
/** Fewer texels than this by the ring, and it tells nothing of the leg's colour. */
const LEAST_NEAR = 30
/** How far above a ring (in the foot's lengths) the leg is recoloured to its skin, fading out between the two. */
const FIX_RISE: readonly [number, number] = [0.3, 0.5]
/** How far above a ring a skin-hued texel the body's mask leaves out is still toned as skin, fading out. */
const SHADOW_RISE: readonly [number, number] = [0.4, 0.7]

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
  // The leg's skin higher up, clear of the shoe: by a pump's low ring the
  // skin is shaded darker than the leg, which is no less skin for it.
  const higher = medianColour(
    texture,
    texels
      .filter((texel) => texel.rise > CLEAR[0] && texel.rise < CLEAR[1])
      .map((texel) => texel.texel),
  )
  const clear = higher && isSkin(higher, [colour, ...skins]) ? higher : null
  const clearLum = clear ? luminance(...clear) : 0
  const whole = new Map<number, number>()
  const fixes = new Map<number, Rgb>()
  for (const texel of texels) {
    const p = texel.texel * 4
    const was: Rgb = [texture.data[p]!, texture.data[p + 1]!, texture.data[p + 2]!]
    const distance = Math.min(
      colorDistance(was[0], was[1], was[2], colour, lum),
      clear ? colorDistance(was[0], was[1], was[2], clear, clearLum) : Number.POSITIVE_INFINITY,
    )
    let alike = 1 - smoothstep(0.2, 0.45, distance)
    // Right by the ring the leg is skin whatever its texture holds there:
    // it takes the leg's colour there, at its own lightness — the shaded
    // colour by the ring, the clear one by the time it fades out, so its
    // top edge leaves no band. By the rise, not the height: the fade
    // follows the ring round, not a texture island's slant.
    const byRing = 1 - smoothstep(FIX_RISE[0], FIX_RISE[1], texel.rise)
    if (byRing > 0 && alike < 1) {
      const toClear = smoothstep(NEAR_RING[1], FIX_RISE[0], texel.rise)
      const want = clear
        ? ([0, 1, 2].map((c) => colour[c]! + (clear[c]! - colour[c]!) * toClear) as Rgb)
        : colour
      const light = Math.min(
        1.1,
        Math.max(0.75, luminance(...was) / Math.max(luminance(...want), 1)),
      )
      const share = byRing * (1 - alike)
      fixes.set(
        texel.texel,
        [0, 1, 2].map((c) => was[c]! + (want[c]! * light - was[c]!) * share) as Rgb,
      )
      alike = Math.max(alike, byRing)
    }
    // And any skin's hue near it: the collar's shadow too.
    const shadow = skinHued(was) ? 1 - smoothstep(SHADOW_RISE[0], SHADOW_RISE[1], texel.rise) : 0
    const weight = Math.max(alike, shadow)
    if (weight > 0) whole.set(texel.texel, Math.max(whole.get(texel.texel) ?? 0, weight))
  }
  // The leg's very edge, where a shoe's collar or a sock's top was drawn,
  // takes the colour just above it (as fixed), angle by angle: no line
  // runs round the weld.
  const fixed: Pixels = { ...texture, data: texture.data.slice() }
  for (const [texel, rgb] of fixes) fixed.data.set(rgb, texel * 4)
  const above = byAngle(
    fixed,
    texels.filter((texel) => texel.rise > EDGE[1] && texel.rise < EDGE[2]),
  )
  if (above) {
    for (const texel of texels) {
      const share = 1 - smoothstep(EDGE[0], EDGE[1], texel.rise)
      if (share <= 0) continue
      const p = texel.texel * 4
      const want = angleColour(above, texel.theta)
      fixes.set(
        texel.texel,
        [0, 1, 2].map((c) => fixed.data[p + c]! + (want[c]! - fixed.data[p + c]!) * share) as Rgb,
      )
      whole.set(texel.texel, Math.max(whole.get(texel.texel) ?? 0, share))
    }
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
    skins,
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
 * The body's points along its welds and the normals they take there (in
 * the bind pose; see Ring's `normals`), which the feet's tops take too.
 */
export type FeetSeam = { points: Uint32Array; normals: Float32Array }

/**
 * Fitted feet as the main thread wears them (see avatar-feet.ts): `key`
 * names the fit (the body, the donor and the kind); the body's triangles
 * to hide (by side, −1 shown); the feet's mesh in the body's bind pose;
 * and the seam's normals on the body.
 */
export type FittedFeet = { key: string; hidden: Int8Array; mesh: FeetMesh; seam: FeetSeam }

/**
 * Borrowed feet fitted to a body: `kind` names the fit (the donor, bare or
 * socked); the body's triangles hidden for them (by side, −1 shown); the
 * feet's mesh; the seam's normals; each foot; and each side's welded bare
 * leg (see Leg).
 */
export type WornFeet = {
  kind: string
  hidden: Int8Array
  mesh: FeetMesh
  seam: FeetSeam
  feet: FootFit[]
  planned: Planned
  legs: (Leg | null)[]
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
  const worn = found && fitFeet(body, found, donor, wear, kind)
  kept.set(kind, worn)
  return worn
}

/**
 * A weld onto a bare leg that has to snap the donor's leg further than this
 * (in the foot's lengths) meets it too low, where the shoe's opening flares
 * the leg wider than an ankle: its ring is raised (see raiseRing) by
 * RAISE_STEP at a time, up to RAISE_MOST, while that brings the two closer.
 */
const RAISE_SNAP = 0.15
const RAISE_STEP = 0.1
const RAISE_MOST = 0.8

function fitFeet(
  body: FeetBody,
  found: Planned,
  donor: FeetDonor,
  wear: 'socks' | 'bare',
  kind: string,
): WornFeet | null {
  const { bind } = body
  const { plan } = found
  const bones = remapBones(donor.bones, bind.bones)
  const feet: FootFit[] = []
  let hidden = plan.hidden
  const raisedSides = new Set<number>()
  for (const planned of plan.feet) {
    const frame = plan.frames[planned.side]
    const donorFoot = donor.feet[planned.side]
    if (!(frame && donorFoot)) continue
    const fit = (foot: FootPlan) =>
      fitFoot(carryFoot(donorFoot, bones, frame, carryHeight(foot)), foot, bind, frame)
    let foot = planned
    let fitted = fit(foot)
    for (
      let rise = RAISE_STEP;
      fitted.mode === 'weld' && foot.skin && fitted.snap > RAISE_SNAP && rise <= RAISE_MOST;
      rise += RAISE_STEP
    ) {
      const trial = hidden.slice()
      const raised = raiseRing(bind, plan, foot, trial, planned.ring.high + rise)
      if (!raised) continue
      const refitted = fit(raised)
      if (refitted.mode !== 'weld' || refitted.snap >= fitted.snap) continue
      hidden = trial
      foot = raised
      fitted = refitted
      raisedSides.add(foot.side)
    }
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
  const shown = hidden.map((side) => (feet.some((each) => each.plan.side === side) ? side : -1))
  const raisedPlan = { ...plan, hidden }
  const legs = found.legs.map((leg, side) => {
    if (!raisedSides.has(side)) return leg
    const foot = feet.find((each) => each.plan.side === side)!
    return legOf(bind, body.texture, raisedPlan, foot.plan, foot.frame, found.skins)
  })
  return {
    kind,
    hidden: shown,
    mesh: meshOf(feet),
    seam: seamOf(bind, plan, feet),
    feet,
    planned: found,
    legs,
  }
}

/** The body's points along the feet's welds, all of each spot's, with their ring's normals. */
function seamOf(bind: BodyBind, plan: FeetPlan, feet: readonly FootFit[]): FeetSeam {
  const { spots } = plan.layout
  const bySpot = new Map<number, number[]>()
  for (const { plan: foot, fitted } of feet) {
    if (fitted.mode !== 'weld') continue
    foot.ring.legPoint.forEach((point, k) => {
      const normal = foot.ring.normals[k]
      if (point >= 0 && normal) bySpot.set(spots[point]!, normal)
    })
  }
  const points: number[] = []
  const normals: number[] = []
  for (let i = 0; i < bind.positions.length / 3; i++) {
    const normal = bySpot.get(spots[i]!)
    if (!normal) continue
    points.push(i)
    normals.push(...normal)
  }
  return { points: Uint32Array.from(points), normals: Float32Array.from(normals) }
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

/**
 * How far above a weld (in the foot's lengths) a sock's cuff reaches at
 * least, over the leg's shaded edge there (a pump's low ring sits well up
 * a raised heel's shin: a crew sock's cuff below it would leave a band of
 * that shading between the two), and how high a cuff may go for that.
 */
const CUFF_OVER = 0.15
const CUFF_MOST = 2

/** Where a sock's cuff on a welded foot's bare leg is, or null for a foot whose sock stops on the foot (see paintFeet). */
function legCuff(foot: FootFit) {
  if (foot.fitted.mode !== 'weld' || foot.plan.shaft) return null
  const top = Math.max(SOCK_TOP, foot.plan.ring.high + CUFF_OVER)
  return top <= CUFF_MOST ? top : null
}

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
    foot.fitted.mode === 'weld' ? worn.legs[foot.plan.side] : null,
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
      const cuff = legCuff(foot)
      if (leg && cuff !== null) paintSock(body, leg.texels, sock, cuff, foot.front)
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
    const leg = foot.fitted.mode === 'weld' ? worn.legs[foot.plan.side] : null
    let colour = leg?.colour ?? hands ?? face ?? DEFAULT_SKIN
    if (skin) colour = tonedColour(colour, skin, feet.bodySkin)
    const matched = wear.wear === 'bare' && leg ? byAngle(body, leg.near) : null
    paintBare(atlas, foot.texels, colour, matched)
    if (wear.wear === 'socks') {
      const sock = wear.color ? hexToRgb(wear.color) : DEFAULT_SOCK
      paintSock(
        atlas,
        foot.texels,
        sock,
        leg && legCuff(foot) !== null ? null : SOCK_TOP,
        foot.front,
      )
    }
  }
  return atlas
}
