import type { AvatarGender } from '../avatar-catalog'
import { type BaseBody, movedPositions } from './base-body'
import type { Expression } from './expressions'
import { ringLandmarks } from './features'
import { EYES } from './landmark-sets'
import { fillTriangles } from './silhouette'
import { linearToSrgb, median, srgbToLinear, TEXEL_FEATURE, type Texels } from './texture'

/**
 * The eyes and mouth of a photo avatar, past what the fit and the skin
 * give them: which photos show the eyes open (only those may paint the
 * lids or say what colour the whites are), the eyeball's iris and sclera
 * in the person's colours, lashes as long and as thick as a man's or a
 * woman's, the wet pink rims where the lids meet the eye (with the
 * caruncle in the inner corner) and inside the lips, and teeth and tongue
 * that read as inside a mouth.
 */

/** A photo's eyes count as shut above this (MediaPipe's eyeBlink, or the lids' own measure, 0–1). */
export const SHUT = 0.4

/** What a view says of its eyes: MediaPipe's blendshapes where it read them, else the lids' opening. */
export type EyeReading = {
  blendshapes?: Record<string, number> | null
  blink?: number
}

/** Whether a photo shows the eyes shut (or nearly): its lids and irises are no measure of open eyes. */
export function eyesShut(view: EyeReading): boolean {
  const shapes = view.blendshapes
  if (shapes && ('eyeBlinkLeft' in shapes || 'eyeBlinkRight' in shapes))
    return Math.max(shapes.eyeBlinkLeft ?? 0, shapes.eyeBlinkRight ?? 0) > SHUT
  return (view.blink ?? 0) > SHUT
}

/** The eyes' openings, each a ring of landmarks (the subject's left, then right). */
const EYE_RINGS = [EYES.slice(0, 16), EYES.slice(16)]

/**
 * The texels (`size` across) of both eyes' lids: an oval about each
 * opening, reaching up past the lid's crease and down over the lower lid.
 * A photo with the eyes shut paints none of them: its closed lid would put
 * the lid's skin, and its crease, where the open eye's lid is not. Given
 * the texels' kinds (`kind`, texelKinds' at this size), the brows are left
 * out: shut eyes show them as open ones do, and low brows reach the oval.
 */
export function lidTexels(landmarkUv: Float32Array, size: number, kind?: Uint8Array): Uint8Array {
  const out = new Uint8Array(size * size)
  for (const all of EYE_RINGS) {
    const ring = ringLandmarks(landmarkUv, all)
    let cu = 0
    let cv = 0
    for (const l of ring) {
      cu += landmarkUv[l * 2]!
      cv += landmarkUv[l * 2 + 1]!
    }
    cu /= ring.length
    cv /= ring.length
    let half = 0
    let tall = 0
    for (const l of ring) {
      half = Math.max(half, Math.abs(landmarkUv[l * 2]! - cu))
      tall = Math.max(tall, Math.abs(landmarkUv[l * 2 + 1]! - cv))
    }
    if (!(half > 0 && tall > 0)) continue
    // The texture's v runs down: the upper lid (to the brow's crease) lies at smaller v.
    const across = half * 1.45
    const up = tall * 2.4
    const down = tall * 2.2
    const x0 = Math.max(0, Math.floor((cu - across) * size))
    const x1 = Math.min(size - 1, Math.ceil((cu + across) * size))
    const y0 = Math.max(0, Math.floor((cv - up) * size))
    const y1 = Math.min(size - 1, Math.ceil((cv + down) * size))
    for (let y = y0; y <= y1; y++) {
      const dv = (y + 0.5) / size - cv
      const reach = dv < 0 ? up : down
      for (let x = x0; x <= x1; x++) {
        const du = (x + 0.5) / size - cu
        if ((du / across) ** 2 + (dv / reach) ** 2 > 1) continue
        if (kind?.[y * size + x] !== TEXEL_FEATURE) out[y * size + x] = 1
      }
    }
  }
  return out
}

/** Iris landmarks: each eye's centre then four points on its rim (the subject's right, then left). */
const IRISES = [
  [468, 469, 470, 471, 472],
  [473, 474, 475, 476, 477],
] as const

