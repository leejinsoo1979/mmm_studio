import type { CaptureView } from './avatar-job'
import { type BaseBody, movedPositions } from './base-body'
import type { Camera } from './camera'
import { eyesShut, lidTexels } from './eyes'
import {
  distanceTo,
  EYE_RINGS,
  faceOpenings,
  landmarkUvs,
  type TexelFeatures,
  texelFeatures,
} from './features'
import {
  bleed,
  composite,
  edgeColour,
  fillVertexColors,
  nearestSeed,
  rasterizeVertexColors,
  type SurfaceGraph,
  smoothOnGraph,
  surfaceGraph,
  toneGains,
} from './fill'
import type { GltfJson } from './glb'
import { vertexNormals } from './head-model'
import { classPlane } from './segment'
import { fillTriangles, rasterTriangle } from './silhouette'
import {
  blendViews,
  delightTogether,
  depthBuffer,
  featherWeights,
  linearToSrgb,
  litTrust,
  matchExposure,
  median,
  type ProjectedView,
  projectView,
  rasterizeUv,
  sceneRgb,
  smooth,
  srgbToLinear,
  type Texels,
  type UvMesh,
  untoneNeutral,
} from './texture'

/**
 * The avatar's skin from its photos: the head's colour texture (each
 * photo's light taken out, the photos agreeing on one skin, its left and
 * right evened out where only the light could have made them differ), the
 * body's tinted to the face, and the head's roughness. The skin's colour is
 * read from the photos' own skin once their light is out, never from one
 * photo's cheeks.
 */

export type Picture = { data: Uint8Array | Uint8ClampedArray; width: number; height: number }

export type SkinInput = {
  base: BaseBody
  views: CaptureView[]
  /** Each view's solved camera. */
  cameras: Camera[]
  /** The fitted head's base mesh moves (baseMeshMoves). */
  moves: Float64Array
  /** The base body's pictures: head colour, body colour and head roughness. */
  head: Picture
  body: Picture
  roughness: Picture
  progress?: (fraction: number) => void
}

export type SkinOutput = {
  /** RGBA, each at its base picture's size. */
  head: Uint8ClampedArray
  body: Uint8ClampedArray
  roughness: Uint8ClampedArray
  /** The face's skin colour (linear RGB) with the light taken out. */
  albedo: [number, number, number]
  /**
   * What the photos' colours (linear, as shown) were scaled by to be the
   * texture's, the light's shading aside: their cast and exposure taken out.
   */
  gains: [number, number, number]
  /** The head's texels at the size the photos were laid at. */
  texels: Texels
  /** Per view, how well a smooth light explained its skin (r²). */
  lightFit: number[]
  /** How much of the head's texels a photo saw well. */
  photoShare: number
}

/** Texels per side the photos are laid at (the face island then holds ≈ 730 photo pixels across). */
const WORKING = 1024
/** How far (texels) each photo's weight eases in from its edges. */
const FEATHER = 5

/** How far (a share of the eyes' distance) a photo's skin and hair maps are softened. */
const MAP_SOFTEN = 0.025
/**
 * How far (a share of the eyes' distance, about 4 mm) from a photo's hair
 * its skin is not taken: hair's wisps and the shadow it casts lie on the
 * skin at its edge, which is neither the skin's colour nor a hairline.
 */
const HAIRLINE = 0.06

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** The distance between a view's irises (pixels), or a guess from its size without landmarks. */
function eyeDistance(view: CaptureView): number {
  const points = view.landmarks
  if (!points) return 0.08 * Math.max(view.width, view.height)
  return Math.hypot(
    points[468 * 2]! - points[473 * 2]!,
    points[468 * 2 + 1]! - points[473 * 2 + 1]!,
  )
}

/**
 * A photo's hair map (0–255) reaching `reach` pixels further onto the skin
 * around it: full on the hair, easing off to its own value `reach` away.
 */
export function hairline(
  hair: Uint8Array,
  width: number,
  height: number,
  reach: number,
): Uint8Array {
  const sure = new Uint8Array(hair.length)
  for (let i = 0; i < hair.length; i++) sure[i] = hair[i]! > 127 ? 1 : 0
  const distance = distanceTo(sure, width, height)
  const out = new Uint8Array(hair.length)
  for (let i = 0; i < hair.length; i++)
    out[i] = Math.max(hair[i]!, Math.round(255 * smooth(reach, 0.3 * reach, distance[i]!)))
  return out
}

/** A one-byte map blurred (a box `radius` out, twice: a tent). */
export function softPlane(
  plane: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  let from = Float32Array.from(plane)
  const span = 2 * radius + 1
  for (let pass = 0; pass < 2; pass++) {
    const across = new Float32Array(from.length)
    for (let y = 0; y < height; y++) {
      const row = y * width
      let sum = 0
      for (let x = -radius - 1; x < radius; x++)
        sum += from[row + Math.min(width - 1, Math.max(0, x))]!
      for (let x = 0; x < width; x++) {
        sum +=
          from[row + Math.min(width - 1, x + radius)]! -
          from[row + Math.min(width - 1, Math.max(0, x - radius - 1))]!
        across[row + x] = sum / span
      }
    }
    const down = new Float32Array(from.length)
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let y = -radius - 1; y < radius; y++)
        sum += across[Math.min(height - 1, Math.max(0, y)) * width + x]!
      for (let y = 0; y < height; y++) {
        sum +=
          across[Math.min(height - 1, y + radius) * width + x]! -
          across[Math.min(height - 1, Math.max(0, y - radius - 1)) * width + x]!
        down[y * width + x] = sum / span
      }
    }
    from = down
  }
  const out = new Uint8Array(plane.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(from[i]!)
  return out
}

