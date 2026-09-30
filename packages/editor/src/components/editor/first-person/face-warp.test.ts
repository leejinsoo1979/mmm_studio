import { describe, expect, test } from 'bun:test'
import type { Point } from './face-points'
import { delaunay, flattenLighting, polygonMask, seamlessClone, warpTriangles } from './face-warp'
import { luminance, type Pixels } from './look-pixels'

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

/** A seeded generator (mulberry32), so a failure reproduces. */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/** The convex hull's area (Andrew's monotone chain). */
function hullArea(points: readonly Point[]) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const chain = (list: Point[]) => {
    const hull: Point[] = []
    for (const point of list) {
      while (
        hull.length >= 2 &&
        cross(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0
      ) {
        hull.pop()
      }
      hull.push(point)
    }
    return hull.slice(0, -1)
  }
  const hull = [...chain(sorted), ...chain(sorted.reverse())]
  let area = 0
  for (let i = 0; i < hull.length; i++) {
    const [x0, y0] = hull[i]!
    const [x1, y1] = hull[(i + 1) % hull.length]!
    area += x0 * y1 - x1 * y0
  }
  return Math.abs(area) / 2
}

/** Checks every triangle winds counter-clockwise on the image and isn't flat; returns their total area. */
function meshArea(points: readonly Point[], triangles: [number, number, number][]) {
  let area = 0
  for (const [a, b, c] of triangles) {
    const twice = cross(points[a]!, points[b]!, points[c]!)
    expect(twice).toBeLessThan(0)
    area -= twice / 2
  }
  return area
}

function ellipse(cx: number, cy: number, rx: number, ry: number, count: number): Point[] {
  return Array.from({ length: count }, (_, k) => {
    const angle = (k / count) * Math.PI * 2
    return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry] as Point
  })
}

