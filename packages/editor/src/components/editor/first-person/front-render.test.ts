import { describe, expect, test } from 'bun:test'
import { bakeFront, renderFront, tintIris } from './front-render'
import { type HeadTriangle, luminance, type Pixels, type Rgb } from './look-pixels'

function image(width: number, height: number, fill: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fill(x, y)
      data.set([r!, g!, b!, a], (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

const at = (pixels: Pixels, x: number, y: number) => {
  const p = (y * pixels.width + x) * 4
  return [...pixels.data.slice(p, p + 4)]
}

const rgb = (pixels: Pixels, x: number, y: number) => at(pixels, x, y).slice(0, 3)

/**
 * A rectangle `[x0, y0, x1, y1]` of the front view showing the texture's
 * `[u0, v0, u1, v1]`, `z` deep, facing the front by `n`.
 */
function quad(
  [x0, y0, x1, y1]: number[],
  [u0, v0, u1, v1]: number[],
  z = 0,
  n = 1,
): HeadTriangle[] {
  const flat = [z, z, z]
  const facing = [n, n, n]
  return [
    {
      x: [x0!, x1!, x0!],
      y: [y0!, y0!, y1!],
      u: [u0!, u1!, u0!],
      v: [v0!, v0!, v1!],
      z: flat,
      n: facing,
    },
    {
      x: [x1!, x1!, x0!],
      y: [y0!, y1!, y1!],
      u: [u1!, u1!, u0!],
      v: [v0!, v1!, v1!],
      z: flat,
      n: facing,
    },
  ]
}

const SKIN: Rgb = [200, 160, 130]
const BLUE = [0, 0, 255]

/** A front view painted one colour, keeping its depth. */
function paint(front: ReturnType<typeof renderFront>, color: number[]) {
  const { data } = front.image
  for (let p = 0; p < data.length; p += 4) data.set(color, p)
  return front
}

describe('rendering the head to the front', () => {
  // Red, green / blue, white quarters.
  const quarters = image(64, 64, (x, y) =>
    y < 32 ? (x < 32 ? [255, 0, 0] : [0, 255, 0]) : x < 32 ? [0, 0, 255] : [255, 255, 255],
  )

  test('draws a textured quad the right way up, covering just its pixels', () => {
    const front = renderFront(quarters, quad([0.25, 0.25, 0.75, 0.75], [0, 0, 1, 1], 0.05), 32)
    expect(rgb(front.image, 10, 10)).toEqual([255, 0, 0])
    expect(rgb(front.image, 21, 10)).toEqual([0, 255, 0])
    expect(rgb(front.image, 10, 21)).toEqual([0, 0, 255])
    expect(rgb(front.image, 21, 21)).toEqual([255, 255, 255])
    let drawn = 0
    for (let i = 0; i < 32 * 32; i++) {
      const alpha = front.image.data[i * 4 + 3]
      expect(alpha === 0 || alpha === 255).toBe(true)
      if (alpha === 255) drawn++
    }
    expect(drawn).toBe(16 * 16)
    expect(at(front.image, 2, 2)).toEqual([0, 0, 0, 0])
    expect(front.depth[16 * 32 + 16]).toBeCloseTo(0.05, 6)
    expect(front.depth[2 * 32 + 2]).toBe(Number.NEGATIVE_INFINITY)
  })

  test('the nearer surface wins, whichever is drawn first', () => {
    const near = quad([0.2, 0.2, 0.6, 0.6], [0, 0, 0.4, 0.4], 0.03)
    const far = quad([0.4, 0.4, 0.8, 0.8], [0.6, 0.6, 1, 1], 0)
    for (const triangles of [
      [...near, ...far],
      [...far, ...near],
    ]) {
      const front = renderFront(quarters, triangles, 32)
      // Both cover (0.5, 0.5): the near quad's red shows.
      expect(rgb(front.image, 16, 16)).toEqual([255, 0, 0])
      expect(front.depth[16 * 32 + 16]).toBeCloseTo(0.03, 6)
      // Where only the far one is, its white.
      expect(rgb(front.image, 23, 23)).toEqual([255, 255, 255])
    }
  })

  test('skips triangles facing away', () => {
    const away = quad([0, 0, 1, 1], [0, 0, 1, 1], 0, -0.5)
    const mostlyAway: HeadTriangle = {
      x: [0, 1, 0],
      y: [0, 0, 1],
      u: [0, 1, 0],
      v: [0, 0, 1],
      z: [0, 0, 0],
      n: [0.4, -0.3, -0.3],
    }
    const front = renderFront(quarters, [...away, mostlyAway], 16)
    expect(front.image.data.every((value) => value === 0)).toBe(true)
    expect(front.depth.every((depth) => depth === Number.NEGATIVE_INFINITY)).toBe(true)
  })

  test('renders ~4000 triangles into 1024² quickly', () => {
    // A sphere filling most of the view, as a head does.
    const rings = 32
    const segments = 64
    const vertex = (ring: number, segment: number) => {
      const theta = (ring / rings) * Math.PI
      const phi = (segment / segments) * Math.PI * 2
      const nx = Math.sin(theta) * Math.cos(phi)
      const ny = Math.cos(theta)
      const nz = Math.sin(theta) * Math.sin(phi)
      return {
        x: 0.5 + nx * 0.45,
        y: 0.5 - ny * 0.45,
        z: nz * 0.1,
        n: nz,
        u: phi / (Math.PI * 2),
        v: ring / rings,
      }
    }
    const sphere: HeadTriangle[] = []
    const triangle = (...corners: ReturnType<typeof vertex>[]): HeadTriangle => ({
      x: corners.map((c) => c.x),
      y: corners.map((c) => c.y),
      z: corners.map((c) => c.z),
      n: corners.map((c) => c.n),
      u: corners.map((c) => c.u),
      v: corners.map((c) => c.v),
    })
    for (let ring = 0; ring < rings; ring++) {
      for (let segment = 0; segment < segments; segment++) {
        const a = vertex(ring, segment)
        const b = vertex(ring, segment + 1)
        const c = vertex(ring + 1, segment)
        const d = vertex(ring + 1, segment + 1)
        sphere.push(triangle(a, b, c), triangle(b, d, c))
      }
    }
    expect(sphere.length).toBe(4096)
    const texture = image(1024, 1024, (x, y) => [x & 255, y & 255, (x ^ y) & 255])
    const start = performance.now()
    const front = renderFront(texture, sphere, 1024)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(300)
    let drawn = 0
    for (let i = 3; i < front.image.data.length; i += 4) if (front.image.data[i]) drawn++
    expect(drawn / (1024 * 1024)).toBeCloseTo(Math.PI * 0.45 * 0.45, 2)
  })
})

describe('baking the front view back into the texture', () => {
  test('a front view baked back unchanged leaves the texture as it was', () => {
    const texture = image(32, 32, (x, y) => [40 + x * 4, 30 + y * 5, 100])
    const original = new Uint8ClampedArray(texture.data)
    const square = quad([0, 0, 1, 1], [0, 0, 1, 1])
    const front = renderFront(texture, square, 32)
    bakeFront(texture, square, front, new Float32Array(32 * 32).fill(1))
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(texture.data[i]! - original[i]!)).toBeLessThanOrEqual(1)
    }
  })

  test('takes the edited front where the weight is 1, and not where it is 0', () => {
    const texture = image(32, 32, (x, y) => [40 + x * 4, 30 + y * 5, 100])
    const square = quad([0, 0, 1, 1], [0, 0, 1, 1])
    const front = paint(renderFront(texture, square, 32), BLUE)
    // The left half of the front view.
    const weight = new Float32Array(32 * 32).map((_, i) => (i % 32 < 16 ? 1 : 0))
    bakeFront(texture, square, front, weight)
    expect(rgb(texture, 4, 10)).toEqual(BLUE)
    expect(rgb(texture, 12, 20)).toEqual(BLUE)
    expect(rgb(texture, 20, 10)).toEqual([40 + 20 * 4, 30 + 10 * 5, 100])
    expect(rgb(texture, 28, 20)).toEqual([40 + 28 * 4, 30 + 20 * 5, 100])
  })

  test('leaves texels a nearer surface hides in the front view', () => {
    const texture = image(64, 64, () => SKIN)
    // The skin across the view on the texture's left half; 2 cm before its
    // middle, a nose on the right half.
    const skin = quad([0, 0, 1, 1], [0, 0, 0.5, 1], 0)
    const nose = quad([0.25, 0.25, 0.75, 0.75], [0.5, 0, 1, 1], 0.02)
    const triangles = [...skin, ...nose]
    const front = paint(renderFront(texture, triangles, 64), BLUE)
    bakeFront(texture, triangles, front, new Float32Array(64 * 64).fill(1))
    // The skin behind the nose (front view 0.5, 0.5) keeps its own.
    expect(rgb(texture, 16, 32)).toEqual(SKIN)
    // The skin beside it (0.2, 0.5) and at a corner (0.1, 0.1) take the front view…
    expect(rgb(texture, 6, 32)).toEqual(BLUE)
    expect(rgb(texture, 3, 6)).toEqual(BLUE)
    // …as does the nose.
    expect(rgb(texture, 48, 32)).toEqual(BLUE)
    // The skin's rim reaching past its edge (u = 0.5) leaves the nose's texels to the nose.
    expect(rgb(texture, 32, 32)).toEqual(BLUE)
  })

  test('fades out where the surface turns away from the front', () => {
    const bake = (n: number) => {
      const texture = image(16, 16, () => SKIN)
      const square = quad([0, 0, 1, 1], [0, 0, 1, 1], 0, n)
      const front = paint(renderFront(texture, square, 16), BLUE)
      bakeFront(texture, square, front, new Float32Array(16 * 16).fill(1))
      return rgb(texture, 8, 8)
    }
    expect(bake(0.2)).toEqual(SKIN)
    expect(bake(0.9)).toEqual(BLUE)
    const half = bake((0.3 + 0.65) / 2)
    expect(half[2]!).toBeGreaterThan(SKIN[2] + 40)
    expect(half[2]!).toBeLessThan(250)
  })
})

describe('dyeing an iris', () => {
  // An eyeball on the front view at (0.3, 0.4), 0.05 across its half, as a
  // dome; its texture on the right half, the front view's square onto it.
  const centre = [0.3, 0.4] as const
  const r = 0.05
  const steps = 16
  const corner = (i: number, j: number) => {
    const x = centre[0] - r + (i / steps) * 2 * r
    const y = centre[1] - r + (j / steps) * 2 * r
    const d = Math.min(1, Math.hypot(x - centre[0], y - centre[1]) / r)
    const n = Math.sqrt(1 - d * d)
    return { x, y, z: 0.012 * n, n, u: 0.5 + (i / steps) * 0.5, v: j / steps }
  }
  const eye: HeadTriangle[] = []
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      const quadCorners = [corner(i, j), corner(i + 1, j), corner(i, j + 1), corner(i + 1, j + 1)]
      for (const [a, b, c] of [
        [0, 1, 2],
        [1, 3, 2],
      ] as const) {
        const tri = [quadCorners[a]!, quadCorners[b]!, quadCorners[c]!]
        eye.push({
          x: tri.map((k) => k.x),
          y: tri.map((k) => k.y),
          z: tri.map((k) => k.z),
          n: tri.map((k) => k.n),
          u: tri.map((k) => k.u),
          v: tri.map((k) => k.v),
        })
      }
    }
  }
  /** How far a texel of the eye's half is from the eye's centre, over its half-width. */
  const distance = (x: number, y: number) =>
    Math.hypot(((x + 0.5) / 64 - 0.75) * 4, ((y + 0.5) / 64 - 0.5) * 2)
  const PUPIL: Rgb = [12, 10, 10]
  const BROWN: Rgb = [120, 80, 40]
  const SCLERA: Rgb = [235, 230, 225]
  const texture = image(64, 64, (x, y) => {
    if (x < 32) return SKIN
    const d = distance(x, y)
    return d < 0.12 ? PUPIL : d < 0.44 ? BROWN : SCLERA
  })
  tintIris(texture, eye, [40, 90, 200])

  test('dyes the iris', () => {
    // 0.28 from the centre.
    expect(distance(52, 32)).toBeCloseTo(0.28, 1)
    const [red, green, blue] = rgb(texture, 52, 32) as Rgb
    expect(blue).toBeGreaterThan(green * 1.5)
    expect(green).toBeGreaterThan(red)
    // About as light as it was.
    expect(Math.abs(luminance(red, green, blue) - luminance(...BROWN))).toBeLessThan(25)
  })

  test('keeps the pupil dark', () => {
    expect(distance(47, 32)).toBeLessThan(0.12)
    expect(luminance(...(rgb(texture, 47, 32) as Rgb))).toBeLessThan(25)
  })

  test('leaves the sclera and the rest of the texture', () => {
    expect(distance(59, 32)).toBeGreaterThan(0.6)
    expect(rgb(texture, 59, 32)).toEqual(SCLERA)
    expect(rgb(texture, 48, 4)).toEqual(SCLERA)
    expect(rgb(texture, 10, 10)).toEqual(SKIN)
    expect(rgb(texture, 31, 32)).toEqual(SKIN)
  })
})

