import type { StudioFilterId } from './stage-contract'

/**
 * The studio's photo filters: a CSS filter on the canvas, and overlays
 * drawn over it (a colour wash, film grain, a vignette). The live view
 * draws them in the page; a snapshot draws the same on a 2D canvas, so it
 * comes out as the stage looked.
 */

export type Overlay =
  /** Darkens towards the edges, round the free room's middle. */
  | { kind: 'vignette'; strength: number }
  /** A wash of colour (a gradient at `angle`° as CSS has them, or one colour), soft-light blended. */
  | { kind: 'tint'; colors: readonly string[]; angle: number; blend: 'soft-light' }
  /** Film grain: a noise tile, overlay blended. */
  | { kind: 'grain'; opacity: number }

export type StudioFilter = { css: string; overlays: readonly Overlay[] }

export const STUDIO_FILTER: Readonly<Record<StudioFilterId, StudioFilter>> = {
  realistic: { css: 'none', overlays: [] },
  mono: {
    css: 'grayscale(1) contrast(1.18) brightness(1.03)',
    overlays: [
      { kind: 'grain', opacity: 0.1 },
      { kind: 'vignette', strength: 0.35 },
    ],
  },
  sunset: {
    css: 'sepia(0.2) saturate(1.25) hue-rotate(-8deg) brightness(1.04)',
    overlays: [
      {
        kind: 'tint',
        colors: ['rgba(255,150,70,0.30)', 'rgba(130,70,170,0.18)'],
        angle: 160,
        blend: 'soft-light',
      },
      { kind: 'vignette', strength: 0.25 },
    ],
  },
  vintage: {
    css: 'sepia(0.45) saturate(0.8) contrast(0.92) brightness(1.06)',
    overlays: [
      { kind: 'tint', colors: ['rgba(255,228,190,0.14)'], angle: 180, blend: 'soft-light' },
      { kind: 'grain', opacity: 0.14 },
      { kind: 'vignette', strength: 0.45 },
    ],
  },
  cinema: {
    css: 'contrast(1.12) saturate(0.88) brightness(0.97)',
    overlays: [
      {
        kind: 'tint',
        colors: ['rgba(0,95,115,0.20)', 'rgba(255,160,90,0.14)'],
        angle: 180,
        blend: 'soft-light',
      },
      { kind: 'vignette', strength: 0.4 },
    ],
  },
  crush: {
    css: 'contrast(1.38) saturate(1.3) brightness(0.93)',
    overlays: [{ kind: 'vignette', strength: 0.3 }],
  },
}

const FUNCTIONS = [
  'grayscale',
  'sepia',
  'saturate',
  'hue-rotate',
  'brightness',
  'contrast',
] as const
export type FilterFunction = { name: (typeof FUNCTIONS)[number]; amount: number }

/** A CSS filter's functions, amounts as numbers (percentages as fractions, hue turns in degrees). */
export function parseFilter(css: string): FilterFunction[] {
  const text = css.trim()
  if (text === 'none' || text === '') return []
  const functions: FilterFunction[] = []
  const pattern = /([a-z-]+)\(\s*(-?[\d.]+)(%|deg)?\s*\)/gy
  let rest = text
  while (rest.length > 0) {
    pattern.lastIndex = 0
    const match = pattern.exec(rest)
    if (!match) throw new Error(`filter: can't read "${rest}"`)
    const name = match[1] as FilterFunction['name']
    if (!FUNCTIONS.includes(name)) throw new Error(`filter: no ${name}`)
    const unit = match[3]
    if ((name === 'hue-rotate') !== (unit === 'deg')) throw new Error(`filter: ${match[0]}`)
    const value = Number(match[2])
    functions.push({ name, amount: unit === '%' ? value / 100 : value })
    rest = rest.slice(match[0].length).trimStart()
  }
  return functions
}

/** A colour matrix, row by row: four rows (r, g, b, a) of five (the four channels and an offset, in 0–1). */
export type ColorMatrix = number[]

export const IDENTITY_MATRIX: ColorMatrix = [
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
]

const rgb = (m: readonly number[], offset = 0): ColorMatrix => [
  m[0]!,
  m[1]!,
  m[2]!,
  0,
  offset,
  m[3]!,
  m[4]!,
  m[5]!,
  0,
  offset,
  m[6]!,
  m[7]!,
  m[8]!,
  0,
  offset,
  0,
  0,
  0,
  1,
  0,
]