describe('delaunay', () => {
  test('no point lies inside any triangle’s circumcircle', () => {
    const next = random(1)
    const points = Array.from({ length: 250 }, () => [next() * 500, next() * 500] as Point)
    const triangles = delaunay(points)
    expect(meshArea(points, triangles)).toBeCloseTo(hullArea(points), 6)
    expect(new Set(triangles.flat()).size).toBe(points.length)
    for (const [a, b, c] of triangles) {
      const [ax, ay] = points[a]!
      const [bx, by] = points[b]!
      const [cx, cy] = points[c]!
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
      const ux =
        ((ax * ax + ay * ay) * (by - cy) +
          (bx * bx + by * by) * (cy - ay) +
          (cx * cx + cy * cy) * (ay - by)) /
        d
      const uy =
        ((ax * ax + ay * ay) * (cx - bx) +
          (bx * bx + by * by) * (ax - cx) +
          (cx * cx + cy * cy) * (bx - ax)) /
        d
      const radius = Math.hypot(ax - ux, ay - uy)
      points.forEach(([x, y], i) => {
        if (i !== a && i !== b && i !== c) {
          expect(Math.hypot(x - ux, y - uy)).toBeGreaterThan(radius * (1 - 1e-9))
        }
      })
    }
  })

  test('handles duplicates and collinear runs', () => {
    // A grid: rows and columns of collinear points, every square's corners on one circle.
    const grid: Point[] = []
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) grid.push([x * 10, y * 10])
    const points = [...grid, [30, 30], [0, 70], [70, 0]] as Point[]
    const triangles = delaunay(points)
    expect(meshArea(points, triangles)).toBeCloseTo(70 * 70, 6)
    expect(triangles).toHaveLength(7 * 7 * 2)
    // Repeats resolve to their first occurrence.
    expect(triangles.flat().every((i) => i < grid.length)).toBe(true)

    expect(
      delaunay([
        [0, 0],
        [1, 1],
        [2, 2],
        [5, 5],
        [3, 3],
      ]),
    ).toEqual([])
    expect(
      delaunay([
        [4, 4],
        [4, 4],
        [4, 4],
      ]),
    ).toEqual([])
    expect(
      delaunay([
        [0, 0],
        [1, 0],
      ]),
    ).toEqual([])
    expect(delaunay([])).toEqual([])
  })

  test('stays a clean mesh where points nearly line up or share circles', () => {
    const next = random(5)
    // Rows and columns off true by a hair: tests on them fall within rounding.
    const jittered: Point[] = []
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) jittered.push([x + next() * 1e-9, y + next() * 1e-9])
    }
    expect(meshArea(jittered, delaunay(jittered))).toBeCloseTo(hullArea(jittered), 6)
    // A face's two halves mirror each other: their points pair up on circles.
    const mirrored = Array.from(
      { length: 60 },
      () => [next() * 500, next() * 1000] as Point,
    ).flatMap(([x, y]) => [[x, y] as Point, [1000 - x, y] as Point])
    expect(meshArea(mirrored, delaunay(mirrored))).toBeCloseTo(hullArea(mirrored), 4)
  })

  test('a closed mouth’s meeting lips make valid triangles over the whole face', () => {
    const outline = ellipse(512, 540, 330, 400, 36)
    const outerLips = ellipse(512, 760, 90, 40, 12)
    // The inner lips' upper and lower points coincide; one pair only nearly.
    const upper = Array.from({ length: 7 }, (_, k) => [452 + k * 20, 760] as Point)
    const lower = upper.map(([x, y], k) => [x, k === 3 ? y + 1e-5 : y] as Point)
    const points = [...outline, ...outerLips, ...upper, ...lower]
    const triangles = delaunay(points)
    expect(meshArea(points, triangles)).toBeCloseTo(hullArea(points), 4)
    const lowerStart = outline.length + outerLips.length + upper.length
    expect(triangles.flat().every((i) => i < lowerStart)).toBe(true)
    // Every distinct point is a corner.
    expect(new Set(triangles.flat()).size).toBe(lowerStart)
  })

  test('meshes awkward point sets exactly once over their hull', () => {
    const next = random(6)
    const awkward: ((k: number) => Point)[] = [
      // Quantised coordinates: repeats, rows, columns and shared circles galore.
      () => [Math.round(next() * 12) * 5, Math.round(next() * 12) * 5],
      // Collinear runs through a scatter.
      (k) => (k % 3 ? [k * 2, (k % 3) * 40 + k * 0.5] : [next() * 120, next() * 120]),
      // A ring of cocircular points around its centre.
      (k) =>
        k === 0 ? [500, 500] : [500 + 300 * Math.cos(k * 0.37), 500 + 300 * Math.sin(k * 0.37)],
      // Far from the origin, spread over a hundredth: rounding bites hardest.
      () => [1e6 + next() * 1e-2, -3e5 + next() * 1e-2],
    ]
    for (let trial = 0; trial < 24; trial++) {
      const make = awkward[trial % awkward.length]!
      const base = Array.from({ length: 20 + Math.floor(next() * 120) }, (_, k) => make(k))
      // Repeats and near-repeats (well under or well over the merge distance).
      const points = base.flatMap((point) => {
        const roll = next()
        if (roll < 0.15) return [point, [...point] as Point]
        if (roll < 0.3) return [point, [point[0] * (1 + 1e-12), point[1]] as Point]
        return [point]
      })
      // Checked relative to the first point, where the arithmetic is exact enough.
      const [ox, oy] = points[0]!
      const local = points.map(([x, y]) => [x - ox, y - oy] as Point)
      const extent = Math.sqrt(hullArea(local))
      const distinct: number[] = []
      local.forEach(([x, y], i) => {
        const repeat = distinct.some(
          (j) => Math.hypot(local[j]![0] - x, local[j]![1] - y) < 1e-7 * extent,
        )
        if (!repeat) distinct.push(i)
      })
      const triangles = delaunay(points)
      expect(Math.abs(meshArea(local, triangles) - hullArea(local))).toBeLessThan(
        1e-9 * extent ** 2,
      )
      expect([...new Set(triangles.flat())].sort((a, b) => a - b)).toEqual(distinct)
      // Each edge is used once each way at most: nothing overlaps or folds.
      const edges = new Set<string>()
      for (const [a, b, c] of triangles) {
        for (const edge of [`${a}>${b}`, `${b}>${c}`, `${c}>${a}`]) {
          expect(edges.has(edge)).toBe(false)
          edges.add(edge)
        }
      }
    }
  })
})