/**
 * A bumpy sheet over the front view's `[x0, y0, x1, y1]`, `cells` a side
 * with its corners jittered (so its triangles are uneven), `z` deep, its
 * texture's `[u0, v0, u1, v1]` stretched straight across it.
 */
function sheet(
  [x0, y0, x1, y1]: number[],
  [u0, v0, u1, v1]: number[],
  cells: number,
  z: (x: number, y: number) => number,
): HeadTriangle[] {
  const corner = (i: number, j: number) => {
    // Its outline stays straight.
    const jitter = i > 0 && j > 0 && i < cells && j < cells ? 0.3 : 0
    const fx = (i + jitter * Math.sin(i * 12.9898 + j * 78.233)) / cells
    const fy = (j + jitter * Math.cos(i * 39.346 + j * 11.135)) / cells
    const x = x0! + (x1! - x0!) * fx
    const y = y0! + (y1! - y0!) * fy
    return { x, y, z: z(x, y), n: 1, u: u0! + (u1! - u0!) * fx, v: v0! + (v1! - v0!) * fy }
  }
  const triangles: HeadTriangle[] = []
  const triangle = (...corners: ReturnType<typeof corner>[]): HeadTriangle => ({
    x: corners.map((c) => c.x),
    y: corners.map((c) => c.y),
    z: corners.map((c) => c.z),
    n: corners.map((c) => c.n),
    u: corners.map((c) => c.u),
    v: corners.map((c) => c.v),
  })
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = corner(i, j)
      const b = corner(i + 1, j)
      const c = corner(i, j + 1)
      const d = corner(i + 1, j + 1)
      triangles.push(triangle(a, b, c), triangle(b, d, c))
    }
  }
  return triangles
}