export function skinTextures({
  base,
  views,
  cameras,
  moves,
  head,
  body,
  roughness,
  progress = () => {},
}: SkinInput): SkinOutput {
  const { headSkin } = base
  const positions = movedPositions(base, headSkin.primitive, moves)
  const mesh: UvMesh = {
    positions,
    normals: vertexNormals(positions, headSkin.mesh.triangles, positions.length / 3),
    uvs: headSkin.mesh.uvs,
    triangles: headSkin.mesh.triangles,
  }
  // What hides the head from a photo: the head and the neck and shoulders below it.
  const occluder = occluderMesh(base, moves)
  const texels = rasterizeUv(mesh, WORKING)
  const landmarkUv = landmarkUvs(base.head, headSkin.weld, headSkin.mesh.uvs)
  const features = texelFeatures(texels, landmarkUv)
  const lids = lidTexels(landmarkUv, WORKING, features.brows)
  const balance = whiteBalance(views)

  const projected: ProjectedView[] = []
  views.forEach((view, k) => {
    const camera = cameras[k]!
    const rgb = sceneRgb(view.rgba, view.width, view.height)
    for (let i = 0; i < rgb.length; i++) rgb[i] = rgb[i]! * balance[i % 3]!
    const classes =
      view.classes && view.classes.width === view.width && view.classes.height === view.height
        ? view.classes
        : null
    // The skin and hair maps are read pixel by pixel (and the segmenter's at a coarser size):
    // softened over a few pixels, where a photo stops follows the skin, not their stairs.
    const soften = Math.max(1, Math.round(MAP_SOFTEN * eyeDistance(view)))
    const seen = projectView(
      texels,
      features,
      {
        width: view.width,
        height: view.height,
        rgb,
        mask: view.mask,
        skin: view.skin && softPlane(view.skin, view.width, view.height, soften),
        hair:
          classes &&
          hairline(
            softPlane(classPlane(classes, 'hair'), view.width, view.height, soften),
            view.width,
            view.height,
            HAIRLINE * eyeDistance(view),
          ),
        openings: faceOpenings(view.landmarks, view.width, view.height),
      },
      camera,
      depthBuffer(occluder, camera),
    )
    if (eyesShut(view)) for (let i = 0; i < lids.length; i++) if (lids[i]) seen.weight[i] = 0
    featherWeights(seen.weight, texels, FEATHER)
    projected.push(seen)
    progress((0.5 * (k + 1)) / views.length)
  })
  // The front photo sets the scale the others' light and exposure are read against.
  const front = Math.max(
    0,
    views.findIndex((view) => view.slot === 'front'),
  )
  const delit = delightTogether(projected, texels, features, cameras, front)
  const shadings = delit.map((one) => one.shading)
  const lightFit = delit.map((one) => one.fit)
  // A smile or an open mouth stretches the lips over the teeth: they no longer lie where the
  // head's closed lips are, so such a photo gives the lips their colour, not their shape.
  const movedLips: number[][] = [[], [], []]
  projected.forEach((seen, k) => {
    const moved = mouthMoved(views[k]!)
    if (moved <= 0) return
    for (let i = 0; i < seen.weight.length; i++) {
      if (features.lips[i]! >= 0.8 && features.mouth[i]! <= 0.1 && seen.weight[i]! >= 0.5)
        for (let c = 0; c < 3; c++) movedLips[c]!.push(seen.color[i * 3 + c]!)
      seen.weight[i] = seen.weight[i]! * (1 - moved * features.around[i]!)
    }
  })
  progress(0.6)
  for (let k = 0; k < projected.length; k++) {
    if (k === front) continue
    matchExposure(projected[k]!, projected[front]!, features, {
      view: shadings[k]!,
      reference: shadings[front]!,
    })
  }
  const blended = blendViews(projected, WORKING * WORKING, shadings)
  // How lit the photos that saw each texel well saw it, at best.
  const lit = new Float32Array(WORKING * WORKING)
  projected.forEach((view, k) => {
    for (let i = 0; i < lit.length; i++) {
      const w = view.weight[i]!
      if (w > 0.2) lit[i] = Math.max(lit[i]!, litTrust(shadings[k]![i]!) * smooth(0.2, 0.5, w))
    }
  })
  projected.length = 0

  // The skin alone (no lips, brows or eyes), for what is measured of it.
  const plain = new Float32Array(WORKING * WORKING)
  for (let i = 0; i < plain.length; i++)
    plain[i] = texels.triangle[i]! >= 0 ? (1 - features.feature[i]!) * (1 - features.eye[i]!) : 0
  const trust = new Float32Array(plain.length)
  for (let i = 0; i < trust.length; i++) trust[i] = blended.weight[i]! * plain[i]!
  const read = cheekColour(blended.color, trust, texels, base.head.frame)
  const exposure = Math.min(
    exposureFromWhites(views[front]!, balance),
    read ? SKIN_CEILING / Math.max(1e-4, luminance(...read)) : Number.POSITIVE_INFINITY,
  )
  for (let i = 0; i < blended.color.length; i++) {
    const c = blended.color[i]! * exposure
    blended.color[i] = Math.max(c - SKIN_SHINE, SHINE_FLOOR * c)
  }
  const graph = surfaceGraph(mesh, headSkin.weld)
  const mirror = mirrorVertices(graph, base.basemesh)
  symmetrise(blended.color, trust, lit, texels, mesh, graph, mirror)
  mirrorFill(
    blended.color,
    blended.weight,
    mirrorTexels(texels, mesh, graph, mirror),
    skinLevels(blended.color, trust, texels, mesh, graph),
  )
  // What the mirror lent ends where its side was last seen well: eased in, as each photo's own edge is.
  featherWeights(blended.weight, texels, FEATHER)
  for (let i = 0; i < trust.length; i++) trust[i] = blended.weight[i]! * plain[i]!
  toneEars(blended.color, trust, blended.weight, texels, base.head.frame)
  const albedo = faceAlbedo(blended.color, trust, texels, base.head.frame)
  const cheeks = cheekColour(blended.color, trust, texels, base.head.frame) ?? albedo
  progress(0.75)

  // The skin carried on where no photo saw it.
  const vertexCount = positions.length / 3
  const vertexColor = new Float32Array(vertexCount * 3)
  const vertexWeight = new Float32Array(vertexCount)
  for (let v = 0; v < vertexCount; v++) {
    const x = Math.min(WORKING - 1, Math.max(0, Math.floor(mesh.uvs[v * 2]! * WORKING)))
    const y = Math.min(WORKING - 1, Math.max(0, Math.floor(mesh.uvs[v * 2 + 1]! * WORKING)))
    // The best-seen plain skin texel around the vertex.
    let best = -1
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = x + dx
        const py = y + dy
        if (px < 0 || py < 0 || px >= WORKING || py >= WORKING) continue
        const i = py * WORKING + px
        if (best < 0 || trust[i]! > trust[best]!) best = i
      }
    }
    if (best < 0) continue
    vertexWeight[v] = trust[best]!
    for (let k = 0; k < 3; k++) vertexColor[v * 3 + k] = blended.color[best * 3 + k]!
  }
  const fillColors = fillVertexColors(
    mesh,
    headSkin.weld,
    vertexColor,
    vertexWeight,
    edgeColour(graph, vertexColor, vertexWeight) ?? albedo,
  )
  const fill = rasterizeVertexColors(mesh, fillColors, WORKING)
  const inside = new Uint8Array(WORKING * WORKING)
  for (let i = 0; i < inside.length; i++) inside[i] = texels.triangle[i]! >= 0 ? 1 : 0
  bleed(fill, inside, WORKING, 3, 8)
  // The lips where no photo saw them (their inner side, rolled into the mouth): the lips' own
  // colour, darker inside, never the skin's nor the base's.
  const lip = lipColour(blended, features, movedLips)
  for (let i = 0; i < inside.length; i++) {
    const m = features.mouth[i]!
    const amount = Math.max(features.lips[i]!, m)
    if (amount <= 0) continue
    const shade = 1 - m + INNER_LIP * m
    for (let k = 0; k < 3; k++)
      fill[i * 3 + k] = fill[i * 3 + k]! * (1 - amount) + shade * lip[k]! * amount
  }
  const coverage = new Float32Array(WORKING * WORKING)
  for (let i = 0; i < coverage.length; i++)
    coverage[i] = blended.weight[i]! * (1 - features.eye[i]!) * (1 - features.mouth[i]!)
  bleed(coverage, inside, WORKING, 1, 8)
  const flat = Float32Array.from(features.mouth)
  bleed(flat, inside, WORKING, 1, 8)
  const seen = new Uint8Array(WORKING * WORKING)
  for (let i = 0; i < seen.length; i++) seen[i] = blended.weight[i]! > 0 ? 1 : 0
  bleed(blended.color, seen, WORKING, 3, 4)
  bleed(plain, inside, WORKING, 1, 8)
  const inner = innerIslands(base)
  progress(0.85)

  const islands = new Uint8Array(head.width * head.height)
  const xy = new Float32Array(mesh.uvs.length)
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    xy[i] = mesh.uvs[i]! * head.width
    xy[i + 1] = mesh.uvs[i + 1]! * head.height
  }
  fillTriangles(xy, mesh.triangles, head.width, head.height, islands, 1)
  const baseSkin = imageMedian(head.data, (i) => islands[i] === 1)
  const headPixels = composite({
    base: head.data,
    size: head.width,
    // Inside the mouth and the sockets is mucous membrane, which skin's melanin darkens only partly.
    gains: toneGains(baseSkin, albedo, 50).map(Math.sqrt) as [number, number, number],
    photo: blended.color,
    coverage,
    fill,
    working: WORKING,
    inner,
    plain,
    flat,
    islands,
  })
  const bodyPixels = toneBody(base, body, cheeks, moves)
  matchSeam(headPixels, head.width, bodyPixels, body.width, body.height, {
    base,
    mesh,
    graph,
    mirror,
    inside,
  })
  progress(1)

  let seenTexels = 0
  let skinTexels = 0
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue
    skinTexels++
    if (blended.weight[i]! > 0.5) seenTexels++
  }
  return {
    head: headPixels,
    body: bodyPixels,
    roughness: headRoughness(base, roughness, albedo, texels),
    albedo,
    gains: balance.map((g) => g * exposure) as [number, number, number],
    texels,
    lightFit,
    photoShare: skinTexels ? seenTexels / skinTexels : 0,
  }
}

