import { ACESFilmicToneMapping, NeutralToneMapping, type ToneMapping } from 'three'
import type { RenderShading } from './materials'

/**
 * The display's tone mapping for the shading: ACES everywhere but hyper,
 * which takes Khronos PBR Neutral — ACES shifts whites and light finishes
 * (plaster, oak, beige paper) towards yellow and washes out colour, where
 * Neutral keeps them as picked.
 */
export function toneMappingFor(shading: RenderShading): ToneMapping {
  return shading === 'hyper' ? NeutralToneMapping : ACESFilmicToneMapping
}