/** The front view the slow way: each pixel centre's nearest triangle, its texture bilinear. */
function referenceFront(texture: Pixels, triangles: readonly HeadTriangle[], size: number) {
  const image = new Uint8ClampedArray(size * size * 4)
  const depth = new Float64Array(size * size).fill(Number.NEGATIVE_INFINITY)
  const texel = (x: number, y: number, c: number) =>
    texture.data[
      (Math.min(texture.height - 1, Math.max(0, y)) * texture.width +
        Math.min(texture.width - 1, Math.max(0, x))) *
        4 +
        c
    ]!
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sx = (px + 0.5) / size
      const sy = (py + 0.5) / size
      let best: { z: number; u: number; v: number } | null = null
      for (const tri of triangles) {
        if (tri.n[0]! + tri.n[1]! + tri.n[2]! <= 0) continue
        const [ax, bx, cx] = tri.x as [number, number, number]
        const [ay, by, cy] = tri.y as [number, number, number]
        const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if (area === 0) continue
        const w0 = ((bx - sx) * (cy - sy) - (cx - sx) * (by - sy)) / area
        const w1 = ((cx - sx) * (ay - sy) - (ax - sx) * (cy - sy)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = tri.z[0]! * w0 + tri.z[1]! * w1 + tri.z[2]! * w2
        if (best && z <= best.z) continue
        best = {
          z,
          u: tri.u[0]! * w0 + tri.u[1]! * w1 + tri.u[2]! * w2,
          v: tri.v[0]! * w0 + tri.v[1]! * w1 + tri.v[2]! * w2,
        }
      }
      if (!best) continue
      const i = py * size + px
      depth[i] = best.z
      const tx = best.u * texture.width - 0.5
      const ty = best.v * texture.height - 0.5
      const x = Math.floor(Math.min(texture.width - 1, Math.max(0, tx)))
      const y = Math.floor(Math.min(texture.height - 1, Math.max(0, ty)))
      const fx = Math.min(texture.width - 1, Math.max(0, tx)) - x
      const fy = Math.min(texture.height - 1, Math.max(0, ty)) - y
      for (let c = 0; c < 3; c++) {
        image[i * 4 + c] =
          (texel(x, y, c) * (1 - fx) + texel(x + 1, y, c) * fx) * (1 - fy) +
          (texel(x, y + 1, c) * (1 - fx) + texel(x + 1, y + 1, c) * fx) * fy
      }
      image[i * 4 + 3] = 255
    }
  }
  return { image, depth }
}

