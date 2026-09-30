import { describe, expect, test } from 'bun:test'
import { BufferGeometry, Float32BufferAttribute, Mesh, SphereGeometry, Vector3 } from 'three'
import { earShaper, findEars } from './ear-shape'
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

type Parts = { positions: number[]; index: number[] }

/**
 * A sparse sphere for the skull — a couple of dozen points round, where an
 * ear has dozens in a few centimetres — with, per `side`, an ear: a dense
 * flap at the side of the head leaning back, joined to the nearest skull
 * points along its root, and an earring (a piece of its own) under it.
 */
function head(sides: readonly number[], options: { shell?: boolean } = {}) {
  const sphere = new SphereGeometry(RADIUS, 16, 12).translate(0, CENTRE, 0)
  const parts: Parts = {
    positions: [...sphere.getAttribute('position').array],
    index: [...sphere.index!.array],
  }
  const skullCount = parts.positions.length / 3
  for (const side of sides) addEar(parts, side, skullCount)
  if (sides.length) addEarring(parts, sides[0]!)
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
  return new Mesh(geometry)
}

function addEar(parts: Parts, side: number, skullCount: number) {
  const first = parts.positions.length / 3
  const bottom = CENTRE - 0.03
  for (let up = 0; up < ROWS_UP; up++) {
    for (let out = 0; out < ROWS_OUT; out++) {
      const y = bottom + up * STEP
      const rootX = Math.sqrt(RADIUS ** 2 - (y - CENTRE) ** 2)
      parts.positions.push(
        side * (rootX + out * STEP * Math.cos(LEAN)),
        y,
        -out * STEP * Math.sin(LEAN),
      )
    }
  }
  const at = (up: number, out: number) => first + up * ROWS_OUT + out
  for (let up = 0; up + 1 < ROWS_UP; up++) {
    for (let out = 0; out + 1 < ROWS_OUT; out++) {
      parts.index.push(at(up, out), at(up + 1, out), at(up, out + 1))
      parts.index.push(at(up + 1, out), at(up + 1, out + 1), at(up, out + 1))
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

/** A little tetrahedron under the ear's lobe: an earring. */
function addEarring(parts: Parts, side: number) {
  const first = parts.positions.length / 3
  const x = side * (RADIUS + STEP)
  const y = CENTRE - 0.034
  const size = 0.002
  parts.positions.push(x, y, 0, x + size, y - size, 0, x, y - size, size, x, y - size, -size)
  parts.index.push(first, first + 1, first + 2, first, first + 2, first + 3)
  parts.index.push(first, first + 3, first + 1, first + 1, first + 3, first + 2)
}

const pointsOf = (mesh: Mesh) => [...mesh.geometry.getAttribute('position').array]
const shaped = (sliders: FaceShape['sliders']): FaceShape => ({ fit: 1, sliders })

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
const earPoints = (side: number) => {
  const first = SKULL_POINTS + (side < 0 ? 0 : ROWS_UP * ROWS_OUT)
  return Array.from({ length: ROWS_UP * ROWS_OUT }, (_, k) => first + k)
}

/** The skull's top (a sphere's first point). */
const TOP_OF_SKULL = 0

describe('finding the ears', () => {
  test('one each side, where the flap joins the skull, pointing out', () => {
    const mesh = head([-1, 1])
    const ears = findEars(pointsOf(mesh), mesh.geometry.index!.array, headFrame(mesh))
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
    const [left] = findEars(pointsOf(mesh), mesh.geometry.index!.array, headFrame(mesh))
    for (const i of earPoints(-1)) expect(left!.onEar[i]).toBe(1)
    expect(left!.onEar[TOP_OF_SKULL]).toBe(0)
    expect(left!.carried[TOP_OF_SKULL]).toBe(0)
    left!.onEar.forEach((share, i) => {
      expect(left!.carried[i]!).toBeGreaterThanOrEqual(share)
    })
  })

  test('a head without ears (a hood, a hair shell with none under it) has none', () => {
    const mesh = head([])
    expect(findEars(pointsOf(mesh), mesh.geometry.index!.array, headFrame(mesh))).toEqual([])
  })

  test('ears under a hair shell are found through it', () => {
    const mesh = head([-1, 1], { shell: true })
    expect(findEars(pointsOf(mesh), mesh.geometry.index!.array, headFrame(mesh))).toHaveLength(2)
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
    const [left] = findEars(pointsOf(mesh), mesh.geometry.index!.array, headFrame(mesh))
    const moved = moves(mesh, { earSize: 1 })
    const tip = earPoints(-1).at(-1)!
    const place = new Vector3().fromArray(pointsOf(mesh), tip * 3)
    const after = place.clone().add(moved[tip]!)
    expect(after.distanceTo(left!.root)).toBeGreaterThan(place.distanceTo(left!.root) * 1.2)
    expect(moved[TOP_OF_SKULL]!.length()).toBe(0)
  })

  test('a higher ear moves up, both sides alike', () => {
    const mesh = head([-1, 1])
    const moved = moves(mesh, { earHeight: 1 })
    const [left, right] = [-1, 1].map((side) => moved[earPoints(side)[ROWS_OUT + 1]!]!)
    expect(left!.y).toBeGreaterThan(0.005)
    expect(right!.y).toBeCloseTo(left!.y, 6)
    expect(right!.x).toBeCloseTo(-left!.x, 6)
  })

  test('turned out, the flap stands further off the head; turned in, it lies closer', () => {
    const mesh = head([-1, 1])
    const outer = earPoints(-1).at(-1)!
    // The image's left ear: further out is further towards −x.
    expect(moves(mesh, { earAngle: 1 })[outer]!.x).toBeLessThan(-0.002)
    expect(moves(mesh, { earAngle: -1 })[outer]!.x).toBeGreaterThan(0.001)
    // Pressed flat, the flap stays out of the skull.
    const pressed = new Vector3().fromArray(pointsOf(mesh), outer * 3)
    pressed.add(moves(mesh, { earAngle: -1 })[outer]!)
    expect(pressed.distanceTo(new Vector3(0, CENTRE, 0))).toBeGreaterThan(RADIUS)
  })

  test('a pointed ear draws its top up, its bottom barely', () => {
    const mesh = head([-1, 1])
    const moved = moves(mesh, { earPoint: 1 })
    const ear = earPoints(-1)
    const top = moved[ear[(ROWS_UP - 1) * ROWS_OUT + 2]!]!
    const bottom = moved[ear[2]!]!
    expect(top.y).toBeGreaterThan(0.003)
    expect(Math.abs(bottom.y)).toBeLessThan(top.y / 10)
  })

  test('an earring goes with its ear, as a whole', () => {
    const mesh = head([-1])
    const count = mesh.geometry.getAttribute('position').count
    const moved = moves(mesh, { earHeight: 1 })
    const ring = [count - 4, count - 3, count - 2, count - 1].map((i) => moved[i]!)
    expect(ring[0]!.y).toBeGreaterThan(0.005)
    for (const move of ring) expect(move.distanceTo(ring[0]!)).toBe(0)
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
})
