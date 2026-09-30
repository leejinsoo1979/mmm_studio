import { FACE_PARTS, type FacePoint, packPoints, unpackPoints } from '@pascal-app/editor'

/**
 * When no face is found in a photo, the player marks its eyes and mouth
 * instead, and the character's own face points are carried onto the photo
 * by the similarity (turn, uniform size, shift) that lays the character's
 * eyes and mouth on the marked ones: sized by the geometric mean of the
 * eyes' spacing and the eyes-to-mouth drop, so neither a wide nor a long
 * face is favoured.
 *
 * `marks` are the photo's left eye, right eye and mouth (as seen) in
 * fractions of its width and height; `aspect` is its height over its width;
 * `target` the character's packed face points. Returns the photo's packed
 * face points.
 */
export function pointsFromMarks(
  marks: [FacePoint, FacePoint, FacePoint],
  aspect: number,
  target: readonly number[],
): number[] {
  const character = unpackPoints(target)
  const mean = (indices: readonly number[]): FacePoint => {
    let x = 0
    let y = 0
    for (const i of indices) {
      x += character[i]![0]
      y += character[i]![1]
    }
    return [x / indices.length, y / indices.length]
  }
  // In units of the photo's width, y down.
  const [p1, p2, pm] = marks.map(([x, y]) => [x, y * aspect] as FacePoint) as [
    FacePoint,
    FacePoint,
    FacePoint,
  ]
  const t1 = mean(FACE_PARTS.rightEye)
  const t2 = mean(FACE_PARTS.leftEye)
  const tm = mean(FACE_PARTS.lips)

  const sub = (a: FacePoint, b: FacePoint): FacePoint => [a[0] - b[0], a[1] - b[1]]
  const mid = (a: FacePoint, b: FacePoint): FacePoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const length = (v: FacePoint) => Math.hypot(v[0], v[1])
  const angle = (v: FacePoint) => Math.atan2(v[1], v[0])

  const rotation = angle(sub(p2, p1)) - angle(sub(t2, t1))
  const eyeScale = length(sub(p2, p1)) / Math.max(1e-6, length(sub(t2, t1)))
  const mouthScale = length(sub(pm, mid(p1, p2))) / Math.max(1e-6, length(sub(tm, mid(t1, t2))))
  const scale = Math.sqrt(eyeScale * mouthScale)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const from: FacePoint = [(t1[0] + t2[0] + tm[0]) / 3, (t1[1] + t2[1] + tm[1]) / 3]
  const to: FacePoint = [(p1[0] + p2[0] + pm[0]) / 3, (p1[1] + p2[1] + pm[1]) / 3]

  return packPoints(
    character.map(([x, y]) => {
      const dx = (x - from[0]) * scale
      const dy = (y - from[1]) * scale
      return [to[0] + dx * cos - dy * sin, (to[1] + dx * sin + dy * cos) / aspect] as FacePoint
    }),
  )
}
