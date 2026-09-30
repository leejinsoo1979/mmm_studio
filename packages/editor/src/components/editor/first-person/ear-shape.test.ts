import { describe, expect, test } from 'bun:test'
import { BufferGeometry, Float32BufferAttribute, Mesh, SphereGeometry, Vector3 } from 'three'
import { earShaper, earShares, findEars, hasEars } from './ear-shape'
import type { FaceShape } from './face-shape'
import { headFrame } from './head-geometry'

/** The skull's centre height and radius (m). */
const CENTRE = 1.6
const RADIUS = 0.1

/** An ear flap's rows up and out from the skull, and the step between its points (m). */
const ROWS_UP = 9
const ROWS_OUT = 5
const STEP = 0.004

/** How far the flap leans back from standing straight out of the skull (radians). */
const LEAN = 0.9

/** How much higher (m) an ear modelled out of line with its twin sits. */
const RAISED = 0.003

/** How many of its top rows a partly modelled ear lacks. */
const MISSING_ROWS = 2

type Parts = { positions: number[]; index: number[] }

/**
 * How one side's ear is modelled: triangulated otherwise (its quads split
 * along the other diagonal, the skull triangle by its root in three),
 * sitting higher than its twin, or lacking its top rows.
 */
type EarMaking = { retriangulated?: boolean; raised?: boolean; partial?: boolean }

type HeadOptions = { shell?: boolean; right?: EarMaking }

/**
 * A sparse sphere for the skull — a couple of dozen points round, where an
 * ear has dozens in a few centimetres — with, per `side`, an ear: a dense
 * flap at the side of the head leaning back, joined to the nearest skull
 * points along its root, and an earring (a piece of its own) under it.
 */
function head(sides: readonly number[], options: HeadOptions = {}) {
  const sphere = new SphereGeometry(RADIUS, 16, 12).translate(0, CENTRE, 0)
  const parts: Parts = {
    positions: [...sphere.getAttribute('position').array],
    index: [...sphere.index!.array],
  }
  if (options.right?.retriangulated) splitSkullBy(parts, new Vector3(RADIUS, CENTRE - 0.015, 0))
  const skullCount = parts.positions.length / 3
  for (const side of sides) addEar(parts, side, skullCount, side > 0 ? options.right : undefined)
  for (const side of sides) addEarring(parts, side)
  if (options.shell) {
    // A hair shell standing well off the skull, over the ears.
    const shell = new SphereGeometry(RADIUS * 1.4, 12, 8).translate(0, CENTRE, 0)
    const offset = parts.positions.length / 3
    parts.positions.push(...shell.getAttribute('position').array)
    parts.index.push(...[...shell.index!.array].map((i) => i + offset))
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(parts.positions, 3))
  geometry.setIndex(parts.index)
  const mesh = new Mesh(geometry)
  mesh.userData.skullPoints = skullCount
  return mesh
}

function addEar(parts: Parts, side: number, skullCount: number, making: EarMaking = {}) {
  const first = parts.positions.length / 3
  const bottom = CENTRE - 0.03
  const rows = making.partial ? ROWS_UP - MISSING_ROWS : ROWS_UP
  for (let up = 0; up < rows; up++) {
    for (let out = 0; out < ROWS_OUT; out++) {
      const y = bottom + up * STEP
      const rootX = Math.sqrt(RADIUS ** 2 - (y - CENTRE) ** 2)
      parts.positions.push(
        side * (rootX + out * STEP * Math.cos(LEAN)),
        y + (making.raised ? RAISED : 0),
        -out * STEP * Math.sin(LEAN),
      )
    }
  }
  const at = (up: number, out: number) => first + up * ROWS_OUT + out
  for (let up = 0; up + 1 < rows; up++) {
    for (let out = 0; out + 1 < ROWS_OUT; out++) {
      if (making.retriangulated) {
        parts.index.push(at(up, out), at(up + 1, out + 1), at(up, out + 1))
        parts.index.push(at(up, out), at(up + 1, out), at(up + 1, out + 1))
      } else {
        parts.index.push(at(up, out), at(up + 1, out), at(up, out + 1))
        parts.index.push(at(up + 1, out), at(up + 1, out + 1), at(up, out + 1))
      }
    }
    // The root joined to the skull point nearest it.
    const root = new Vector3().fromArray(parts.positions, at(up, 0) * 3)
    let nearest = 0
    for (let i = 1; i < skullCount; i++) {
      const distance = root.distanceTo(new Vector3().fromArray(parts.positions, i * 3))
      if (distance < root.distanceTo(new Vector3().fromArray(parts.positions, nearest * 3))) {
        nearest = i
      }
    }
    parts.index.push(at(up, 0), at(up + 1, 0), nearest)
  }
}

