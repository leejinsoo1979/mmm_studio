import { describe, expect, test } from 'bun:test'
import type { CaptureView } from './avatar-job'
import { EYE_RINGS } from './features'
import { surfaceGraph } from './fill'
import {
  exposureFromWhites,
  hairline,
  mirrorFill,
  mirrorTexels,
  mirrorVertices,
  mouthMoved,
  skinLevels,
  softPlane,
  symmetrise,
  toneEars,
  whiteBalance,
} from './skin-texture'
import { linearToSrgb, rasterizeUv, type Texels, type UvMesh } from './texture'

/** A flat patch of skin across the midline (x −7…7 cm, y 0…4 cm), 5 mm a vertex, one UV island. */
function patch(): UvMesh {
  const positions: number[] = []
  const uvs: number[] = []
  const columns = 29
  const rows = 9
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const x = -0.07 + c * 0.005
      const y = r * 0.005
      positions.push(x, y, 0)
      uvs.push(0.05 + ((x + 0.07) / 0.14) * 0.9, 0.05 + (y / 0.04) * 0.9)
    }
  }
  const triangles: number[] = []
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = r * columns + c
      triangles.push(a, a + 1, a + columns + 1, a, a + columns + 1, a + columns)
    }
  }
  const n = positions.length / 3
  return {
    positions: Float32Array.from(positions),
    normals: new Float32Array(n * 3),
    uvs: Float32Array.from(uvs),
    triangles: Uint32Array.from(triangles),
  }
}