/** One filter function's matrix, by the Filter Effects formulas. */
export function functionMatrix({ name, amount }: FilterFunction): ColorMatrix {
  switch (name) {
    case 'grayscale': {
      const a = 1 - Math.min(1, Math.max(0, amount))
      return rgb([
        0.2126 + 0.7874 * a,
        0.7152 - 0.7152 * a,
        0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a,
        0.7152 + 0.2848 * a,
        0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a,
        0.7152 - 0.7152 * a,
        0.0722 + 0.9278 * a,
      ])
    }
    case 'sepia': {
      const a = 1 - Math.min(1, Math.max(0, amount))
      return rgb([
        0.393 + 0.607 * a,
        0.769 - 0.769 * a,
        0.189 - 0.189 * a,
        0.349 - 0.349 * a,
        0.686 + 0.314 * a,
        0.168 - 0.168 * a,
        0.272 - 0.272 * a,
        0.534 - 0.534 * a,
        0.131 + 0.869 * a,
      ])
    }
    case 'saturate': {
      const s = Math.max(0, amount)
      return rgb([
        0.213 + 0.787 * s,
        0.715 - 0.715 * s,
        0.072 - 0.072 * s,
        0.213 - 0.213 * s,
        0.715 + 0.285 * s,
        0.072 - 0.072 * s,
        0.213 - 0.213 * s,
        0.715 - 0.715 * s,
        0.072 + 0.928 * s,
      ])
    }
    case 'hue-rotate': {
      const turn = (amount * Math.PI) / 180
      const c = Math.cos(turn)
      const s = Math.sin(turn)
      return rgb([
        0.213 + c * 0.787 - s * 0.213,
        0.715 - c * 0.715 - s * 0.715,
        0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143,
        0.715 + c * 0.285 + s * 0.14,
        0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787,
        0.715 - c * 0.715 + s * 0.715,
        0.072 + c * 0.928 + s * 0.072,
      ])
    }
    case 'brightness': {
      const b = Math.max(0, amount)
      return rgb([b, 0, 0, 0, b, 0, 0, 0, b])
    }
    case 'contrast': {
      const k = Math.max(0, amount)
      return rgb([k, 0, 0, 0, k, 0, 0, 0, k], 0.5 - 0.5 * k)
    }
  }
}

/** `second` after `first`. */
function compose(second: ColorMatrix, first: ColorMatrix): ColorMatrix {
  const out: number[] = []
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 5; column++) {
      let sum = column === 4 ? second[row * 5 + 4]! : 0
      for (let k = 0; k < 4; k++) sum += second[row * 5 + k]! * first[k * 5 + column]!
      out.push(sum)
    }
  }
  return out
}

/**
 * A filter's CSS as one colour matrix, for a canvas that can't filter:
 * its functions one after the other (without the clamping between them).
 */
export function filterMatrix(id: StudioFilterId): ColorMatrix {
  return parseFilter(STUDIO_FILTER[id].css).reduce(
    (matrix, fn) => compose(functionMatrix(fn), matrix),
    IDENTITY_MATRIX,
  )
}

/** Applies a colour matrix to RGBA pixels (0–255) in place. */
export function applyColorMatrix(pixels: Uint8ClampedArray, m: ColorMatrix) {
  for (let p = 0; p < pixels.length; p += 4) {
    const r = pixels[p]! / 255
    const g = pixels[p + 1]! / 255
    const b = pixels[p + 2]! / 255
    const a = pixels[p + 3]! / 255
    pixels[p] = 255 * (m[0]! * r + m[1]! * g + m[2]! * b + m[3]! * a + m[4]!)
    pixels[p + 1] = 255 * (m[5]! * r + m[6]! * g + m[7]! * b + m[8]! * a + m[9]!)
    pixels[p + 2] = 255 * (m[10]! * r + m[11]! * g + m[12]! * b + m[13]! * a + m[14]!)
    pixels[p + 3] = 255 * (m[15]! * r + m[16]! * g + m[17]! * b + m[18]! * a + m[19]!)
  }
}

/** A box on the stage (CSS px) and the point overlays centre on: the free room's middle. */
export type OverlayBox = { width: number; height: number; cx: number; cy: number }

/**
 * The vignette's ellipse: CSS's `ellipse farthest-corner` round (cx, cy),
 * shaped as its closest sides and grown to the farthest corner.
 */
export function vignetteEllipse({ width, height, cx, cy }: OverlayBox): { rx: number; ry: number } {
  const closestX = Math.max(1, Math.min(cx, width - cx))
  const closestY = Math.max(1, Math.min(cy, height - cy))
  const farX = Math.max(cx, width - cx)
  const farY = Math.max(cy, height - cy)
  const grow = Math.hypot(farX / closestX, farY / closestY)
  return { rx: closestX * grow, ry: closestY * grow }
}

/** Where the vignette starts to darken, as a share of its ellipse. */
export const VIGNETTE_START = 0.55

/** The CSS gradient line of a `linear-gradient(<angle>deg, …)` over a box: from its start to its end. */
export function gradientLine(angle: number, width: number, height: number) {
  const turn = (angle * Math.PI) / 180
  const dx = Math.sin(turn)
  const dy = -Math.cos(turn)
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2
  return {
    x0: width / 2 - dx * half,
    y0: height / 2 - dy * half,
    x1: width / 2 + dx * half,
    y1: height / 2 + dy * half,
  }
}

