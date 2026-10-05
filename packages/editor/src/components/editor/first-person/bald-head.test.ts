import { describe, expect, test } from 'bun:test'
import {
  bentSkull,
  cutRings,
  keptTriangles,
  type OwnHead,
  ownHair,
  PAINT_RINGS,
  PAINTED,
  READ,
  scalpPaint,
  scalpTriangles,
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
      if (y < -0.03) expect(radiusOf(bent.points, i)).toBeCloseTo(0.105 - 0.0015, 3)
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
    for (let i = hung.neckFrom; i < hung.points.length / 3; i++) {
      // Behind the neck's middle, 8 cm below the rim, facing out level.
      expect(hung.points[i * 3 + 2]!).toBeLessThan(0.001)
      expect(hung.points[i * 3 + 1]!).toBeLessThan(-0.12)
      expect(hung.normals[i * 3 + 1]).toBe(0)
      const out =
        hung.points[i * 3]! * hung.normals[i * 3]! +
        hung.points[i * 3 + 2]! * hung.normals[i * 3 + 2]!
      expect(out).toBeGreaterThan(0)
    }
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
  test('paints by ring, reads the tone off the forehead under the cut, and puts the swatch there', () => {
    // Facing the front (+z), above the eyes; the first quad taken.
    const head = strip(12, () => ({ y: 0.1 }))
    const normals = new Float32Array(head.points.length)
    for (let i = 2; i < normals.length; i += 3) normals[i] = 1
    const uvs = Float32Array.from({ length: (head.points.length / 3) * 2 }, (_, j) =>
      j % 2 === 0 ? head.points[(j / 2) * 3]! : head.points[((j - 1) / 2) * 3 + 1]!,
    )
    const taken = new Uint8Array(24)
    taken[0] = taken[1] = 1
    const rings = cutRings(head.index, taken, head.spots, head.spotCount, PAINT_RINGS.length)
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
      },
    )
    // Triangles within PAINT_NEAR rings of the cut: quads 1 to 3.
    expect(painted.paint.length / PAINTED).toBe(6)
    const amounts = new Set<number>()
    for (let k = 2; k < painted.paint.length; k += 3)
      amounts.add(Math.round(painted.paint[k]! * 100))
    expect([...amounts].sort((a, b) => b - a)).toEqual([90, 70, 45, 25])
    // The tone: the skin within the painted rings; the rest of the forehead after.
    expect(painted.tone[0]!.length / READ).toBe(2 * 4)
    expect(painted.tone[1]!.length / READ).toBe(2 * 7)
    // The swatch: on a quad within two rings of the cut, nearest the eyes' middle (x 0.03).
    expect(painted.swatch[0]).toBeGreaterThan(0.02)
    expect(painted.swatch[0]).toBeLessThan(0.04)
  })

  test('reads how much of what a triangle covers each mask is', () => {
    const mask = Float32Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? 1 : 0))
    const [share] = texelShares([0, 1, 2, 0, 2, 3], [0, 0, 1, 0, 1, 1, 0, 1], 4, 4, [mask])
    // Both halves of the square: as much of the left as of the right in each.
    expect(share![0]! + share![1]!).toBeCloseTo(1, 1)
    expect(share![1]!).toBeGreaterThan(share![0]!)
  })
})
