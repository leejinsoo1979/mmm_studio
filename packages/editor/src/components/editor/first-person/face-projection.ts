import {
  cameraDepth,
  eyeDistance,
  type FaceSurface,
  faceSurface,
  type MaskFit,
  maskOffset,
  maskSpread,
  patchTouch,
  projectPoint,
} from './face-mask3d'
import { FRONT } from './face-swap'
import { sampleColor } from './front-render'
import type { HeadGeometry } from './head-geometry'
import type { Pixels } from './look-pixels'

/**
 * The photo's face projected onto the character's (a face texture from one
 * photo, as FaceBuilder makes it): every point of the head's front view
 * found on the fitted mask (face-mask3d.ts) and taken from the photo there,
 * so a head turned in the photo comes out facing the front. Plain pixels,
 * so it runs in a worker.
 */
export type ProjectedFace = {
  /**
   * The photo on the character's front view, laid out as FaceWarp.warped:
   * over the face and a little past its outline, transparent elsewhere.
   * Where `seen` is near 0 its colour is whatever the photo has there — at
   * a turned face's silhouette, the background — for the swap to fill in.
   */
  warped: Pixels
  /**
   * How well the photo shows each pixel's point (0–1): facing its camera,
   * not hidden behind a nearer part of the face, clear of the face's
   * silhouette, inside the photo. A point taken from its mirror image
   * counts for MIRROR_TRUST of that one's.
   */
  seen: Float32Array
  /** How much of each pixel came from its mirror image across the face (0–1). */
  mirrored: Float32Array
}

/**
 * How squarely (the normal's part towards the camera) a surface must face
 * the photo to start to show, and to show fully. A surface turned 60° from
 * the camera shows fully: a frontal photo's nose sides are that steep. What
 * goes wrong on a strongly turned face is its silhouette (see
 * SILHOUETTE_REACH), not how steep the face is there.
 */
const FACING_FROM = 0.15
const FACING_TO = 0.5

/**
 * How far round a point's place in the photo (× the distance between the
 * eyes, as the pose scales it, and at least SILHOUETTE_PIXELS) the photo
 * is looked at for the background past the mask's silhouette: as far as
 * the photo's face may end short of the mask's — a pose a few degrees out,
 * a nose that stands out less, the landmarks' guesses along a turned
 * face's profile.
 */
const SILHOUETTE_REACH = 0.15
const SILHOUETTE_PIXELS = 3

/**
 * How much of the photo round a point (weighted towards the point: see
 * backgroundNear) may be background before the point starts to count as
 * not shown, and by when it counts as not shown at all: from about 0.85 of
 * SILHOUETTE_REACH in from the silhouette, and within about half of it.
 */
const BACKGROUND_FROM = 0.01
const BACKGROUND_TO = 0.1

/**
 * How much nearer the photo's camera (fractions of the front view) a
 * surface must be than a point to start to hide it, and to hide it fully:
 * past the surface's own unevenness from pixel to pixel.
 */
const HIDDEN_FROM = 0.004
const HIDDEN_TO = 0.012

/** How far apart (front-view pixels) the smooth part of the mask's push and pull is worked out, and filled in between. */
const SPREAD_STEP = 4

/** How far (× the front view's side) how well a point is seen is softened, so a mirrored patch fades in. */
const SEEN_SOFTENING = 0.006

/**
 * How far (× the front view's side) how well a point is seen is averaged
 * to choose which side of the face it is taken from: over a feature as a
 * whole, so an eye comes whole from one side (an eyeball's own curve faces
 * the camera from a far eye the lids and nose all but hide).
 */
const SIDE_SOFTENING = 0.02

/** How much a colour copied from the face's other side is trusted, against one the photo shows. */
const MIRROR_TRUST = 0.5

/**
 * How much better the photo must show a point's mirror image than the
 * point to start to take it from there, and to take it wholly. The two
 * sides are placed by different landmarks, each a little off in its own
 * way, so a mix of them doubles the features: the switch is steep, taking
 * one or the other nearly everywhere.
 */
const MIRROR_FROM = 0.1
const MIRROR_TO = 0.3

/** How far outside a triangle (as a barycentric weight) a pixel centre may lie and still count. */
const EDGE = 1e-9

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** A rectangle of an image's pixels: left, top, right, bottom (the last two past its edge). */
type Box = [number, number, number, number]

/**
 * Visits the pixel centres inside a triangle (corners in pixels) of an
 * image `stride` pixels wide, within `box`, with barycentric weights.
 */