describe('warping triangles', () => {
  test('the same points on both sides reproduce the source', () => {
    const next = random(2)
    const source = image(64, 64, () => [next() * 255, next() * 255, next() * 255])
    const points: Point[] = [
      [0, 0],
      [64, 0],
      [0, 64],
      [64, 64],
      ...Array.from({ length: 30 }, () => [next() * 64, next() * 64] as Point),
    ]
    const warped = warpTriangles(source, points, points, delaunay(points), 64, 64)
    expect([...warped.data]).toEqual([...source.data])
  })

  test('moves and scales a checker pattern', () => {
    // 8 px squares: dark and light.
    const checker = (x: number, y: number) =>
      (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 220 : 30
    const source = image(64, 64, (x, y) => [checker(x, y), 100, 255 - checker(x, y)])
    const from: Point[] = [
      [0, 0],
      [64, 0],
      [0, 64],
      [64, 64],
      [32, 32],
      [16, 40],
    ]
    const to = from.map(([x, y]) => [x / 2 + 20, y / 2 + 10] as Point)
    const warped = warpTriangles(source, from, to, delaunay(to), 64, 64)
    for (let y = 10; y < 42; y++) {
      for (let x = 20; x < 52; x++) {
        const sx = (x + 0.5 - 20) * 2
        const sy = (y + 0.5 - 10) * 2
        // Away from the squares' edges, where the bilinear sample blends them.
        const nearEdge = (v: number) => Math.min(v % 8, 8 - (v % 8)) < 1.5
        if (nearEdge(sx) || nearEdge(sy)) continue
        const [r, , b, a] = at(warped, x, y)
        expect(a).toBe(255)
        expect(Math.abs(r! - checker(sx, sy))).toBeLessThanOrEqual(1)
        expect(Math.abs(b! - (255 - checker(sx, sy)))).toBeLessThanOrEqual(1)
      }
    }
    // Outside the moved square nothing is drawn.
    expect(at(warped, 5, 5)[3]).toBe(0)
    expect(at(warped, 60, 50)[3]).toBe(0)
  })

  test('skips triangles flat in the result, fills ones flat in the source', () => {
    const source = image(8, 8, (x, y) => [x === y ? 200 : 0, 0, 0])
    const triangle: Point[] = [
      [0, 0],
      [8, 0],
      [0, 8],
    ]
    const flat: Point[] = [
      [0, 0],
      [4, 4],
      [8, 8],
    ]
    const tris: [number, number, number][] = [[0, 1, 2]]
    expect(warpTriangles(source, triangle, flat, tris, 8, 8).data.every((v) => v === 0)).toBe(true)
    // Every pixel of the triangle samples the source's diagonal.
    const smeared = warpTriangles(source, flat, triangle, tris, 8, 8)
    expect(at(smeared, 1, 1)[3]).toBe(255)
    expect(at(smeared, 5, 1)[3]).toBe(255)
    expect(at(smeared, 5, 1)[0]).toBeGreaterThan(100)
    expect(at(smeared, 7, 7)[3]).toBe(0)
  })

  test('leaves no gaps where edges run exactly through pixel centres', () => {
    const next = random(7)
    const source = image(32, 32, () => [200, 100, 50])
    for (let trial = 0; trial < 12; trial++) {
      // Corners on pixel centres and pixel corners, so edges hit centres exactly.
      const to = Array.from(
        { length: 20 },
        () => [Math.floor(next() * 48) / 2, Math.floor(next() * 48) / 2] as Point,
      )
      const from = to.map(([x, y]) => [x * 1.3 + 2, y * 0.8 + 5] as Point)
      const triangles = delaunay(to)
      const warped = warpTriangles(source, from, to, triangles, 24, 24)
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          const centre: Point = [x + 0.5, y + 0.5]
          const covered = triangles.some(([a, b, c]) => {
            const sides = [
              cross(to[a]!, to[b]!, centre),
              cross(to[b]!, to[c]!, centre),
              cross(to[c]!, to[a]!, centre),
            ]
            return sides.every((side) => side <= 0)
          })
          if (covered) expect(at(warped, x, y)).toEqual([200, 100, 50, 255])
        }
      }
    }
  })

  test('skips triangles with a corner that isn’t finite', () => {
    const source = image(8, 8, () => [255, 255, 255])
    const triangle: Point[] = [
      [0, 0],
      [8, 0],
      [0, 8],
    ]
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const broken: Point[] = [triangle[0]!, [bad, 0], triangle[2]!]
      const tris: [number, number, number][] = [[0, 1, 2]]
      expect(warpTriangles(source, broken, triangle, tris, 8, 8).data.every((v) => v === 0)).toBe(
        true,
      )
      expect(warpTriangles(source, triangle, broken, tris, 8, 8).data.every((v) => v === 0)).toBe(
        true,
      )
    }
  })
})