/** How dark the inside of the lips is against their outside. */
const INNER_LIP = 0.55

/**
 * The lips' colour (linear): the median of their well-seen texels; else of
 * the lips the photos with a smile or an open mouth showed (`moved`, per
 * channel); else a plain red-brown.
 */
function lipColour(
  blended: ProjectedView,
  features: TexelFeatures,
  moved: number[][],
): [number, number, number] {
  const channels: number[][] = [[], [], []]
  for (let i = 0; i < blended.weight.length; i++) {
    if (features.lips[i]! < 0.8 || features.mouth[i]! > 0.1 || blended.weight[i]! < 0.5) continue
    for (let k = 0; k < 3; k++) channels[k]!.push(blended.color[i * 3 + k]!)
  }
  const found = channels[0]!.length >= 50 ? channels : moved[0]!.length >= 50 ? moved : null
  if (!found) return [0.3, 0.12, 0.1]
  return found.map((list) => median(list)) as [number, number, number]
}

/**
 * How far a photo's mouth has left the closed, resting one (0–1), by its
 * blendshapes: a smile, or the jaw dropped. None where MediaPipe found no
 * face (a profile).
 */
export function mouthMoved(view: CaptureView): number {
  const shapes = view.blendshapes
  if (!shapes) return 0
  const smile = Math.max(shapes.mouthSmileLeft ?? 0, shapes.mouthSmileRight ?? 0)
  return Math.max(smooth(0.25, 0.5, smile), smooth(0.12, 0.3, shapes.jawOpen ?? 0))
}

/** The head's skin and the body's (neck, shoulders) as they stand after `moves`: what hides the face from a camera. */
export function occluderMesh(base: BaseBody, moves: Float64Array): UvMesh {
  const positions: number[] = []
  const triangles: number[] = []
  base.primitives.forEach((p, index) => {
    if (p.material !== 'Head_Skin' && p.material !== 'Body_Skin') return
    const moved = movedPositions(base, index, moves)
    const offset = positions.length / 3
    for (let i = 0; i < moved.length; i++) positions.push(moved[i]!)
    for (const i of p.indices) triangles.push(i + offset)
  })
  const n = positions.length / 3
  return {
    positions: Float32Array.from(positions),
    normals: new Float32Array(n * 3),
    uvs: new Float32Array(n * 2),
    triangles: Uint32Array.from(triangles),
  }
}

/** Past this (a factor, either way) a cast's red or blue is the light's, not the scene's own colour. */
const CAST_LEEWAY = 1.08

/**
 * Per-channel gains (linear, brightness kept) taking out a colour cast the
 * camera left in: where the background (grey on average) and the whites of
 * the eyes both lean the same way, by the lesser lean, less the leeway a
 * warm wall or a creamy white has of its own. Usually none.
 */
export function whiteBalance(views: CaptureView[]): [number, number, number] {
  const background = [0, 0, 0]
  for (const view of views) {
    const size = view.width * view.height
    const ground =
      view.classes && view.classes.width === view.width && view.classes.height === view.height
        ? classPlane(view.classes, 'background')
        : null
    for (let i = 0; i < size; i += 3) {
      if (view.mask && view.mask[i]! > 25) continue
      if (ground && ground[i]! < 200) continue
      const r = srgbToLinear(view.rgba[i * 4]!)
      const g = srgbToLinear(view.rgba[i * 4 + 1]!)
      const b = srgbToLinear(view.rgba[i * 4 + 2]!)
      const low = Math.min(r, g, b)
      if (low < 0.02 || Math.max(r, g, b) > 4 * low) continue
      background[0] = background[0]! + r
      background[1] = background[1]! + g
      background[2] = background[2]! + b
    }
  }
  const whites = [0, 0, 0]
  for (const view of views) {
    const found = eyeWhites(view, null)
    if (!found) continue
    for (let k = 0; k < 3; k++) whites[k] = whites[k]! + found[k]!
  }
  const lean = (colour: number[], k: number) =>
    colour[1]! > 0 && colour[k]! > 0 ? Math.log(colour[k]! / colour[1]!) : 0
  const leeway = Math.log(CAST_LEEWAY)
  const gains: [number, number, number] = [1, 1, 1]
  for (const k of [0, 2]) {
    const a = lean(background, k)
    const b = lean(whites, k)
    if (a * b <= 0) continue
    const cast = Math.sign(a) * Math.max(0, Math.min(Math.abs(a), Math.abs(b)) - leeway)
    gains[k] = Math.exp(-cast)
  }
  const kept = luminance(gains[0], gains[1], gains[2])
  return gains.map((g) => g / kept) as [number, number, number]
}

/**
 * How bright (scene light, luminance) the whites of the eyes show in a
 * photo whose skin, its light taken out, holds its true colour: a photo's
 * own exposure and light level are read off its whites against this.
 */
const WHITE_REFERENCE = 0.41
/** The most the whites may brighten or darken the skin: past it they were more likely misread. */
const EXPOSURE_LIMIT = 1.8
/**
 * The most light the fairest cheek reflects (luminance, as albedo): under
 * half, as measured skin reflects at green. A photo whose whites could not
 * be read, or read too dark, never makes the skin brighter than that.
 */