describe("evening out the skin's left and right", () => {
  const mesh = patch()
  const weld = Uint32Array.from({ length: mesh.positions.length / 3 }, (_, i) => i)
  const basemesh = Float32Array.from(mesh.positions)
  const size = 128
  const texels = rasterizeUv(mesh, size)
  const graph = surfaceGraph(mesh, weld)
  const mirror = mirrorVertices(graph, basemesh)
  const texelMirror = mirrorTexels(texels, mesh, graph, mirror)
  const texelAt = (x: number, y: number) => {
    const u = 0.05 + ((x + 0.07) / 0.14) * 0.9
    const v = 0.05 + (y / 0.04) * 0.9
    return Math.floor(v * size) * size + Math.floor(u * size)
  }

  test('each vertex and texel finds its mirror across the midline', () => {
    const left = texelAt(-0.03, 0.02)
    const right = texelAt(0.03, 0.02)
    expect(Math.abs(texelMirror[left]! - right)).toBeLessThanOrEqual(1)
    expect(Math.abs(texelMirror[right]! - left)).toBeLessThanOrEqual(1)
    // A vertex on the midline is its own mirror.
    expect(mirror[14]).toBe(14)
  })

  test('a light falling across the face is evened out, a mole kept', () => {
    const color = new Float32Array(size * size * 3)
    const trust = new Float32Array(size * size)
    for (let i = 0; i < size * size; i++) {
      if (texels.triangle[i]! < 0) continue
      const x = texels.position[i * 3]!
      // Twice as bright on the right as on the left, smoothly.
      const light = 0.45 * Math.exp((Math.log(2) / 0.14) * x)
      for (let k = 0; k < 3; k++) color[i * 3 + k] = light * [1, 0.6, 0.45][k]!
      trust[i] = 1
    }
    const mole = texelAt(0.02, 0.02)
    for (let k = 0; k < 3; k++) color[mole * 3 + k] = color[mole * 3 + k]! * 0.4
    const before = color[(mole + 3) * 3]!
    symmetrise(color, trust, new Float32Array(size * size).fill(1), texels, mesh, graph, mirror)
    for (const x of [0.01, 0.02, 0.03, 0.04]) {
      const right = color[texelAt(x, 0.025) * 3]!
      const left = color[texelAt(-x, 0.025) * 3]!
      expect(right / left).toBeGreaterThan(0.93)
      expect(right / left).toBeLessThan(1.07)
    }
    // The mole stays darker than the skin beside it.
    expect(color[mole * 3]! / color[(mole + 3) * 3]!).toBeLessThan(0.5)
    expect(color[(mole + 3) * 3]!).not.toBe(before)
  })

  test("a side every photo saw in shadow takes the lit side's colour", () => {
    const color = new Float32Array(size * size * 3)
    const trust = new Float32Array(size * size)
    const lit = new Float32Array(size * size)
    for (let i = 0; i < size * size; i++) {
      if (texels.triangle[i]! < 0) continue
      const right = texels.position[i * 3]! > 0
      // The left still half as bright as it should be once its shadow was lifted.
      const level = right ? 0.5 : 0.25
      color.set([level, level * 0.6, level * 0.45], i * 3)
      trust[i] = 1
      lit[i] = right ? 1 : 0.15
    }
    symmetrise(color, trust, lit, texels, mesh, graph, mirror)
    for (const x of [0.03, 0.05]) {
      expect(color[texelAt(x, 0.02) * 3]!).toBeGreaterThan(0.47)
      expect(color[texelAt(-x, 0.02) * 3]!).toBeGreaterThan(0.44)
      expect(color[texelAt(-x, 0.02) * 3]!).toBeLessThan(0.5)
    }
  })

  test('a side no photo saw takes its mirror, a side seen keeps its own', () => {
    const color = new Float32Array(size * size * 3)
    const weight = new Float32Array(size * size)
    for (let i = 0; i < size * size; i++) {
      if (texels.triangle[i]! < 0) continue
      const right = texels.position[i * 3]! > 0
      color.set(right ? [0.5, 0.3, 0.2] : [0.1, 0.1, 0.1], i * 3)
      weight[i] = right ? 1 : 0
    }
    mirrorFill(color, weight, texelMirror)
    const left = texelAt(-0.03, 0.02)
    expect(color[left * 3]!).toBeCloseTo(0.5, 5)
    expect(weight[left]!).toBeGreaterThan(0.8)
    expect(color[texelAt(0.03, 0.02) * 3]!).toBeCloseTo(0.5, 5)
  })

  test('a side no photo saw takes its mirror whole even where the mirror was seen less well', () => {
    const color = new Float32Array(size * size * 3)
    const weight = new Float32Array(size * size)
    for (let i = 0; i < size * size; i++) {
      if (texels.triangle[i]! < 0 || texels.position[i * 3]! <= 0) continue
      color.set([0.5, 0.3, 0.2], i * 3)
      weight[i] = 0.7
    }
    mirrorFill(color, weight, texelMirror)
    const left = texelAt(-0.03, 0.02)
    expect(color[left * 3]!).toBeCloseTo(0.5, 5)
    expect(color[left * 3 + 2]!).toBeCloseTo(0.2, 5)
    expect(weight[left]!).toBeGreaterThan(0)
    expect(weight[left]!).toBeLessThan(0.7)
  })

  test("a gap in the shadowed side takes its mirror's detail at its own side's level", () => {
    const color = new Float32Array(size * size * 3)
    const weight = new Float32Array(size * size)
    const hole = [-0.03, 0.02]
    const mole = [0.03, 0.02]
    for (let i = 0; i < size * size; i++) {
      if (texels.triangle[i]! < 0) continue
      const x = texels.position[i * 3]!
      const y = texels.position[i * 3 + 1]!
      const right = x > 0
      const level = right ? 0.5 : 0.25
      const dark = Math.hypot(x - mole[0]!, y - mole[1]!) < 0.002 ? 0.4 : 1
      color.set([level * dark, level * 0.6 * dark, level * 0.45 * dark], i * 3)
      weight[i] = Math.hypot(x - hole[0]!, y - hole[1]!) < 0.008 ? 0 : 1
    }
    const levels = skinLevels(color, weight, texels, mesh, graph)
    mirrorFill(color, weight, texelMirror, levels)
    const beside = color[texelAt(-0.035, 0.02) * 3]!
    expect(beside).toBeGreaterThan(0.21)
    expect(beside).toBeLessThan(0.29)
    expect(color[texelAt(hole[0]!, hole[1]!) * 3]! / beside).toBeLessThan(0.6)
  })
})