/** An overlay's CSS background over a box. */
export function overlayBackground(overlay: Overlay, box: OverlayBox, grain: string | null): string {
  switch (overlay.kind) {
    case 'vignette': {
      const { rx, ry } = vignetteEllipse(box)
      return `radial-gradient(ellipse ${rx}px ${ry}px at ${box.cx}px ${box.cy}px, transparent ${VIGNETTE_START * 100}%, rgba(0,0,0,${overlay.strength}) 100%)`
    }
    case 'tint': {
      const [first, second] = overlay.colors
      return `linear-gradient(${overlay.angle}deg, ${first}, ${second ?? first})`
    }
    case 'grain':
      return grain ? `url(${grain})` : 'none'
  }
}

/** The blend an overlay is drawn with, in CSS and on a canvas alike. */
export function overlayBlend(overlay: Overlay): 'normal' | 'soft-light' | 'overlay' {
  if (overlay.kind === 'tint') return overlay.blend
  return overlay.kind === 'grain' ? 'overlay' : 'normal'
}

/** The grain tile's size (px). */
export const GRAIN_TILE = 128

/** The grain tile's pixels: grey noise, the same every time (a seeded generator). */
export function grainPixels(size = GRAIN_TILE, seed = 0x9e3779b9): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(size * size * 4)
  let state = seed >>> 0
  for (let p = 0; p < pixels.length; p += 4) {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    const grey = Math.round(value * 255)
    pixels[p] = grey
    pixels[p + 1] = grey
    pixels[p + 2] = grey
    pixels[p + 3] = 255
  }
  return pixels
}

let grainCanvas: HTMLCanvasElement | null = null
let grainUrl: string | null = null

/** The grain tile as a canvas, made once. */
export function grainTile(): HTMLCanvasElement | null {
  if (grainCanvas) return grainCanvas
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = GRAIN_TILE
  canvas.height = GRAIN_TILE
  const context = canvas.getContext('2d')
  if (!context) return null
  context.putImageData(new ImageData(grainPixels(), GRAIN_TILE, GRAIN_TILE), 0, 0)
  grainCanvas = canvas
  return canvas
}

/** The grain tile as a data URL, for the live view's overlay. */
export function grainDataUrl(): string | null {
  grainUrl ??= grainTile()?.toDataURL('image/png') ?? null
  return grainUrl
}

/**
 * Draws a frame filtered as the live view shows it: `source` is the stage's
 * picture of the crop `crop` (stage CSS px) at `scale` px per CSS px, and
 * `box` the whole stage with the free room's middle.
 */
export function drawFiltered(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  id: StudioFilterId,
  box: OverlayBox,
  crop: { x: number; y: number; width: number; height: number },
  scale: number,
) {
  const { css, overlays } = STUDIO_FILTER[id]
  const width = Math.round(crop.width * scale)
  const height = Math.round(crop.height * scale)
  const canFilter = 'filter' in CanvasRenderingContext2D.prototype
  context.save()
  if (canFilter) context.filter = css
  context.drawImage(source, 0, 0, width, height)
  context.restore()
  if (!canFilter && css !== 'none') {
    const image = context.getImageData(0, 0, width, height)
    applyColorMatrix(image.data, filterMatrix(id))
    context.putImageData(image, 0, 0)
  }
  for (const overlay of overlays) {
    context.save()
    // The overlays are laid over the whole stage: draw them in its CSS px.
    context.setTransform(scale, 0, 0, scale, -crop.x * scale, -crop.y * scale)
    const blend = overlayBlend(overlay)
    context.globalCompositeOperation = blend === 'normal' ? 'source-over' : blend
    if (overlay.kind === 'tint') {
      const [first, second] = overlay.colors
      const line = gradientLine(overlay.angle, box.width, box.height)
      const gradient = context.createLinearGradient(line.x0, line.y0, line.x1, line.y1)
      gradient.addColorStop(0, first!)
      gradient.addColorStop(1, second ?? first!)
      context.fillStyle = gradient
      context.fillRect(0, 0, box.width, box.height)
    } else if (overlay.kind === 'grain') {
      const tile = grainTile()
      const pattern = tile && context.createPattern(tile, 'repeat')
      if (pattern) {
        context.globalAlpha = overlay.opacity
        context.fillStyle = pattern
        context.fillRect(0, 0, box.width, box.height)
      }
    } else {
      const { rx, ry } = vignetteEllipse(box)
      context.translate(box.cx, box.cy)
      context.scale(1, ry / rx)
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, rx)
      gradient.addColorStop(VIGNETTE_START, 'rgba(0,0,0,0)')
      gradient.addColorStop(1, `rgba(0,0,0,${overlay.strength})`)
      context.fillStyle = gradient
      const reach = Math.hypot(box.width, box.height) * Math.max(1, rx / ry)
      context.fillRect(-reach, -reach, 2 * reach, 2 * reach)
    }
    context.restore()
  }
}