/**
 * The skull triangle nearest `place` split in three at its middle (pushed
 * out onto the sphere), its new point last among the skull's.
 */
function splitSkullBy(parts: Parts, place: Vector3) {
  const corner = (t: number, k: number) =>
    new Vector3().fromArray(parts.positions, parts.index[t + k]! * 3)
  const middle = (t: number) => corner(t, 0).add(corner(t, 1)).add(corner(t, 2)).divideScalar(3)
  let nearest = 0
  for (let t = 3; t < parts.index.length; t += 3) {
    if (middle(t).distanceTo(place) < middle(nearest).distanceTo(place)) nearest = t
  }
  const split = middle(nearest)
    .sub(new Vector3(0, CENTRE, 0))
    .setLength(RADIUS)
  const added = parts.positions.length / 3
  parts.positions.push(split.x, split.y + CENTRE, split.z)
  const [a, b, c] = parts.index.splice(nearest, 3) as [number, number, number]
  parts.index.push(a, b, added, b, c, added, c, a, added)
}

/** A little tetrahedron hanging from the ear's lobe: an earring. */
function addEarring(parts: Parts, side: number) {
  const first = parts.positions.length / 3
  const x = side * (RADIUS - STEP / 2)
  const y = CENTRE - 0.031
  const z = -STEP / 2
  const size = 0.002
  parts.positions.push(x, y, z, x + size, y - size, z, x, y - size, z + size, x, y - size, z - size)
  parts.index.push(first, first + 1, first + 2, first, first + 2, first + 3)
  parts.index.push(first, first + 3, first + 1, first + 1, first + 3, first + 2)
}

const pointsOf = (mesh: Mesh) => [...mesh.geometry.getAttribute('position').array]
const placeOf = (mesh: Mesh, i: number) => new Vector3().fromArray(pointsOf(mesh), i * 3)
const shaped = (sliders: FaceShape['sliders']): FaceShape => ({ fit: 1, sliders })
const earsOf = (mesh: Mesh) => findEars(pointsOf(mesh), mesh.geometry.index!.array, headFrame(mesh))

/** Every point's move under a shape: the ear shaper's, for the head. */
function moves(mesh: Mesh, sliders: FaceShape['sliders']) {
  const move = earShaper(mesh, shaped(sliders))!(mesh)!
  const position = mesh.geometry.getAttribute('position')
  return Array.from({ length: position.count }, (_, i) => {
    const out = new Vector3()
    move(new Vector3().fromBufferAttribute(position, i), i, out)
    return out
  })
}

const SKULL_POINTS = new SphereGeometry(RADIUS, 16, 12).getAttribute('position').count

/** A side's ear points (by index) on a head with both ears, row by row from the bottom, root first. */
const earPoints = (mesh: Mesh, side: number, rows = ROWS_UP) => {
  const first = (mesh.userData.skullPoints as number) + (side < 0 ? 0 : ROWS_UP * ROWS_OUT)
  return Array.from({ length: rows * ROWS_OUT }, (_, k) => first + k)
}

/** The earrings' points on a head with both ears: the image's left one first. */
const earringPoints = (mesh: Mesh) => {
  const count = mesh.geometry.getAttribute('position').count
  return [0, 1].map((k) => Array.from({ length: 4 }, (_, i) => count - 8 + k * 4 + i))
}

/** A move mirrored across the head's middle. */
const mirrored = (move: Vector3) => new Vector3(-move.x, move.y, move.z)

const EVERY_SLIDER: FaceShape['sliders'][] = [
  { earSize: 1 },
  { earSize: -1 },
  { earAngle: 1 },
  { earAngle: -1 },
  { earHeight: 1 },
  { earPoint: 1 },
  { earPoint: -1 },
]

/** The skull's top (a sphere's first point). */
const TOP_OF_SKULL = 0

