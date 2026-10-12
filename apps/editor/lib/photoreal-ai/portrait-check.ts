/**
 * Whether a portrait suits the 3D avatar service, read in the browser from
 * MediaPipe's landmarks (`detectFaces` in lib/face-detect.ts) before the paid
 * 3D step is offered: one face, frontal and level, big enough, inside the
 * frame, eyes open and mouth closed. Pure: the caller runs the landmarker.
 * The limits are first guesses, to be tuned on real portraits.
 */

type Point = readonly [number, number]

export type PortraitFace = {
  /** All 478 landmarks, in pixels. */
  points: readonly Point[]
  yaw: number
  pitch: number
  roll: number
}

export type PortraitIssue =
  | 'no_face'
  | 'several_faces'
  | 'turned'
  | 'tilted'
  | 'too_small'
  | 'off_centre'
  | 'cropped'
  | 'eyes_closed'
  | 'mouth_open'

export const PORTRAIT_ISSUE_TEXT: Record<PortraitIssue, string> = {
  no_face: '사진에서 얼굴을 찾지 못했어요.',
  several_faces: '사진에 사람이 여러 명 있어요.',
  turned: '얼굴이 정면을 보고 있지 않아요.',
  tilted: '고개가 기울어 있어요.',
  too_small: '얼굴이 너무 작게 나왔어요.',
  off_centre: '얼굴이 가운데에 있지 않아요.',
  cropped: '머리나 턱이 사진 밖으로 잘렸어요.',
  eyes_closed: '눈을 감고 있어요.',
  mouth_open: '입이 벌어져 있어요.',
}

/** Limits, in degrees and fractions of the image. */
export const PORTRAIT_LIMITS = {
  yaw: 10,
  pitch: 12,
  roll: 8,
  /** Forehead-to-chin landmark height, as a share of the image height. */
  minFaceHeight: 0.3,
  minFacePixels: 256,
  /** How far the face centre may sit from the image centre, as a share of the width. */
  maxOffCentre: 0.1,
  /** The landmarks keep this share of the image clear on every side. */
  margin: 0.03,
  /** Eye height over eye width; below it the eye reads as closed. */
  minEyeOpen: 0.14,
  /** Inner-lip gap over mouth width; above it the mouth reads as open. */
  maxMouthOpen: 0.12,
}

// MediaPipe Face Mesh indices: eyelids and corners of each eye, inner lips and mouth corners,
// forehead top and chin.
const RIGHT_EYE = { top: 159, bottom: 145, outer: 33, inner: 133 }
const LEFT_EYE = { top: 386, bottom: 374, outer: 263, inner: 362 }
const LIPS = { top: 13, bottom: 14, left: 78, right: 308 }
const FOREHEAD = 10
const CHIN = 152

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

function openness(points: readonly Point[], eye: typeof RIGHT_EYE): number {
  const width = distance(points[eye.outer]!, points[eye.inner]!)
  return width > 0 ? distance(points[eye.top]!, points[eye.bottom]!) / width : 0
}

/** Every reason the portrait would make a poor avatar; empty when it is fine. */
export function portraitIssues(
  face: PortraitFace | null,
  faces: number,
  image: { width: number; height: number },
): PortraitIssue[] {
  if (!face || faces === 0) return ['no_face']
  const issues: PortraitIssue[] = []
  const limits = PORTRAIT_LIMITS
  if (faces > 1) issues.push('several_faces')
  if (Math.abs(face.yaw) > limits.yaw || Math.abs(face.pitch) > limits.pitch) issues.push('turned')
  if (Math.abs(face.roll) > limits.roll) issues.push('tilted')

  const { points } = face
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  const faceHeight = distance(points[FOREHEAD]!, points[CHIN]!)
  if (faceHeight < limits.minFaceHeight * image.height || faceHeight < limits.minFacePixels) {
    issues.push('too_small')
  }
  if (Math.abs((left + right) / 2 - image.width / 2) > limits.maxOffCentre * image.width) {
    issues.push('off_centre')
  }
  const mx = limits.margin * image.width
  const my = limits.margin * image.height
  if (left < mx || top < my || right > image.width - mx || bottom > image.height - my) {
    issues.push('cropped')
  }
  if (Math.min(openness(points, RIGHT_EYE), openness(points, LEFT_EYE)) < limits.minEyeOpen) {
    issues.push('eyes_closed')
  }
  const mouthWidth = distance(points[LIPS.left]!, points[LIPS.right]!)
  const gap = distance(points[LIPS.top]!, points[LIPS.bottom]!)
  if (mouthWidth > 0 && gap / mouthWidth > limits.maxMouthOpen) issues.push('mouth_open')
  return issues
}