const SKIN_CEILING = 0.45

/**
 * What skin's surface reflects of the light, colourless, as a share of it
 * (as albedo is): a photo holds it over the skin's own colour, and the
 * avatar's material reflects it again, so it is taken out of the colour —
 * on dark skin it is a good part of what the camera sees. No colour loses
 * more than half to it.
 */
const SKIN_SHINE = 0.015
const SHINE_FLOOR = 0.5

/**
 * What the skin's colours (in `view`'s exposure, the light taken out, its
 * colour cast `balance` taken out) are scaled by to be its own: the whites
 * of the eyes are about as white on everyone, so they say how bright the
 * photo's light was, which the light taken out of the skin cannot (a dim
 * photo of pale skin and a bright one of dark skin look alike). 1 where the
 * eyes are shut or too small to read.
 */
export function exposureFromWhites(
  view: CaptureView,
  balance: [number, number, number] = [1, 1, 1],
): number {
  if ((view.blink ?? 0) > 0.5) return 1
  const white = eyeWhites(view, balance)
  if (!white) return 1
  const scene = Float32Array.from(white)
  untoneNeutral(scene)
  const brightness = luminance(scene[0]!, scene[1]!, scene[2]!)
  if (!(brightness > 0)) return 1
  return Math.min(EXPOSURE_LIMIT, Math.max(1 / EXPOSURE_LIMIT, WHITE_REFERENCE / brightness))
}

/** Whites less saturated than this ((max − min) / max, their cast taken out) are white; more is lid, lash or iris. */
const WHITE_SATURATION = 0.25

/**
 * The whites of a view's eyes (linear RGB), or null where too little of
 * them shows: the pixels between the lids around each iris (clear of it).
 * With `balance` (the photo's cast, taken out first), only the near-grey
 * ones count, the lighter half less glints; without, whatever their colour
 * (a cast tints them too), the lightest third less glints.
 */
function eyeWhites(
  view: CaptureView,
  balance: [number, number, number] | null,
): [number, number, number] | null {
  const points = view.landmarks
  if (!points) return null
  const picked: [number, number, number][] = []
  for (const [e, eye] of EYE_RINGS.entries()) {
    const centre = e === 0 ? 473 : 468
    const cx = points[centre * 2]!
    const cy = points[centre * 2 + 1]!
    let radius = 0
    for (let r = 1; r <= 4; r++)
      radius += Math.hypot(points[(centre + r) * 2]! - cx, points[(centre + r) * 2 + 1]! - cy)
    radius /= 4
    // An iris a tenth of the photo wide or more is no iris: landmarks gone astray.
    if (!(radius >= 3 && radius < 0.1 * Math.max(view.width, view.height))) continue
    const polygon = eye.map((i) => [points[i * 2]!, points[i * 2 + 1]!] as const)
    for (let y = Math.floor(cy - 3 * radius); y <= cy + 3 * radius; y++) {
      for (let x = Math.floor(cx - 3 * radius); x <= cx + 3 * radius; x++) {
        if (x < 0 || y < 0 || x >= view.width || y >= view.height) continue
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if (d < 1.2 * radius || d > 3 * radius || !insidePolygon(polygon, x + 0.5, y + 0.5))
          continue
        const i = (y * view.width + x) * 4
        const c: [number, number, number] = [
          srgbToLinear(view.rgba[i]!),
          srgbToLinear(view.rgba[i + 1]!),
          srgbToLinear(view.rgba[i + 2]!),
        ]
        if (balance) {
          for (let k = 0; k < 3; k++) c[k] = c[k]! * balance[k]!
          // Judged as displayed (sRGB): in linear light a barely tinted white already reads as coloured.
          const shown = c.map(linearToSrgb)
          const high = Math.max(...shown)
          if (high - Math.min(...shown) > WHITE_SATURATION * high) continue
        }
        picked.push(c)
      }
    }
  }
  if (picked.length < 20) return null
  picked.sort((a, b) => luminance(...a) - luminance(...b))
  const from = balance ? 0.5 : 2 / 3
  const kept = picked.slice(Math.floor(picked.length * from), Math.ceil(picked.length * 0.9))
  const out: [number, number, number] = [0, 0, 0]
  for (const p of kept) for (let k = 0; k < 3; k++) out[k] = out[k]! + p[k]! / kept.length
  return out
}

function insidePolygon(polygon: readonly (readonly [number, number])[], x: number, y: number) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Each welded vertex's mirror (the one at (−x, y, z) at rest), −1 where none is within 4 mm. */
export function mirrorVertices(graph: SurfaceGraph, basemesh: Float32Array): Int32Array {
  const m = graph.keys.length
  const cell = 0.005
  const grid = new Map<string, number[]>()
  const at = (v: number) => graph.keys[v]! * 3
  for (let v = 0; v < m; v++) {
    const p = at(v)
    const key = `${Math.floor(basemesh[p]! / cell)},${Math.floor(basemesh[p + 1]! / cell)},${Math.floor(basemesh[p + 2]! / cell)}`
    const list = grid.get(key)
    if (list) list.push(v)
    else grid.set(key, [v])
  }
  const mirror = new Int32Array(m).fill(-1)
  for (let v = 0; v < m; v++) {
    const p = at(v)
    const x = -basemesh[p]!
    const y = basemesh[p + 1]!
    const z = basemesh[p + 2]!
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    const cz = Math.floor(z / cell)
    let nearest = 0.004
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const u of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const q = at(u)
            const d = Math.hypot(basemesh[q]! - x, basemesh[q + 1]! - y, basemesh[q + 2]! - z)
            if (d < nearest) {
              nearest = d
              mirror[v] = u
            }
          }
  }
  return mirror
}

/**
 * Each texel's mirror across the face's midline (its index, −1 where there
 * is none): its triangle's corners mirrored, and the same blend of their
 * places in the texture — so a brow maps onto the other brow and an ear
 * onto the other ear, whichever way the mesh's quads were split.
 */
