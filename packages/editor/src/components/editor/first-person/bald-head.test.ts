import { describe, expect, test } from 'bun:test'
import {
  bentSkull,
  cleanCut,
  cutRings,
  hairShadow,
  hollowShade,
  keptTriangles,
  necklineFan,
  type OwnHead,
  ownHair,
  PAINTED,
  READ,
  SCALP,
  SHADED,
  scalpPaint,
  scalpTriangles,
  scalpUvs,
  smoothNape,
  spreadWeights,
  TONE_RINGS,
  texelShares,
  withNeckPiece,
} from './bald-head'
import { PointGrid, type Skull } from './head-skull'

/** What a strip's column of points is: over the skull, on the texture, in the bind pose. */
type Column = {
  zone?: number
  height?: number
  off?: number
  shell?: number
  y?: number
  z?: number
}

/**
 * A strip of `quads` quads along x, a column of two points between each
 * (0.01 apart), each column as `at` says; with per-triangle texture shares
 * when given. Quad q is triangles 2q and 2q + 1.
 */
function strip(
  quads: number,
  at: (column: number) => Column,
  shares: { hair?: (quad: number) => number; notSkin?: (quad: number) => number } = {},
  marks = { neck: -1, eyeFront: 1 },
): OwnHead {
  const columns = quads + 1
  const points: number[] = []
  const zone: number[] = []
  const height: number[] = []
  const off: number[] = []
  const shell: number[] = []
  for (let c = 0; c < columns; c++) {
    const column = at(c)
    for (let row = 0; row < 2; row++) {
      points.push(c * 0.01, (column.y ?? 0) + row * 0.01, column.z ?? 0)
      zone.push(column.zone ?? 0)
      height.push(column.height ?? 0)
      off.push(column.off ?? 0.001)
      shell.push(column.shell ?? 0)
    }
  }
  const index: number[] = []
  for (let q = 0; q < quads; q++) {
    const [a, b, c, d] = [q * 2, q * 2 + 2, q * 2 + 3, q * 2 + 1]
    index.push(a, b, c, a, c, d)
  }
  const perTriangle = (share?: (quad: number) => number) =>
    share ? Float32Array.from({ length: quads * 2 }, (_, t) => share(Math.floor(t / 2))) : null
  return {
    points: Float32Array.from(points),
    index,
    spots: Int32Array.from({ length: columns * 2 }, (_, i) => i),
    spotCount: columns * 2,
    shell,
    height: Float32Array.from(height),
    zone: Float32Array.from(zone),
    off: Float32Array.from(off),
    neck: marks.neck,
    eyeFront: marks.eyeFront,
    hair: perTriangle(shares.hair),
    notSkin: perTriangle(shares.notSkin),
  }
}

/** Which quads of a strip are taken. */
const takenQuads = (flags: Uint8Array) =>
  Array.from({ length: flags.length / 2 }, (_, q) => q).filter(
    (q) => flags[q * 2] && flags[q * 2 + 1],
  )