/** Irises smaller than this (px) are too few pixels to read. */
const MIN_IRIS = 3
/** More saturated than this ((max − min) / max) is lid, lash or iris, not the white of the eye. */
const MAX_WHITE_SATURATION = 0.25
/** A turned face shows one white foreshortened and the other in the nose's shadow. */
const MAX_WHITES_YAW = (25 * Math.PI) / 180

type WhitesView = EyeReading & {
  width: number
  height: number
  rgba: ArrayLike<number>
  landmarks: Float32Array | null
  yaw: number
}

/**
 * The whites of the eyes as the photos show them (linear RGB): the lighter
 * half of the near-grey pixels between the lids round each iris, less
 * their brightest tenth (the light's glints), over every photo facing the
 * camera with its eyes open. Null when no photo shows enough of them.
 */
export function photoWhites(views: readonly WhitesView[]): [number, number, number] | null {
  const samples: number[][] = [[], [], []]
  for (const view of views) {
    if (!view.landmarks || eyesShut(view) || Math.abs(view.yaw) > MAX_WHITES_YAW) continue
    const at = (l: number): [number, number] => [
      view.landmarks![l * 2]!,
      view.landmarks![l * 2 + 1]!,
    ]
    const found: number[] = []
    IRISES.forEach(([centre, ...rim], k) => {
      const c = at(centre)
      const radius = rim.reduce((s, l) => s + Math.hypot(at(l)[0] - c[0], at(l)[1] - c[1]), 0) / 4
      if (!(radius >= MIN_IRIS)) return
      // The subject's right iris (468) sits in the right eye's opening (EYE_RINGS[1]).
      const ring = EYE_RINGS[1 - k]!.map(at)
      const mask = new Uint8Array(view.width * view.height)
      const xy = ring.flat()
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
      const triangles: number[] = []
      for (let i = 0; i < ring.length; i++) triangles.push(ring.length, i, (i + 1) % ring.length)
      fillTriangles([...xy, cx, cy], triangles, view.width, view.height, mask)
      const x0 = Math.max(0, Math.floor(c[0] - 3.5 * radius))
      const x1 = Math.min(view.width - 1, Math.ceil(c[0] + 3.5 * radius))
      const y0 = Math.max(0, Math.floor(c[1] - 2 * radius))
      const y1 = Math.min(view.height - 1, Math.ceil(c[1] + 2 * radius))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * view.width + x
          if (!mask[i] || Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1]) < 1.15 * radius) continue
          const r = view.rgba[i * 4]!
          const g = view.rgba[i * 4 + 1]!
          const b = view.rgba[i * 4 + 2]!
          const top = Math.max(r, g, b)
          if (top - Math.min(r, g, b) > MAX_WHITE_SATURATION * top) continue
          found.push(i)
        }
      }
    })
    if (found.length < 12) continue
    const light = (i: number) =>
      0.2126 * view.rgba[i * 4]! + 0.7152 * view.rgba[i * 4 + 1]! + 0.0722 * view.rgba[i * 4 + 2]!
    found.sort((a, b) => light(a) - light(b))
    for (const i of found.slice(Math.floor(found.length / 2), Math.floor(found.length * 0.9)))
      for (let k = 0; k < 3; k++) samples[k]!.push(srgbToLinear(view.rgba[i * 4 + k]!))
  }
  if (samples[0]!.length < 12) return null
  return samples.map((s) => median(s)) as [number, number, number]
}

/** How light (linear) a sclera may be made: no paler than a living one, no darker than one in shade. */
const SCLERA_LIGHT: [number, number] = [0.38, 0.62]
/** Most a sclera's tint may lean from grey ((max − min) / max, linear). */
const SCLERA_TINT = 0.14

/**
 * The sclera's colour (linear) from the photos' whites, taken to the
 * texture's scale by the gains that took the photos' skin to the skin's
 * colour, then held to a living eye's range (lightness and tint).
 */