function rasterise(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  stride: number,
  [left, top, right, bottom]: Box,
  visit: (pixel: number, w0: number, w1: number, w2: number) => void,
) {
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  if (!(Math.abs(area) > 1e-12)) return
  const inverse = 1 / area
  const minX = Math.max(left, Math.ceil(Math.min(ax, bx, cx) - 0.5))
  const maxX = Math.min(right - 1, Math.floor(Math.max(ax, bx, cx) - 0.5))
  const minY = Math.max(top, Math.ceil(Math.min(ay, by, cy) - 0.5))
  const maxY = Math.min(bottom - 1, Math.floor(Math.max(ay, by, cy) - 0.5))
  for (let py = minY; py <= maxY; py++) {
    const sy = py + 0.5
    for (let px = minX; px <= maxX; px++) {
      const sx = px + 0.5
      const w0 = ((bx - sx) * (cy - sy) - (cx - sx) * (by - sy)) * inverse
      if (w0 < -EDGE) continue
      const w1 = ((cx - sx) * (ay - sy) - (ax - sx) * (cy - sy)) * inverse
      const w2 = 1 - w0 - w1
      if (w1 < -EDGE || w2 < -EDGE) continue
      visit(py * stride + px, w0, w1, w2)
    }
  }
}

/**
 * The front-view pixels the face reaches: the box round the fit's ring (a
 * little past the face's outline, as far as a photo warp reaches), as wide
 * either side of the face's middle so each pixel's mirror image is in it.
 */
function faceBox(fit: MaskFit, size: number): Box {
  const half = Math.max(...fit.ring.map(([x]) => Math.abs(x - fit.midline)))
  const ys = fit.ring.map(([, y]) => y)
  const at = (value: number) => Math.min(size, Math.max(0, value))
  return [
    at(Math.floor((fit.midline - half) * size) - 1),
    at(Math.floor(Math.min(...ys) * size) - 1),
    at(Math.ceil((fit.midline + half) * size) + 1),
    at(Math.ceil(Math.max(...ys) * size) + 1),
  ]
}

/**
 * Box sums of a `width` × `height` grid (zeros beyond it) out to `radius`
 * each way, rows then columns (a row at a time, walking memory in order).
 * In place.
 */
function boxSums(values: Float32Array, width: number, height: number, radius: number) {
  const scratch = new Float32Array(values.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += values[row + x]!
    for (let x = 0; x < width; x++) {
      scratch[row + x] = sum
      if (x + radius + 1 < width) sum += values[row + x + radius + 1]!
      if (x - radius >= 0) sum -= values[row + x - radius]!
    }
  }
  const sums = new Float64Array(width)
  for (let y = 0; y <= Math.min(radius, height - 1); y++) {
    for (let x = 0; x < width; x++) sums[x]! += scratch[y * width + x]!
  }
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) values[row + x] = sums[x]!
    if (y + radius + 1 < height) {
      const entering = (y + radius + 1) * width
      for (let x = 0; x < width; x++) sums[x]! += scratch[entering + x]!
    }
    if (y - radius >= 0) {
      const leaving = (y - radius) * width
      for (let x = 0; x < width; x++) sums[x]! -= scratch[leaving + x]!
    }
  }
}

/**
 * A blur of `values` (an image `size` wide) within `box`, over only where
 * `within` is set (a weighted mean, so nothing outside leaks in): two box
 * blurs, close to a Gaussian. In place.
 */
function softenWithin(
  values: Float32Array,
  within: Uint8Array,
  size: number,
  [left, top, right, bottom]: Box,
  radius: number,
) {
  const width = right - left
  const height = bottom - top
  if (radius < 1 || width <= 0 || height <= 0) return
  const sum = new Float32Array(width * height)
  const count = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y + top) * size + x + left
      if (!within[i]) continue
      sum[y * width + x] = values[i]!
      count[y * width + x] = 1
    }
  }
  for (let round = 0; round < 2; round++) {
    boxSums(sum, width, height, radius)
    boxSums(count, width, height, radius)
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y + top) * size + x + left
      if (within[i]) values[i] = sum[y * width + x]! / count[y * width + x]!
    }
  }
}

/**
 * The photo's own depth buffer: how near its camera (fractions of the
 * front view) the head's skin is at each photo pixel, the mask set on it;
 * -Infinity where there is none. Only the skin: the character's hair (and
 * anything else of its own) is not in the photo to hide anything.
 */