describe('rendering the front, against a slow reference', () => {
  // Smooth, so a quarter-pixel shift along an edge moves a colour by little.
  const smooth = image(128, 128, (x, y) => [x * 2, y * 2, 255 - x - y])

  test('crossing bumpy sheets of uneven triangles: same pixels, colours, depths; no cracks', () => {
    const size = 96
    const outlines = [
      [0.1, 0.1, 0.8, 0.85],
      [0.3, 0.2, 0.95, 0.7],
    ]
    const triangles = [
      ...sheet(outlines[0]!, [0, 0, 1, 1], 9, (x, y) => 0.01 * Math.sin(9 * x) * Math.cos(7 * y)),
      ...sheet(outlines[1]!, [0.1, 0.2, 0.6, 0.9], 7, (x) => 0.03 * (x - 0.55)),
    ]
    const front = renderFront(smooth, triangles, size)
    const reference = referenceFront(smooth, triangles, size)
    /** How far (pixels) a pixel's centre lies outside the nearer sheet. */
    const outside = (i: number) =>
      Math.min(
        ...outlines.map(([x0, y0, x1, y1]) =>
          Math.hypot(
            Math.max(0, x0! * size - ((i % size) + 0.5), (i % size) + 0.5 - x1! * size),
            Math.max(
              0,
              y0! * size - (Math.floor(i / size) + 0.5),
              Math.floor(i / size) + 0.5 - y1! * size,
            ),
          ),
        ),
      )
    let drawn = 0
    let off = 0
    for (let i = 0; i < size * size; i++) {
      const alpha = front.image.data[i * 4 + 3]
      if (reference.depth[i] === Number.NEGATIVE_INFINITY) {
        // Past the silhouette by no more than the edge tolerance (at a corner, both ways).
        if (alpha) expect(outside(i)).toBeLessThanOrEqual(0.25 * Math.SQRT2)
        continue
      }
      drawn++
      expect(alpha).toBe(255)
      expect(Math.abs(front.depth[i]! - reference.depth[i]!)).toBeLessThan(0.0005)
      const worst = Math.max(
        ...[0, 1, 2].map((c) =>
          Math.abs(front.image.data[i * 4 + c]! - reference.image[i * 4 + c]!),
        ),
      )
      if (worst > 2) off++
    }
    expect(drawn).toBeGreaterThan(size * size * 0.5)
    // Only where the sheets cross can a quarter-pixel rim pick the other.
    expect(off / drawn).toBeLessThan(0.002)
  })

  test('a fan of hundreds of slivers leaves no cracks', () => {
    const size = 64
    const fan: HeadTriangle[] = []
    const spokes = 500
    const point = (k: number) => {
      const angle = (k / spokes) * Math.PI * 2
      return [0.5 + 0.4 * Math.cos(angle), 0.5 + 0.4 * Math.sin(angle)] as const
    }
    for (let k = 0; k < spokes; k++) {
      const [bx, by] = point(k)
      const [cx, cy] = point(k + 1)
      fan.push({
        x: [0.5, bx, cx],
        y: [0.5, by, cy],
        u: [0.5, 0.5, 0.5],
        v: [0.5, 0.5, 0.5],
        z: [0, 0, 0],
        n: [1, 1, 1],
      })
    }
    const front = renderFront(smooth, fan, size)
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const d = Math.hypot((px + 0.5) / size - 0.5, (py + 0.5) / size - 0.5)
        if (d < 0.39) expect(front.image.data[(py * size + px) * 4 + 3]).toBe(255)
        if (d > 0.41) expect(front.image.data[(py * size + px) * 4 + 3]).toBe(0)
      }
    }
  })

  test('clips triangles past the view without wrapping them onto the far side', () => {
    const size = 16
    const front = renderFront(smooth, quad([-0.5, -0.2, 0.3, 1.4], [0, 0, 1, 1]), size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        expect(front.image.data[(y * size + x) * 4 + 3]).toBe((x + 0.5) / size < 0.3 ? 255 : 0)
      }
    }
  })

  test('draws, bakes and dyes nothing for degenerate triangles', () => {
    const size = 16
    const flat: HeadTriangle[] = [
      {
        x: [0.2, 0.2, 0.2],
        y: [0.2, 0.2, 0.2],
        u: [0, 0, 0],
        v: [0, 0, 0],
        z: [0, 0, 0],
        n: [1, 1, 1],
      },
      {
        x: [0.1, 0.5, 0.9],
        y: [0.1, 0.5, 0.9],
        u: [0, 1, 0],
        v: [0, 0, 1],
        z: [0, 0, 0],
        n: [1, 1, 1],
      },
    ]
    const front = renderFront(smooth, flat, size)
    expect(front.image.data.every((value) => value === 0)).toBe(true)
    const texture = image(8, 8, () => SKIN)
    const before = new Uint8ClampedArray(texture.data)
    bakeFront(texture, flat, front, new Float32Array(size * size).fill(1))
    expect(texture.data).toEqual(before)
    tintIris(texture, flat, [0, 0, 255])
    expect(texture.data).toEqual(before)
  })
})