export function scleraColour(
  whites: [number, number, number],
  gains: readonly number[],
): [number, number, number] {
  const toned = whites.map((c, k) => c * gains[k]!) as [number, number, number]
  const light = 0.2126 * toned[0] + 0.7152 * toned[1] + 0.0722 * toned[2]
  const scale = Math.min(SCLERA_LIGHT[1], Math.max(SCLERA_LIGHT[0], light)) / Math.max(light, 1e-4)
  const out = toned.map((c) => c * scale) as [number, number, number]
  const top = Math.max(...out)
  const bottom = Math.min(...out)
  if (top - bottom > SCLERA_TINT * top) {
    // Pull the channels toward their lightness by the share that leaves the tint at its most.
    const grey = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]
    const keep = (SCLERA_TINT * grey) / (top - bottom - SCLERA_TINT * (top - grey))
    for (let k = 0; k < 3; k++) out[k] = grey + (out[k]! - grey) * keep
  }
  return out
}

/** The texels (image pixels) a primitive's UVs cover. */
function uvMask(p: BaseBody['primitives'][number], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height)
  const uv = p.attributes.TEXCOORD_0?.values
  if (!uv) return mask
  const xy = new Float32Array(uv.length)
  for (let i = 0; i < uv.length; i += 2) {
    xy[i] = uv[i]! * width
    xy[i + 1] = uv[i + 1]! * height
  }
  fillTriangles(xy, p.indices, width, height, mask)
  return mask
}

type Image = { data: ArrayLike<number>; width: number; height: number }

const lightOf = (data: ArrayLike<number>, i: number) =>
  0.2126 * srgbToLinear(data[i * 4]!) +
  0.7152 * srgbToLinear(data[i * 4 + 1]!) +
  0.0722 * srgbToLinear(data[i * 4 + 2]!)

/**
 * The eye texture in the person's colours: each iris texel the iris colour
 * (linear) scaled by how light it is against the iris's median, so the iris
 * keeps its fibres and dark rim; each sclera texel toned, channel by
 * channel, from the texture's sclera to the sclera colour, its veins kept.
 * Either colour may be null (that part is left as it is).
 */
export function eyeTexture(
  base: BaseBody,
  image: Image,
  iris: [number, number, number] | null,
  sclera: [number, number, number] | null,
): Uint8ClampedArray {
  const out = Uint8ClampedArray.from(image.data)
  const { width, height, data } = image
  const irisPart = base.primitives.find((one) => one.material === 'Eye_Iris')
  const scleraPart = base.primitives.find((one) => one.material === 'Eye_Sclera')
  const irisMask = irisPart ? uvMask(irisPart, width, height) : new Uint8Array(width * height)
  if (iris && irisPart) {
    const lights: number[] = []
    for (let i = 0; i < irisMask.length; i++) if (irisMask[i]) lights.push(lightOf(data, i))
    const average = Math.max(median(lights), 1e-4)
    for (let i = 0; i < irisMask.length; i++) {
      if (!irisMask[i]) continue
      const scale = lightOf(data, i) / average
      for (let k = 0; k < 3; k++) out[i * 4 + k] = linearToSrgb(iris[k]! * scale)
    }
  }
  if (sclera && scleraPart) {
    const mask = uvMask(scleraPart, width, height)
    const channels: number[][] = [[], [], []]
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || irisMask[i]) continue
      for (let k = 0; k < 3; k++) channels[k]!.push(srgbToLinear(data[i * 4 + k]!))
    }
    if (channels[0]!.length) {
      const gains = channels.map((c, k) => sclera[k]! / Math.max(median(c), 1e-4))
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i] || irisMask[i]) continue
        for (let k = 0; k < 3; k++)
          out[i * 4 + k] = linearToSrgb(srgbToLinear(data[i * 4 + k]!) * gains[k]!)
      }
    }
  }
  return out
}

/**
 * How long a man's and a woman's lashes are against the base's (upper and
 * lower lids), and how dense they show (their material's alpha): the base's
 * are long, dense false lashes on both lids, for both.
 */
