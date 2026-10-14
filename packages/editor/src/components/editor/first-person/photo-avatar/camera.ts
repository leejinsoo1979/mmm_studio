import {
  apply3,
  type Mat3,
  mulMat3,
  rotation,
  rotationX,
  rotationY,
  rotationZ,
  transpose3,
  type Vec3,
} from './linalg'

/**
 * A photo's pinhole camera, looking at a head in the base body's space
 * (glTF metres: +y up, the face towards +z, the subject's left +x). Camera
 * space is the image's: x right, y down, z away from the camera; a point X
 * is seen at `R X + t`, and lands on the image at
 * `(f x / z + cx, f y / z + cy)` pixels.
 */
export type Camera = {
  rotation: Mat3
  translation: Vec3
  focal: number
  cx: number
  cy: number
  width: number
  height: number
}

/** A head facing the camera squarely: the body's +z towards it, +y up the image. */
export const FACING: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1]

/**
 * The rotation of a head seen turned by `yaw` (radians; > 0: the subject
 * turned to their left, so their nose points to the image's right), nodded
 * by `pitch` (> 0: chin up) and leaning by `roll` (> 0: towards their right
 * shoulder, anticlockwise in the image).
 */
export function headRotation(yaw: number, pitch = 0, roll = 0): Mat3 {
  // In body space the turn is about +y, the nod about +x (chin up is −x), the lean about +z.
  return mulMat3(FACING, mulMat3(rotationZ(roll), mulMat3(rotationY(yaw), rotationX(-pitch))))
}

/** The yaw, pitch and roll (radians) `headRotation` would need to give `r`. */
export function headAngles(r: Mat3): { yaw: number; pitch: number; roll: number } {
  // FACINGᵀ r = Rz(roll) Ry(yaw) Rx(−pitch).
  const m = mulMat3(transpose3(FACING), r)
  return {
    yaw: Math.asin(Math.max(-1, Math.min(1, -m[6]))),
    pitch: -Math.atan2(m[7], m[8]),
    roll: Math.atan2(m[3], m[0]),
  }
}

/** Where the camera sees a body-space point (camera space). */
export const toCamera = (camera: Camera, p: Vec3): Vec3 => {
  const q = apply3(camera.rotation, p)
  return [q[0] + camera.translation[0], q[1] + camera.translation[1], q[2] + camera.translation[2]]
}

/** Where a camera-space point lands on the image (pixels). */
export const projectCamera = (camera: Camera, q: Vec3): [number, number] => [
  (camera.focal * q[0]) / q[2] + camera.cx,
  (camera.focal * q[1]) / q[2] + camera.cy,
]

export const project = (camera: Camera, p: Vec3) => projectCamera(camera, toCamera(camera, p))

/** The camera's centre in body space. */
export function cameraCentre(camera: Camera): Vec3 {
  const c = apply3(transpose3(camera.rotation), camera.translation)
  return [-c[0], -c[1], -c[2]]
}

/** The derivatives of a projection with respect to the camera-space point: rows du/dq and dv/dq. */
export function projectionJacobian(camera: Camera, q: Vec3): [Vec3, Vec3] {
  const iz = 1 / q[2]
  const f = camera.focal * iz
  return [
    [f, 0, -f * q[0] * iz],
    [0, f, -f * q[1] * iz],
  ]
}

/**
 * A camera after the head turns by a small rotation `w` (camera space)
 * about `pivot` (camera space), moves by `dt`, and the focal length scales
 * by e^`dLogFocal`.
 */
export function nudgeCamera(camera: Camera, w: Vec3, dt: Vec3, pivot: Vec3, dLogFocal = 0): Camera {
  const turn = rotation(w)
  const offset = apply3(turn, [
    camera.translation[0] - pivot[0],
    camera.translation[1] - pivot[1],
    camera.translation[2] - pivot[2],
  ])
  return {
    ...camera,
    rotation: mulMat3(turn, camera.rotation),
    translation: [
      offset[0] + pivot[0] + dt[0],
      offset[1] + pivot[1] + dt[1],
      offset[2] + pivot[2] + dt[2],
    ],
    focal: camera.focal * Math.exp(dLogFocal),
  }
}

/**
 * The derivative of a camera-space point q with respect to a small turn
 * about `pivot`: −[q − pivot]× (row-major).
 */
export function turnJacobian(q: Vec3, pivot: Vec3): Mat3 {
  const x = q[0] - pivot[0]
  const y = q[1] - pivot[1]
  const z = q[2] - pivot[2]
  return [0, z, -y, -z, 0, x, y, -x, 0]
}

/** The focal length (pixels) of a 70° diagonal field of view: what phones and webcams mostly have. */
export function defaultFocal(width: number, height: number): number {
  return Math.hypot(width, height) / 2 / Math.tan((35 * Math.PI) / 180)
}

/**
 * The nearest (m) a lone photo whose file doesn't say its lens is taken to have been taken from:
 * a portrait's usual metre. Such photos are mostly crops (profile and ID pictures, a face cut out
 * of a larger photo), and the phone's lens would put the camera a hand's breadth from a face that
 * fills one: the face's sides and jaw, further from it than the nose and eyes, would be read as
 * drawn smaller than they are and fitted broader — a round face seen from a step away.
 */
const PORTRAIT_DISTANCE = 1
/** Adults' mean pupil distance (m), both sexes: what tells the face's distance from its size. */
const PUPILS = 0.0635

/**
 * The focal length (pixels) for a lone photo, `width` × `height`, whose lens nothing says: the
 * phone's, or the longer one that puts the camera `PORTRAIT_DISTANCE` from the eyes MediaPipe
 * found (`landmarks`, its 478 points).
 */
export function loneFocal(width: number, height: number, landmarks: ArrayLike<number>): number {
  const pupils = Math.hypot(
    landmarks[468 * 2]! - landmarks[473 * 2]!,
    landmarks[468 * 2 + 1]! - landmarks[473 * 2 + 1]!,
  )
  return Math.max(defaultFocal(width, height), (PORTRAIT_DISTANCE * pupils) / PUPILS)
}

/**
 * A camera on an image `width` × `height` (focal length `focal`, else the
 * usual phone or webcam one), looking at a head with `rotation`, its point
 * `target` (body space) landing on the image at `at`, `distance` metres away.
 */
export function cameraLookingAt({
  width,
  height,
  focal = defaultFocal(width, height),
  rotation: r,
  target,
  at = [width / 2, height / 2],
  distance,
}: {
  width: number
  height: number
  focal?: number
  rotation: Mat3
  target: Vec3
  at?: [number, number]
  distance: number
}): Camera {
  const cx = width / 2
  const cy = height / 2
  const q = apply3(r, target)
  const want: Vec3 = [
    ((at[0] - cx) / focal) * distance,
    ((at[1] - cy) / focal) * distance,
    distance,
  ]
  return {
    rotation: r,
    translation: [want[0] - q[0], want[1] - q[1], want[2] - q[2]],
    focal,
    cx,
    cy,
    width,
    height,
  }
}