describe('a head’s own hair', () => {
  test('is its sculpted shell, its cranium and volume standing off the skull', () => {
    expect(takenQuads(ownHair(strip(30, (c) => ({ shell: c <= 2 ? 1 : 0 }))))).toEqual([0, 1, 2])
    expect(takenQuads(ownHair(strip(30, (c) => ({ zone: c <= 5 ? 0.5 : 0 }))))).toEqual([
      0, 1, 2, 3, 4,
    ])
    expect(
      takenQuads(ownHair(strip(30, (c) => (c <= 1 ? { zone: 0.1, height: 0.01 } : {})))),
    ).toEqual([0, 1])
    // Standing off the skull far past it is no hair: an ear, a nose.
    expect(
      takenQuads(ownHair(strip(30, (c) => (c <= 1 ? { zone: 0.1, height: 0.01, off: 0.05 } : {})))),
    ).toEqual([])
  })

  test('takes painted hair and a garment touching the hair, not apart from it', () => {
    const painted = strip(30, (c) => ({ zone: 0.1, shell: c === 0 ? 1 : 0 }), {
      hair: (q) => (q === 5 ? 0.2 : 0.8),
    })
    expect(takenQuads(ownHair(painted))).toEqual([0, 1, 2, 3, 4])
    const garment = strip(30, (c) => ({ shell: c === 0 ? 1 : 0 }), {
      notSkin: (q) => (q <= 3 || q >= 6 ? 0.9 : 0),
    })
    expect(takenQuads(ownHair(garment))).toEqual([0, 1, 2, 3])
  })

  test('never takes the face, whatever it is painted', () => {
    const face = strip(
      30,
      (c) => ({ zone: 0.01, shell: c === 0 ? 1 : 0 }),
      { hair: () => 1, notSkin: () => 1 },
      { neck: -1, eyeFront: 0.04 },
    )
    expect(takenQuads(ownHair(face))).toEqual([0])
  })

  test('leaves a stray lock lying flat on the skin, apart from the rest of the hair', () => {
    // The hair over quads 0–99; a lock at 140, lying flat or standing.
    const lock = (height: number) =>
      strip(160, (c) =>
        c <= 100 ? { zone: 0.5 } : c >= 140 && c <= 141 ? { shell: 1, height } : {},
      )
    expect(takenQuads(ownHair(lock(0))).includes(140)).toBe(false)
    expect(takenQuads(ownHair(lock(0.01))).includes(140)).toBe(true)
  })

  test('takes a hem hanging off the neck, and what is left in small pieces but an eyeball', () => {
    const hem = strip(
      30,
      (c) => (c <= 3 ? { y: -0.2, height: 0.02 } : {}),
      {},
      {
        neck: -0.1,
        eyeFront: 1,
      },
    )
    expect(takenQuads(ownHair(hem))).toEqual([0, 1, 2])
    // Not the chest, in front of the neck.
    const chest = strip(
      30,
      (c) => (c <= 3 ? { y: -0.2, z: 0.95, height: 0.02 } : { z: 0.95 }),
      {},
      {
        neck: -0.1,
        eyeFront: 1,
      },
    )
    expect(takenQuads(ownHair(chest))).toEqual([])
    // The cranium cuts a piece of 3 quads off the end of the strip: it goes.
    const cut = strip(80, (c) => ({ zone: c >= 75 && c <= 77 ? 0.5 : 0 }))
    expect(takenQuads(ownHair(cut))).toEqual([75, 76, 77, 78, 79])
    // In front, by the eyes, it is an eyeball, and stays.
    const eye = strip(80, (c) => ({ zone: c >= 75 && c <= 77 ? 0.5 : 0, z: c >= 77 ? 0.99 : 0 }))
    expect(takenQuads(ownHair(eye))).toEqual([75, 76])
  })
})

describe('the cut', () => {
  test('keeps the triangles not taken', () => {
    expect([...keptTriangles([0, 1, 2, 2, 1, 3, 3, 1, 4], [0, 1, 0])]).toEqual([0, 1, 2, 3, 1, 4])
  })

  test('counts rings of kept skin out from it', () => {
    const head = strip(10, () => ({}))
    const taken = new Uint8Array(20)
    taken[0] = taken[1] = 1
    const rings = cutRings(head.index, taken, head.spots, head.spotCount, 3)
    const column = (c: number) => rings[c * 2]
    expect([0, 1, 2, 3, 4, 5, 6].map(column)).toEqual([0, 0, 1, 2, 3, 4, 4])
    expect([...cutRings(head.index, new Uint8Array(20), head.spots, head.spotCount, 3)]).toEqual(
      new Array(22).fill(4),
    )
  })
})

/** A ball of `rows` bands × `columns` slices: points, outward normals, triangles; the top pole first. */
function ball(radius: number, rows: number, columns: number) {
  const points: number[] = [0, radius, 0]
  for (let r = 1; r < rows; r++) {
    const lat = Math.PI / 2 - (Math.PI * r) / rows
    for (let c = 0; c < columns; c++) {
      const lon = (2 * Math.PI * c) / columns
      points.push(
        radius * Math.cos(lat) * Math.sin(lon),
        radius * Math.sin(lat),
        radius * Math.cos(lat) * Math.cos(lon),
      )
    }
  }
  points.push(0, -radius, 0)
  const last = points.length / 3 - 1
  const at = (r: number, c: number) => 1 + (r - 1) * columns + (c % columns)
  const triangles: number[] = []
  for (let c = 0; c < columns; c++) {
    triangles.push(0, at(1, c), at(1, c + 1))
    for (let r = 1; r < rows - 1; r++) {
      triangles.push(
        at(r, c),
        at(r + 1, c),
        at(r + 1, c + 1),
        at(r, c),
        at(r + 1, c + 1),
        at(r, c + 1),
      )
    }
    triangles.push(at(rows - 1, c), last, at(rows - 1, c + 1))
  }
  const normals = points.map((value) => value / radius)
  return {
    points: Float32Array.from(points),
    normals: Float32Array.from(normals),
    triangles: Uint32Array.from(triangles),
  }
}