describe('baking the front view back, adversarially', () => {
  test('a facing island’s margin leaves a turned-away island beside it on the texture', () => {
    const texture = image(64, 64, () => SKIN)
    // The face on the texture's left half, the back of the head on its right, no gap between.
    const face = quad([0.1, 0.1, 0.6, 0.9], [0, 0, 0.5, 1], 0.05)
    const back = quad([0.2, 0.2, 0.7, 0.8], [0.5, 0, 1, 1], -0.05, 0.1)
    const triangles = [...face, ...back]
    const front = paint(renderFront(texture, triangles, 64), BLUE)
    bakeFront(texture, triangles, front, new Float32Array(64 * 64).fill(1))
    expect(rgb(texture, 31, 20)).toEqual(BLUE)
    for (let y = 0; y < 64; y++) expect(rgb(texture, 32, y)).toEqual(SKIN)
  })

  test('leaves skin another piece hides, however close, and takes none of its colour', () => {
    const texture = image(64, 64, () => SKIN)
    const skin = quad([0, 0, 1, 1], [0, 0, 1, 1], 0)
    // An eyeball 1 mm before the skin's middle, a piece of its own.
    const eyeball = quad([0.3, 0.3, 0.7, 0.7], [0, 0, 1, 1], 0.001)
    const front = renderFront(texture, [...skin, ...eyeball], 64)
    // The front view shows the eyeball white, the skin blue.
    for (let i = 0; i < 64 * 64; i++) {
      front.image.data.set(front.depth[i]! > 0.0005 ? [255, 255, 255] : BLUE, i * 4)
    }
    bakeFront(texture, skin, front, new Float32Array(64 * 64).fill(1))
    expect(rgb(texture, 32, 32)).toEqual(SKIN)
    expect(rgb(texture, 10, 32)).toEqual(BLUE)
    // Every texel kept its skin or took the skin's blue: none took any of the eyeball's white.
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const color = rgb(texture, x, y)
        expect([SKIN, BLUE].some((c) => c.every((value, i) => value === color[i]))).toBe(true)
      }
    }
  })

  test('bakes skin up to its silhouette over another piece behind it', () => {
    const texture = image(256, 16, () => SKIN)
    // A lip reaching to 16.2 pixels of a 32-pixel view, the teeth behind it past its edge.
    const lip = quad([0, 0, 16.2 / 32, 1], [0, 0, 1, 1], 0.02)
    const teeth = quad([0.4, 0, 1, 1], [0, 0, 1, 1], 0)
    const front = paint(renderFront(texture, [...lip, ...teeth], 32), BLUE)
    bakeFront(texture, lip, front, new Float32Array(32 * 32).fill(1))
    // The lip's last texels, past the last pixel centre it covers.
    for (let x = 250; x < 256; x++) expect(rgb(texture, x, 8)).toEqual(BLUE)
  })

  test('a texel shared with a turned-away triangle listed first still takes the front view', () => {
    const texture = image(16, 16, () => SKIN)
    // The back of a thin shell mapped onto the same texels as its front (mirrored UVs).
    const back = quad([0, 0, 1, 1], [0, 0, 1, 1], -0.01, -1)
    const face = quad([0, 0, 1, 1], [0, 0, 1, 1], 0.01)
    const triangles = [...back, ...face]
    const front = paint(renderFront(texture, triangles, 16), BLUE)
    bakeFront(texture, triangles, front, new Float32Array(16 * 16).fill(1))
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) expect(rgb(texture, x, y)).toEqual(BLUE)
  })

  test('leaves the texture’s alpha alone', () => {
    const texture = image(16, 16, () => [...SKIN, 77])
    const square = quad([0, 0, 1, 1], [0, 0, 1, 1])
    const front = paint(renderFront(texture, square, 16), BLUE)
    bakeFront(texture, square, front, new Float32Array(16 * 16).fill(1))
    expect(at(texture, 8, 8)).toEqual([...BLUE, 77])
  })

  test('bakes where only a single front-view pixel has any weight, and nowhere else', () => {
    const texture = image(64, 64, () => SKIN)
    const square = quad([0, 0, 1, 1], [0, 0, 1, 1])
    const front = paint(renderFront(texture, square, 32), BLUE)
    const weight = new Float32Array(32 * 32)
    weight[20 * 32 + 11] = 1
    bakeFront(texture, square, front, weight)
    // Front pixel (11, 20) is texels (22–23, 40–41).
    expect(rgb(texture, 22, 40)).toEqual([
      ...BLUE.map((c, i) => Math.round(SKIN[i]! + (c - SKIN[i]!) * 0.5625)),
    ])
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (Math.abs(x - 22.5) > 2 || Math.abs(y - 40.5) > 2)
          expect(rgb(texture, x, y)).toEqual(SKIN)
      }
    }
  })

  test('leaves texels whose front-view point falls outside the view', () => {
    const texture = image(16, 16, () => SKIN)
    // The quad's right half hangs past the view's right edge.
    const square = quad([0.5, 0, 1.5, 1], [0, 0, 1, 1])
    const front = paint(renderFront(texture, square, 16), BLUE)
    bakeFront(texture, square, front, new Float32Array(16 * 16).fill(1))
    expect(rgb(texture, 3, 8)).toEqual(BLUE)
    expect(rgb(texture, 12, 8)).toEqual(SKIN)
  })

  test('bakes 1024² into a 2048² texture quickly when only the face has weight', () => {
    const rings = 48
    const segments = 96
    const vertex = (ring: number, segment: number) => {
      const theta = (ring / rings) * Math.PI
      const phi = (segment / segments) * Math.PI * 2
      const nz = Math.sin(theta) * Math.sin(phi)
      return {
        x: 0.5 + Math.sin(theta) * Math.cos(phi) * 0.45,
        y: 0.5 - Math.cos(theta) * 0.45,
        z: nz * 0.1,
        n: nz,
        u: phi / (Math.PI * 2),
        v: ring / rings,
      }
    }
    const sphere: HeadTriangle[] = []
    const triangle = (...corners: ReturnType<typeof vertex>[]): HeadTriangle => ({
      x: corners.map((c) => c.x),
      y: corners.map((c) => c.y),
      z: corners.map((c) => c.z),
      n: corners.map((c) => c.n),
      u: corners.map((c) => c.u),
      v: corners.map((c) => c.v),
    })
    for (let ring = 0; ring < rings; ring++) {
      for (let segment = 0; segment < segments; segment++) {
        const a = vertex(ring, segment)
        const b = vertex(ring, segment + 1)
        const c = vertex(ring + 1, segment)
        const d = vertex(ring + 1, segment + 1)
        sphere.push(triangle(a, b, c), triangle(b, d, c))
      }
    }
    const texture = image(2048, 2048, (x, y) => [x & 255, y & 255, 128])
    const front = paint(renderFront(texture, sphere, 1024), BLUE)
    const weight = new Float32Array(1024 * 1024)
    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) {
        const d = Math.hypot((x / 1024 - 0.5) / 0.18, (y / 1024 - 0.55) / 0.24)
        weight[y * 1024 + x] = Math.min(1, Math.max(0, (1 - d) * 10))
      }
    }
    const start = performance.now()
    bakeFront(texture, sphere, front, weight)
    expect(performance.now() - start).toBeLessThan(250)
    // The face's middle (front view 0.5, 0.55) took the front view.
    expect(rgb(texture, 512, Math.round(((Math.acos(-0.05 / 0.45) / Math.PI) * 2048) | 0))).toEqual(
      BLUE,
    )
  })
})