export const LASHES: Record<AvatarGender, { upper: number; lower: number; opacity: number }> = {
  male: { upper: 0.68, lower: 0.42, opacity: 0.72 },
  female: { upper: 0.9, lower: 0.55, opacity: 0.9 },
}

/**
 * The lashes' positions (metres at rest, after `moves`): each lash drawn
 * in toward where it grows from the lid (its nearest skin vertex) to a
 * man's or a woman's length, the lower ones shortest.
 */
export function lashPositions(base: BaseBody, moves: Float64Array, gender: AvatarGender) {
  const index = base.primitives.findIndex((one) => one.material === 'Eyelashes')
  if (index < 0) return null
  const restLash = movedPositions(base, index, new Float64Array(base.basemesh.length))
  const moved = movedPositions(base, index, moves)
  const skin = base.headSkin.mesh.positions
  const skinMoved = movedPositions(base, base.headSkin.primitive, moves)
  const { Left, Right } = base.meta.eyeCentres
  const { upper, lower } = LASHES[gender]
  const out = new Float32Array(moved.length)
  for (let i = 0; i < moved.length / 3; i++) {
    let best = 0
    let distance = Number.POSITIVE_INFINITY
    for (let j = 0; j < skin.length / 3; j++) {
      const d =
        (skin[j * 3]! - restLash[i * 3]!) ** 2 +
        (skin[j * 3 + 1]! - restLash[i * 3 + 1]!) ** 2 +
        (skin[j * 3 + 2]! - restLash[i * 3 + 2]!) ** 2
      if (d < distance) {
        distance = d
        best = j
      }
    }
    const eye = restLash[i * 3]! > 0 ? Left : Right
    const f = restLash[i * 3 + 1]! < eye[1] ? lower : upper
    for (let k = 0; k < 3; k++) {
      const root = skinMoved[best * 3 + k]!
      out[i * 3 + k] = root + f * (moved[i * 3 + k]! - root)
    }
  }
  return { index, positions: out }
}

/**
 * The teeth and tongue as they read inside a mouth: the base's bright
 * white enamel and glossy red tongue darkened and warmed (linear gains).
 */
export const TEETH_TONE: [number, number, number] = [0.62, 0.58, 0.5]
export const TONGUE_TONE: [number, number, number] = [0.62, 0.55, 0.55]

export function toneImage(image: Image, gains: readonly number[]): Uint8ClampedArray {
  const out = Uint8ClampedArray.from(image.data)
  for (let i = 0; i < image.width * image.height; i++)
    for (let k = 0; k < 3; k++)
      out[i * 4 + k] = linearToSrgb(srgbToLinear(image.data[i * 4 + k]!) * gains[k]!)
  return out
}

/** How far (m) from an eyeball's surface the lids' rims reach. */
const RIM_REACH = 0.0025
/** Skin facing away from the eyeball more than this (the cosine) is the lid's outside, not its rim. */
const RIM_FACING = 0.35
/** How far (m) round the opening from its inner corner the caruncle's pink reaches. */
const CARUNCLE_REACH = 0.005
/** The rims' and the caruncle's colour against the skin's (linear), and the inside of the lips' against the lips'. */
const RIM_TINT: [number, number, number] = [0.95, 0.68, 0.66]
const CARUNCLE_TINT: [number, number, number] = [0.92, 0.5, 0.5]
const INNER_LIP_TINT: [number, number, number] = [0.55, 0.42, 0.42]
/** Lip skin facing the camera less than this (its normal's forward part) turns in between the lips. */
const INNER_LIP_FACING = 0.4
/**
 * The mouth's inside, as deep in it as the light doesn't reach (linear
 * gains on its texture), how deep (m behind the lips) that is, and how much
 * of it the inside just behind the lips already has: the renderer shades
 * no cavity, so the texture must.
 */
const CAVITY_TINT: [number, number, number] = [0.16, 0.09, 0.09]
const CAVITY_DEPTH = 0.025
const CAVITY_NEAR = 0.25

