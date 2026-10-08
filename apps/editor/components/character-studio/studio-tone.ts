import { Color, LinearSRGBColorSpace } from 'three'

/**
 * The studio renders with three's WebGPURenderer, as the game does, which
 * tone maps and encodes the whole frame in an output pass: unlike WebGL's
 * per-material `toneMapped`, nothing escapes it. What must show as an exact
 * sRGB colour (the backdrop, the AI photo's grey) is therefore drawn as the
 * linear colour Khronos PBR Neutral, the studio's tone mapping, turns into
 * it. Below Neutral's highlight compression (a peak of 0.76, about sRGB 0.89)
 * the curve only subtracts an offset, which this inverts exactly.
 */

export type Rgb = [number, number, number]

/** Where Neutral starts compressing the highlights (linear). */
export const NEUTRAL_COMPRESSION = 0.8 - 0.04

/**
 * The linear colour Neutral maps to `toned` (linear) at `exposure`: exact
 * while `toned` peaks below NEUTRAL_COMPRESSION. The offset Neutral took is
 * found from the darkest channel, which it maps to 6.25 x² below 0.08 and
 * to x − 0.04 above.
 */
export function neutralUntone([r, g, b]: Rgb, exposure = 1): Rgb {
  const darkest = Math.max(0, Math.min(r, g, b))
  const offset = darkest < 0.04 ? 0.4 * Math.sqrt(darkest) - darkest : 0.04
  return [(r + offset) / exposure, (g + offset) / exposure, (b + offset) / exposure]
}

/** The linear colour the studio draws for the frame to show `css` (an sRGB colour) exactly. */
export function untonedColor(css: string, exposure = 1): Color {
  // three holds colours in linear sRGB.
  const { r, g, b } = new Color(css)
  const [ur, ug, ub] = neutralUntone([r, g, b], exposure)
  return new Color().setRGB(ur, ug, ub, LinearSRGBColorSpace)
}

/**
 * What the contact shadow's transmittance is raised to, by what it lies on,
 * for the frame's linear blend to darken it as WebGL's blend of the encoded
 * colours did (to 1 − a of it). Neutral is quadratic in the darkest tones
 * and an offset in the light ones, and the sRGB encoding bends them further
 * apart, so no one power does for both: these are fitted to the platform's
 * tones round the feet (sRGB 23–46) and to the AI photo's light grey.
 */
export const SHADOW_POWER = { platform: 0.85, light: 1.88 } as const
