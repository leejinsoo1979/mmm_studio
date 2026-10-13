import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBaseForTests } from './__bench__/base-for-tests'
import { type BaseBody, movedPositions } from './base-body'
import { type ExpressionIndex, readExpressions } from './expressions'
import {
  eyesShut,
  eyeTexture,
  innerSurfaces,
  LASHES,
  lashPositions,
  lidTexels,
  lipsTogether,
  paintInnerSurfaces,
  photoWhites,
  scleraColour,
  sealLips,
  toneImage,
} from './eyes'
import { landmarkUvs, ringLandmarks, texelKinds } from './features'
import { EYES } from './landmark-sets'
import { rasterizeUv, srgbToLinear, TEXEL_EYE } from './texture'

const PUBLIC = join(import.meta.dir, '../../../../../../../apps/editor/public/characters/photoreal')

let base: BaseBody

beforeAll(async () => {
  base = await loadBaseForTests('male')
})

describe('which photos show the eyes open', () => {
  test('MediaPipe’s blink scores decide; the lids’ own measure when it has none', () => {
    expect(eyesShut({ blendshapes: { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.2 } })).toBe(false)
    expect(eyesShut({ blendshapes: { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.55 } })).toBe(true)
    expect(eyesShut({ blendshapes: { jawOpen: 0.3 }, blink: 0.7 })).toBe(true)
    expect(eyesShut({ blink: 0.2 })).toBe(false)
    expect(eyesShut({})).toBe(false)
  })
})

/** A photo of two eyes: grey skin, white whites between oval lids, dark irises; MediaPipe's points on them. */
function eyePhoto(white: [number, number, number], { shut = false } = {}) {
  const width = 400
  const height = 200
  const rgba = new Uint8ClampedArray(width * height * 4)
  const landmarks = new Float32Array(478 * 2)
  const eyes = [
    { cx: 280, ring: EYES.slice(0, 16), iris: 473 },
    { cx: 120, ring: EYES.slice(16), iris: 468 },
  ]
  for (let i = 0; i < width * height; i++) rgba.set([150, 110, 90, 255], i * 4)
  for (const { cx, ring, iris } of eyes) {
    ring.forEach((l, k) => {
      const a = (k / ring.length) * Math.PI * 2
      landmarks[l * 2] = cx + 40 * Math.cos(a)
      landmarks[l * 2 + 1] = 100 + 16 * Math.sin(a)
    })
    landmarks[iris * 2] = cx
    landmarks[iris * 2 + 1] = 100
    for (let k = 1; k <= 4; k++) {
      const a = (k / 4) * Math.PI * 2
      landmarks[(iris + k) * 2] = cx + 12 * Math.cos(a)
      landmarks[(iris + k) * 2 + 1] = 100 + 12 * Math.sin(a)
    }
    for (let y = 84; y <= 116; y++)
      for (let x = cx - 40; x <= cx + 40; x++) {
        const inside = ((x - cx) / 40) ** 2 + ((y - 100) / 16) ** 2 <= 1
        if (!inside) continue
        const i = (y * width + x) * 4
        rgba.set(Math.hypot(x - cx, y - 100) < 12 ? [60, 40, 25, 255] : [...white, 255], i)
      }
  }
  return {
    width,
    height,
    rgba,
    landmarks,
    yaw: 0,
    blendshapes: { eyeBlinkLeft: shut ? 0.9 : 0.05, eyeBlinkRight: shut ? 0.9 : 0.05 },
  }
}

describe('the whites of the eyes', () => {
  test('are read between the lids round the irises, from photos with the eyes open', () => {
    const whites = photoWhites([eyePhoto([220, 210, 200])])!
    expect(whites).not.toBeNull()
    expect(whites[0]).toBeCloseTo(srgbToLinear(220), 2)
    expect(whites[2]).toBeCloseTo(srgbToLinear(200), 2)
    expect(photoWhites([eyePhoto([220, 210, 200], { shut: true })])).toBeNull()
  })

  test('make a sclera in a living eye’s range: never paper white, never as tinted as skin', () => {
    const light = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
    expect(light(scleraColour([1, 1, 1], [1, 1, 1]))).toBeCloseTo(0.62, 3)
    expect(light(scleraColour([0.05, 0.05, 0.05], [1, 1, 1]))).toBeCloseTo(0.38, 3)
    const tinted = scleraColour([0.6, 0.3, 0.2], [1, 1, 1])
    expect((Math.max(...tinted) - Math.min(...tinted)) / Math.max(...tinted)).toBeLessThanOrEqual(
      0.1401,
    )
  })
})

