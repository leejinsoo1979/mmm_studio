/**
 * The form a foot out of its shoe takes, measured off Rocketbox's own bare
 * feet (Sports_Male_01's and Sports_Female_01's, between the two and a
 * little slighter, so a shoe is always taken in). It is laid out in the
 * foot's own frame and in the foot's own length (from the ankle bone to the
 * ball of the foot, the toe bone, along the ground), so it fits a child as
 * well as a man: `along` from straight under the ankle (0) towards the toes
 * (1 at the ball), `out` across it (positive towards the foot's outside,
 * away from the other foot), `up` from the ground. The shaper (feet.ts)
 * takes a shoe in to it; the paint (feet-paint.ts) finds the toes on it.
 */

/** Where the heel reaches back to, at its fullest (HEEL_FULLEST up). */
export const HEEL_BACK = -0.44
export const HEEL_FULLEST = 0.25
/**
 * How far forward of HEEL_BACK the heel's back sits on the ground (it rounds
 * under), and up the Achilles tendon, above the heel.
 */
const HEEL_UNDER = 0.07
const ACHILLES = 0.12
const ACHILLES_FROM = 0.3
const ACHILLES_TO = 0.7

/**
 * Where the big toe reaches to (the toes' line slants back from it to the
 * little toe's tip), at TOE_MIDDLE up; the toes' fronts round off over
 * TOE_ROUND above and below that.
 */
export const TOE_TIP = 1.46
export const LITTLE_TOE_TIP = 1.33
export const TOE_MIDDLE = 0.09
const TOE_ROUND = 0.11

/**
 * Where the toes begin (their roots, across the top of the foot) along the
 * big toe's side and the little toe's.
 */
export const TOE_ROOT_INSIDE = 1.12
export const TOE_ROOT_OUTSIDE = 1.02

/**
 * Where the inside (the big toe's side) and the outside of the foot start to
 * round in to the toes' tips, and how square that rounding is (2 a quarter
 * ellipse; more, blunter).
 */
const TAPER_INSIDE = 1.2
const TAPER_OUTSIDE = 1.1
const TAPER_POWER = 2.6

/** How far along the heel rounds in to its back, seen from above. */
const HEEL_ROUND = 0.2

/** Half the foot's width (its widest, near the ground) along it: heel, the waist over the arch, the ball. */
const HALF_WIDTH: readonly (readonly [number, number])[] = [
  [HEEL_BACK + HEEL_ROUND, 0.25],
  [-0.05, 0.255],
  [0.15, 0.25],
  [0.45, 0.285],
  [0.75, 0.335],
  [0.95, 0.34],
  [1.15, 0.33],
]

/**
 * The top of the foot from the front of the ankle down the instep to the
 * toes: behind INSTEP_FROM it has no top of its own (the ankle rises into
 * the leg), and it takes over fully by INSTEP_TO.
 */
const TOP: readonly (readonly [number, number])[] = [
  [0.3, 0.81],
  [0.4, 0.65],
  [0.5, 0.54],
  [0.6, 0.48],
  [0.7, 0.405],
  [0.8, 0.355],
  [0.9, 0.31],
  [1.0, 0.28],
  [1.1, 0.25],
  [1.2, 0.225],
  [1.3, 0.2],
  [1.46, 0.17],
]
export const INSTEP_FROM = 0.15
export const INSTEP_TO = 0.55

/**
 * How the foot's sides round in to the sole: `least` of its width is left
 * on the ground, and it has its full width `height` up. The heel is round
 * underneath, the ball nearly flat, and the inside of the midfoot rises
 * over the arch.
 */
const SOLE_HEEL = { least: 0.55, height: 0.25 }
const SOLE_BALL = { least: 0.85, height: 0.08 }
const SOLE_ARCH = { least: 0.45, height: 0.22 }
const ARCH_FROM = -0.05
const ARCH_TO = 0.7

/** How square the forefoot's top rounds over (see `section`): 2 an ellipse, more flatter-topped. */
const TOP_POWER = 3

/** How much slimmer the ankle is than the heel under it (the ankle's share), from ANKLE_FROM up to ANKLE_TO. */
const ANKLE_SHARE = 0.92
const ANKLE_FROM = 0.35
const ANKLE_TO = 0.7

export const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * A smooth curve through knots (x rising), flat beyond its ends: monotone
 * between them (Fritsch–Carlson), so it never overshoots a knot and makes a
 * bump the foot doesn't have.
 */