describe('polygon masks', () => {
  test('0 outside, 1 deep inside, rising smoothly across the feather', () => {
    const square: Point[] = [
      [10, 10],
      [50, 10],
      [50, 50],
      [10, 50],
    ]
    const mask = polygonMask(square, 64, 64, 8)
    const value = (x: number, y: number) => mask[y * 64 + x]!
    expect(value(30, 30)).toBe(1)
    expect(value(5, 5)).toBe(0)
    expect(value(55, 30)).toBe(0)
    expect(value(9, 30)).toBe(0)
    expect(value(10, 30)).toBeGreaterThan(0)
    for (let x = 10; x < 30; x++) expect(value(x + 1, 30)).toBeGreaterThanOrEqual(value(x, 30))
    expect(value(14, 30)).toBeGreaterThan(0.2)
    expect(value(14, 30)).toBeLessThan(0.8)
    expect(value(18, 30)).toBe(1)
  })

  test('leaves a concave polygon’s notch out', () => {
    // A U: two arms joined along the bottom.
    const u: Point[] = [
      [4, 4],
      [16, 4],
      [16, 40],
      [48, 40],
      [48, 4],
      [60, 4],
      [60, 60],
      [4, 60],
    ]
    const mask = polygonMask(u, 64, 64, 0)
    const value = (x: number, y: number) => mask[y * 64 + x]!
    expect(value(32, 20)).toBe(0)
    expect(value(10, 20)).toBe(1)
    expect(value(54, 20)).toBe(1)
    expect(value(32, 50)).toBe(1)
    const feathered = polygonMask(u, 64, 64, 6)
    // Just below the notch the skin nearest its floor is feathered too.
    expect(feathered[42 * 64 + 32]!).toBeLessThan(1)
    expect(feathered[42 * 64 + 32]!).toBeGreaterThan(0)
  })

  test('matches a pixel-by-pixel fill and distance on awkward polygons', () => {
    const next = random(8)
    const [width, height] = [40, 30]
    for (let trial = 0; trial < 24; trial++) {
      // Self-crossing, partly off the image, with corners on pixel-centre rows.
      const polygon = Array.from(
        { length: 3 + Math.floor(next() * 12) },
        () =>
          [
            Math.round(next() * 50) - 5,
            Math.round(next() * 40) - 5 + (next() < 0.5 ? 0.5 : 0),
          ] as Point,
      )
      if (trial % 2) polygon.reverse()
      const feather = [0, 2.5, 9][trial % 3]!
      const mask = polygonMask(polygon, width, height, feather)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const [px, py] = [x + 0.5, y + 0.5]
          let inside = false
          let nearest = Number.POSITIVE_INFINITY
          polygon.forEach(([x0, y0], e) => {
            const [x1, y1] = polygon[(e + 1) % polygon.length]!
            if (y0 <= py !== y1 <= py && px < x0 + ((py - y0) * (x1 - x0)) / (y1 - y0)) {
              inside = !inside
            }
            const length = (x1 - x0) ** 2 + (y1 - y0) ** 2
            const t = length ? ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / length : 0
            const along = Math.min(1, Math.max(0, t))
            nearest = Math.min(
              nearest,
              Math.hypot(px - x0 - along * (x1 - x0), py - y0 - along * (y1 - y0)),
            )
          })
          const depth = feather > 0 ? Math.min(1, nearest / feather) : 1
          const expected = inside ? depth * depth * (3 - 2 * depth) : 0
          expect(Math.abs(mask[y * width + x]! - expected)).toBeLessThan(1e-5)
        }
      }
    }
  })

  test('is quick on a full-size face', () => {
    const outline = ellipse(512, 540, 330, 400, 36)
    const start = performance.now()
    const mask = polygonMask(outline, 1024, 1024, 24)
    expect(performance.now() - start).toBeLessThan(150)
    expect(mask[540 * 1024 + 512]).toBe(1)
  })
})

