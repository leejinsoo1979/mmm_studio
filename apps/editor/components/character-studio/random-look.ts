import {
  type AvatarLook,
  avatarGender,
  BEARD_STYLES,
  BODY_SLIDERS,
  type BodyShape,
  FACE_SLIDERS,
  type FacePaint,
  type FaceShape,
  type HairStyleEntry,
  NO_PAINT,
} from '@pascal-app/editor'
import { isChild } from './avatar-counterpart'
import {
  BLUSH_SWATCHES,
  HAIR_SWATCHES,
  LIP_SWATCHES,
  NATURAL_HAIR_SWATCHES,
  SHADOW_SWATCHES,
  type Swatch,
} from './studio-data'

/** A number from 0 (inclusive) to 1, like Math.random: tests pass a seeded one. */
export type Random = () => number

/** How far a random face or body slider (and height) goes either way: faces told apart, none a caricature. */
const REACH = 0.5
/** The chance of keeping the character's own hair colour rather than dyeing it. */
const OWN_HAIR_COLOUR_CHANCE = 0.25
/** The chance a dye is any of them, fashion colours too, rather than a natural shade. */
const FASHION_HAIR_CHANCE = 0.15
/** The chance of keeping the character's own hairstyle rather than borrowing one. */
const OWN_HAIRSTYLE_CHANCE = 0.2
/** The chance a woman wears lipstick. */
const LIPS_CHANCE = 0.6
/** The chance a woman wears blush. */
const BLUSH_CHANCE = 0.5
/** The chance a woman wears eyeshadow. */
const SHADOW_CHANCE = 0.35
/** The chance a woman wears eyeliner. */
const LINER_CHANCE = 0.4
/** The chance a man has stubble. */
const STUBBLE_CHANCE = 0.4
/** The chance of a fuller beard, for a man with no stubble. */
const BEARD_CHANCE = 0.2

/** An amount's least and most (0–1), for a random look. */
type Range = readonly [low: number, high: number]

/** Lipstick: visible, never garish. */
const LIP_AMOUNT: Range = [0.35, 0.75]
/** Blush: a flush, not a mark. */
const BLUSH_AMOUNT: Range = [0.3, 0.6]
/** Eyeshadow: a wash of colour. */
const SHADOW_AMOUNT: Range = [0.3, 0.6]
/** Eyeliner: from a fine line to a clear one. */
const LINER_AMOUNT: Range = [0.3, 0.7]
/** Stubble: enough to read as a shadow. */
const STUBBLE_AMOUNT: Range = [0.5, 0.9]
/** A fuller beard: grown in. */
const BEARD_AMOUNT: Range = [0.6, 0.95]

const pick = <T>(list: readonly T[], random: Random): T =>
  list[Math.min(list.length - 1, Math.floor(random() * list.length))]!

/** An amount within `range`, to the percent the sliders show. */
const between = ([low, high]: Range, random: Random) =>
  Math.round((low + (high - low) * random()) * 100) / 100

/**
 * A slider setting within ±REACH, most often near the middle (the sum of
 * two draws), so few features go to their ends at once.
 */
const setting = (random: Random) => Math.round((random() + random() - 1) * REACH * 100) / 100

/** Settings for every slider of a list, those that came out 0 left out as the saved shapes do. */
function settings<Id extends string>(sliders: readonly { id: Id }[], random: Random) {
  const out: Partial<Record<Id, number>> = {}
  for (const { id } of sliders) {
    const value = setting(random)
    if (value !== 0) out[id] = value
  }
  return out
}

const colourOr = (chance: number, swatches: Swatch[], random: Random) =>
  random() < chance ? pick(swatches, random).hex : null

/**
 * Make-up for women (lips, blush, eyeshadow and liner, each only
 * sometimes), stubble or a beard for some men, and none for children; the
 * iris colour the player chose stays.
 */
function randomPaint(look: AvatarLook, avatar: string, random: Random): FacePaint {
  const paint: FacePaint = { ...NO_PAINT, eyes: look.paint.eyes }
  if (isChild(avatar)) return paint
  if (avatarGender(avatar) === 'female') {
    return {
      ...paint,
      lips: colourOr(LIPS_CHANCE, LIP_SWATCHES, random),
      lipAmount: between(LIP_AMOUNT, random),
      blush: colourOr(BLUSH_CHANCE, BLUSH_SWATCHES, random),
      blushAmount: between(BLUSH_AMOUNT, random),
      shadow: colourOr(SHADOW_CHANCE, SHADOW_SWATCHES, random),
      shadowAmount: between(SHADOW_AMOUNT, random),
      liner: random() < LINER_CHANCE ? between(LINER_AMOUNT, random) : 0,
    }
  }
  if (random() < STUBBLE_CHANCE) {
    return { ...paint, beard: 'stubble', beardAmount: between(STUBBLE_AMOUNT, random) }
  }
  if (random() < BEARD_CHANCE) {
    const fuller = BEARD_STYLES.filter((style) => style !== 'none' && style !== 'stubble')
    return { ...paint, beard: pick(fuller, random), beardAmount: between(BEARD_AMOUNT, random) }
  }
  return paint
}

/** Mostly a natural shade, sometimes a fashion colour, sometimes the character's own. */
function randomHairColour(random: Random): string | null {
  if (random() < OWN_HAIR_COLOUR_CHANCE) return null
  const swatches = random() < FASHION_HAIR_CHANCE ? HAIR_SWATCHES : NATURAL_HAIR_SWATCHES
  return pick(swatches, random).hex
}

/**
 * A random look for the 무작위 button: the face and body sliders (a random
 * face replaces the sculpted one, its pins cleared), height, a hairstyle of
 * the character's sex (sometimes its own, which is null as the gallery
 * saves it, never its own id; the one it has while the library is
 * unavailable), hair colour and face paint. The base character, the face
 * photo (and how closely the head follows it) and the skin stay, as the
 * player chose those deliberately.
 */
export function randomLook(
  look: AvatarLook,
  avatar: string,
  styles: readonly HairStyleEntry[] | null,
  random: Random = Math.random,
): AvatarLook {
  const shape: FaceShape = { ...look.shape, sliders: settings(FACE_SLIDERS, random), pins: {} }
  const body: BodyShape = { height: setting(random), sliders: settings(BODY_SLIDERS, random) }
  const gender = avatarGender(avatar)
  const ofSex = styles?.filter((style) => style.gender === gender && style.id !== avatar) ?? []
  const hairStyle = !styles
    ? look.hairStyle
    : ofSex.length === 0 || random() < OWN_HAIRSTYLE_CHANCE
      ? null
      : pick(ofSex, random).id
  return {
    ...look,
    shape,
    body,
    hairStyle,
    hair: randomHairColour(random),
    paint: randomPaint(look, avatar, random),
  }
}
