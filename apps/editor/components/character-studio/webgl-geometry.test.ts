import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Float32BufferAttribute,
  Frustum,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  IntType,
  Mesh,
  MeshBasicMaterial,
  Scene,
  type WebGLRenderer,
} from 'three'
// @ts-expect-error three ships no types for its WebGPU backend's internals
import WebGPUAttributeUtils from 'three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js'
import { drawWebglGeometries, webglGeometry } from './webgl-geometry'

type Attribute = BufferAttribute | InterleavedBufferAttribute

const USAGE = { INDEX: 0x10, VERTEX: 0x20, COPY_DST: 0x08 }
const global = globalThis as { GPUBufferUsage?: unknown }
const hadUsage = 'GPUBufferUsage' in global
beforeAll(() => {
  if (!hadUsage) global.GPUBufferUsage = USAGE
})
afterAll(() => {
  if (!hadUsage) delete global.GPUBufferUsage
})

/** Uploads a geometry as the game's WebGPU renderer does, with three's own code and a stand-in device. */
function drawWithWebGPU(geometry: BufferGeometry) {
  const data = new WeakMap<object, Record<string, unknown>>()
  const backend = {
    get(object: object) {
      let found = data.get(object)
      if (!found) {
        found = {}
        data.set(object, found)
      }
      return found
    },
    device: {
      createBuffer: ({ size }: { size: number }) => ({
        getMappedRange: () => new ArrayBuffer(size),
        unmap: () => {},
      }),
    },
  }
  const utils = new WebGPUAttributeUtils(backend)
  for (const attribute of Object.values(geometry.attributes)) {
    utils.createAttribute(attribute, USAGE.VERTEX | USAGE.COPY_DST)
  }
  if (geometry.index) utils.createAttribute(geometry.index, USAGE.INDEX | USAGE.COPY_DST)
}

/** Whether WebGL binds an attribute as integers (WebGLBindingStates: an INT or UNSIGNED_INT array, or gpuType IntType). */
function boundAsIntegers(attribute: Attribute): boolean {
  if (attribute instanceof InterleavedBufferAttribute) {
    return attribute.data.array instanceof Int32Array || attribute.data.array instanceof Uint32Array
  }
  return (
    attribute.array instanceof Int32Array ||
    attribute.array instanceof Uint32Array ||
    attribute.gpuType === IntType
  )
}

const SLOTS = [0, 3, 0, 0, 7, 3, 0, 0, 61, 0, 0, 0]

/** A body laid out as a Rocketbox file's is once loaded (see withPlainVertices). */
function body() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  geometry.setAttribute(
    'uv',
    new BufferAttribute(new Uint16Array([0, 0, 65535, 0, 0, 65535]), 2, true),
  )
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint8Array(SLOTS), 4))
  geometry.setAttribute(
    'skinWeight',
    new BufferAttribute(new Uint8Array([200, 55, 0, 0, 128, 127, 0, 0, 255, 0, 0, 0]), 4, true),
  )
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1))
  return geometry
}

const valuesOf = (attribute: Attribute) =>
  Array.from({ length: attribute.count * attribute.itemSize }, (_, j) =>
    attribute.getComponent(Math.floor(j / attribute.itemSize), j % attribute.itemSize),
  )