export function mirrorTexels(
  texels: Texels,
  mesh: UvMesh,
  graph: SurfaceGraph,
  mirror: Int32Array,
): Int32Array {
  const { size } = texels
  const uv = mesh.uvs
  // Every copy (across UV seams) of each welded vertex.
  const copies: number[][] = Array.from({ length: graph.keys.length }, () => [])
  for (let v = 0; v < graph.local.length; v++) copies[graph.local[v]!]!.push(v)
  const tris = mesh.triangles
  const near = (v: number, to: number) =>
    Math.hypot(uv[v * 2]! - uv[to * 2]!, uv[v * 2 + 1]! - uv[to * 2 + 1]!)
  const triangleArea = (a: number, b: number, c: number) =>
    (uv[b * 2]! - uv[a * 2]!) * (uv[c * 2 + 1]! - uv[a * 2 + 1]!) -
    (uv[b * 2 + 1]! - uv[a * 2 + 1]!) * (uv[c * 2]! - uv[a * 2]!)
  // Each triangle's corners' mirrors (the first −1 where it has none).
  const picks = new Int32Array(tris.length).fill(-1)
  for (let t = 0; t < tris.length / 3; t++) {
    let ok = true
    for (let k = 0; k < 3 && ok; k++) {
      const m = mirror[graph.local[tris[t * 3 + k]!]!]!
      ok = m >= 0
      if (!ok) break
      // The copy nearest the first corner's in the texture: the same island.
      const options = copies[m]!
      let best = options[0]!
      if (k > 0)
        for (const option of options)
          if (near(option, picks[t * 3]!) < near(best, picks[t * 3]!)) best = option
      picks[t * 3 + k] = best
    }
    const area = triangleArea(tris[t * 3]!, tris[t * 3 + 1]!, tris[t * 3 + 2]!)
    // Corners mirrored onto different islands (a seam there): no mirror.
    if (
      !ok ||
      Math.abs(area) < 1e-14 ||
      Math.abs(triangleArea(picks[t * 3]!, picks[t * 3 + 1]!, picks[t * 3 + 2]!)) >
        4 * Math.abs(area)
    )
      picks[t * 3] = -1
  }
  const out = new Int32Array(size * size).fill(-1)
  for (let i = 0; i < out.length; i++) {
    const t = texels.triangle[i]!
    if (t < 0 || picks[t * 3]! < 0) continue
    const a = tris[t * 3]!
    const b = tris[t * 3 + 1]!
    const c = tris[t * 3 + 2]!
    const pa = picks[t * 3]!
    const pb = picks[t * 3 + 1]!
    const pc = picks[t * 3 + 2]!
    const ax = uv[a * 2]!
    const ay = uv[a * 2 + 1]!
    const area = triangleArea(a, b, c)
    const px = ((i % size) + 0.5) / size
    const py = (Math.floor(i / size) + 0.5) / size
    const wb = ((px - ax) * (uv[c * 2 + 1]! - ay) - (py - ay) * (uv[c * 2]! - ax)) / area
    const wc = ((uv[b * 2]! - ax) * (py - ay) - (uv[b * 2 + 1]! - ay) * (px - ax)) / area
    const wa = 1 - wb - wc
    const u = wa * uv[pa * 2]! + wb * uv[pb * 2]! + wc * uv[pc * 2]!
    const v = wa * uv[pa * 2 + 1]! + wb * uv[pb * 2 + 1]! + wc * uv[pc * 2 + 1]!
    const x = Math.min(size - 1, Math.max(0, Math.floor(u * size)))
    const y = Math.min(size - 1, Math.max(0, Math.floor(v * size)))
    out[i] = y * size + x
  }
  return out
}

/** How far (rounds of averaging with the neighbours: a few centimetres) the light's left–right difference is read. */
const SYMMETRY_ROUNDS = 4
/** The most either side is brightened or darkened to meet the other. */
const SYMMETRY_LIMIT = Math.log(2.2)

/**
 * Evens out the skin's left and right where only the light could have made
 * them differ (in place): the colour's broad course over the head (each
 * channel's log, averaged over a few centimetres of the surface) against
 * the same at the mirrored place, each side moved towards the other — by
 * half when the photos saw both alike lit, nearly all the way when one side
 * was in shadow in every photo (`lit`: 0–1, how lit the best photos saw a
 * texel) and the other lit. Fine detail — a mole, a scar, one brow higher —
 * is left as it is.
 */
export function symmetrise(
  color: Float32Array,
  trust: Float32Array,
  lit: Float32Array,
  texels: Texels,
  mesh: UvMesh,
  graph: SurfaceGraph,
  mirror: Int32Array,
) {
  const m = graph.keys.length
  // Each texel's log colour and how lit it was onto its triangle's corners, with its weight:
  // smoothed together (a normalised convolution).
  const field = new Float64Array(m * 5)
  for (let i = 0; i < trust.length; i++) {
    const w = trust[i]!
    const t = texels.triangle[i]!
    if (w <= 0.05 || t < 0) continue
    for (let c = 0; c < 3; c++) {
      const v = graph.local[mesh.triangles[t * 3 + c]!]!
      for (let k = 0; k < 3; k++)
        field[v * 5 + k] = field[v * 5 + k]! + w * Math.log(Math.max(1e-4, color[i * 3 + k]!))
      field[v * 5 + 3] = field[v * 5 + 3]! + w
      field[v * 5 + 4] = field[v * 5 + 4]! + w * lit[i]!
    }
  }
  smoothOnGraph(graph, field, 5, SYMMETRY_ROUNDS)
  const strong = median(Array.from({ length: m }, (_, v) => field[v * 5 + 3]!).filter((w) => w > 0))
  const welded = new Float32Array(m * 3).fill(1)
  for (let v = 0; v < m; v++) {
    const u = mirror[v]!
    if (u < 0) continue
    const sure = Math.min(field[v * 5 + 3]!, field[u * 5 + 3]!) / Math.max(strong, 1e-9)
    const amount = smooth(0.1, 0.5, sure)
    if (amount <= 0) continue
    const litOwn = (field[v * 5 + 4]! / field[v * 5 + 3]!) ** 2
    const litOther = (field[u * 5 + 4]! / field[u * 5 + 3]!) ** 2
    const lean = litOwn + litOther > 0 ? litOther / (litOwn + litOther) : 0.5
    for (let k = 0; k < 3; k++) {
      const own = field[v * 5 + k]! / field[v * 5 + 3]!
      const other = field[u * 5 + k]! / field[u * 5 + 3]!
      const shift = Math.min(SYMMETRY_LIMIT, Math.max(-SYMMETRY_LIMIT, lean * (other - own)))
      welded[v * 3 + k] = Math.exp(shift * amount)
    }
  }
  const n = mesh.positions.length / 3
  const factor = new Float32Array(n * 3)
  for (let v = 0; v < n; v++)
    for (let k = 0; k < 3; k++) factor[v * 3 + k] = welded[graph.local[v]! * 3 + k]!
  const scale = rasterizeVertexColors(mesh, factor, texels.size)
  for (let i = 0; i < texels.triangle.length; i++) {
    if (texels.triangle[i]! < 0) continue
    for (let k = 0; k < 3; k++) color[i * 3 + k] = color[i * 3 + k]! * scale[i * 3 + k]!
  }
}

/** How much a mirrored texel is trusted against one a photo saw there itself. */
const MIRROR_TRUST = 0.85

/** How far (rounds of averaging with the neighbours: about a centimetre) a texel's surroundings are read for `skinLevels`. */
const LEVEL_ROUNDS = 8

/**
 * Each texel's surroundings' colour (the log of each channel, 3 per texel),
 * from the texels `trust` says were seen, averaged over about a centimetre
 * of the head across its UV seams; NaN where nothing seen is near.
 */