/**
 * Where the head's skin turns in under the lids and between the lips, at
 * the texels' size (0–1, feathered): the lids' rims against the eyeballs
 * (`rim`, with `caruncle` at each inner corner) and the lips' insides
 * (`innerLip`) — skin no photo sees, which the fill gives the face's
 * colour, and which on a person is wet and pink — and how far into the
 * mouth's inside each of its texels lies (`cavity`, 0 at the lips).
 */
export function innerSurfaces(
  base: BaseBody,
  moves: Float64Array,
  texels: Texels,
): {
  rim: Float32Array
  caruncle: Float32Array
  innerLip: Float32Array
  lipFront: Float32Array
  cavity: Float32Array
} {
  const count = texels.size * texels.size
  const rim = new Float32Array(count)
  const caruncle = new Float32Array(count)
  const innerLip = new Float32Array(count)
  const lipFront = new Float32Array(count)
  const cavity = new Float32Array(count)
  // The mouth's inside has its own UV island (v up, as Blender's; the texels' rows run down).
  const inside = base.meta.headUV.boxes.mouth
  const cavityBox: [number, number, number, number] | null = inside
    ? [
        Math.floor(inside[0] * texels.size),
        Math.floor((1 - inside[3]) * texels.size),
        Math.ceil(inside[2] * texels.size),
        Math.ceil((1 - inside[1]) * texels.size),
      ]
    : null
  const eyes = base.primitives.findIndex((one) => one.material === 'Eye_Sclera')
  const balls: { centre: [number, number, number]; radius: number; inner: number }[] = []
  if (eyes >= 0) {
    const moved = movedPositions(base, eyes, moves)
    for (const side of [1, -1]) {
      const centre: [number, number, number] = [0, 0, 0]
      let n = 0
      for (let i = 0; i < moved.length / 3; i++) {
        if (moved[i * 3]! * side <= 0) continue
        for (let k = 0; k < 3; k++) centre[k] = centre[k]! + moved[i * 3 + k]!
        n++
      }
      if (!n) continue
      for (let k = 0; k < 3; k++) centre[k] = centre[k]! / n
      let radius = 0
      for (let i = 0; i < moved.length / 3; i++) {
        if (moved[i * 3]! * side <= 0) continue
        radius = Math.max(
          radius,
          Math.hypot(
            moved[i * 3]! - centre[0],
            moved[i * 3 + 1]! - centre[1],
            moved[i * 3 + 2]! - centre[2],
          ),
        )
      }
      balls.push({ centre, radius, inner: side })
    }
  }
  // The lips: between the mouth's corners, a little above and below them.
  const mouth = mouthBox(base, moves)
  for (let i = 0; i < count; i++) {
    if (texels.triangle[i]! < 0) continue
    const x = texels.position[i * 3]!
    const y = texels.position[i * 3 + 1]!
    const z = texels.position[i * 3 + 2]!
    for (const ball of balls) {
      if (z < ball.centre[2]) continue
      const d2 = (x - ball.centre[0]) ** 2 + (y - ball.centre[1]) ** 2 + (z - ball.centre[2]) ** 2
      if (d2 > (ball.radius + RIM_REACH) ** 2) continue
      const d = Math.sqrt(d2)
      // The lids' outer skin lies over the eyeball too, facing away from it; the rims turn in.
      const away =
        (texels.normal[i * 3]! * (x - ball.centre[0]) +
          texels.normal[i * 3 + 1]! * (y - ball.centre[1]) +
          texels.normal[i * 3 + 2]! * (z - ball.centre[2])) /
        Math.max(d, 1e-6)
      if (away > RIM_FACING) continue
      const w =
        (1 - Math.max(0, d - ball.radius) / RIM_REACH) * Math.min(1, (RIM_FACING - away) / 0.3)
      rim[i] = Math.max(rim[i]!, w)
      // The inner corner is the opening's end nearest the nose (x toward 0).
      const fromCorner = Math.abs(x) - (Math.abs(ball.centre[0]) - ball.radius * 0.75)
      caruncle[i] = Math.max(
        caruncle[i]!,
        w * Math.max(0, 1 - Math.max(0, fromCorner) / CARUNCLE_REACH),
      )
    }
    if (
      mouth &&
      Math.abs(x - mouth.x) < mouth.half &&
      y > mouth.bottom &&
      y < mouth.top &&
      z < mouth.front
    ) {
      const nz = texels.normal[i * 3 + 2]!
      // Facing up, down or back: the lips' inner faces, not their fronts.
      innerLip[i] = Math.min(1, Math.max(0, (INNER_LIP_FACING - nz) / 0.3))
      if (nz > 0.75) lipFront[i] = 1
    }
    if (mouth && cavityBox) {
      const tx = i % texels.size
      const ty = Math.floor(i / texels.size)
      if (tx >= cavityBox[0] && tx <= cavityBox[2] && ty >= cavityBox[1] && ty <= cavityBox[3]) {
        const depth = Math.min(1, Math.max(0, (mouth.front - 0.004 - z) / CAVITY_DEPTH))
        cavity[i] = CAVITY_NEAR + (1 - CAVITY_NEAR) * depth
      }
    }
  }
  // About a millimetre of the face either way, whatever the texels' size.
  for (const mask of [rim, caruncle, innerLip])
    feather(mask, texels.size, Math.max(1, Math.round(texels.size / 512)))
  // Out over the island's edge too, where the texture's sampling reaches past it.
  if (cavityBox) {
    const size = texels.size
    const [x0, y0, x1, y1] = [
      Math.max(1, cavityBox[0] - 2),
      Math.max(1, cavityBox[1] - 2),
      Math.min(size - 2, cavityBox[2] + 2),
      Math.min(size - 2, cavityBox[3] + 2),
    ]
    for (let pass = 0; pass < 2; pass++) {
      const was = Float32Array.from(cavity)
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * size + x
          if (texels.triangle[i]! >= 0) continue
          cavity[i] = Math.max(was[i - 1]!, was[i + 1]!, was[i - size]!, was[i + size]!, was[i]!)
        }
      }
    }
  }
  return { rim, caruncle, innerLip, lipFront, cavity }
}

