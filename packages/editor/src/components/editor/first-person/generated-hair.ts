import type { Object3D } from 'three'
import type { HairOn } from './avatar-hair'
import type { HairCut } from './hair-cut'

/**
 * How much generated hair a character gets: the studio's tier (a drag
 * previews at the game's), the game's with its distance ramp, or the far
 * prefix alone for crowds.
 */
export type HairDetail = 'studio' | 'game' | 'crowd'

/**
 * Generated hair on a character: what the rest of the look needs of it
 * (see HairOn; null while none is worn), and `settled`, which resolves
 * once no grow is pending for it and its final tier is on, so a capture
 * never shows a preview, or the old hair, mid-build.
 */
export type GeneratedHair = { on: HairOn | null; settled: Promise<void> }

/**
 * Keeps a character in a generated cut (null: its own hair), coloured
 * `colours.hair` (null: its own hair colour) with roots tinted toward
 * `colours.skin`.
 */
export function useGeneratedHair(
  model: Object3D,
  avatarId: string,
  cut: HairCut | null,
  colours: { hair: string | null; skin: string | null },
  detail: HairDetail,
): GeneratedHair {
  throw new Error('useGeneratedHair: generated hair is not built yet')
}