export function skinLevels(
  color: Float32Array,
  trust: Float32Array,
  texels: Texels,
  mesh: UvMesh,
  graph: SurfaceGraph,
): Float32Array {
  const m = graph.keys.length
  const field = new Float64Array(m * 4)
  for (let i = 0; i < trust.length; i++) {
    const w = trust[i]!
    const t = texels.triangle[i]!
    if (w < 0.5 || t < 0) continue
    for (let c = 0; c < 3; c++) {
      const v = graph.local[mesh.triangles[t * 3 + c]!]!
      for (let k = 0; k < 3; k++)
        field[v * 4 + k] = field[v * 4 + k]! + w * Math.log(Math.max(1e-4, color[i * 3 + k]!))
      field[v * 4 + 3] = field[v * 4 + 3]! + w
    }
  }
  smoothOnGraph(graph, field, 4, LEVEL_ROUNDS)
  const n = mesh.positions.length / 3
  const sums = new Float32Array(n * 3)
  const weights = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) {
    const w = graph.local[v]!
    for (let k = 0; k < 3; k++) {
      sums[v * 3 + k] = field[w * 4 + k]!
      weights[v * 3 + k] = field[w * 4 + 3]!
    }
  }
  const sum = rasterizeVertexColors(mesh, sums, texels.size)
  const total = rasterizeVertexColors(mesh, weights, texels.size)
  const out = new Float32Array(sum.length).fill(Number.NaN)
  for (let i = 0; i < out.length; i++) if (total[i]! > 1e-6) out[i] = sum[i]! / total[i]!
  return out
}

/** The most a mirrored colour is brightened or darkened to its new surroundings. */
const MIRROR_MATCH = 2

/**
 * Where no photo saw one side (hair over a temple, a brow or an ear) but
 * they saw its mirror well, that side takes its mirror's colour (in place):
 * the two weighed by how well each was seen, so a texel no photo saw (its
 * colour nothing) takes its mirror's whole, never a darkened share of it.
 * With `levels` (skinLevels), what is taken is the mirror's detail on this
 * side's own colour: a gap in the shadowed side of a face is not filled
 * with the lit side's brightness.
 */
export function mirrorFill(
  color: Float32Array,
  weight: Float32Array,
  mirrored: Int32Array,
  levels?: Float32Array,
) {
  const before = Float32Array.from(weight)
  const source = Float32Array.from(color)
  for (let i = 0; i < mirrored.length; i++) {
    const j = mirrored[i]!
    if (j < 0) continue
    const own = before[i]!
    const lent = MIRROR_TRUST * before[j]! * smooth(0.35, 0.1, own) * smooth(0.6, 0.9, before[j]!)
    if (lent <= 0) continue
    for (let k = 0; k < 3; k++) {
      const shift = levels ? levels[i * 3 + k]! - levels[j * 3 + k]! : 0
      const match = Number.isFinite(shift)
        ? Math.min(MIRROR_MATCH, Math.max(1 / MIRROR_MATCH, Math.exp(shift)))
        : 1
      color[i * 3 + k] =
        (own * source[i * 3 + k]! + lent * source[j * 3 + k]! * match) / (own + lent)
    }
    weight[i] = Math.max(own, lent)
  }
}

/**
 * Roughness added (0–1) to the base's (0.59 on its skin, less on the lips):
 * the face to about 0.72, the forehead a little more, the ears most, and
 * dark skin a little more again, whose sheen shows most against it.
 */
const FACE_ROUGHNESS = 0.13
const FOREHEAD_ROUGHNESS = 0.15
const EAR_ROUGHNESS = 0.23
const DARK_ROUGHNESS = 0.04

/** The body's roughness (it has no map): the head's face's, so the neck shows no change of gloss. */
const BODY_ROUGHNESS = 0.72

/** The avatar file's skin materials as the skin here is made for them (by material name). */
export const SKIN_MATERIAL_EDITS: Record<string, (material: GltfJson) => void> = {
  Body_Skin: (material) => {
    material.pbrMetallicRoughness = {
      ...material.pbrMetallicRoughness,
      roughnessFactor: BODY_ROUGHNESS,
    }
  },
}

/**
 * The head's roughness (its green channel; red is how much a texel is
 * skin): the base's raised everywhere, the lips keeping their gloss over
 * the skin, the ears and the forehead duller still (thin, dry skin, not
 * the wet plastic a uniform gloss makes of them). Regions are found on the
 * head at rest.
 */
export function headRoughness(
  base: BaseBody,
  roughness: Picture,
  albedo: [number, number, number],
  laid?: Texels,
): Uint8ClampedArray {
  const out = Uint8ClampedArray.from(roughness.data)
  const { width, height } = roughness
  if (width !== height) return out
  const texels = laid?.size === width ? laid : rasterizeUv(base.headSkin.mesh, width)
  const { frame } = base.head
  const dark = DARK_ROUGHNESS * smooth(0.12, 0.04, luminance(...albedo))
  for (let i = 0; i < width * height; i++) {
    if (texels.triangle[i]! < 0) continue
    const y = texels.position[i * 3 + 1]! - frame.eyes[1]
    const z = texels.position[i * 3 + 2]!
    const ear = earShare(texels, i, frame)
    const forehead = smooth(frame.earZ, frame.earZ + 0.02, z) * smooth(0.02, 0.035, y)
    const raised = FACE_ROUGHNESS + (FOREHEAD_ROUGHNESS - FACE_ROUGHNESS) * forehead
    const added = raised + (EAR_ROUGHNESS - raised) * ear + dark
    out[i * 4 + 1] = Math.min(255, Math.round(out[i * 4 + 1]! + 255 * added))
  }
  return out
}

type HeadFrame = BaseBody['head']['frame']

/** How much a texel is ear (0–1), by where it sits on the head: beside it, behind the face, from the jaw to the brows. */
function earShare(texels: Texels, i: number, { eyes, earZ, eyeDistance }: HeadFrame): number {
  const x = Math.abs(texels.position[i * 3]! - eyes[0])
  const y = texels.position[i * 3 + 1]! - eyes[1]
  const z = texels.position[i * 3 + 2]!
  return (
    smooth(0.95 * eyeDistance, 1.08 * eyeDistance, x) *
    smooth(earZ + 0.01, earZ - 0.005, z) *
    smooth(-0.07, -0.055, y) *
    smooth(0.03, 0.015, y)
  )
}

/**
 * The ears brought to the cheek just ahead of them (in place): each ear's
 * colour (its median) made that of the skin there, which the photos see
 * far better, its own detail kept. Seen nearly edge on and shaded in their
 * own folds, the ears come out of the photos too light, too dark or too
 * pink.
 */
