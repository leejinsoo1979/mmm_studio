/**
 * A hairstyle grown on the character's own scalp: one of the styles, its
 * sliders, and how its ends are coloured and how it shines. The cut fits
 * any avatar (the hair grows from each one's own scalp), so it moves from
 * one character to another as it is. Its base colour is the look's `hair`
 * (null: the avatar's own hair colour). Pure: the store, the studio and
 * the hair workers all read it.
 */

export const HAIR_CUT_STYLES = [
  'short',
  'dandy',
  'twoBlock',
  'bob',
  'long',
  'layered',
  'ponytail',
  'bun',
  'curly',
] as const
export type HairCutStyle = (typeof HAIR_CUT_STYLES)[number]

/** A generated hairstyle. */
export type HairCut = {
  style: HairCutStyle
  /** −1..1, 0 = the style's own length. */
  length: number
  /** −1..1. */
  volume: number
  /** 0..1. */
  curl: number
  /** −1..1: + moves the part toward the character's left. */
  part: number
  /** 0..1, absolute: each style starts at its own. */
  fringe: number
  /** The ends' colour (#rrggbb, ombré from ear level down), or null for none. */
  tip: string | null
  /** 0..1. */
  shine: number
}

/** A cut's sliders and the range each goes over. */
export const HAIR_CUT_RANGES = {
  length: [-1, 1],
  volume: [-1, 1],
  curl: [0, 1],
  part: [-1, 1],
  fringe: [0, 1],
} as const satisfies Record<string, readonly [number, number]>
export type HairCutSlider = keyof typeof HAIR_CUT_RANGES

/** What hair is grown from: a cut without its colours, which are its material's alone. */
export type GrowCut = Pick<HairCut, 'style' | HairCutSlider>

/** Where each style's sliders start when it is picked: its own length and volume, its fringe and part. */
export const DEFAULT_CUT_PARAMS: Record<HairCutStyle, Readonly<Record<HairCutSlider, number>>> = {
  short: { length: 0, volume: 0, curl: 0, part: 0.35, fringe: 0.2 },
  dandy: { length: 0, volume: 0, curl: 0, part: 0, fringe: 0.8 },
  twoBlock: { length: 0, volume: 0, curl: 0, part: 0.2, fringe: 0.6 },
  bob: { length: 0, volume: 0, curl: 0, part: 0, fringe: 0.5 },
  long: { length: 0, volume: 0, curl: 0, part: 0.2, fringe: 0.3 },
  layered: { length: 0, volume: 0, curl: 0, part: 0.3, fringe: 0.4 },
  ponytail: { length: 0, volume: 0, curl: 0, part: 0, fringe: 0.2 },
  bun: { length: 0, volume: 0, curl: 0, part: 0, fringe: 0.2 },
  curly: { length: 0, volume: 0, curl: 0, part: 0, fringe: 0.4 },
}

export const DEFAULT_SHINE = 0.5

const HEX = /^#[0-9a-f]{6}$/i
const SLIDERS = Object.keys(HAIR_CUT_RANGES) as HairCutSlider[]

const isStyle = (value: unknown): value is HairCutStyle =>
  HAIR_CUT_STYLES.includes(value as HairCutStyle)

/** To the hundredth the sliders show, so a cut read back is the cut saved (and never −0). */
const hundredths = (value: number) => Math.round(value * 100) / 100 || 0

const setting = (value: unknown, [low, high]: readonly [number, number], fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? hundredths(Math.min(high, Math.max(low, value)))
    : fallback

/**
 * A cut as saved or received, or null when it isn't one (no cut, or a
 * style this client doesn't have): the character wears its own hair. Each
 * slider is kept in its range, to the hundredth; a missing one is the
 * style's own.
 */
export function readHairCut(value: unknown): HairCut | null {
  const cut = value as Partial<Record<keyof HairCut, unknown>> | null
  if (!cut || typeof cut !== 'object' || !isStyle(cut.style)) return null
  const defaults = DEFAULT_CUT_PARAMS[cut.style]
  const sliders = Object.fromEntries(
    SLIDERS.map((id) => [id, setting(cut[id], HAIR_CUT_RANGES[id], defaults[id])]),
  ) as Record<HairCutSlider, number>
  return {
    style: cut.style,
    ...sliders,
    tip: typeof cut.tip === 'string' && HEX.test(cut.tip) ? cut.tip : null,
    shine: setting(cut.shine, [0, 1], DEFAULT_SHINE),
  }
}

/**
 * What a cut grows the same hair for: its style and sliders, each to the
 * hundredth (its colours change the material alone).
 */
export const cutKey = (cut: GrowCut): string =>
  [cut.style, ...SLIDERS.map((id) => Math.round(cut[id] * 100) || 0)].join('|')

/**
 * `hair-grow.json`, made offline by scripts/characters/gen-hair-grow.ts:
 * for each avatar, the generated cut closest to its own hair (what the
 * first pick, a random look and an old borrowed hairstyle start from), its
 * own hair's and its scalp-side skin's colours, whether generated hair can
 * be worn at all, and what it is worn over.
 */
export type HairGrowFile = {
  version: 1
  avatars: Record<string, HairGrowEntry>
}

export type HairGrowEntry = {
  /** The generated cut closest to the avatar's own hair (style and sliders). */
  cut: HairCut
  /** The avatar's own hair colour (#rrggbb): the hair's base colour while the look's `hair` is null. */
  colour: string
  /** The avatar's skin beside its hairline (#rrggbb): the roots' tint while the look's `skin` is null. */
  skin: string
  /** False for heads that can't wear generated hair (headwear modelled into the head, one-piece heads, a failed flatten). */
  grow: boolean
  /** What generated hair is worn over: the head's own surface flattened, or the fitted bald skull. */
  base: 'flat' | 'skull'
}