describe('the eye texture', () => {
  test('takes the iris colour (keeping its pattern) and tones the sclera to the photos’ whites', () => {
    const width = 128
    const height = 128
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++)
      data.set([200 + (i % 3) * 10, 200, 200, 255], i * 4)
    const iris: [number, number, number] = [0.05, 0.12, 0.2]
    const sclera: [number, number, number] = [0.5, 0.45, 0.4]
    const out = eyeTexture(base, { data, width, height }, iris, sclera)
    let blueish = 0
    let warm = 0
    for (let i = 0; i < width * height; i++) {
      const [r, g, b] = [out[i * 4]!, out[i * 4 + 1]!, out[i * 4 + 2]!]
      if (b > r + 20) blueish++
      if (r > b + 10 && r < 200) warm++
    }
    expect(blueish).toBeGreaterThan(50)
    expect(warm).toBeGreaterThan(500)
    // With neither colour the picture is left as it was.
    expect(Array.from(eyeTexture(base, { data, width, height }, null, null))).toEqual(
      Array.from(data),
    )
  })
})

describe('lashes', () => {
  test('are drawn in toward the lids, a man’s shorter than the base’s and the lower ones shortest', () => {
    const moves = new Float64Array(base.basemesh.length)
    const shaped = lashPositions(base, moves, 'male')!
    const before = movedPositions(base, shaped.index, moves)
    const skin = base.headSkin.mesh.positions
    const { Left, Right } = base.meta.eyeCentres
    const reach = (positions: Float32Array, lower: boolean) => {
      let most = 0
      for (let i = 0; i < positions.length / 3; i++) {
        const eye = before[i * 3]! > 0 ? Left : Right
        if (before[i * 3 + 1]! < eye[1] !== lower) continue
        let near = Number.POSITIVE_INFINITY
        for (let j = 0; j < skin.length / 3; j++)
          near = Math.min(
            near,
            Math.hypot(
              skin[j * 3]! - positions[i * 3]!,
              skin[j * 3 + 1]! - positions[i * 3 + 1]!,
              skin[j * 3 + 2]! - positions[i * 3 + 2]!,
            ),
          )
        most = Math.max(most, near)
      }
      return most
    }
    expect(reach(shaped.positions, false)).toBeLessThan(reach(before, false) * (LASHES.male.upper + 0.08))
    expect(reach(shaped.positions, true)).toBeLessThan(reach(before, true) * (LASHES.male.lower + 0.08))
  })
})

describe('the skin that turns in under the lids and between the lips', () => {
  test('is found against the eyeballs (the caruncle at the inner corners) and inside the lips', () => {
    const moves = new Float64Array(base.basemesh.length)
    const texels = rasterizeUv(base.headSkin.mesh, 1024)
    const masks = innerSurfaces(base, moves, texels)
    const sum = (m: Float32Array) => m.reduce((s, v) => s + v, 0)
    expect(sum(masks.rim)).toBeGreaterThan(20)
    expect(sum(masks.caruncle)).toBeGreaterThan(2)
    expect(sum(masks.caruncle)).toBeLessThan(sum(masks.rim))
    expect(sum(masks.innerLip)).toBeGreaterThan(10)
    // Not the lids' outer skin, which lies over the eyeballs facing away from them.
    const { Left, Right } = base.meta.eyeCentres
    let outer = 0
    let painted = 0
    for (let i = 0; i < texels.size * texels.size; i++) {
      if (texels.triangle[i]! < 0) continue
      const p = [0, 1, 2].map((k) => texels.position[i * 3 + k]!)
      const eye = p[0]! > 0 ? Left : Right
      const d = Math.hypot(p[0]! - eye[0], p[1]! - eye[1], p[2]! - eye[2])
      if (d > 0.016 || p[2]! < eye[2]) continue
      const away = [0, 1, 2].reduce((s, k) => s + texels.normal[i * 3 + k]! * (p[k]! - eye[k]!), 0) / d
      if (away < 0.85) continue
      outer++
      painted += masks.rim[i]!
    }
    expect(outer).toBeGreaterThan(50)
    expect(painted).toBeLessThan(0.02 * outer)
  })

  test('is painted pink and wet there and nowhere else', () => {
    const size = 64
    const working = 32
    const pixels = new Uint8ClampedArray(size * size * 4).fill(180)
    const zero = () => new Float32Array(working * working)
    const masks = { rim: zero(), caruncle: zero(), innerLip: zero(), lipFront: zero() }
    masks.rim[5 * working + 5] = 1
    masks.innerLip[20 * working + 20] = 1
    masks.lipFront[21 * working + 21] = 1
    const before = Uint8ClampedArray.from(pixels)
    paintInnerSurfaces(pixels, size, masks, working, [0.5, 0.35, 0.3])
    const at = (x: number, y: number) => Array.from(pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 3))
    expect(at(10, 10)[0]!).toBeGreaterThan(at(10, 10)[1]!)
    expect(at(40, 40)[0]!).toBeLessThan(180)
    expect(at(60, 2)).toEqual(Array.from(before.subarray((2 * size + 60) * 4, (2 * size + 60) * 4 + 3)))
  })
})

