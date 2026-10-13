/**
 * MediaPipe Face Landmarker's points as the fit weighs them. The outline
 * points are where the face's edge shows, not fixed spots on the skin: they
 * slide along the head's outline in every view. Of the rest, the eyes,
 * nose and lips are sharp features MediaPipe finds well; the points it
 * spreads between them (cheeks, forehead) are guesses from its average
 * face, and weigh little.
 */

/** The face's outline, clockwise from the top of the forehead. */
export const OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
  176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const

export const EYES = [
  263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398, 33, 7, 163, 144,
  145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173,
] as const

export const BROWS = [
  276, 283, 282, 295, 285, 300, 293, 334, 296, 336, 46, 53, 52, 65, 55, 70, 63, 105, 66, 107,
] as const

export const LIPS_OUTER = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
] as const

export const LIPS_INNER = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
] as const

export const NOSE = [
  168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327, 64, 294, 129, 358, 49, 279, 48, 278, 115, 344, 220,
  440, 45, 275, 51, 281, 3, 248,
] as const

/** The face's midline, forehead to chin: what a profile is made of. */
export const MIDLINE = [
  10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 164, 0, 11, 12, 13, 14, 15, 16, 17, 18, 200,
  199, 175, 152,
] as const

/** Iris centres (the subject's right, then left). */
export const IRIS_CENTRES = [468, 473] as const

/** How much each of the 468 face points counts as a fixed point on the skin (0 for the outline). */
export const LANDMARK_WEIGHT: Float32Array = (() => {
  const weights = new Float32Array(478).fill(0.25)
  for (const i of EYES) weights[i] = 1
  for (const i of NOSE) weights[i] = 1
  for (const i of BROWS) weights[i] = 0.6
  for (const i of LIPS_OUTER) weights[i] = 0.8
  for (const i of LIPS_INNER) weights[i] = 0.3
  for (const i of OVAL) weights[i] = 0
  for (let i = 468; i < 478; i++) weights[i] = 0
  return weights
})()

export const isOval = (() => {
  const set = new Uint8Array(478)
  for (const i of OVAL) set[i] = 1
  return (i: number) => set[i] === 1
})()

export const isEye = (() => {
  const set = new Uint8Array(478)
  for (const i of EYES) set[i] = 1
  return (i: number) => set[i] === 1
})()

export const isLip = (() => {
  const set = new Uint8Array(478)
  for (const i of [...LIPS_OUTER, ...LIPS_INNER]) set[i] = 1
  return (i: number) => set[i] === 1
})()