export function curve(knots: readonly (readonly [number, number])[]) {
  const n = knots.length
  const x = knots.map((knot) => knot[0])
  const y = knots.map((knot) => knot[1])
  const slopes = Array.from({ length: n - 1 }, (_, i) => (y[i + 1]! - y[i]!) / (x[i + 1]! - x[i]!))
  const tangents = x.map((_, i) => {
    if (i === 0) return slopes[0]!
    if (i === n - 1) return slopes[n - 2]!
    const [a, b] = [slopes[i - 1]!, slopes[i]!]
    return a * b <= 0 ? 0 : (3 * (a + b)) / ((2 * a + b) / a + (a + 2 * b) / b)
  })
  return (at: number) => {
    if (at <= x[0]!) return y[0]!
    if (at >= x[n - 1]!) return y[n - 1]!
    let i = 0
    while (at > x[i + 1]!) i++
    const h = x[i + 1]! - x[i]!
    const t = (at - x[i]!) / h
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * y[i]! +
      (t3 - 2 * t2 + t) * h * tangents[i]! +
      (-2 * t3 + 3 * t2) * y[i + 1]! +
      (t3 - t2) * h * tangents[i + 1]!
    )
  }
}

const halfWidthAlong = curve(HALF_WIDTH)
const topAlong = curve(TOP)

/** The top of the foot at `along`: the instep's and the toes' (behind INSTEP_FROM, the ankle's front, which the leg carries on up). */
export const footTop = (along: number) => topAlong(along)

/** A rounded end: none of `reach` taken off at the middle, all of it `radius` away either side. */
const rounded = (offset: number, radius: number, reach: number) => {
  const t = Math.min(1, Math.abs(offset) / radius)
  return reach * (1 - Math.sqrt(1 - t * t))
}

/** How far back the foot reaches at `up`: the heel rounds under, and the Achilles tendon above it is further in. */
export function heelBack(up: number) {
  const under = up < HEEL_FULLEST ? rounded(HEEL_FULLEST - up, HEEL_FULLEST, HEEL_UNDER) : 0
  return HEEL_BACK + under + ACHILLES * smoothstep(ACHILLES_FROM, ACHILLES_TO, up)
}

/** How far forward the big toe reaches at `up`: its front rounds off above and below its middle. */
export function toeFront(up: number) {
  return TOE_TIP - rounded(up - TOE_MIDDLE, TOE_ROUND, TOE_ROUND)
}

/** A superellipse's quarter: 1 at 0, 0 at 1. */
const quarter = (t: number, power: number) =>
  t <= 0 ? 1 : t >= 1 ? 0 : (1 - t ** power) ** (1 / power)

/**
 * Half the foot's width on one side (`inside`, the big toe's, or the
 * outside) at `along`, `up`: its outline seen from above (the heel rounded,
 * the toes' tips slanting back to the little toe), narrowed where its sides
 * round in to the sole and over its top, and up the slimmer ankle.
 */
export function halfWidth(along: number, up: number, inside: boolean) {
  const back = heelBack(up)
  let width = halfWidthAlong(along)
  // Seen from above, the heel is a half round.
  if (along < back + HEEL_ROUND) {
    const into = (along - back) / HEEL_ROUND
    width *= into <= 0 ? 0 : Math.sqrt(1 - (1 - into) ** 2)
  }
  const [taper, tip] = inside ? [TAPER_INSIDE, TOE_TIP] : [TAPER_OUTSIDE, LITTLE_TOE_TIP]
  if (along > taper) width *= quarter((along - taper) / (tip - taper), TAPER_POWER)
  // Round in to the sole: the heel, the arch (inside only) and the ball.
  const ball = smoothstep(-0.1, 0.6, along)
  let least = lerp(SOLE_HEEL.least, SOLE_BALL.least, ball)
  let height = lerp(SOLE_HEEL.height, SOLE_BALL.height, ball)
  if (inside) {
    const arch = smoothstep(ARCH_FROM, 0.2, along) * (1 - smoothstep(0.45, ARCH_TO, along))
    least = lerp(least, SOLE_ARCH.least, arch)
    height = lerp(height, SOLE_ARCH.height, arch)
  }
  width *= least + (1 - least) * (1 - rounded(1 - Math.min(1, up / height), 1, 1))
  // Over the forefoot's top, and up the ankle.
  const fore = smoothstep(INSTEP_FROM, INSTEP_TO, along)
  const top = footTop(along)
  width *= lerp(1, quarter(Math.min(0.97, up / top), TOP_POWER), fore)
  width *= lerp(1, ANKLE_SHARE, smoothstep(ANKLE_FROM, ANKLE_TO, up) * (1 - fore))
  return width
}
