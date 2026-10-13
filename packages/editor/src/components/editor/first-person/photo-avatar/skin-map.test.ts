import { describe, expect, test } from 'bun:test'
import { hairColor, skinMaps, skinModel } from './skin-map'

/**
 * A made-up photo: a grey-blue background, a smooth skin-coloured face
 * (gently shaded, a little noise), and above it a fringe of fine strands in
 * nearly the skin's colour (blond hair) — which is not skin.
 */
const W = 160
const H = 160
const SKIN = [205, 160, 135]
const CHEEKS = [50, 280, 205, 425, 101, 330, 36, 266, 187, 411, 117, 346, 118, 347, 123, 352]

function photo() {
  const rgba = new Uint8ClampedArray(W * H * 4)
  const mask = new Uint8Array(W * H)
  let seed = 3
  const noise = () => {
    seed = (seed * 1103515245 + 12345) >>> 0
    return ((seed >>> 16) / 65536 - 0.5) * 4
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      let colour = [120, 130, 150]
      const inFace = (x - 80) ** 2 / 45 ** 2 + (y - 90) ** 2 / 55 ** 2 <= 1
      if (inFace) {
        mask[i] = 255
        const shade = 0.85 + (0.15 * x) / W
        colour = SKIN.map((c) => c * shade + noise())
        // The fringe: the face's top, thin light and dark strands.
        if (y < 60) colour = SKIN.map((c) => c * (x % 3 === 0 ? 0.55 : 1.05) + 15)
      }
      rgba.set([...colour, 255], i * 4)
    }
  }
  return { rgba, mask }
}

function landmarks() {
  const points = new Float32Array(478 * 2).fill(80)
  CHEEKS.forEach((l, k) => {
    points[l * 2] = k % 2 ? 105 + (k % 4) : 55 - (k % 4)
    points[l * 2 + 1] = 100 + (k % 5) * 3
  })
  // Irises 60 px apart; the forehead's top (10), chin (152), the face's sides (234, 454).
  points.set([50, 80], 468 * 2)
  points.set([110, 80], 473 * 2)
  points.set([80, 62], 10 * 2)
  points.set([80, 142], 152 * 2)
  points.set([36, 90], 234 * 2)
  points.set([124, 90], 454 * 2)
  return points
}

describe('skin maps', () => {
  const { rgba, mask } = photo()
  const model = skinModel(rgba, W, H, landmarks())!

  test('learns the skin’s colour from the cheeks', () => {
    expect(model).not.toBeNull()
    const cb = 128 - 0.168736 * SKIN[0]! - 0.331264 * SKIN[1]! + 0.5 * SKIN[2]!
    expect(Math.abs(model.cb - cb)).toBeLessThan(4)
  })

  test('tells skin from background and from strands of skin-coloured hair', () => {
    const { skin, covered } = skinMaps(rgba, W, H, model, mask)
    const at = (map: Uint8Array, x: number, y: number) => map[y * W + x]!
    expect(at(skin, 80, 110)).toBeGreaterThan(200)
    expect(at(skin, 10, 10)).toBeLessThan(30)
    expect(at(skin, 80, 50)).toBeLessThan(60)
    expect(at(covered, 80, 50)).toBeGreaterThan(200)
    expect(at(covered, 80, 110)).toBeLessThan(30)
  })

  test('reads the hair’s colour above the forehead', () => {
    const { skin } = skinMaps(rgba, W, H, model, mask)
    const hair = hairColor(rgba, W, H, landmarks(), mask, skin)
    expect(hair).not.toBeNull()
  })
})