describe('flattening lighting', () => {
  // Grey light falling off from right to left, over a fine checker of ±10 %.
  const lit = () =>
    image(256, 256, (x, y) => {
      const light = 60 + (120 * x) / 255
      const v = light * ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 1.1 : 0.9)
      return [v, v, v]
    })
  const everywhere = new Float32Array(256 * 256).fill(1)
  /** Mean lightness of the 8-px-wide column band at x, down the middle rows. */
  const band = (pixels: Pixels, x: number) => {
    let sum = 0
    for (let y = 64; y < 192; y++) {
      for (let dx = 0; dx < 8; dx++) {
        const [r, g, b] = at(pixels, x + dx, y)
        sum += luminance(r!, g!, b!)
      }
    }
    return sum / (128 * 8)
  }
  const spread = (pixels: Pixels) => {
    const bands = [64, 96, 128, 160, 184].map((x) => band(pixels, x))
    return Math.max(...bands) - Math.min(...bands)
  }
  /** Weber contrast of the checker's squares around (x, y). */
  const contrast = (pixels: Pixels, x: number, y: number) => {
    const light = at(pixels, x + 2, y + 2)[0]!
    const dark = at(pixels, x + 6, y + 2)[0]!
    return (light - dark) / (light + dark)
  }

  test('evens out a sweep of light and keeps small detail', () => {
    const pixels = lit()
    const before = { spread: spread(pixels), contrast: contrast(pixels, 128, 128) }
    flattenLighting(pixels, everywhere, 1, 16)
    expect(spread(pixels)).toBeLessThan(before.spread / 20)
    expect(Math.abs(contrast(pixels, 128, 128) - before.contrast)).toBeLessThan(0.02)
    expect(Math.abs(contrast(pixels, 72, 128))).toBeGreaterThan(0.08)
  })

  test('strength 0 and pixels outside the mask are left alone', () => {
    const pixels = lit()
    const original = [...pixels.data]
    flattenLighting(pixels, everywhere, 0, 16)
    expect([...pixels.data]).toEqual(original)
    const leftHalf = new Float32Array(256 * 256).map((_, i) => (i % 256 < 128 ? 1 : 0))
    flattenLighting(pixels, leftHalf, 1, 16)
    expect(at(pixels, 200, 100)).toEqual(
      original.slice((100 * 256 + 200) * 4, (100 * 256 + 200) * 4 + 4),
    )
    expect(at(pixels, 20, 100)).not.toEqual(
      original.slice((100 * 256 + 20) * 4, (100 * 256 + 20) * 4 + 4),
    )
  })

  test('matches its formula worked out directly, blur edges included', () => {
    const next = random(9)
    const [width, height] = [37, 23]
    /** One box blur (zeros beyond the image), summed the slow way. */
    const box = (values: Float64Array, radius: number) => {
      const rows = new Float64Array(values.length)
      for (let i = 0; i < values.length; i++) {
        const x = i % width
        for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k++) {
          rows[i]! += values[i - x + k]! / (2 * radius + 1)
        }
      }
      values.fill(0)
      for (let i = 0; i < values.length; i++) {
        const y = Math.floor(i / width)
        for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k++) {
          values[i]! += rows[i + (k - y) * width]! / (2 * radius + 1)
        }
      }
    }
    // Radii from a pixel to wider than the image, over a patchy, feathered mask.
    for (const [radius, strength] of [
      [1, 1],
      [4, 0.6],
      [30, 1.5],
    ] as const) {
      const pixels = image(width, height, () => [next() * 255, next() * 255, next() * 255])
      const original = pixels.data.slice()
      const mask = new Float32Array(width * height).map(() => (next() < 0.3 ? 0 : next()))
      flattenLighting(pixels, mask, strength, radius)
      const lit = new Float64Array(width * height)
      const weight = new Float64Array(width * height)
      mask.forEach((m, i) => {
        lit[i] = luminance(original[i * 4]!, original[i * 4 + 1]!, original[i * 4 + 2]!) * m
        weight[i] = m
      })
      const mean = lit.reduce((a, b) => a + b) / weight.reduce((a, b) => a + b)
      for (let pass = 0; pass < 3; pass++) {
        box(lit, radius)
        box(weight, radius)
      }
      mask.forEach((m, i) => {
        const factor = m > 0 ? (mean / Math.max(lit[i]! / weight[i]!, 1)) ** strength : 1
        for (let c = 0; c < 3; c++) {
          const value = original[i * 4 + c]!
          const expected = value + (Math.min(255, value * factor) - value) * m
          expect(Math.abs(pixels.data[i * 4 + c]! - expected)).toBeLessThanOrEqual(0.51)
        }
      })
    }
  })
})

