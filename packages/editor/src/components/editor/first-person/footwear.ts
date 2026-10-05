/**
 * What the character has on its feet: its own shoes, or a barefoot
 * character's feet borrowed in their place (see bare-feet.ts) — bare, in
 * its skin, or in socks (in `color`, or a plain default).
 */

export const FOOTWEAR = ['shoes', 'socks', 'bare'] as const
export type Footwear = (typeof FOOTWEAR)[number]

export type AvatarFeet = { wear: Footwear; color: string | null }

export const SHOD: AvatarFeet = { wear: 'shoes', color: null }

const HEX = /^#[0-9a-f]{6}$/i

/** Feet as saved or received: shod for anything unknown. */
export function readAvatarFeet(value: unknown): AvatarFeet {
  const feet = value as Partial<AvatarFeet> | null
  if (!feet || typeof feet !== 'object') return SHOD
  const wear = FOOTWEAR.includes(feet.wear as Footwear) ? (feet.wear as Footwear) : 'shoes'
  const color = typeof feet.color === 'string' && HEX.test(feet.color) ? feet.color : null
  return { wear, color }
}
