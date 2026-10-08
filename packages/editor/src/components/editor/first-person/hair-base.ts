import type { HeadMarks, ScalpPaint } from './bald-head'
import type { HairLibrary } from './hair-styles'

/**
 * The head under generated hair: the character's own head mesh with its
 * own hair laid flat onto the fitted cranium (same vertices, UVs and
 * skinning, so no seam), the root layer and undercut shells over it, and
 * how its skin is painted where its own hair was. Built in the hair
 * worker, once per avatar. Pure.
 */

/** A loaded avatar's head and what fits a skull to it, as arrays the worker can take (bind pose). */
export type BaseInput = {
  avatar: string
  /** The head's own material's name, which its hair flags are kept under. */
  material: string
  metresPerUnit: number
  head: {
    points: Float32Array
    normals: Float32Array
    uvs: Float32Array
    index: Uint32Array
    skinIndex: Uint16Array
    skinWeight: Float32Array
  }
  body: { points: Float32Array; uvs: Float32Array; index: Uint32Array }
  /** The lash mesh's bounds, kept clear of a fringe. */
  lashes: { min: [number, number, number]; max: [number, number, number] } | null
  faceBones: Record<string, [number, number, number]>
  bones: Record<
    'head' | 'neck' | 'spine' | 'spine2' | 'clavicleL' | 'clavicleR' | 'upperArmL' | 'upperArmR',
    [number, number, number]
  >
  /** Where those bones are in the head's skeleton, for the hair's skin weights. */
  boneIndex: Record<'head' | 'neck' | 'spine2' | 'clavicleL' | 'clavicleR', number>
  marks: HeadMarks
  /** Which of the head's points are its ears' (1), or null when it has none of its own. */
  ears: Uint8Array | null
}

export type BaseResult = {
  /** Flattened: the head's own surface (`flat`), or the fitted bald skull where that fails. */
  kind: 'flat' | 'skull'
  /** The head flattened: as many points as it came with, an index without the triangles dropped. */
  head: { points: Float32Array; normals: Float32Array; index: Uint32Array }
  /**
   * The root layer, then the undercut's three shells from `shellStart` on
   * in the index. Each point copies its head point's (`srcVertex`) skinning
   * and stands `height` (bind units) off it along its normal.
   */
  roots: {
    position: Float32Array
    normal: Float32Array
    scalpDir: Float32Array
    comb: Float32Array
    skinIndex: Uint16Array
    skinWeight: Float32Array
    index: Uint32Array
    srcVertex: Uint32Array
    height: Float32Array
    shellStart: number
  }
  /** How the look paints the skin where the head's own hair was (skin only, the same for any cut). */
  paint: ScalpPaint
  /** The taken texels (1024²) whose normal-map bumps the look worker flattens, or null. */
  bumpMask: Uint8Array | null
}

/** Lays a head's own hair flat and builds what generated hair stands on (see BaseResult). */
export function flattenHead(input: BaseInput, library: HairLibrary): BaseResult {
  throw new Error('flattenHead: generated hair is not built yet')
}