/** A ball as a fitted skull: its hair zone over its top half. */
function skullBall(radius = 0.1) {
  const { points, normals, triangles } = ball(radius, 24, 32)
  const zone = Float32Array.from({ length: points.length / 3 }, (_, i) =>
    points[i * 3 + 1]! > 0 ? 1 : 0,
  )
  const skull: Skull = { points, normals, zone, grid: new PointGrid(points, 0.02) }
  return { skull, triangles }
}

const radiusOf = (points: Float32Array, i: number) =>
  Math.hypot(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!)

describe('the bald surface', () => {
  test('meets the kept skin, a little under it, and fades back to the skull over the cranium', () => {
    const { skull, triangles } = skullBall()
    const below = ball(0.105, 48, 64)
    const anchors = below.points.filter((_, j) => below.points[j - (j % 3) + 1]! < -0.02)
    const bent = bentSkull(skull, triangles, anchors)
    const count = skull.points.length / 3
    for (let i = 0; i < count; i++) {
      const y = skull.points[i * 3 + 1]!
      if (y < -0.03) expect(radiusOf(bent.points, i)).toBeCloseTo(0.105 - 0.0008, 3)
    }
    // The top pole: back near the skull's own radius.
    expect(radiusOf(bent.points, 0)).toBeGreaterThan(0.0985)
    expect(radiusOf(bent.points, 0)).toBeLessThan(0.1025)
    // Its normals point out still.
    expect(bent.normals[1]!).toBeGreaterThan(0.99)
  })

  test('hangs its open bottom down at the back of the neck, facing out', () => {
    const { points, normals, triangles } = ball(0.1, 24, 32)
    // Without its bottom cap: open below y = -0.05.
    const kept: number[] = []
    for (let t = 0; t < triangles.length; t += 3) {
      const corners = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!]
      if (corners.every((i) => points[i * 3 + 1]! > -0.06)) kept.push(...corners)
    }
    const zone = new Float32Array(points.length / 3)
    const hung = withNeckPiece({ points, normals, zone }, kept, 0)
    const added = hung.points.length / 3 - hung.neckFrom
    expect(hung.neckFrom).toBe(points.length / 3)
    expect(added).toBeGreaterThan(5)
    expect(hung.triangles.length).toBeGreaterThan(kept.length)
    let lowest = 0
    for (let i = hung.neckFrom; i < hung.points.length / 3; i++) {
      // Behind the neck's middle, in rings below the rim down to 8 cm under it, facing out level.
      expect(hung.points[i * 3 + 2]!).toBeLessThan(0.001)
      expect(hung.points[i * 3 + 1]!).toBeLessThan(-0.065)
      lowest = Math.min(lowest, hung.points[i * 3 + 1]!)
      expect(hung.normals[i * 3 + 1]).toBe(0)
      const out =
        hung.points[i * 3]! * hung.normals[i * 3]! +
        hung.points[i * 3 + 2]! * hung.normals[i * 3 + 2]!
      expect(out).toBeGreaterThan(0)
    }
    expect(lowest).toBeLessThan(-0.12)
  })

  test('closes the head where its skin was taken, not under the skin it keeps nor over its face', () => {
    const { skull, triangles } = skullBall()
    const surface = {
      points: skull.points,
      normals: skull.normals,
      zone: skull.zone,
      triangles,
      neckFrom: skull.points.length / 3,
    }
    // The head keeps its front (a little over the skull), not its back.
    const head = ball(0.101, 24, 32)
    const front: number[] = []
    for (let t = 0; t < head.triangles.length; t += 3) {
      const corners = [head.triangles[t]!, head.triangles[t + 1]!, head.triangles[t + 2]!]
      if (corners.every((i) => head.points[i * 3 + 2]! > 0)) front.push(...corners)
    }
    const chosen = scalpTriangles(
      surface,
      { points: head.points, normals: head.normals, index: front },
      {
        eyes: [
          [-0.03, 0.02, 0.09],
          [0.03, 0.02, 0.09],
        ],
        neck: -0.2,
        nape: 0,
      },
    )
    const centre = (t: number, axis: number) =>
      (skull.points[triangles[t * 3]! * 3 + axis]! +
        skull.points[triangles[t * 3 + 1]! * 3 + axis]! +
        skull.points[triangles[t * 3 + 2]! * 3 + axis]!) /
      3
    const centreZ = (t: number) => centre(t, 2)
    // The back of the cranium (lower, beside the ears the head keeps, are the skull's ears).
    const back = Array.from({ length: triangles.length / 3 }, (_, t) => t).filter(
      (t) => centreZ(t) < -0.02 && centre(t, 1) > 0.06,
    )
    expect(back.length).toBeGreaterThan(20)
    expect(back.every((t) => chosen.includes(t))).toBe(true)
    // Under the kept front, only the ring tucked under its edge.
    expect(chosen.filter((t) => centreZ(t) > 0.04)).toEqual([])
  })
})

