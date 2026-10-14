import type { CaptureSlot } from '@pascal-app/editor'

/**
 * Which pose an uploaded photo shows, read off the photo itself, so the
 * player can put up 3 or 5 photos in any order: MediaPipe's turn where it
 * finds the face, and for a full side view (where it loses the face, or
 * only guesses at it) which way the nose points — the face's skin lies on
 * the nose's side of the head and the hair behind it, or, for a head
 * without hair to tell by, the head reaches out over the neck on the nose's
 * side.
 */

export type PoseSlot = Exclude<CaptureSlot, 'free'>

export type SlotReading = {
  /** MediaPipe's turn where it found a face (degrees; > 0: turned to the subject's left, the nose toward the picture's right). */
  yaw: number | null
  /** Across the head (x, in pixels): the middle of its face skin, of its hair, of its outline, and of the neck below it; null where unseen. */
  faceSkinX: number | null
  hairX: number | null
  headX: number | null
  neckX: number | null
  /** The head's width (pixels), which the offsets above are judged against. */
  headWidth: number
}

/** Under this turn (degrees) a photo is the front one; under SIDE_YAW, a ¾ one. */
const FRONT_YAW = 20
/** From here MediaPipe's turn is a guess at a full side view (only its sign is believed). */
export const SIDE_YAW = 60
/** An offset under this share of the head's width tells no side. */
const SURE_SHIFT = 0.06

/** The pose `reading` shows, or null when the photo can't tell which way it is turned. */
export function slotFromReading(reading: SlotReading): PoseSlot | null {
  const { yaw } = reading
  if (yaw !== null && Math.abs(yaw) < FRONT_YAW) return 'front'
  if (yaw !== null && Math.abs(yaw) < SIDE_YAW) return yaw > 0 ? 'left45' : 'right45'
  const right = noseRight(reading)
  if (right === null) return null
  return right ? 'left90' : 'right90'
}

/** Whether a side view's nose points to the picture's right (null: can't tell). */
function noseRight({
  yaw,
  faceSkinX,
  hairX,
  headX,
  neckX,
  headWidth,
}: SlotReading): boolean | null {
  if (yaw !== null) return yaw > 0
  const sure = SURE_SHIFT * headWidth
  if (faceSkinX !== null && hairX !== null && Math.abs(faceSkinX - hairX) > sure) {
    return faceSkinX > hairX
  }
  if (headX !== null && neckX !== null && Math.abs(headX - neckX) > sure) return headX > neckX
  return null
}
