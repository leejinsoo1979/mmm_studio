import { describe, expect, test } from 'bun:test'
import {
  BufferAttribute,
  type BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  type SkinnedMesh,
} from 'three'
import { applyShape, headOf, onShaped, reshapeNow, type Shaper, shapeVersion } from './avatar-shape'
import { loadCharacterScene } from './hair-test-utils'
import { originalGeometry } from './head-geometry'

const isHead = (mesh: Mesh) =>
  /_head$/.test(((mesh.userData.lookOriginal ?? mesh.material) as { name: string }).name)

/** Lifts the head's points 1 mm (bind units), counting each point it is asked about. */
function lifting() {
  const asked = { count: 0 }
  const shaper: Shaper = (mesh) =>
    isHead(mesh)
      ? (_point, _i, move) => {
          asked.count++
          move.set(0, 0.001, 0)
        }
      : null
  return { shaper, asked }
}

/** A copy of a geometry with its first `moved` points pushed out 5 mm, the rest where they were. */
function flattened(geometry: BufferGeometry, moved: number): BufferGeometry {
  const copy = geometry.clone()
  const position = copy.getAttribute('position') as BufferAttribute
  const values = Float32Array.from({ length: position.count * 3 }, (_, j) =>
    position.getComponent(Math.floor(j / 3), j % 3),
  )
  for (let i = 0; i < moved; i++) values[i * 3 + 2]! += 0.005
  copy.setAttribute('position', new BufferAttribute(values, 3))
  return copy
}

const yOf = (geometry: BufferGeometry, i: number) => geometry.getAttribute('position').getY(i)
const zOf = (geometry: BufferGeometry, i: number) => geometry.getAttribute('position').getZ(i)

describe('onShaped', () => {
  test('hears each shape put on and taken off, the version rising, until stopped', async () => {
    const scene = await loadCharacterScene('Male_Adult_01')
    const heard: number[] = []
    const stop = onShaped(scene, (version) => heard.push(version))
    const undo = applyShape(scene, [lifting().shaper])
    expect(heard).toEqual([shapeVersion()])
    undo()
    expect(heard.length).toBe(2)
    expect(heard[1]!).toBeGreaterThan(heard[0]!)
    stop()
    applyShape(scene, [lifting().shaper])()
    expect(heard.length).toBe(2)
  })
})

describe('reshapeNow', () => {
  test('reshapes a head at once from what it is now shaped from, keeping the moves of points that stayed', async () => {
    const scene = await loadCharacterScene('Male_Adult_01')
    const head = headOf(scene) as SkinnedMesh
    const loaded = head.geometry
    const count = loaded.getAttribute('position').count
    const { shaper, asked } = lifting()
    const undo = applyShape(scene, [shaper])
    const first = head.geometry
    expect(yOf(first, 0)).toBeCloseTo(yOf(loaded, 0) + 0.001, 6)
    let freed = false
    first.addEventListener('dispose', () => {
      freed = true
    })

    const flat = flattened(loaded, 10)
    head.userData.shapeOriginal = flat
    asked.count = 0
    reshapeNow(head)
    // Only the ten moved points are asked about again (each with its three steps for the normal).
    expect(asked.count).toBe(10 * 4)
    expect(freed).toBe(true)
    expect(head.geometry).not.toBe(first)
    expect(originalGeometry(head)).toBe(flat)
    expect(zOf(head.geometry, 0)).toBeCloseTo(zOf(loaded, 0) + 0.005, 6)
    expect(yOf(head.geometry, 0)).toBeCloseTo(yOf(loaded, 0) + 0.001, 6)
    expect(yOf(head.geometry, count - 1)).toBeCloseTo(yOf(loaded, count - 1) + 0.001, 6)

    const second = head.geometry
    let secondFreed = false
    second.addEventListener('dispose', () => {
      secondFreed = true
    })
    undo()
    expect(head.geometry).toBe(flat)
    expect(head.userData.shapeOriginal).toBeUndefined()
    expect(secondFreed).toBe(true)
  })

  test('leaves a mesh with no shape on it as it is', async () => {
    const scene = await loadCharacterScene('Male_Adult_01')
    const head = headOf(scene) as SkinnedMesh
    const shown = head.geometry
    reshapeNow(head)
    expect(head.geometry).toBe(shown)
  })
})

describe('applyShape', () => {
  test('leaves generated hair be: it follows the head itself', async () => {
    const scene = await loadCharacterScene('Male_Adult_01')
    const head = headOf(scene) as SkinnedMesh
    const hair = new Mesh(head.geometry.clone(), new MeshBasicMaterial())
    hair.userData.hair = {}
    head.parent!.add(hair)
    const shown = hair.geometry
    const everything: Shaper = () => (_point, _i, move) => move.set(0, 0.001, 0)
    const undo = applyShape(scene, [everything])
    expect(hair.geometry).toBe(shown)
    expect(head.geometry).not.toBe(originalGeometry(head))
    undo()
  })
})