describe('the photos’ lids', () => {
  test('reach above the eye’s opening further than below it', () => {
    const uv = landmarkUvs(base.head, base.headSkin.weld, base.headSkin.mesh.uvs)
    const size = 256
    const lids = lidTexels(uv, size)
    const ring = EYES.slice(0, 16)
    const cv = ring.reduce((s, l) => s + uv[l * 2 + 1]!, 0) / ring.length
    const cu = ring.reduce((s, l) => s + uv[l * 2]!, 0) / ring.length
    const column = Math.floor(cu * size)
    let above = 0
    let below = 0
    for (let y = 0; y < size; y++) {
      if (!lids[y * size + column]) continue
      if ((y + 0.5) / size < cv) above++
      else below++
    }
    expect(above).toBeGreaterThan(below)
    expect(below).toBeGreaterThan(0)
  })
})

describe('the eyes’ openings in the head’s texture', () => {
  test('stay about the eyes, though the landmark map puts some of their points in the socket', async () => {
    for (const gender of ['male', 'female'] as const) {
      const body = await loadBaseForTests(gender)
      const uv = landmarkUvs(body.head, body.headSkin.weld, body.headSkin.mesh.uvs)
      const size = 256
      const kind = texelKinds(rasterizeUv(body.headSkin.mesh, size), uv)
      const lids = lidTexels(uv, size)
      let eye = 0
      let astray = 0
      for (let i = 0; i < kind.length; i++) {
        if (kind[i] !== TEXEL_EYE) continue
        eye++
        if (!lids[i]) astray++
      }
      expect(eye).toBeGreaterThan(100)
      expect(astray).toBe(0)
    }
  })

  test('leave out a ring’s points off on another island', () => {
    const uvs = new Float32Array(20 * 2)
    for (let i = 0; i < 8; i++) {
      uvs[i * 2] = 0.3 + 0.02 * Math.cos(i)
      uvs[i * 2 + 1] = 0.3 + 0.01 * Math.sin(i)
    }
    uvs[8 * 2] = 0.77
    uvs[8 * 2 + 1] = 0.51
    expect(ringLandmarks(uvs, [0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
})

describe('the mouth', () => {
  test('the photos’ lips count as together when the inner lips meet, read from views facing the camera', () => {
    const view = (gap: number, yaw = 0) => {
      const landmarks = new Float32Array(478 * 2)
      landmarks.set([100, 200], 61 * 2)
      landmarks.set([160, 200], 291 * 2)
      landmarks.set([130, 200 - gap / 2], 13 * 2)
      landmarks.set([130, 200 + gap / 2], 14 * 2)
      return { landmarks, yaw }
    }
    expect(lipsTogether([view(0.5), view(1)])).toBe(true)
    expect(lipsTogether([view(12), view(10)])).toBe(false)
    expect(lipsTogether([view(12, 1.2), view(0.5)])).toBe(true)
    expect(lipsTogether([{ landmarks: null, yaw: 0 }])).toBe(false)
  })

  test('lips left apart by the head are brought together, the chin and upper lip kept', () => {
    const bytes = readFileSync(join(PUBLIC, 'mpfb-face-expressions.bin'))
    const jaw = readExpressions(
      JSON.parse(readFileSync(join(PUBLIC, 'mpfb-face-expressions.json'), 'utf8')) as ExpressionIndex,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ).find((one) => one.name === 'jawOpen')!
    // The base's own mouth rests a little open.
    const moves = new Float64Array(base.basemesh.length)
    const sealed = sealLips(base, moves, jaw)
    expect(sealed).not.toBe(moves)
    let most = 0
    let lowest = Number.POSITIVE_INFINITY
    let chinMove = 0
    jaw.vertices.forEach((v, i) => {
      const lift = Math.hypot(sealed[v * 3]!, sealed[v * 3 + 1]!, sealed[v * 3 + 2]!)
      most = Math.max(most, lift)
      if (Math.hypot(jaw.deltas[i * 3]!, jaw.deltas[i * 3 + 1]!, jaw.deltas[i * 3 + 2]!) < 1e-3)
        expect(lift).toBeLessThan(1e-4)
      const y = base.basemesh[v * 3 + 1]!
      if (y < lowest) {
        lowest = y
        chinMove = lift
      }
    })
    expect(most).toBeGreaterThan(0.0004)
    expect(most).toBeLessThan(0.004)
    expect(chinMove).toBe(0)
    // Shut, there is nothing left to close.
    expect(sealLips(base, sealed, jaw)).toBe(sealed)
  })

  test('teeth and tongue are toned by linear gains, alpha kept', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 128])
    const out = toneImage({ data, width: 1, height: 1 }, [0.5, 0.5, 0.25])
    expect(srgbToLinear(out[0]!)).toBeCloseTo(0.5, 1)
    expect(srgbToLinear(out[2]!)).toBeCloseTo(0.25, 1)
    expect(out[3]).toBe(128)
  })
})