/** The mouth's box on the fitted head (metres): its middle, half width, top, bottom and front. */
function mouthBox(base: BaseBody, moves: Float64Array) {
  const head = base.head
  const at = (l: number) => {
    let p = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const local = head.landmarkVertices[l * 3 + k]!
      if (local < 0) return null
      const w = head.landmarkWeights[l * 3 + k]!
      const v = head.vertices[local]!
      p = p.map((c, j) => c + w * (base.basemesh[v * 3 + j]! + moves[v * 3 + j]!))
    }
    return p
  }
  const left = at(291)
  const right = at(61)
  const top = at(0)
  const bottom = at(17)
  if (!(left && right && top && bottom)) return null
  return {
    x: (left[0]! + right[0]!) / 2,
    half: Math.abs(left[0]! - right[0]!) / 2 + 0.002,
    top: top[1]! + 0.002,
    bottom: bottom[1]! - 0.002,
    front: Math.max(top[2]!, bottom[2]!) + 0.004,
  }
}

/** The photos' lips are together below this: the inner lips' gap against the mouth's width. */
const LIPS_TOGETHER = 0.05
/** A face turned further than this foreshortens its mouth. */
const MAX_LIPS_YAW = (30 * Math.PI) / 180

/** Whether the photos facing the camera show the lips together (by the median of their gaps). */
export function lipsTogether(
  views: readonly { landmarks: Float32Array | null; yaw: number }[],
): boolean {
  const gaps: number[] = []
  for (const view of views) {
    const p = view.landmarks
    if (!p || Math.abs(view.yaw) > MAX_LIPS_YAW) continue
    const d = (a: number, b: number) =>
      Math.hypot(p[a * 2]! - p[b * 2]!, p[a * 2 + 1]! - p[b * 2 + 1]!)
    const width = d(61, 291)
    if (width > 0) gaps.push(d(13, 14) / width)
  }
  return gaps.length > 0 && median(gaps) < LIPS_TOGETHER
}