describe('the hairline', () => {
  test('the skin just below hair the photo is sure of is counted as hair, fading out', () => {
    const width = 40
    const height = 40
    const hair = new Uint8Array(width * height)
    // Sure hair above row 10, and a faint wisp the segmenter half saw at row 30.
    for (let i = 0; i < width * 10; i++) hair[i] = 230
    for (let x = 0; x < width; x++) hair[30 * width + x] = 90
    const out = hairline(hair, width, height, 10)
    const at = (y: number) => out[y * width + 20]!
    expect(at(5)).toBe(255)
    expect(at(12)).toBe(255)
    expect(at(16)).toBeGreaterThan(0)
    expect(at(16)).toBeLessThan(255)
    expect(at(21)).toBe(0)
    for (let y = 12; y < 22; y++) expect(at(y + 1)).toBeLessThanOrEqual(at(y))
    // A wisp is not sure hair: no margin round it.
    expect(at(30)).toBe(90)
    expect(at(28)).toBe(0)
  })
})

/** A photo: `background` all over, the person a box in the middle, their eyes' whites `white`. */
function photo(background: number[], white: number[] | null, blink = 0): CaptureView {
  const width = 200
  const height = 160
  const rgba = new Uint8ClampedArray(width * height * 4)
  const mask = new Uint8Array(width * height)
  const landmarks = new Float32Array(478 * 2)
  const eyes = [
    [130, 70],
    [70, 70],
  ]
  EYE_RINGS.forEach((eye, e) => {
    const [cx, cy] = eyes[e]!
    eye.forEach((l, k) => {
      const a = (2 * Math.PI * k) / eye.length
      landmarks[l * 2] = cx! + 18 * Math.cos(a)
      landmarks[l * 2 + 1] = cy! + 8 * Math.sin(a)
    })
    const centre = e === 0 ? 473 : 468
    landmarks.set([cx!, cy!], centre * 2)
    for (let r = 1; r <= 4; r++) {
      const a = (Math.PI / 2) * r
      landmarks.set([cx! + 5 * Math.cos(a), cy! + 5 * Math.sin(a)], (centre + r) * 2)
    }
  })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      let colour = background
      if (x > 40 && x < 160 && y > 40) {
        mask[i] = 255
        colour = [190, 140, 115]
        const eye = eyes.find(([cx, cy]) => ((x - cx!) / 18) ** 2 + ((y - cy!) / 8) ** 2 < 1)
        if (eye && white) colour = Math.hypot(x - eye[0]!, y - eye[1]!) < 5 ? [60, 40, 30] : white
      }
      rgba.set([...colour, 255], i * 4)
    }
  }
  return {
    slot: 'front',
    width,
    height,
    rgba,
    mask,
    skin: null,
    covered: null,
    classes: null,
    blendshapes: null,
    landmarks,
    yaw: 0,
    blink,
  }
}

describe("the photos' colour cast and light", () => {
  test('a strong cast that the background and the whites agree on is taken out', () => {
    const gains = whiteBalance([photo([210, 180, 120], [235, 205, 140])])
    expect(gains[0]).toBeLessThan(0.95)
    expect(gains[2]).toBeGreaterThan(1.2)
  })

  test('a warm wall alone, or a mild cast, is left as it is', () => {
    expect(whiteBalance([photo([210, 180, 120], [225, 225, 225])])).toEqual([1, 1, 1])
    expect(whiteBalance([photo([205, 200, 192], [230, 226, 220])])).toEqual([1, 1, 1])
  })

  test('the whites tell how bright the light was; shut eyes tell nothing', () => {
    // Twice the light (in scene terms) halves the scale.
    const dim = exposureFromWhites(
      photo(
        [128, 128, 128],
        [130, 130, 130].map((v) => v),
      ),
    )
    const bright = exposureFromWhites(
      photo(
        [128, 128, 128],
        [130, 130, 130].map((v) => linearToSrgb((v / 255) ** 2.2 * 2)),
      ),
    )
    expect(dim / bright).toBeGreaterThan(1.6)
    expect(exposureFromWhites(photo([128, 128, 128], [130, 130, 130], 1))).toBe(1)
    expect(exposureFromWhites(photo([128, 128, 128], null))).toBe(1)
  })
})