export function toneEars(
  color: Float32Array,
  trust: Float32Array,
  weight: Float32Array,
  texels: Texels,
  frame: HeadFrame,
) {
  const { eyes, earZ, eyeDistance } = frame
  for (const side of [-1, 1]) {
    const band: number[][] = [[], [], []]
    const ear: number[][] = [[], [], []]
    const onSide = (i: number) => Math.sign(texels.position[i * 3]! - eyes[0]) === side
    for (let i = 0; i < trust.length; i++) {
      if (texels.triangle[i]! < 0 || !onSide(i)) continue
      const x = Math.abs(texels.position[i * 3]! - eyes[0])
      const y = texels.position[i * 3 + 1]! - eyes[1]
      const z = texels.position[i * 3 + 2]!
      const cheek =
        trust[i]! > 0.5 &&
        x > 0.75 * eyeDistance &&
        x < 0.95 * eyeDistance &&
        z > earZ + 0.01 &&
        z < earZ + 0.04 &&
        y > -0.06 &&
        y < -0.01
      const list = cheek ? band : weight[i]! > 0 && earShare(texels, i, frame) > 0.5 ? ear : null
      if (list) for (let k = 0; k < 3; k++) list[k]!.push(color[i * 3 + k]!)
    }
    if (band[0]!.length < 50 || ear[0]!.length < 50) continue
    const gains = [0, 1, 2].map((k) =>
      Math.min(
        EAR_TONE_LIMIT,
        Math.max(1 / EAR_TONE_LIMIT, median(band[k]!) / Math.max(1e-4, median(ear[k]!))),
      ),
    )
    for (let i = 0; i < trust.length; i++) {
      if (texels.triangle[i]! < 0 || !onSide(i)) continue
      const share = earShare(texels, i, frame)
      if (share <= 0) continue
      for (let k = 0; k < 3; k++) color[i * 3 + k] = color[i * 3 + k]! * gains[k]! ** share
    }
  }
}

/** The most an ear's colour is scaled, either way, to meet the cheek's. */
const EAR_TONE_LIMIT = 2.5

/** How far up the head (m) its texture is brought to the body's where the two meet at the neck. */
const SEAM_REACH = 0.03

/**
 * The head's texture brought to the body's where they meet (in place): at
 * each vertex the two share, the body's colour over the head's, smoothed
 * along the seam, then eased out up the head over `SEAM_REACH`, so the
 * neck shows no line, only the head's own detail.
 */
export function matchSeam(
  headPixels: Uint8ClampedArray,
  headSize: number,
  bodyPixels: Uint8ClampedArray,
  bodyWidth: number,
  bodyHeight: number,
  {
    base,
    mesh,
    graph,
    mirror,
    inside,
  }: {
    base: BaseBody
    mesh: UvMesh
    graph: SurfaceGraph
    mirror: Int32Array
    /** Which texels (working size) the head's triangles cover. */
    inside: Uint8Array
  },
) {
  const bodyPrimitive = base.primitives.find((p) => p.material === 'Body_Skin')
  const bodyMh = bodyPrimitive?.attributes._MHVERT?.values
  const bodyUv = bodyPrimitive?.attributes.TEXCOORD_0?.values
  if (!bodyMh || !bodyUv) return
  const bodyAt = new Map<number, number>()
  for (let i = 0; i < bodyMh.length; i++) bodyAt.set(bodyMh[i]!, i)
  const m = graph.keys.length
  const sample = (
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    u: number,
    v: number,
  ) => {
    const cx = Math.floor(u * width)
    const cy = Math.floor(v * height)
    const out = [0, 0, 0]
    let count = 0
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.min(width - 1, Math.max(0, cx + dx))
        const y = Math.min(height - 1, Math.max(0, cy + dy))
        for (let k = 0; k < 3; k++)
          out[k] = out[k]! + srgbToLinear(pixels[(y * width + x) * 4 + k]!)
        count++
      }
    return out.map((c) => c / count)
  }
  const ratio = new Float64Array(m * 3)
  const onSeam = new Uint8Array(m)
  const heads = new Float64Array(m * 4)
  for (let v = 0; v < mesh.uvs.length / 2; v++) {
    const w = graph.local[v]!
    if (!bodyAt.has(graph.keys[w]!)) continue
    const c = sample(headPixels, headSize, headSize, mesh.uvs[v * 2]!, mesh.uvs[v * 2 + 1]!)
    for (let k = 0; k < 3; k++) heads[w * 4 + k] = heads[w * 4 + k]! + c[k]!
    heads[w * 4 + 3] = heads[w * 4 + 3]! + 1
  }
  for (let w = 0; w < m; w++) {
    const b = bodyAt.get(graph.keys[w]!)
    if (b === undefined || !heads[w * 4 + 3]) continue
    const c = sample(bodyPixels, bodyWidth, bodyHeight, bodyUv[b * 2]!, bodyUv[b * 2 + 1]!)
    onSeam[w] = 1
    for (let k = 0; k < 3; k++) {
      const own = heads[w * 4 + k]! / heads[w * 4 + 3]!
      ratio[w * 3 + k] = Math.log(Math.max(1e-4, c[k]!) / Math.max(1e-4, own))
    }
  }
  // The same either side of the neck (the body's texture is not quite symmetric, and the face
  // has just been made so), then smoothed along the seam alone.
  const next = new Float64Array(ratio)
  for (let w = 0; w < m; w++) {
    const u = mirror[w]!
    if (!onSeam[w] || u < 0 || !onSeam[u]) continue
    for (let k = 0; k < 3; k++) next[w * 3 + k] = 0.5 * (ratio[w * 3 + k]! + ratio[u * 3 + k]!)
  }
  ratio.set(next)
  for (let round = 0; round < 8; round++) {
    for (let w = 0; w < m; w++) {
      if (!onSeam[w]) continue
      let count = 1
      const sums = [ratio[w * 3]!, ratio[w * 3 + 1]!, ratio[w * 3 + 2]!]
      for (let e = graph.start[w]!; e < graph.start[w + 1]!; e++) {
        const u = graph.next[e]!
        if (!onSeam[u]) continue
        count++
        for (let k = 0; k < 3; k++) sums[k] = sums[k]! + ratio[u * 3 + k]!
      }
      for (let k = 0; k < 3; k++) next[w * 3 + k] = sums[k]! / count
    }
    ratio.set(next)
  }
  const { source, distance } = nearestSeed(graph, (w) => onSeam[w] === 1)
  const n = mesh.positions.length / 3
  const factor = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) {
    const w = graph.local[v]!
    const s = source[w]!
    const ease = s < 0 ? 0 : 1 - smooth(0, SEAM_REACH, distance[w]!)
    for (let k = 0; k < 3; k++) factor[v * 3 + k] = s < 0 ? 0 : ratio[s * 3 + k]! * ease
  }
  const field = rasterizeVertexColors(mesh, factor, WORKING)
  bleed(field, inside, WORKING, 3, 6)
  for (let y = 0; y < headSize; y++) {
    for (let x = 0; x < headSize; x++) {
      const i = y * headSize + x
      const fx = Math.min(WORKING - 1, Math.floor(((x + 0.5) / headSize) * WORKING))
      const fy = Math.min(WORKING - 1, Math.floor(((y + 0.5) / headSize) * WORKING))
      const j = fy * WORKING + fx
      for (let k = 0; k < 3; k++) {
        const shift = field[j * 3 + k]!
        if (shift === 0) continue
        headPixels[i * 4 + k] = linearToSrgb(srgbToLinear(headPixels[i * 4 + k]!) * Math.exp(shift))
      }
    }
  }
}