/** The most the lips are drawn together (the jaw's opening taken back, as jawOpen's weight), and its steps. */
const MAX_SEAL = 0.15
const SEAL_STEP = 0.01
/** How far (m) past the mouth's corners and below the lower lip the lift fades out. */
const SEAL_FADE = 0.008
/** The front view's pixel (m) where the slit between the lips is looked for. */
const SEAL_PIXEL = 0.0002
/** Columns across the mouth's middle with a gap between the lips, past which it shows a slit. */
const SLIT_COLUMNS = 0.03

/**
 * `moves` with the lips brought together where the fitted head leaves a
 * slit between them that the teeth show through: the lower lip raised by
 * the least of the jaw's closing (`jaw`, the jawOpen shape taken back) that
 * leaves no gap across the mouth's middle seen from the front, and a step
 * more so they press, fading out past the corners and below the lip so
 * the chin stays where the fit put it.
 */
export function sealLips(base: BaseBody, moves: Float64Array, jaw: Expression): Float64Array {
  const mouth = mouthBox(base, moves)
  const teethIndex = base.primitives.findIndex((one) => one.material === 'Teeth')
  if (!mouth || teethIndex < 0) return moves
  const { weld, mesh, primitive } = base.headSkin
  const isSkin = new Uint8Array(base.basemesh.length / 3)
  for (const v of weld) isSkin[v] = 1
  const lift = new Float64Array(base.basemesh.length)
  jaw.vertices.forEach((v, i) => {
    if (!isSkin[v]) return
    const x = base.basemesh[v * 3]! + moves[v * 3]!
    const y = base.basemesh[v * 3 + 1]! + moves[v * 3 + 1]!
    const across = Math.min(1, Math.max(0, (Math.abs(x - mouth.x) - mouth.half) / SEAL_FADE))
    const below = Math.min(1, Math.max(0, (mouth.bottom - y) / SEAL_FADE))
    const w = (1 - across) * (1 - below)
    for (let k = 0; k < 3; k++) lift[v * 3 + k] = -w * jaw.deltas[i * 3 + k]!
  })
  // Only the lips' fronts, ahead of the teeth: deeper skin would hide the slit from a front view.
  const teeth = movedPositions(base, teethIndex, moves)
  let teethFront = Number.NEGATIVE_INFINITY
  for (let i = 2; i < teeth.length; i += 3) teethFront = Math.max(teethFront, teeth[i]!)
  const rest = movedPositions(base, primitive, moves)
  const middle = (mouth.half - 0.002) * 0.7
  const width = Math.ceil((2 * middle) / SEAL_PIXEL)
  const height = Math.ceil((mouth.top - mouth.bottom) / SEAL_PIXEL)
  const lips: number[] = []
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const c = [0, 0, 0]
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) c[k] = c[k]! + rest[mesh.triangles[t + j]! * 3 + k]! / 3
    if (
      Math.abs(c[0]! - mouth.x) < middle + 0.003 &&
      c[1]! > mouth.bottom - 0.003 &&
      c[1]! < mouth.top + 0.003 &&
      c[2]! > teethFront - 0.001
    )
      lips.push(mesh.triangles[t]!, mesh.triangles[t + 1]!, mesh.triangles[t + 2]!)
  }
  const xy = new Float32Array((rest.length / 3) * 2)
  const cover = new Uint8Array(width * height)
  const slit = (s: number) => {
    for (let i = 0; i < rest.length / 3; i++) {
      const v = weld[i]!
      xy[i * 2] = (rest[i * 3]! + s * lift[v * 3]! - (mouth.x - middle)) / SEAL_PIXEL
      xy[i * 2 + 1] = (mouth.top - (rest[i * 3 + 1]! + s * lift[v * 3 + 1]!)) / SEAL_PIXEL
    }
    cover.fill(0)
    fillTriangles(xy, lips, width, height, cover)
    let open = 0
    for (let x = 0; x < width; x++) {
      let top = -1
      let bottom = -1
      for (let y = 0; y < height; y++) {
        if (!cover[y * width + x]) continue
        if (top < 0) top = y
        bottom = y
      }
      for (let y = top + 1; top >= 0 && y < bottom; y++) {
        if (cover[y * width + x]) continue
        open++
        break
      }
    }
    return open > SLIT_COLUMNS * width
  }
  if (!slit(0)) return moves
  let s = SEAL_STEP
  while (s < MAX_SEAL && slit(s)) s += SEAL_STEP
  s = Math.min(MAX_SEAL, s + SEAL_STEP)
  const out = Float64Array.from(moves)
  for (let i = 0; i < out.length; i++) out[i] = out[i]! + s * lift[i]!
  return out
}