describe('dyeing an iris, adversarially', () => {
  /**
   * An eyeball's front, a dome `r` across its half at (0.4, 0.4) on the
   * front view, its texture a front-on picture of it filling the texture.
   */
  const r = 0.05
  const steps = 24
  const corner = (i: number, j: number) => {
    const x = 0.4 - r + (i / steps) * 2 * r
    const y = 0.4 - r + (j / steps) * 2 * r
    const d = Math.min(1, Math.hypot(x - 0.4, y - 0.4) / r)
    const n = Math.sqrt(1 - d * d)
    return { x, y, z: 0.012 * n, n, u: i / steps, v: j / steps }
  }
  const eye: HeadTriangle[] = []
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      const corners = [corner(i, j), corner(i + 1, j), corner(i, j + 1), corner(i + 1, j + 1)]
      for (const [a, b, c] of [
        [0, 1, 2],
        [1, 3, 2],
      ] as const) {
        const tri = [corners[a]!, corners[b]!, corners[c]!]
        eye.push({
          x: tri.map((k) => k.x),
          y: tri.map((k) => k.y),
          z: tri.map((k) => k.z),
          n: tri.map((k) => k.n),
          u: tri.map((k) => k.u),
          v: tri.map((k) => k.v),
        })
      }
    }
  }
  const SIZE = 256
  const PUPIL: Rgb = [8, 6, 6]
  const IRIS: Rgb = [110, 75, 40]
  const SCLERA: Rgb = [225, 220, 215]
  /** A texel's distance, over the eyeball's radius, from `[dx, dy]` radii off the eye's apex. */
  const distance = (x: number, y: number, [dx, dy]: readonly number[] = [0, 0]) =>
    Math.hypot(((x + 0.5) / SIZE) * 2 - 1 - dx!, ((y + 0.5) / SIZE) * 2 - 1 - dy!)
  /** An eye's texture, its iris ending `edge` radii from `centre` (radii off the apex). */
  const eyeTexture = (edge: number, centre: readonly number[] = [0, 0]) =>
    image(SIZE, SIZE, (x, y) => {
      const d = distance(x, y, centre)
      return d < 0.13 ? PUPIL : d < edge ? IRIS : SCLERA
    })
  const BLUE_EYE: Rgb = [40, 90, 200]
  const isBlue = ([red, green, blue]: number[]) => blue! > green! * 1.5 && green! > red!

  test('dyes the whole iris and none of the sclera, however narrow the iris', () => {
    const texture = eyeTexture(0.34)
    tintIris(texture, eye, BLUE_EYE)
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const d = distance(x, y)
        const color = rgb(texture, x, y)
        if (d > 0.13 && d < 0.32) expect(isBlue(color)).toBe(true)
        // No blue halo round it.
        if (d > 0.37) expect(color).toEqual(SCLERA)
      }
    }
  })

  test('follows an iris painted off the eyeball’s apex (an eye turned aside)', () => {
    const centre = [0.35, 0.05]
    const texture = eyeTexture(0.36, centre)
    tintIris(texture, eye, BLUE_EYE)
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const d = distance(x, y, centre)
        const color = rgb(texture, x, y)
        if (d < 0.12) expect(luminance(...(color as Rgb))).toBeLessThan(15)
        else if (d < 0.33) expect(isBlue(color)).toBe(true)
        else if (d > 0.4) expect(color).toEqual(SCLERA)
      }
    }
  })

  test('keeps each texel’s lightness relative to the iris', () => {
    // A lighter and a darker ring through the iris; a dye dark enough not to clip.
    const texture = image(SIZE, SIZE, (x, y) => {
      const d = distance(x, y)
      if (d < 0.13) return PUPIL
      if (d < 0.25) return [150, 110, 60]
      if (d < 0.36) return [80, 50, 25]
      return SCLERA
    })
    tintIris(texture, eye, [30, 60, 110])
    const inner = rgb(texture, 128 + 24, 128) as Rgb
    const outer = rgb(texture, 128 + 38, 128) as Rgb
    expect(isBlue(inner) && isBlue(outer)).toBe(true)
    expect(luminance(...inner) / luminance(...outer)).toBeCloseTo(
      luminance(150, 110, 60) / luminance(80, 50, 25),
      1,
    )
  })

  test('dyes by `amount`', () => {
    const texture = eyeTexture(0.36)
    const full = eyeTexture(0.36)
    tintIris(texture, eye, BLUE_EYE, 0.5)
    tintIris(full, eye, BLUE_EYE)
    const [x, y] = [128 + 28, 128]
    for (let c = 0; c < 3; c++) {
      expect(rgb(texture, x, y)[c]!).toBeCloseTo((IRIS[c]! + rgb(full, x, y)[c]!) / 2, -0.5)
    }
    const none = eyeTexture(0.36)
    tintIris(none, eye, BLUE_EYE, 0)
    expect(none.data).toEqual(eyeTexture(0.36).data)
  })

  test('dyeing an eye twice (both eyes share texels) keeps the iris, spares the sclera', () => {
    const once = eyeTexture(0.36)
    tintIris(once, eye, BLUE_EYE)
    const twice = eyeTexture(0.36)
    tintIris(twice, eye, BLUE_EYE)
    tintIris(twice, eye, BLUE_EYE)
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const d = distance(x, y)
        // Only the fading rim of the iris takes a little more.
        if (d < 0.32) {
          for (let c = 0; c < 3; c++) {
            expect(Math.abs(rgb(twice, x, y)[c]! - rgb(once, x, y)[c]!)).toBeLessThanOrEqual(2)
          }
        }
        if (d > 0.38) expect(rgb(twice, x, y)).toEqual(SCLERA)
      }
    }
  })

  test('dyes an eyeball whose back shares its front’s texels, the back listed first', () => {
    const texture = eyeTexture(0.36)
    const back = eye.map((tri) => ({ ...tri, z: tri.z.map((z) => -z), n: tri.n.map((n) => -n) }))
    tintIris(texture, [...back, ...eye], BLUE_EYE)
    expect(isBlue(rgb(texture, 128 + 28, 128))).toBe(true)
    expect(rgb(texture, 128 + 60, 128)).toEqual(SCLERA)
  })

  test('leaves an eye alone when its texture shows no pupil', () => {
    const texture = image(SIZE, SIZE, () => SCLERA)
    tintIris(texture, eye, BLUE_EYE)
    expect(texture.data.every((value, i) => value === (i % 4 === 3 ? 255 : SCLERA[i % 4]))).toBe(
      true,
    )
  })

  test('leaves the texture’s alpha alone', () => {
    const texture = image(SIZE, SIZE, (x, y) => [...(distance(x, y) < 0.13 ? PUPIL : IRIS), 90])
    tintIris(texture, eye, BLUE_EYE)
    for (let i = 3; i < texture.data.length; i += 4) expect(texture.data[i]).toBe(90)
  })
})
