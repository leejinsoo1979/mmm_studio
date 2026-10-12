import {
  type AvatarLook,
  DEFAULT_CUT_PARAMS,
  DEFAULT_SHINE,
  HAIR_CUT_RANGES,
  type HairCut,
  type HairCutSlider,
  type HairCutStyle,
} from '@pascal-app/editor'

/** The generated hairstyles the 헤어 panel offers so far, in its order. */
export const OFFERED_CUTS: readonly HairCutStyle[] = ['bob', 'twoBlock']

/** The sliders it offers under them while one is worn. */
export const OFFERED_SLIDERS: readonly HairCutSlider[] = ['length', 'volume']

/**
 * The look with a style picked (null: the character's own hair): the
 * style's own sliders, the tip colour and shine carried over from the cut
 * worn. A borrowed hairstyle the look still names is let go once a cut is
 * picked, so it stops travelling with the look.
 */
export function pickCut(
  look: Pick<AvatarLook, 'hairCut' | 'hairStyle'>,
  style: HairCutStyle | null,
): Pick<AvatarLook, 'hairCut' | 'hairStyle'> {
  if (style === null) return { hairCut: null, hairStyle: look.hairStyle }
  const worn = look.hairCut
  return {
    hairCut: {
      style,
      ...DEFAULT_CUT_PARAMS[style],
      tip: worn?.tip ?? null,
      shine: worn?.shine ?? DEFAULT_SHINE,
    },
    hairStyle: null,
  }
}

/** A cut with one slider set, kept in its range and to the hundredth a saved cut keeps. */
export function setSlider(cut: HairCut, slider: HairCutSlider, value: number): HairCut {
  const [low, high] = HAIR_CUT_RANGES[slider]
  return { ...cut, [slider]: Math.round(Math.min(high, Math.max(low, value)) * 100) / 100 || 0 }
}
