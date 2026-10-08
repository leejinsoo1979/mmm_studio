import type { Mesh } from 'three'
import type { HairBuild } from './hair-grow'

/**
 * Generated hair's materials: the strands', the studio's soft pass over
 * them, and the root layer's, each one instance shared by every character.
 * What differs per character (colours, shine, hairline, part, undercut)
 * lives on that character's hair meshes, so writing it is a value change:
 * no texture, no look job, no new pipeline.
 */

/** A character's hair colours (#rrggbb; no tip colour: null), its shine (0–1), and its skin for the roots' tint. */
export type HairLook = { base: string; tip: string | null; shine: number; skin: string }

/** A character's hair meshes, which carry its own values for the shared materials. */
export type HairCharacter = { readonly meshes: readonly Mesh[] }

/** What the root layer takes from a build: its hairline, part and undercut. */
export type RootsStyle = Pick<HairBuild, 'hairline' | 'part' | 'undercut'>

/** Gives a character's hair its colours and shine, from the next frame. */
export function setHairLook(character: HairCharacter, look: HairLook): void {
  throw new Error('setHairLook: generated hair is not built yet')
}

/** Gives a character's root layer the hairline, part and undercut of the build it wears. */
export function setRootsStyle(character: HairCharacter, build: RootsStyle): void {
  throw new Error('setRootsStyle: generated hair is not built yet')
}