describe('painting round the cut', () => {
  test('paints by how far from the cut, reads the tone off the forehead under it, and the skin round it', () => {
    // Facing the front (+z), above the eyes; the first quad taken.
    const head = strip(12, () => ({ y: 0.1 }))
    const normals = new Float32Array(head.points.length)
    for (let i = 2; i < normals.length; i += 3) normals[i] = 1
    const uvs = Float32Array.from({ length: (head.points.length / 3) * 2 }, (_, j) =>
      j % 2 === 0 ? head.points[(j / 2) * 3]! : head.points[((j - 1) / 2) * 3 + 1]!,
    )
    const taken = new Uint8Array(24)
    taken[0] = taken[1] = 1
    const rings = cutRings(head.index, taken, head.spots, head.spotCount, TONE_RINGS)
    const scalp = { uvs: Float32Array.from([0, 0, 0.01, 0, 0, 0.01]), points: new Float32Array(9) }
    const painted = scalpPaint(
      { points: head.points, normals, uvs, index: head.index },
      taken,
      rings,
      head.spots,
      head.zone,
      {
        eyes: [
          [0.02, 0, 0.09],
          [0.04, 0, 0.09],
        ],
        neck: -1,
        nape: 0,
      },
      scalp,
    )
    // Triangles within the feather of the cut (4.5 cm): quads 1 to 5.
    expect(painted.paint.length / PAINTED).toBe(10)
    const amount = (x: number) => {
      for (let k = 0; k < painted.paint.length; k += PAINTED / 3) {
        if (Math.abs(painted.paint[k]! - x) < 1e-6) return painted.paint[k + 2]!
      }
      return Number.NaN
    }
    // Wholly within 1.2 cm of it, then less and less.
    expect(amount(0.01)).toBe(1)
    expect(amount(0.02)).toBe(1)
    expect(amount(0.03)).toBeLessThan(1)
    expect(amount(0.04)).toBeLessThan(amount(0.03))
    expect(amount(0.06)).toBe(0)
    // Its colour the skin's round it, read clear of the cut.
    const ref = painted.paint[3]!
    expect(ref).toBeGreaterThanOrEqual(0)
    expect(painted.skin[ref * 5]!).toBeGreaterThanOrEqual(0.02)
    // The tone: the skin within the rings near the cut; the rest of the forehead after.
    expect(painted.tone[0]!.length / READ).toBe(2 * 4)
    expect(painted.tone[1]!.length / READ).toBe(2 * 7)
    expect(painted.kept.length / READ).toBe(22)
    expect(painted.taken.length / READ).toBe(2)
    expect(painted.scalp.length / SCALP).toBe(1)
  })

  test('reads how much of what a triangle covers each mask is', () => {
    const mask = Float32Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? 1 : 0))
    const [share] = texelShares([0, 1, 2, 0, 2, 3], [0, 0, 1, 0, 1, 1, 0, 1], 4, 4, [mask])
    // Both halves of the square: as much of the left as of the right in each.
    expect(share![0]! + share![1]!).toBeCloseTo(1, 1)
    expect(share![1]!).toBeGreaterThan(share![0]!)
  })
})