describe('seamless cloning', () => {
  const disc = (size: number, cx: number, cy: number, radius: number) =>
    new Float32Array(size * size).map((_, i) =>
      Math.hypot((i % size) + 0.5 - cx, Math.floor(i / size) + 0.5 - cy) < radius ? 1 : 0,
    )

  test('a source offset from the target blends back to the target', () => {
    const next = random(3)
    const target = image(128, 128, (x, y) => [
      60 + x + next() * 20,
      140 - y * 0.5 + next() * 20,
      90 + 40 * Math.sin(x / 9),
    ])
    const source = { ...target, data: target.data.map((v, i) => (i % 4 === 3 ? v : v + 30)) }
    const region = disc(128, 64, 64, 40)
    const blended = seamlessClone(source, target, region, 1)
    for (let i = 0; i < blended.data.length; i++) {
      expect(Math.abs(blended.data[i]! - target.data[i]!)).toBeLessThan(2)
    }
    // At strength 0 the region shows the source untouched.
    const pasted = seamlessClone(source, target, region, 0)
    expect(at(pasted, 64, 64)).toEqual(at(source, 64, 64))
    expect(at(pasted, 2, 2)).toEqual(at(target, 2, 2))
  })

  test('a small bright feature keeps its contrast', () => {
    const skinColour = [90, 70, 60]
    const target = image(96, 96, () => skinColour)
    const source = image(96, 96, (x, y) =>
      Math.abs(x - 47.5) < 3 && Math.abs(y - 47.5) < 3 ? [230, 220, 210] : [160, 140, 120],
    )
    const blended = seamlessClone(source, target, disc(96, 48, 48, 30), 1)
    const feature = at(blended, 47, 47)
    const skin = at(blended, 60, 47)
    const sourceContrast = [70, 80, 90]
    for (let c = 0; c < 3; c++) {
      expect(skin[c]).toBe(skinColour[c]!)
      expect(Math.abs(feature[c]! - skin[c]! - sourceContrast[c]!)).toBeLessThanOrEqual(1)
    }
  })

  test('meets the target without a seam', () => {
    const target = image(128, 128, (x) => [40 + x, 60 + x / 2, 200 - x])
    const source = image(128, 128, (_, y) => [220 - y, 30 + y, 120])
    const region = disc(128, 60, 70, 45)
    const blended = seamlessClone(source, target, region, 1)
    let seam = 0
    for (let y = 1; y < 127; y++) {
      for (let x = 1; x < 127; x++) {
        if (!region[y * 128 + x]) continue
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ] as const) {
          if (region[ny * 128 + nx]) continue
          for (let c = 0; c < 3; c++) {
            seam = Math.max(seam, Math.abs(at(blended, x, y)[c]! - at(target, nx, ny)[c]!))
          }
        }
      }
    }
    // A plain paste would jump by up to ~150 levels here.
    expect(seam).toBeLessThanOrEqual(3)
  })

  test('matches a brute-force solve, even where the region meets the image’s rim', () => {
    const next = random(4)
    const size = 48
    const target = image(size, size, (x, y) => [
      150 + 50 * Math.sin(y / 4),
      40 + x * 3 + next() * 30,
      100 + next() * 60,
    ])
    const source = image(size, size, (x, y) => [80 + next() * 40, 200 - y * 2, 60 + x])
    // A disc spilling off the image's left edge.
    const region = disc(size, 6, 24, 20)
    const blended = seamlessClone(source, target, region, 1)
    // Plain over-relaxation, to convergence, in double precision.
    const d = new Float64Array(size * size * 3)
    for (let i = 0; i < size * size; i++) {
      if (!region[i])
        for (let c = 0; c < 3; c++) d[i * 3 + c] = target.data[i * 4 + c]! - source.data[i * 4 + c]!
    }
    for (let sweep = 0; sweep < 1500; sweep++) {
      for (let i = 0; i < size * size; i++) {
        if (!region[i]) continue
        const x = i % size
        const y = Math.floor(i / size)
        const neighbours = [
          x > 0 && i - 1,
          x < size - 1 && i + 1,
          y > 0 && i - size,
          y < size - 1 && i + size,
        ]
        const present = neighbours.filter((n): n is number => n !== false)
        for (let c = 0; c < 3; c++) {
          const mean = present.reduce((sum, n) => sum + d[n * 3 + c]!, 0) / present.length
          d[i * 3 + c] = d[i * 3 + c]! + 1.85 * (mean - d[i * 3 + c]!)
        }
      }
    }
    for (let i = 0; i < size * size; i++) {
      if (!region[i]) continue
      for (let c = 0; c < 3; c++) {
        const expected = Math.min(255, Math.max(0, source.data[i * 4 + c]! + d[i * 3 + c]!))
        expect(Math.abs(blended.data[i * 4 + c]! - expected)).toBeLessThan(1)
      }
    }
  })

  /**
   * D to convergence by conjugate gradients in doubles: Laplace's equation
   * over the region, `boundary` at the cells around it, nothing flowing
   * across the image's rim.
   */
  function harmonicFill(
    width: number,
    height: number,
    region: Float32Array,
    boundary: (i: number, c: number) => number,
  ) {
    const count = width * height
    const inside = (i: number) => region[i]! > 0.5
    const neighbours = Array.from({ length: count }, (_, i) => {
      const x = i % width
      const y = Math.floor(i / width)
      return [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ].filter((j) => j >= 0)
    })
    const apply = (v: Float64Array, out: Float64Array) => {
      for (let i = 0; i < count; i++) {
        if (!inside(i)) continue
        out[i] = neighbours[i]!.length * v[i]!
        for (const j of neighbours[i]!) if (inside(j)) out[i]! -= v[j]!
      }
    }
    const fill = new Float64Array(count * 3)
    for (let c = 0; c < 3; c++) {
      const solution = new Float64Array(count)
      const residual = new Float64Array(count)
      for (let i = 0; i < count; i++) {
        if (!inside(i)) continue
        for (const j of neighbours[i]!) if (!inside(j)) residual[i]! += boundary(j, c)
      }
      const direction = residual.slice()
      const product = new Float64Array(count)
      const dot = (a: Float64Array, b: Float64Array) => a.reduce((sum, v, i) => sum + v * b[i]!, 0)
      let size = dot(residual, residual)
      const start = size
      for (let step = 0; step < 5000 && size > 1e-24 * start; step++) {
        apply(direction, product)
        const alpha = size / dot(direction, product)
        for (let i = 0; i < count; i++) {
          solution[i]! += alpha * direction[i]!
          residual[i]! -= alpha * product[i]!
        }
        const previous = size
        size = dot(residual, residual)
        for (let i = 0; i < count; i++)
          direction[i] = residual[i]! + (size / previous) * direction[i]!
      }
      solution.forEach((v, i) => {
        fill[i * 3 + c] = v
      })
    }
    return fill
  }

  test('converges where the image’s rim, not the target, surrounds most of the region', () => {
    const next = random(10)
    const size = 96
    const target = image(size, size, (x, y) => [
      130 + 60 * Math.sin(x / 7 + y / 11) + next() * 50,
      110 + x * 0.6 + next() * 50,
      90 + 50 * Math.cos(y / 5) + next() * 50,
    ])
    const source = image(size, size, (x, y) => [110 + 20 * Math.sin(y / 3), 120, 100 + x * 0.3])
    const cells = (inside: (x: number, y: number) => boolean) =>
      new Float32Array(size * size).map((_, i) => (inside(i % size, Math.floor(i / size)) ? 1 : 0))
    for (const region of [
      // A face spilling off the bottom and both sides.
      cells((x, y) => ((x - 47.5) / 55) ** 2 + ((y - 64) / 60) ** 2 < 1),
      // All but a 2×2 block in a corner, or a single pixel: boundary is scarce.
      cells((x, y) => x > 1 || y > 1),
      cells((x, y) => x !== 50 || y !== 30),
    ]) {
      const blended = seamlessClone(source, target, region, 1)
      const fill = harmonicFill(
        size,
        size,
        region,
        (i, c) => target.data[i * 4 + c]! - source.data[i * 4 + c]!,
      )
      for (let i = 0; i < size * size; i++) {
        for (let c = 0; c < 3; c++) {
          const exact = region[i]
            ? source.data[i * 4 + c]! + fill[i * 3 + c]!
            : target.data[i * 4 + c]!
          // Within rounding of the exact blend, the solver's own error a fraction of a level.
          expect(Math.abs(blended.data[i * 4 + c]! - exact)).toBeLessThan(0.8)
        }
      }
    }
  })

  test('a region covering the whole image keeps the source', () => {
    const next = random(11)
    const source = image(40, 30, () => [next() * 255, next() * 255, next() * 255, 17])
    const target = image(40, 30, () => [0, 0, 0])
    const blended = seamlessClone(source, target, new Float32Array(40 * 30).fill(1), 1)
    expect([...blended.data]).toEqual([...source.data].map((v, i) => (i % 4 === 3 ? 255 : v)))
  })

  test('a harsh, noisy boundary still solves to within a fraction of a level', () => {
    const next = random(12)
    const size = 128
    // Mid-grey source, so source + D never clips and the result shows D itself.
    const source = image(size, size, () => [128, 128, 128])
    const target = image(size, size, () => [
      128 + (next() - 0.5) * 180,
      128 + (next() - 0.5) * 180,
      128 + (next() - 0.5) * 180,
    ])
    const region = disc(size, 60, 66, 50)
    const blended = seamlessClone(source, target, region, 1)
    const fill = harmonicFill(size, size, region, (i, c) => target.data[i * 4 + c]! - 128)
    for (let i = 0; i < size * size; i++) {
      if (!region[i]) continue
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(blended.data[i * 4 + c]! - (128 + fill[i * 3 + c]!))).toBeLessThan(0.8)
      }
    }
  })

  test('is quick on a full-size face', () => {
    const next = random(5)
    const size = 1024
    const target = image(size, size, (x, y) => [180 - x / 8, 120 + y / 10, 100 + next() * 20])
    const source = image(size, size, (x, y) => [
      140 + 40 * Math.sin(x / 40),
      110 + 30 * Math.cos(y / 30),
      80 + next() * 40,
    ])
    const region = polygonMask(ellipse(512, 540, 330, 400, 36), size, size, 24)
    let covered = 0
    for (const m of region) if (m > 0.5) covered++
    expect(covered / region.length).toBeGreaterThan(0.35)
    const start = performance.now()
    const blended = seamlessClone(source, target, region, 1)
    expect(performance.now() - start).toBeLessThan(400)
    // Continuous with the target at the face's edge, the source's detail within.
    const [r] = at(blended, 512, 540 - 400 + 26)
    expect(Math.abs(r! - at(target, 512, 540 - 400 + 20)[0]!)).toBeLessThan(6)
  })
})