/** A box blur, `radius` texels, in place (twice: near a Gaussian), over the part of `mask` that isn't zero. */
function feather(mask: Float32Array, size: number, radius: number) {
  let x0 = size
  let y0 = size
  let x1 = -1
  let y1 = -1
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const x = i % size
    const y = Math.floor(i / size)
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  if (x1 < 0) return
  // Two passes spread it twice the radius.
  x0 = Math.max(0, x0 - 2 * radius)
  y0 = Math.max(0, y0 - 2 * radius)
  x1 = Math.min(size - 1, x1 + 2 * radius)
  y1 = Math.min(size - 1, y1 + 2 * radius)
  const tmp = new Float32Array(mask.length)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let s = 0
        let n = 0
        for (let d = -radius; d <= radius; d++) {
          const xx = x + d
          if (xx < 0 || xx >= size) continue
          s += mask[y * size + xx]!
          n++
        }
        tmp[y * size + x] = s / n
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let s = 0
        let n = 0
        for (let d = -radius; d <= radius; d++) {
          const yy = y + d
          if (yy < 0 || yy >= size) continue
          s += tmp[yy * size + x]!
          n++
        }
        mask[y * size + x] = s / n
      }
    }
  }
}

/**
 * The head's texture (sRGB RGBA, `size` across), in place, with the lids'
 * rims and caruncles tinted from the skin's colour (`skin`, linear), the
 * lips' insides darkened from the lips' fronts as the texture has them,
 * and the mouth's inside the darker the deeper; the masks at the texels'
 * size (`working`).
 */
export function paintInnerSurfaces(
  pixels: Uint8ClampedArray,
  size: number,
  masks: ReturnType<typeof innerSurfaces>,
  working: number,
  skin: readonly number[],
) {
  // The pixels each texel covers: from the first whose texel it is to the next texel's first.
  const first = (t: number) => Math.ceil((t * size) / working)
  const channels: number[][] = [[], [], []]
  for (let j = 0; j < working * working; j++) {
    const x = first(j % working)
    const y = first(Math.floor(j / working))
    if (masks.lipFront[j]! < 1 || x >= size || y >= size) continue
    for (let k = 0; k < 3; k++) channels[k]!.push(srgbToLinear(pixels[(y * size + x) * 4 + k]!))
  }
  const lips = channels.map((c, k) => (c.length ? median(c) : skin[k]! * 0.8))
  for (let ty = 0; ty < working; ty++) {
    for (let tx = 0; tx < working; tx++) {
      const j = ty * working + tx
      const rim = masks.rim[j]!
      const lip = masks.innerLip[j]!
      const deep = masks.cavity[j]!
      if (rim <= 0.001 && lip <= 0.001 && deep <= 0) continue
      const corner = masks.caruncle[j]!
      const gains = [0, 1, 2].map((k) => 1 + (CAVITY_TINT[k]! - 1) * deep)
      const tints = [0, 1, 2].map(
        (k) =>
          RIM_TINT[k]! +
          (CARUNCLE_TINT[k]! - RIM_TINT[k]!) * Math.min(1, corner / Math.max(rim, 1e-3)),
      )
      for (let y = first(ty); y < Math.min(size, first(ty + 1)); y++) {
        for (let x = first(tx); x < Math.min(size, first(tx + 1)); x++) {
          const i = (y * size + x) * 4
          for (let k = 0; k < 3; k++) {
            let c = srgbToLinear(pixels[i + k]!)
            c += (skin[k]! * tints[k]! - c) * rim
            c += (lips[k]! * INNER_LIP_TINT[k]! - c) * lip
            pixels[i + k] = linearToSrgb(c * gains[k]!)
          }
        }
      }
    }
  }
}