describe("a photo's mouth", () => {
  test('a smile or a dropped jaw moves the lips; a resting mouth or a profile does not', () => {
    const view = (blendshapes: Record<string, number> | null) => ({
      ...photo([128, 128, 128], null),
      blendshapes,
    })
    expect(mouthMoved(view({ mouthSmileLeft: 0.05, mouthSmileRight: 0.08, jawOpen: 0.02 }))).toBe(0)
    expect(mouthMoved(view(null))).toBe(0)
    expect(mouthMoved(view({ mouthSmileLeft: 0.7, mouthSmileRight: 0.6 }))).toBe(1)
    expect(mouthMoved(view({ jawOpen: 0.4 }))).toBe(1)
    const some = mouthMoved(view({ mouthSmileRight: 0.38 }))
    expect(some).toBeGreaterThan(0.2)
    expect(some).toBeLessThan(0.8)
  })
})

describe('softening a photo map', () => {
  test('an edge becomes an even ramp, a flat map stays flat', () => {
    const width = 40
    const height = 20
    const edge = new Uint8Array(width * height)
    for (let i = 0; i < edge.length; i++) edge[i] = i % width >= 20 ? 255 : 0
    const soft = softPlane(edge, width, height, 3)
    const row = Array.from(soft.subarray(10 * width, 11 * width))
    expect(row[10]).toBe(0)
    expect(row[30]).toBe(255)
    for (let x = 1; x < width; x++) expect(row[x]!).toBeGreaterThanOrEqual(row[x - 1]!)
    expect(Math.abs(row[19]! + row[20]! - 255)).toBeLessThanOrEqual(2)
    expect(
      softPlane(new Uint8Array(width * height).fill(200), width, height, 3).every((v) => v === 200),
    ).toBe(true)
  })
})

describe('the ears', () => {
  test('each ear takes the colour of the cheek ahead of it, keeping its own detail', () => {
    const size = 32
    const count = size * size
    const texels: Texels = {
      size,
      triangle: new Int32Array(count),
      position: new Float32Array(count * 3),
      normal: new Float32Array(count * 3),
    }
    const color = new Float32Array(count * 3)
    const trust = new Float32Array(count).fill(1)
    const frame = {
      eyes: [0, 0, 0] as [number, number, number],
      eyeDistance: 0.064,
      chinY: -0.12,
      topY: 0.12,
      earZ: 0,
    }
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1
      const ear = i % 4 >= 2
      texels.position.set(ear ? [side * 0.068, -0.03, -0.02] : [side * 0.055, -0.03, 0.02], i * 3)
      const detail = 1 + 0.1 * Math.sin(i)
      const own = ear ? [0.5, 0.3, 0.25] : side > 0 ? [0.3, 0.15, 0.1] : [0.28, 0.16, 0.11]
      color.set(
        own.map((c) => c * detail),
        i * 3,
      )
    }
    const before = Float32Array.from(color)
    toneEars(color, trust, trust, texels, frame)
    for (const side of [1, -1]) {
      const ears = [...Array(count).keys()].filter((i) => i % 4 >= 2 && (i % 2 ? 1 : -1) === side)
      const red = ears.map((i) => color[i * 3]!).sort((a, b) => a - b)
      expect(red[Math.floor(red.length / 2)]!).toBeCloseTo(side > 0 ? 0.3 : 0.28, 1)
      // The detail is kept: the same ratios between texels as before.
      expect(color[ears[1]! * 3]! / color[ears[0]! * 3]!).toBeCloseTo(
        before[ears[1]! * 3]! / before[ears[0]! * 3]!,
        4,
      )
    }
    // The cheeks are untouched.
    expect(color[0]).toBe(before[0])
  })
})