function photoDepth(fit: MaskFit, skin: FaceSurface, photo: Pixels) {
  const { width, height } = photo
  const { pose } = fit
  const vertices = skin.positions.length / 3
  const nearness = new Float32Array(vertices)
  const photoX = new Float32Array(vertices)
  const photoY = new Float32Array(vertices)
  const offset = [0, 0, 0]
  for (let v = 0; v < vertices; v++) {
    const p = skin.positions.subarray(v * 3, v * 3 + 3)
    nearness[v] = cameraDepth(pose, p)
    maskOffset(fit, p, offset)
    const [x, y] = projectPoint(pose, [p[0]! + offset[0]!, p[1]! + offset[1]!, p[2]! + offset[2]!])
    photoX[v] = x * width
    photoY[v] = y * height
  }
  const depth = new Float32Array(width * height).fill(Number.NEGATIVE_INFINITY)
  const all: Box = [0, 0, width, height]
  const { triangles } = skin
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!]
    const [za, zb, zc] = [nearness[a]!, nearness[b]!, nearness[c]!]
    rasterise(
      photoX[a]!,
      photoY[a]!,
      photoX[b]!,
      photoY[b]!,
      photoX[c]!,
      photoY[c]!,
      width,
      all,
      (pixel, w0, w1, w2) => {
        const z = za * w0 + zb * w1 + zc * w2
        if (z > depth[pixel]!) depth[pixel] = z
      },
    )
  }
  return depth
}

/**
 * How much of the photo round each of its pixels (out to about `reach`
 * pixels, weighted towards the pixel) the mask leaves bare all the way to
 * the photo's edge (`depth`, the photo's depth buffer): its background,
 * not the openings of the eyes and mouth inside it. A point of the face
 * that lands among it is at the mask's silhouette, where the photo's own
 * face may end a little short of the mask's.
 */