describe('the neckline closed', () => {
  // A body's neck hole: a rim round the neck (its top at the origin), and a
  // ring well below it; `dip` lowers the rim's back middle into a notch.
  const body = (dip: number) => {
    const n = 16
    const points: number[] = []
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      const x = Math.sin(a)
      const z = Math.cos(a)
      const back = Math.max(0, -z) ** 4
      points.push(0.06 * x, -0.05 - dip * back, 0.06 * z)
    }
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      points.push(0.2 * Math.sin(a), -0.3, 0.2 * Math.cos(a))
    }
    const index: number[] = []
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n
      index.push(k, n + k, j, j, n + k, n + j)
    }
    return necklineFan(Float32Array.from(points), index, [0, 0, 0])
  }

  test('closes an even neckline from inside the neck', () => {
    const fan = body(0)
    expect(fan.triangles.length).toBeGreaterThan(0)
    expect(fan.points[2]).toBeCloseTo(0, 6)
  })

  test('closes a notch long hair hid level with the back round it', () => {
    const fan = body(0.08)
    expect(fan.points[2]!).toBeLessThan(-0.03)
  })
})

describe('the bald surface shaded by its shape', () => {
  test('darkens a fold, not an open slope', () => {
    // A flat sheet (y = 0, facing up) with a wall rising beside x = 0.008:
    // what lies right on the point (the skin it is tucked under) is no fold.
    const around: number[] = []
    for (let x = -0.024; x <= 0.02401; x += 0.006) {
      for (let z = -0.024; z <= 0.02401; z += 0.006) around.push(x, 0, z)
    }
    for (let y = 0.002; y <= 0.02001; y += 0.002) {
      for (let z = -0.02; z <= 0.02001; z += 0.002) around.push(0.008, y, z)
    }
    const points = Float32Array.from(around)
    const grid = new PointGrid(points, 0.02)
    const shade = hollowShade(
      Float32Array.from([-0.015, 0, 0, 0.002, 0, 0]),
      Float32Array.from([0, 1, 0, 0, 1, 0]),
      { points, grid },
    )
    expect(shade[0]!).toBeGreaterThan(0.99)
    expect(shade[1]!).toBeLessThan(0.95)
  })
})