describe('finding the ears', () => {
  test('one each side, where the flap joins the skull, pointing out', () => {
    const ears = earsOf(head([-1, 1]))
    expect(ears.map((ear) => Math.sign(ear.root.x))).toEqual([-1, 1])
    for (const ear of ears) {
      expect(Math.abs(ear.root.x)).toBeGreaterThan(RADIUS * 0.85)
      expect(Math.abs(ear.root.x)).toBeLessThan(RADIUS * 1.1)
      expect(ear.out.x * Math.sign(ear.root.x)).toBeGreaterThan(0.9)
      expect(ear.back.z).toBeLessThan(-0.9)
      expect(ear.length).toBeCloseTo((ROWS_UP - 1) * STEP, 2)
    }
  })

  test('the ear is all ear; the skull round it fades; far off is none of it', () => {
    const mesh = head([-1, 1])
    const [left] = earsOf(mesh)
    for (const i of earPoints(mesh, -1)) expect(earShares(left!, placeOf(mesh, i))).toEqual([1, 1])
    expect(earShares(left!, placeOf(mesh, TOP_OF_SKULL))).toEqual([0, 0])
    expect(left!.reached[TOP_OF_SKULL]).toBe(0)
    for (let i = 0; i < SKULL_POINTS; i++) {
      const [onEar, carried] = earShares(left!, placeOf(mesh, i))
      expect(carried).toBeGreaterThanOrEqual(onEar)
    }
  })

  test('a head without ears (a hood, a hair shell with none under it) has none', () => {
    const mesh = head([])
    expect(earsOf(mesh)).toEqual([])
    expect(hasEars(mesh)).toBe(false)
    expect(hasEars(head([-1, 1]))).toBe(true)
  })

  test('a lone ear, the other side having nothing like it, is none: shaped alone it would be lopsided', () => {
    const mesh = head([-1])
    expect(earsOf(mesh)).toEqual([])
    expect(hasEars(mesh)).toBe(false)
    expect(earShaper(mesh, shaped({ earSize: 1 }))).toBeNull()
  })

  test('ears under a hair shell are found through it', () => {
    expect(earsOf(head([-1, 1], { shell: true }))).toHaveLength(2)
  })
})

describe('the ear sliders', () => {
  test('none set, or no ears to set them on: no shaper', () => {
    expect(earShaper(head([-1, 1]), shaped({}))).toBeNull()
    expect(earShaper(head([-1, 1]), shaped({ eyeSize: 1, earSize: 0 }))).toBeNull()
    expect(earShaper(head([]), shaped({ earSize: 1 }))).toBeNull()
  })

  test('only the head is reshaped', () => {
    const mesh = head([-1, 1])
    const shaper = earShaper(mesh, shaped({ earSize: 1 }))!
    expect(shaper(new Mesh(new BufferGeometry()))).toBeNull()
    expect(shaper(mesh)).not.toBeNull()
  })

  test('a bigger ear reaches further from its root; the top of the skull stays', () => {
    const mesh = head([-1, 1])
    const [left] = earsOf(mesh)
    const moved = moves(mesh, { earSize: 1 })
    const tip = earPoints(mesh, -1).at(-1)!
    const place = placeOf(mesh, tip)
    const after = place.clone().add(moved[tip]!)
    expect(after.distanceTo(left!.root)).toBeGreaterThan(place.distanceTo(left!.root) * 1.2)
    expect(moved[TOP_OF_SKULL]!.length()).toBe(0)
  })

  test('a higher ear moves up, both sides alike', () => {
    const mesh = head([-1, 1])
    const moved = moves(mesh, { earHeight: 1 })
    const [left, right] = [-1, 1].map((side) => moved[earPoints(mesh, side)[ROWS_OUT + 1]!]!)
    expect(left!.y).toBeGreaterThan(0.005)
    expect(right!.y).toBeCloseTo(left!.y, 6)
    expect(right!.x).toBeCloseTo(-left!.x, 6)
  })

  test('turned out, the flap stands further off the head; turned in, it lies closer', () => {
    const mesh = head([-1, 1])
    const outer = earPoints(mesh, -1).at(-1)!
    // The image's left ear: further out is further towards −x.
    expect(moves(mesh, { earAngle: 1 })[outer]!.x).toBeLessThan(-0.002)
    expect(moves(mesh, { earAngle: -1 })[outer]!.x).toBeGreaterThan(0.001)
    // Pressed flat, the flap stays out of the skull.
    const pressed = placeOf(mesh, outer).add(moves(mesh, { earAngle: -1 })[outer]!)
    expect(pressed.distanceTo(new Vector3(0, CENTRE, 0))).toBeGreaterThan(RADIUS)
  })

  test('a pointed ear draws its top up, its bottom barely', () => {
    const mesh = head([-1, 1])
    const moved = moves(mesh, { earPoint: 1 })
    const ear = earPoints(mesh, -1)
    const top = moved[ear[(ROWS_UP - 1) * ROWS_OUT + 2]!]!
    const bottom = moved[ear[2]!]!
    expect(top.y).toBeGreaterThan(0.003)
    expect(Math.abs(bottom.y)).toBeLessThan(top.y / 10)
  })

  test('each earring goes with its ear, as a whole', () => {
    const mesh = head([-1, 1])
    const moved = moves(mesh, { earHeight: 1 })
    for (const ring of earringPoints(mesh).map((ring) => ring.map((i) => moved[i]!))) {
      expect(ring[0]!.y).toBeGreaterThan(0.005)
      for (const move of ring) expect(move.distanceTo(ring[0]!)).toBe(0)
    }
    const [left, right] = earringPoints(mesh).map((ring) => moved[ring[0]!]!)
    expect(right!.distanceTo(mirrored(left!))).toBeLessThan(1e-9)
  })

  test('points at one place (a texture seam) move as one', () => {
    const mesh = head([-1, 1])
    const points = pointsOf(mesh)
    const moved = moves(mesh, { earSize: 1, earHeight: -0.5 })
    const seen = new Map<string, number>()
    for (let i = 0; i < points.length / 3; i++) {
      const key = points
        .slice(i * 3, i * 3 + 3)
        .map((value) => value.toFixed(5))
        .join()
      const other = seen.get(key)
      if (other === undefined) seen.set(key, i)
      else expect(moved[i]!.distanceTo(moved[other]!)).toBeLessThan(1e-9)
    }
  })

  test('a hair shell over the ears stays put', () => {
    const mesh = head([-1, 1], { shell: true })
    const moved = moves(mesh, { earSize: 1, earAngle: 1 })
    const shellFirst = mesh.geometry.getAttribute('position').count - 13 * 9
    for (let i = shellFirst; i < moved.length; i++) expect(moved[i]!.length()).toBe(0)
  })

  test('the skin round an ear stretches as it goes: its move changes from place to place', () => {
    const mesh = head([-1, 1])
    const [left] = earsOf(mesh)
    const move = earShaper(mesh, shaped({ earHeight: 1 }))!(mesh)!
    // A skull point partly carried: where the probe for its normal looks.
    const i = Array.from({ length: SKULL_POINTS }, (_, i) => i).find((i) => {
      const carried = earShares(left!, placeOf(mesh, i))[1]
      return left!.reached[i] && carried > 0.1 && carried < 0.9
    })!
    const [here, nearby] = [new Vector3(), new Vector3()]
    const place = placeOf(mesh, i)
    move(place, i, here)
    move(place.clone().add(left!.out.clone().multiplyScalar(0.002)), i, nearby)
    expect(nearby.distanceTo(here)).toBeGreaterThan(1e-5)
  })
})

