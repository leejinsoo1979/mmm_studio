/**
 * What MediaPipe's multiclass selfie segmenter (selfie_multiclass_256x256,
 * Apache-2.0) says each pixel of a photo is, and the face blendshapes its
 * Face Landmarker reads off the face: found on the page with each photo and
 * carried to the job with it (see CaptureView). Hair here is the photo's
 * hair (what must not be painted onto skin, and what tells the hairstyle),
 * face skin and body skin are bare skin, the blendshapes say how far from
 * neutral the face is (a blink, an open mouth, a smile).
 */

/** The segmenter's classes, in the order of its output. */
export const SEGMENT_CLASSES = [
  'background',
  'hair',
  'bodySkin',
  'faceSkin',
  'clothes',
  'others',
] as const

export type SegmentClass = (typeof SEGMENT_CLASSES)[number]

/**
 * Each class's confidence (0–255) for every pixel of the view, one plane of
 * width × height bytes per class, in `SEGMENT_CLASSES` order (one buffer, so
 * it crosses to the worker in one transfer).
 */
export type SegmentMasks = { width: number; height: number; planes: Uint8Array }

/** One class's plane (a view onto the masks' buffer, not a copy). */
export function classPlane(masks: SegmentMasks, name: SegmentClass): Uint8Array {
  const size = masks.width * masks.height
  const index = SEGMENT_CLASSES.indexOf(name)
  return masks.planes.subarray(index * size, (index + 1) * size)
}

/** The most likely class of each pixel (its index in `SEGMENT_CLASSES`). */
export function classMap(masks: SegmentMasks): Uint8Array {
  const size = masks.width * masks.height
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    let best = 0
    let bestValue = masks.planes[i]!
    for (let c = 1; c < SEGMENT_CLASSES.length; c++) {
      const value = masks.planes[c * size + i]!
      if (value > bestValue) {
        best = c
        bestValue = value
      }
    }
    out[i] = best
  }
  return out
}

/**
 * MediaPipe's 52 face blendshapes (ARKit's names: eyeBlinkLeft, jawOpen,
 * mouthSmileLeft, browInnerUp…), each 0–1, for the face a photo shows.
 */
export type FaceBlendshapes = Record<string, number>