describe('a body the game has drawn, in the studio', () => {
  test('the WebGPU renderer widens its bone slots in place, which WebGL would bind as integers', () => {
    const geometry = body()
    const skinIndex = geometry.getAttribute('skinIndex') as BufferAttribute
    expect(boundAsIntegers(skinIndex)).toBe(false)
    drawWithWebGPU(geometry)
    expect(geometry.getAttribute('skinIndex')).toBe(skinIndex)
    expect(skinIndex.array).toBeInstanceOf(Uint32Array)
    expect(boundAsIntegers(skinIndex)).toBe(true)
  })

  test('is drawn from a twin WebGL reads as floats, sharing its points', () => {
    const geometry = body()
    drawWithWebGPU(geometry)
    const twin = webglGeometry(geometry)
    expect(twin).not.toBe(geometry)
    for (const attribute of Object.values(twin.attributes)) {
      expect(boundAsIntegers(attribute)).toBe(false)
    }
    const slots = twin.getAttribute('skinIndex') as BufferAttribute
    expect(slots.array).toBeInstanceOf(Float32Array)
    expect(slots.itemSize).toBe(4)
    expect(slots.normalized).toBe(false)
    expect(valuesOf(slots)).toEqual(SLOTS)
    for (const name of ['position', 'normal', 'uv', 'skinWeight']) {
      expect(twin.getAttribute(name)).toBe(geometry.getAttribute(name))
    }
    expect(twin.index).toBe(geometry.index)
    // The game's own stays as its GPU buffer was made from.
    expect(geometry.getAttribute('skinIndex').array).toBeInstanceOf(Uint32Array)
  })

  test('a widened interleaved attribute is drawn from floats too', () => {
    const geometry = body()
    const packed = new InterleavedBuffer(new Uint16Array([1, 9, 2, 8, 3, 7]), 2)
    geometry.setAttribute('slots', new InterleavedBufferAttribute(packed, 1, 1))
    drawWithWebGPU(geometry)
    expect(packed.array).toBeInstanceOf(Uint32Array)
    const slots = webglGeometry(geometry).getAttribute('slots')
    expect(boundAsIntegers(slots)).toBe(false)
    expect(valuesOf(slots)).toEqual([9, 8, 7])
  })

  test('one the game has not drawn, or meant as integers, is drawn as it is', () => {
    const fresh = body()
    expect(webglGeometry(fresh)).toBe(fresh)
    const integers = body()
    drawWithWebGPU(integers)
    ;(integers.getAttribute('skinIndex') as BufferAttribute).gpuType = IntType
    expect(webglGeometry(integers)).toBe(integers)
  })

  test('keeps one twin per geometry, in step with it', () => {
    const geometry = body()
    drawWithWebGPU(geometry)
    const twin = webglGeometry(geometry)
    expect(twin).not.toBe(geometry)
    const slots = twin.getAttribute('skinIndex')
    expect(webglGeometry(geometry)).toBe(twin)
    expect(twin.getAttribute('skinIndex')).toBe(slots)

    const normal = new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3)
    geometry.setAttribute('normal', normal)
    geometry.deleteAttribute('uv')
    const own = geometry.getAttribute('skinIndex') as BufferAttribute
    own.setComponent(2, 0, 12)
    own.needsUpdate = true
    expect(webglGeometry(geometry)).toBe(twin)
    expect(twin.getAttribute('normal')).toBe(normal)
    expect(twin.hasAttribute('uv')).toBe(false)
    expect(twin.getAttribute('skinIndex')).toBe(slots)
    expect(slots.getComponent(2, 0)).toBe(12)
  })

  test('its twin is disposed with it', () => {
    const geometry = body()
    drawWithWebGPU(geometry)
    const twin = webglGeometry(geometry)
    let disposed = false
    twin.addEventListener('dispose', () => {
      disposed = true
    })
    geometry.dispose()
    expect(disposed).toBe(true)
    expect(webglGeometry(geometry)).not.toBe(twin)
  })
})

describe('the stage drawing the twins', () => {
  const renderer = {} as WebGLRenderer
  const camera = {} as Camera
  const extra = [new BufferGeometry(), new MeshBasicMaterial(), new Group()] as const
  const before = (scene: Scene) => scene.onBeforeRender(renderer, scene, camera, ...extra)
  const render = (scene: Scene, during: () => void) => {
    before(scene)
    during()
    scene.onAfterRender(renderer, scene, camera, ...extra)
  }

  test('puts them in only while the scene renders', () => {
    const scene = new Scene()
    const drawn = body()
    drawWithWebGPU(drawn)
    const widened = new Mesh(drawn)
    const plain = new Mesh(body())
    const hidden = new Mesh(drawn)
    hidden.visible = false
    scene.add(widened, plain, hidden)
    const own = plain.geometry
    const stop = drawWebglGeometries(scene)
    render(scene, () => {
      expect(widened.geometry).not.toBe(drawn)
      expect(widened.geometry).toBe(webglGeometry(drawn))
      expect(plain.geometry).toBe(own)
      expect(hidden.geometry).toBe(drawn)
    })
    expect(widened.geometry).toBe(drawn)

    // A render that never finished is put right by the next.
    before(scene)
    render(scene, () => {
      expect(widened.geometry).not.toBe(drawn)
      expect(widened.geometry).toBe(webglGeometry(drawn))
    })
    expect(widened.geometry).toBe(drawn)

    stop()
    render(scene, () => expect(widened.geometry).toBe(drawn))
  })

  test('keeps the bounds three works out on a twin to cull it', () => {
    const scene = new Scene()
    const drawn = body()
    drawWithWebGPU(drawn)
    const mesh = new Mesh(drawn)
    scene.add(mesh)
    const twin = webglGeometry(drawn)
    let worked = 0
    const work = twin.computeBoundingSphere
    twin.computeBoundingSphere = function () {
      worked++
      work.call(this)
    }
    const stop = drawWebglGeometries(scene)
    // As WebGLRenderer culls each mesh, in every render: the frame's, the shadows'.
    const frustum = new Frustum()
    for (let i = 0; i < 3; i++) render(scene, () => frustum.intersectsObject(mesh))
    expect(worked).toBe(1)
    expect(drawn.boundingSphere).toBeNull()

    drawn.computeBoundingSphere()
    drawn.computeBoundingBox()
    render(scene, () => {})
    expect(twin.boundingSphere).toBe(drawn.boundingSphere)
    expect(twin.boundingBox).toBe(drawn.boundingBox)
    stop()
  })

  test('stopping mid-render puts the meshes back', () => {
    const scene = new Scene()
    const drawn = body()
    drawWithWebGPU(drawn)
    const mesh = new Mesh(drawn)
    scene.add(mesh)
    const stop = drawWebglGeometries(scene)
    before(scene)
    expect(mesh.geometry).not.toBe(drawn)
    stop()
    expect(mesh.geometry).toBe(drawn)
  })
})