describe('the cut cleaned', () => {
  const marks = {
    eyes: [
      [0.5, -1, -1],
      [0.6, -1, -1],
    ],
    neck: -2,
    nape: 0,
  }

  test('takes the rim of gear standing off the head, and what that leaves in small pieces', () => {
    // A brim's edge standing 3 cm off the skull at quads 20–21, the hair cut off at quad 0.
    const head = strip(30, (c) => (c >= 20 && c <= 22 ? { height: 0.03 } : {}))
    const taken = new Uint8Array(60)
    taken[0] = taken[1] = 1
    const cleaned = cleanCut(head, taken, marks)
    expect(takenQuads(cleaned)).toEqual([0, 19, 20, 21, 22])
  })

  test('takes the skin left between the hair taken', () => {
    const head = strip(30, () => ({}))
    const taken = new Uint8Array(60)
    for (const q of [0, 1, 2, 4, 5, 6]) taken[q * 2] = taken[q * 2 + 1] = 1
    expect(takenQuads(cleanCut(head, taken, marks))).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('the bald surface on the texture', () => {
  // The hair taken out: a square in z = 0, its texture coordinates its x and y.
  const square = {
    points: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    index: [0, 1, 2, 0, 2, 3],
    triangles: [0, 1],
  }

  test('shows the texels the hair did at each point’s nearest place on it', () => {
    const points = Float32Array.from([0.2, 0.3, 0.05, 0.6, 0.3, -0.05, 0.4, 0.7, 0.02])
    const placed = scalpUvs(points, [0, 1, 2], square)
    expect([...placed.from]).toEqual([0, 1, 2])
    expect(placed.uvs[0]).toBeCloseTo(0.2, 5)
    expect(placed.uvs[1]).toBeCloseTo(0.3, 5)
    expect(placed.uvs[4]).toBeCloseTo(0.4, 5)
    expect(placed.uvs[5]).toBeCloseTo(0.7, 5)
  })

  test('gives a triangle spanning a seam of the texture corners of its own', () => {
    // The square's right half far off on the texture.
    const torn = {
      points: Float32Array.from([
        0, 0, 0, 0.5, 0, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 0, 0, 1, 0, 0, 1, 1, 0, 0.5, 1, 0,
      ]),
      uvs: Float32Array.from([0, 0, 0.1, 0, 0.1, 0.2, 0, 0.2, 0.8, 0, 0.9, 0, 0.9, 0.2, 0.8, 0.2]),
      index: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
      triangles: [0, 1, 2, 3],
    }
    const points = Float32Array.from([0.3, 0.5, 0, 0.7, 0.5, 0, 0.4, 0.6, 0])
    const placed = scalpUvs(points, [0, 1, 2], torn)
    expect(placed.from.length).toBe(6)
    const us = [placed.triangles[0]!, placed.triangles[1]!, placed.triangles[2]!].map(
      (f) => placed.uvs[f * 2]!,
    )
    expect(Math.max(...us) - Math.min(...us)).toBeLessThan(0.2)
  })
})

describe('the bald surface’s skinning', () => {
  test('spreads what is known along the surface, blending it between', () => {
    // A row of 5 points: bone 2 at one end, bone 7 at the other.
    const triangles = [0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4]
    const known = [[[2, 1] as const], null, null, null, [[7, 1] as const]]
    const { index, weight } = spreadWeights(5, triangles, known, 0, 2)
    expect([index[0], weight[0]]).toEqual([2, 1])
    const middle = new Map([
      [index[4]!, weight[4]!],
      [index[5]!, weight[5]!],
    ])
    expect(middle.get(2)).toBeCloseTo(0.5, 2)
    expect(middle.get(7)).toBeCloseTo(0.5, 2)
    for (let i = 0; i < 5; i++) expect(weight[i * 2]! + weight[i * 2 + 1]!).toBeCloseTo(1, 5)
  })

  test('falls back to one bone where nothing is known', () => {
    const { index, weight } = spreadWeights(3, [0, 1, 2], [null, null, null], 9, 2)
    expect([index[0], weight[0], weight[1]]).toEqual([9, 1, 0])
  })
})

describe('the nape smoothed', () => {
  test('smooths a ridge round the top of the neck, behind it, but not where the skin is', () => {
    // A column of points down the back of the neck (z −0.05), one stood out at the top of the neck.
    const points = new Float32Array(11 * 3)
    for (let k = 0; k <= 10; k++) points.set([0, -0.05 + k * 0.01, -0.05], k * 3)
    points[5 * 3 + 2] = -0.07
    const triangles: number[] = []
    for (let k = 0; k < 10; k++) triangles.push(k, k + 1, k + 1)
    const known = new Uint8Array(11)
    known[0] = 1
    smoothNape(points, triangles, known, 0, 0)
    expect(points[5 * 3 + 2]!).toBeGreaterThan(-0.065)
    expect(points[0 * 3 + 2]!).toBeCloseTo(-0.05, 6)
  })
})

describe('the hair’s shadow on the body', () => {
  test('is the body behind and under the neck near the hair, with the light read beside it', () => {
    // A strip of body down the back, the hair hanging over its first quads.
    const body = strip(20, () => ({ y: -0.2, z: -0.1 }))
    const uvs = Float32Array.from({ length: (body.points.length / 3) * 2 }, (_, j) =>
      j % 2 === 0 ? body.points[(j / 2) * 3]! : 0.5,
    )
    const hair = Float32Array.from([0, -0.2, -0.13, 0.02, -0.2, -0.13])
    const shadow = hairShadow({ points: body.points, uvs, index: body.index }, hair, {
      neck: 0,
      nape: 0,
    })
    const triangles = shadow.length / SHADED
    expect(triangles).toBeGreaterThan(0)
    expect(triangles).toBeLessThan(40)
    // Its first corner deep in the shadow, its light read further along.
    expect(shadow[2]!).toBeGreaterThan(0.8)
    expect(shadow[3]!).toBeGreaterThan(0.05)
    // Over the neck, none.
    expect(
      hairShadow({ points: body.points, uvs, index: body.index }, hair, { neck: -1, nape: 0 })
        .length,
    ).toBe(0)
  })
})