describe('both ears alike', () => {
  /** Each image-left ear point's move against its twin's on the right, mirrored: the largest difference. */
  function mismatch(mesh: Mesh, sliders: FaceShape['sliders'], rows = ROWS_UP) {
    const moved = moves(mesh, sliders)
    const right = earPoints(mesh, 1, rows)
    return Math.max(
      ...earPoints(mesh, -1, rows).map((i, k) => moved[right[k]!]!.distanceTo(mirrored(moved[i]!))),
    )
  }

  test('their moves are mirror images, though their triangles differ', () => {
    const mesh = head([-1, 1], { right: { retriangulated: true } })
    for (const sliders of EVERY_SLIDER) expect(mismatch(mesh, sliders)).toBeLessThan(1e-6)
  })

  test('an ear modelled a little higher than its twin moves as its mirror image', () => {
    const mesh = head([-1, 1], { right: { raised: true } })
    const [left, right] = earsOf(mesh)
    expect(right!.root.y - left!.root.y).toBeCloseTo(RAISED, 3)
    for (const sliders of EVERY_SLIDER) {
      expect(mismatch(mesh, sliders)).toBeLessThan(2e-4)
    }
  })

  test('an ear modelled only in part moves as the same part of its twin', () => {
    const mesh = head([-1, 1], { right: { partial: true } })
    const [left, right] = earsOf(mesh)
    expect(right!.length).toBeCloseTo(left!.length, 6)
    for (const sliders of EVERY_SLIDER) {
      expect(mismatch(mesh, sliders, ROWS_UP - MISSING_ROWS)).toBeLessThan(1e-6)
    }
  })
})

test('a head’s ears are found once, not again as each slider moves', () => {
  const mesh = head([-1, 1])
  const before = moves(mesh, { earSize: 1 })
  // Were they found again, the ear moved away would not be where it was.
  const position = mesh.geometry.getAttribute('position')
  for (const i of earPoints(mesh, -1)) position.setY(i, position.getY(i) + 0.05)
  const after = moves(mesh, { earSize: 1 })
  for (const i of earPoints(mesh, 1)) expect(after[i]!.distanceTo(before[i]!)).toBe(0)
})
