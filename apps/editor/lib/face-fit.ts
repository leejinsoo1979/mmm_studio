import type { FaceLandmarks } from '@pascal-app/editor'

export type Point = [number, number]

/** A face photo's placement on the head's front view (AvatarFace without the photo and tone). */
export type FacePlacement = { x: number; y: number; scale: number; rotation: number }

/**
 * Places a photo so the eyes and mouth the player marked on it land on the
 * character's: turned by the line through the eyes, sized by the geometric
 * mean of the eyes' spacing and the eyes-to-mouth drop (so neither a wide
 * nor a long face is favoured), centred on the three points.
 *
 * `marks` are the photo's left eye, right eye and mouth as fractions of its
 * width and height; `aspect` is its height over its width.
 */
export function fitFace(marks: [Point, Point, Point], aspect: number, target: FaceLandmarks) {
  // The photo in units of its width, y down.
  const [p1, p2, pm] = marks.map(([x, y]) => [x, y * aspect] as Point) as [Point, Point, Point]
  const t1 = target.leftEye
  const t2 = target.rightEye
  const tm = target.mouth
  const angle = (v: Point) => Math.atan2(v[1], v[0])
  const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const length = (v: Point) => Math.hypot(v[0], v[1])

  const photoEyes = sub(p2, p1)
  const targetEyes = sub(t2, t1)
  const rotation = angle(targetEyes) - angle(photoEyes)
  const eyeScale = length(targetEyes) / Math.max(1e-6, length(photoEyes))
  const mouthScale = length(sub(tm, mid(t1, t2))) / Math.max(1e-6, length(sub(pm, mid(p1, p2))))
  const scale = Math.sqrt(eyeScale * mouthScale)

  const photoCentre: Point = [0.5, 0.5 * aspect]
  const marked: Point = [(p1[0] + p2[0] + pm[0]) / 3, (p1[1] + p2[1] + pm[1]) / 3]
  const aimed: Point = [(t1[0] + t2[0] + tm[0]) / 3, (t1[1] + t2[1] + tm[1]) / 3]
  const [dx, dy] = sub(marked, photoCentre)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return {
    x: aimed[0] - (dx * cos - dy * sin) * scale,
    y: aimed[1] - (dx * sin + dy * cos) * scale,
    scale,
    rotation,
  } satisfies FacePlacement
}

/** Where a photo point (fractions of the photo) lands on the front view, placed so. */
export function placePoint(point: Point, aspect: number, place: FacePlacement): Point {
  const dx = point[0] - 0.5
  const dy = (point[1] - 0.5) * aspect
  const cos = Math.cos(place.rotation)
  const sin = Math.sin(place.rotation)
  return [
    place.x + (dx * cos - dy * sin) * place.scale,
    place.y + (dx * sin + dy * cos) * place.scale,
  ]
}