function backgroundNear(depth: Float32Array, width: number, height: number, reach: number) {
  const share = new Float32Array(width * height)
  const stack: number[] = []
  const visit = (pixel: number) => {
    if (share[pixel] === 0 && depth[pixel] === Number.NEGATIVE_INFINITY) {
      share[pixel] = 1
      stack.push(pixel)
    }
  }
  for (let x = 0; x < width; x++) {
    visit(x)
    visit((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    visit(y * width)
    visit(y * width + width - 1)
  }
  for (let pixel = stack.pop(); pixel !== undefined; pixel = stack.pop()) {
    const x = pixel % width
    if (x > 0) visit(pixel - 1)
    if (x < width - 1) visit(pixel + 1)
    if (pixel >= width) visit(pixel - width)
    if (pixel < width * (height - 1)) visit(pixel + width)
  }
  // Two box blurs half as wide: a tent reaching `reach`.
  const radius = Math.max(1, Math.round(reach / 2))
  boxSums(share, width, height, radius)
  boxSums(share, width, height, radius)
  const area = (2 * radius + 1) ** 4
  for (let i = 0; i < share.length; i++) share[i]! /= area
  return share
}

/**
 * How much nearer the camera than `z` the surface in front is at a photo
 * position (pixels): the least of the four pixels around it, so a point at
 * the edge of what hides it is not hidden.
 */
function hiddenBy(
  depth: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  z: number,
) {
  const x0 = Math.floor(x - 0.5)
  const y0 = Math.floor(y - 0.5)
  let least = Number.POSITIVE_INFINITY
  for (let k = 0; k < 4; k++) {
    const px = Math.min(width - 1, Math.max(0, x0 + (k & 1)))
    const py = Math.min(height - 1, Math.max(0, y0 + (k >> 1)))
    least = Math.min(least, depth[py * width + px]!)
  }
  return least - z
}

/**
 * The front view within `box`, as renderFront draws it (everything facing
 * it: the eyeballs are not always found as such): each pixel's depth, and
 * how squarely its surface faces the photo.
 */
function frontView(fit: MaskFit, geometry: HeadGeometry, size: number, box: Box) {
  const { positions, normals, triangles, front } = faceSurface(geometry.all, fit.frameSize)
  const facing = new Float32Array(positions.length / 3)
  for (let v = 0; v < facing.length; v++) {
    facing[v] = cameraDepth(fit.pose, normals.subarray(v * 3, v * 3 + 3))
  }
  const depth = new Float32Array(size * size).fill(Number.NEGATIVE_INFINITY)
  const turned = new Float32Array(size * size)
  for (let t = 0; t < front.length; t++) {
    if (!front[t]) continue
    const [a, b, c] = [triangles[t * 3]!, triangles[t * 3 + 1]!, triangles[t * 3 + 2]!]
    const [za, zb, zc] = [positions[a * 3 + 2]!, positions[b * 3 + 2]!, positions[c * 3 + 2]!]
    rasterise(
      positions[a * 3]! * size,
      positions[a * 3 + 1]! * size,
      positions[b * 3]! * size,
      positions[b * 3 + 1]! * size,
      positions[c * 3]! * size,
      positions[c * 3 + 1]! * size,
      size,
      box,
      (pixel, w0, w1, w2) => {
        const z = za * w0 + zb * w1 + zc * w2
        if (z <= depth[pixel]!) return
        depth[pixel] = z
        turned[pixel] = facing[a]! * w0 + facing[b]! * w1 + facing[c]! * w2
      },
    )
  }
  return { depth, facing: turned }
}

/**
 * The smooth part of the mask's push and pull (x, y, z per node) at every
 * SPREAD_STEP-th front-view pixel across `box`, on the surface the front
 * view shows there (nothing where it shows none), to fill in between.
 */
function spreadGrid(
  fit: MaskFit,
  depth: Float32Array,
  size: number,
  [left, top, right, bottom]: Box,
) {
  // At least two nodes each way, for there to be something to fill between.
  const across = Math.max(2, Math.ceil((right - left - 1) / SPREAD_STEP) + 1)
  const down = Math.max(2, Math.ceil((bottom - top - 1) / SPREAD_STEP) + 1)
  const grid = new Float32Array(across * down * 3)
  const offset = [0, 0, 0]
  for (let j = 0; j < down; j++) {
    const py = Math.min(size - 1, top + j * SPREAD_STEP)
    for (let i = 0; i < across; i++) {
      const px = Math.min(size - 1, left + i * SPREAD_STEP)
      const z = depth[py * size + px]!
      if (z === Number.NEGATIVE_INFINITY) continue
      maskSpread(fit, [(px + 0.5) / size, (py + 0.5) / size, z], offset)
      grid.set(offset, (j * across + i) * 3)
    }
  }
  return { grid, across, down }
}

/**
 * The mask's touch-up (x, y, z per pixel) at every front-view pixel of its
 * patches: exact to the pixel, as patches can part sharply (lips along
 * their line).
 */
function touchImage(fit: MaskFit, depth: Float32Array, size: number, box: Box) {
  const touch = new Float32Array(size * size * 3)
  const corner = (k: number) =>
    k < fit.pulled.length ? fit.landmarks[fit.pulled[k]!]! : fit.ring[k - fit.pulled.length]!
  const out = [0, 0, 0]
  fit.patches.forEach(([a, b, c], patch) => {
    const [ax, ay] = corner(a)
    const [bx, by] = corner(b)
    const [cx, cy] = corner(c)
    rasterise(
      ax * size,
      ay * size,
      bx * size,
      by * size,
      cx * size,
      cy * size,
      size,
      box,
      (pixel, w0, w1, w2) => {
        const z = depth[pixel]!
        if (z === Number.NEGATIVE_INFINITY) return
        patchTouch(fit, patch, w0, w1, w2, z, out)
        touch[pixel * 3] = out[0]!
        touch[pixel * 3 + 1] = out[1]!
        touch[pixel * 3 + 2] = out[2]!
      },
    )
  })
  return touch
}

/**
 * The photo projected onto the character's front view (`size` pixels a
 * side, laid out as FaceWarp.warped, so the swap's hair removal and blend
 * run on it as they are): each pixel's point on the head, moved by the mask
 * and set in its pose, sampled from the photo there. Where the photo shows
 * a point clearly worse than its mirror image across the face (turned away
 * from its camera, behind the nose of a face turned aside, at the edge of
 * the face) the mirror image is taken instead; `seen` and `mirrored` say
 * how it went.
 */
export function projectFace(
  photo: Pixels,
  fit: MaskFit,
  geometry: HeadGeometry,
  size = FRONT,
): ProjectedFace {
  const { pose } = fit
  const { width, height } = photo
  const box = faceBox(fit, size)
  const [left, top, right, bottom] = box
  const occluders = photoDepth(fit, faceSurface(geometry.skin, fit.frameSize), photo)
  const reach = SILHOUETTE_REACH * eyeDistance(fit.landmarks) * pose.scale * ((width + height) / 2)
  const background = backgroundNear(occluders, width, height, Math.max(SILHOUETTE_PIXELS, reach))
  const { depth, facing } = frontView(fit, geometry, size, box)
  const { grid, across, down } = spreadGrid(fit, depth, size, box)
  const touch = touchImage(fit, depth, size, box)

  // Each front-view pixel taken from the photo, and how well it shows there.
  const direct = new Uint8ClampedArray(size * size * 4)
  const shown = new Float32Array(size * size)
  const clear = new Float32Array(size * size)
  const onHead = new Uint8Array(size * size)
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = pose.rotation as number[]
  const toX = pose.scale * width
  const toY = pose.scale * height
  const shiftX = pose.shift[0] * width
  const shiftY = pose.shift[1] * height
  const lastX = across - 1.000001
  const lastY = down - 1.000001
  for (let py = top; py < bottom; py++) {
    const gy = Math.min(lastY, (py - top) / SPREAD_STEP)
    const j = Math.floor(gy)
    const fy = gy - j
    const y = (py + 0.5) / size
    for (let px = left; px < right; px++) {
      const pixel = py * size + px
      const z = depth[pixel]!
      if (z === Number.NEGATIVE_INFINITY) continue
      onHead[pixel] = 1
      const x = (px + 0.5) / size
      // The mask's push and pull here: its touch-up, and its spread
      // bilinear between nodes.
      const gx = Math.min(lastX, (px - left) / SPREAD_STEP)
      const i = Math.floor(gx)
      const fx = gx - i
      const n00 = (j * across + i) * 3
      const n01 = n00 + across * 3
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy
      const t = pixel * 3
      const mx =
        x +
        touch[t]! +
        grid[n00]! * w00 +
        grid[n00 + 3]! * w10 +
        grid[n01]! * w01 +
        grid[n01 + 3]! * w11
      const my =
        y +
        touch[t + 1]! +
        grid[n00 + 1]! * w00 +
        grid[n00 + 4]! * w10 +
        grid[n01 + 1]! * w01 +
        grid[n01 + 4]! * w11
      const mz =
        z +
        touch[t + 2]! +
        grid[n00 + 2]! * w00 +
        grid[n00 + 5]! * w10 +
        grid[n01 + 2]! * w01 +
        grid[n01 + 5]! * w11
      const sx = toX * (r0! * mx + r1! * my + r2! * mz) + shiftX
      const sy = toY * (r3! * mx + r4! * my + r5! * mz) + shiftY
      if (sx >= 0 && sy >= 0 && sx <= width && sy <= height) {
        const gap = hiddenBy(occluders, width, height, sx, sy, r6! * x + r7! * y + r8! * z)
        const at =
          Math.min(height - 1, Math.floor(sy)) * width + Math.min(width - 1, Math.floor(sx))
        shown[pixel] =
          smoothstep(FACING_FROM, FACING_TO, facing[pixel]!) *
          (1 - smoothstep(HIDDEN_FROM, HIDDEN_TO, gap))
        clear[pixel] = 1 - smoothstep(BACKGROUND_FROM, BACKGROUND_TO, background[at]!)
      }
      sampleColor(photo, sx - 0.5, sy - 0.5, direct, pixel * 4)
      direct[pixel * 4 + 3] = 255
    }
  }
  // Softened so a mirrored patch fades in. The silhouette's part is left
  // out of that (it is spread across the photo already), so the face beside
  // a silhouette cannot soften it back up.
  softenWithin(shown, onHead, size, box, Math.round(SEEN_SOFTENING * size))
  for (let pixel = 0; pixel < shown.length; pixel++) shown[pixel]! *= clear[pixel]!
  const side = new Float32Array(shown)
  softenWithin(side, onHead, size, box, Math.round(SIDE_SOFTENING * size))

  // What the photo shows clearly worse than its mirror image across the
  // face comes from that.
  const warped = new Uint8ClampedArray(direct)
  const seen = new Float32Array(size * size)
  const mirrored = new Float32Array(size * size)
  const turn = 2 * fit.midline * size
  for (let py = top; py < bottom; py++) {
    for (let px = left; px < right; px++) {
      const pixel = py * size + px
      if (!onHead[pixel]) continue
      const own = shown[pixel]!
      seen[pixel] = own
      const mx = Math.floor(turn - (px + 0.5))
      if (mx < left || mx >= right) continue
      const mirror = py * size + mx
      if (!onHead[mirror]) continue
      const other = shown[mirror]!
      const share = smoothstep(MIRROR_FROM, MIRROR_TO, side[mirror]! - side[pixel]!)
      if (share <= 0) continue
      mirrored[pixel] = share
      seen[pixel] = (1 - share) * own + share * MIRROR_TRUST * other
      for (let c = 0; c < 3; c++) {
        const from = direct[pixel * 4 + c]!
        warped[pixel * 4 + c] = from + (direct[mirror * 4 + c]! - from) * share
      }
    }
  }
  return { warped: { data: warped, width: size, height: size }, seen, mirrored }
}