/** The face's skin colour: the median, per channel, of its plain skin the photos saw well (cheeks, forehead, chin). */
function faceAlbedo(
  color: Float32Array,
  trust: Float32Array,
  texels: Texels,
  frame: BaseBody['head']['frame'],
): [number, number, number] {
  const channels: number[][] = [[], [], []]
  for (let i = 0; i < trust.length; i++) {
    if (trust[i]! < 0.6) continue
    const y = texels.position[i * 3 + 1]!
    const z = texels.position[i * 3 + 2]!
    if (z < frame.earZ + 0.02 || y < frame.chinY || y > frame.eyes[1] + 0.06) continue
    for (let k = 0; k < 3; k++) channels[k]!.push(color[i * 3 + k]!)
  }
  if (channels[0]!.length < 500) return [0.45, 0.3, 0.22]
  return channels.map((list) => median(list)) as [number, number, number]
}

/**
 * The cheeks' colour (the median of their plain skin the photos saw well),
 * or null where too little was seen: the face's own skin colour, which the
 * neck and the body are brought to (the face's median takes in the nose,
 * the chin and the brow, lighter and yellower than the skin around them).
 */
function cheekColour(
  color: Float32Array,
  trust: Float32Array,
  texels: Texels,
  { eyes, eyeDistance, earZ }: HeadFrame,
): [number, number, number] | null {
  const channels: number[][] = [[], [], []]
  for (let i = 0; i < trust.length; i++) {
    if (trust[i]! < 0.6) continue
    const x = Math.abs(texels.position[i * 3]! - eyes[0])
    const y = texels.position[i * 3 + 1]! - eyes[1]
    const z = texels.position[i * 3 + 2]!
    if (x < 0.35 * eyeDistance || x > 0.95 * eyeDistance || y < -0.065 || y > -0.015) continue
    if (z < earZ + 0.02) continue
    for (let k = 0; k < 3; k++) channels[k]!.push(color[i * 3 + k]!)
  }
  if (channels[0]!.length < 500) return null
  return channels.map((list) => median(list)) as [number, number, number]
}

/** The head texture's islands inside the head (the mouth and the eye sockets), where the base is kept toned, at the working size. */
function innerIslands(base: BaseBody): Float32Array {
  const out = new Float32Array(WORKING * WORKING)
  for (const name of ['mouth', 'sockets']) {
    const box = base.meta.headUV.boxes[name]
    if (!box) continue
    // The boxes are v up (Blender's); the texture's rows run down.
    const [u0, v0, u1, v1] = box
    for (let y = Math.floor((1 - v1) * WORKING); y < Math.ceil((1 - v0) * WORKING); y++)
      for (let x = Math.floor(u0 * WORKING); x < Math.ceil(u1 * WORKING); x++)
        if (x >= 0 && y >= 0 && x < WORKING && y < WORKING) out[y * WORKING + x] = 1
  }
  return out
}

/** Median linear colour of an RGBA image's pixels that `use` picks (every third pixel: plenty). */
function imageMedian(
  data: ArrayLike<number>,
  use: (i: number) => boolean,
): [number, number, number] {
  // Counted by byte: sRGB to linear keeps their order, so the median byte's light is the median light.
  const counts = new Uint32Array(3 * 256)
  let picked = 0
  for (let i = 0; i < data.length / 4; i += 3) {
    if (!use(i)) continue
    picked++
    for (let k = 0; k < 3; k++) counts[k * 256 + data[i * 4 + k]!]!++
  }
  if (!picked) return [0.3, 0.3, 0.3]
  return [0, 1, 2].map((k) => {
    let seen = 0
    for (let b = 0; b < 256; b++) {
      seen += counts[k * 256 + b]!
      if (seen > Math.floor(picked / 2)) return srgbToLinear(b)
    }
    return srgbToLinear(255)
  }) as [number, number, number]
}

/** Where the body's texture is the neck, taken to the face's colour on its own (m under the chin): wholly above the first, not below the second. */
const NECK_TOP = 0.07
const NECK_FOOT = 0.17

/**
 * The body's colour texture in the face's tone (`albedo`): the neck brought
 * to it by the front of the neck's own colour (the base's neck is lighter
 * and yellower than the rest of its skin), the rest of the body by the skin's
 * median, the two eased into each other down to the chest — so the face,
 * the neck and the body are one skin.
 */
export function toneBody(
  base: BaseBody,
  body: Picture,
  albedo: [number, number, number],
  moves: Float64Array,
): Uint8ClampedArray {
  const index = base.primitives.findIndex((one) => one.material === 'Body_Skin')
  const p = base.primitives[index]
  const out = new Uint8ClampedArray(body.data.length)
  const { width, height } = body
  if (!p?.attributes.TEXCOORD_0) {
    const gains = toneGains(
      imageMedian(body.data, () => true),
      albedo,
      50,
    )
    for (let i = 0; i < body.data.length; i += 4) {
      for (let k = 0; k < 3; k++)
        out[i + k] = linearToSrgb(srgbToLinear(body.data[i + k]!) * gains[k]!)
      out[i + 3] = body.data[i + 3]!
    }
    return out
  }
  const uv = p.attributes.TEXCOORD_0.values
  const positions = movedPositions(base, index, moves)
  const { chinY, eyes } = base.head.frame
  const neckness = new Float32Array(uv.length / 2)
  const throat = new Float32Array(uv.length / 2)
  for (let v = 0; v < neckness.length; v++) {
    const y = positions[v * 3 + 1]!
    neckness[v] = smooth(chinY - NECK_FOOT, chinY - NECK_TOP, y)
    throat[v] =
      y < chinY - 0.015 && y > chinY - 0.075 && positions[v * 3 + 2]! > eyes[2] - 0.08 ? 1 : 0
  }
  // Each texel the body's skin covers (1), how much of it is neck, and whether it is the front of the neck.
  const skin = new Uint8Array(width * height)
  const neck = new Float32Array(width * height)
  const front = new Uint8Array(width * height)
  for (let t = 0; t < p.indices.length; t += 3) {
    const [a, b, c] = [p.indices[t]!, p.indices[t + 1]!, p.indices[t + 2]!]
    rasterTriangle(
      uv[a * 2]! * width,
      uv[a * 2 + 1]! * height,
      uv[b * 2]! * width,
      uv[b * 2 + 1]! * height,
      uv[c * 2]! * width,
      uv[c * 2 + 1]! * height,
      width,
      height,
      (pixel, w0, w1, w2) => {
        skin[pixel] = 1
        neck[pixel] = w0 * neckness[a]! + w1 * neckness[b]! + w2 * neckness[c]!
        front[pixel] = w0 * throat[a]! + w1 * throat[b]! + w2 * throat[c]! > 0.5 ? 1 : 0
      },
    )
  }
  const bodyGains = toneGains(
    imageMedian(body.data, (i) => skin[i] === 1 && neck[i]! < 0.5),
    albedo,
    50,
  )
  const neckGains = toneGains(
    imageMedian(body.data, (i) => front[i] === 1),
    albedo,
    50,
  )
  for (let i = 0; i < width * height; i++) {
    const n = neck[i]!
    for (let k = 0; k < 3; k++) {
      const gain = Math.exp(n * Math.log(neckGains[k]!) + (1 - n) * Math.log(bodyGains[k]!))
      out[i * 4 + k] = linearToSrgb(srgbToLinear(body.data[i * 4 + k]!) * gain)
    }
    out[i * 4 + 3] = body.data[i * 4 + 3]!
  }
  return out
}

export type { TexelFeatures }
