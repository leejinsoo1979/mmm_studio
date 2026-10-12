import { deflateSync } from 'node:zlib'
import type { AiPersonChoices } from './shared'
import { crc32 } from './zip'

/**
 * The 목업 portrait for `AI_AVATAR_MOCK=true` (development only): a flat
 * 1024² PNG drawn here, a head-and-shoulders figure in the chosen skin, hair
 * and outfit colours on the light-grey backdrop, so the whole flow runs with
 * no image API and no committed photo. It is plainly not a photo.
 */

const SIZE = 1024

type Rgb = readonly [number, number, number]

const SKIN: Record<AiPersonChoices['skinTone'], Rgb> = {
  fair: [246, 222, 205],
  light: [234, 200, 172],
  medium: [214, 170, 132],
  olive: [190, 150, 108],
  brown: [150, 104, 72],
  deep: [96, 64, 44],
}

const HAIR: Record<AiPersonChoices['hairColour'], Rgb> = {
  black: [28, 26, 26],
  darkBrown: [58, 40, 30],
  brown: [96, 66, 44],
  lightBrown: [150, 112, 76],
  blonde: [214, 186, 128],
  auburn: [128, 58, 34],
  grey: [150, 150, 150],
  white: [222, 222, 222],
}

const CLOTH: Record<AiPersonChoices['outfitColour'], Rgb> = {
  white: [244, 244, 244],
  black: [32, 32, 34],
  grey: [128, 128, 128],
  navy: [34, 44, 80],
  beige: [210, 192, 160],
  khaki: [140, 130, 90],
  burgundy: [110, 30, 44],
  skyBlue: [150, 196, 230],
}

const BACKDROP: Rgb = [228, 228, 228]
const FEATURE: Rgb = [40, 30, 28]

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Inside the ellipse centred on (cx, cy) with radii (rx, ry). */
const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1

function colourAt(x: number, y: number, choices: AiPersonChoices): Rgb {
  const skin = SKIN[choices.skinTone]
  const hair = HAIR[choices.hairColour]
  const head = { cx: 512, cy: 430, rx: 165, ry: 215 }
  const longHair = ['shoulder', 'longStraight', 'longWavy', 'bob'].includes(choices.hairStyle)
  // Eyes, brows and a closed mouth, so the figure reads as frontal and neutral.
  for (const side of [-1, 1]) {
    if (inEllipse(x, y, 512 + side * 62, 410, 24, 11)) return FEATURE
    if (y > 368 && y < 378 && Math.abs(x - (512 + side * 62)) < 36) return hair
  }
  if (y > 548 && y < 556 && Math.abs(x - 512) < 42) return [150, 70, 70]
  if (inEllipse(x, y, head.cx, head.cy, head.rx, head.ry)) {
    const hairLine = choices.hairStyle === 'shaved' ? 0 : 300
    return y < hairLine && inEllipse(x, y, head.cx, head.cy - 10, head.rx + 4, head.ry)
      ? hair
      : skin
  }
  if (choices.hairStyle !== 'shaved' && inEllipse(x, y, 512, 410, 182, 238) && y < 330) return hair
  if (longHair && y > 330 && y < 760 && Math.abs(x - 512) > 150 && Math.abs(x - 512) < 200) {
    return hair
  }
  if (Math.abs(x - 512) < 70 && y >= 600 && y < 800) return skin
  if (inEllipse(x, y, 512, 1060, 420, 300)) return CLOTH[choices.outfitColour]
  return BACKDROP
}

/** The mock portrait as PNG bytes (about 20 kB). */
export function mockPortraitPng(choices: AiPersonChoices): Uint8Array<ArrayBuffer> {
  const stride = 1 + SIZE * 3
  const raw = new Uint8Array(stride * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < SIZE; x++) {
      raw.set(colourAt(x, y, choices), y * stride + 1 + x * 3)
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, SIZE)
  view.setUint32(4, SIZE)
  header.set([8, 2, 0, 0, 0], 8)
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
