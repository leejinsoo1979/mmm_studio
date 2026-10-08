// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, spyOn, test } from 'bun:test'
import { BufferGeometry, Float32BufferAttribute, Mesh, Scene, Texture } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { SheenSafePhysicalNodeMaterial } from './sheen-safe-material'
import { prepareWebGPURenderer, rendererForCanvas, watchGpuDevice } from './webgpu-renderer'

function triangle(count = 3) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Array(count * 3).fill(0), 3))
  return geometry
}

type Listener = (event: { error?: { message?: string } }) => void

/** A WebGPU device's surface the watch uses: its loss promise and its error listeners. */
function fakeDevice() {
  const listeners = new Set<Listener>()
  let lose: (info: { reason?: string; message?: string }) => void = () => {}
  const device = {
    lost: new Promise<{ reason?: string; message?: string }>((resolve) => {
      lose = resolve
    }),
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  }
  const error = (message: string) => {
    for (const listener of listeners) listener({ error: { message } })
  }
  return {
    device,
    listeners,
    error,
    lose: (info: { reason?: string; message?: string }) => lose(info),
  }
}

/** The renderer's surface the guards use: render(), the render-object hook, renderObject(), its node library. */
function fakeRenderer(device: object | null) {
  const drawn: object[] = []
  let renderObjectFunction: ((...args: any[]) => void) | null = null
  const renderer = {
    backend: { device },
    library: { materialNodes: new Map<string, unknown>() },
    renders: 0,
    render(scene: Scene) {
      renderer.renders++
      scene.traverse((object) => {
        const mesh = object as Mesh
        if (mesh.isMesh)
          renderObjectFunction?.(mesh, scene, null, mesh.geometry, mesh.material, null)
      })
    },
    setRenderObjectFunction(fn: (...args: any[]) => void) {
      renderObjectFunction = fn
    },
    renderObject(object: object) {
      drawn.push(object)
    },
  }
  return { renderer, drawn, asRenderer: renderer as unknown as WebGPURenderer }
}

/**
 * The renderer's render-object factory as three's is: each listens for its
 * geometry's `dispose`, keeps that listener on a geometry swap and removes
 * it on dispose before calling the factory's `onDispose`.
 */
function fakeRenderObjects(onDisposed: (name: string) => void = () => {}) {
  return {
    createRenderObject(name: string) {
      const renderObject = {
        geometry: triangle(),
        onGeometryDispose: () => {},
        onDispose: () => onDisposed(name),
        setGeometry(geometry: BufferGeometry) {
          renderObject.geometry = geometry
        },
        dispose() {
          renderObject.geometry.removeEventListener('dispose', renderObject.onGeometryDispose)
          renderObject.onDispose()
        },
        listening: (geometry: BufferGeometry) =>
          geometry.hasEventListener('dispose', renderObject.onGeometryDispose),
      }
      renderObject.geometry.addEventListener('dispose', renderObject.onGeometryDispose)
      return renderObject
    },
  }
}

/**
 * The renderer's texture manager as three's is: a texture's first upload
 * adds a `dispose` listener kept in its data, which takes itself off when
 * the texture is disposed and is otherwise never removed.
 */
function fakeTextures() {
  const data = new WeakMap<object, { initialized?: boolean; onDispose?: () => void }>()
  const textures = {
    get(texture: Texture) {
      const entry = data.get(texture) ?? {}
      data.set(texture, entry)
      return entry
    },
    updateTexture(texture: Texture) {
      const entry = textures.get(texture)
      if (entry.initialized === true) return
      entry.initialized = true
      const onDispose = () => {
        texture.removeEventListener('dispose', onDispose)
        data.delete(texture)
      }
      entry.onDispose = onDispose
      texture.addEventListener('dispose', onDispose)
    },
  }
  return textures
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('prepareWebGPURenderer', () => {
  test('skips draws with an empty position buffer and passes the rest on', () => {
    const { device } = fakeDevice()
    const { renderer, drawn, asRenderer } = fakeRenderer(device)
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const release = prepareWebGPURenderer(asRenderer, 'canvas')
      const scene = new Scene()
      const full = new Mesh(triangle())
      const empty = new Mesh(triangle(0))
      scene.add(full, empty)
      renderer.render(scene)
      expect(drawn).toEqual([full])
      expect(full.geometry.getAttribute('position')).toBeDefined()
      expect(String(warn.mock.calls[0]?.[0])).toStartWith('[canvas] skipped a draw')
      release()
    } finally {
      warn.mockRestore()
    }
  })

  test('draws physical materials sheen-safe', () => {
    const { renderer, asRenderer } = fakeRenderer(fakeDevice().device)
    const release = prepareWebGPURenderer(asRenderer, 'canvas')
    expect(renderer.library.materialNodes.get('MeshPhysicalMaterial')).toBe(
      SheenSafePhysicalNodeMaterial,
    )
    release()
  })

  test('holds back the dispose of a drawn geometry, and lets it through once released', () => {
    const { device } = fakeDevice()
    const { renderer, asRenderer } = fakeRenderer(device)
    const release = prepareWebGPURenderer(asRenderer, 'canvas')
    const scene = new Scene()
    const geometry = triangle()
    scene.add(new Mesh(geometry))
    let disposed = 0
    geometry.addEventListener('dispose', () => {
      disposed++
    })
    renderer.render(scene)
    geometry.dispose()
    expect(disposed).toBe(0)
    release()
    expect(disposed).toBe(1)
    geometry.dispose()
    expect(disposed).toBe(2)
  })

  test('disposes the render objects still around once released', () => {
    const { renderer, asRenderer } = fakeRenderer(fakeDevice().device)
    const disposed: string[] = []
    const objects = fakeRenderObjects((name) => disposed.push(name))
    Object.assign(renderer, { _objects: objects })
    const create = objects.createRenderObject
    const release = prepareWebGPURenderer(asRenderer, 'canvas')
    const made = ['quad', 'body', 'hair'].map((name) => objects.createRenderObject(name))
    made[1]?.dispose()
    expect(disposed).toEqual(['body'])
    release()
    expect(disposed).toEqual(['body', 'quad', 'hair'])
    expect(made.every((made) => !made.listening(made.geometry))).toBe(true)
    expect(objects.createRenderObject).toBe(create)
  })

  test("moves a render object's geometry listener along when its mesh swaps geometry", () => {
    const { renderer, asRenderer } = fakeRenderer(fakeDevice().device)
    const objects = fakeRenderObjects()
    Object.assign(renderer, { _objects: objects })
    const release = prepareWebGPURenderer(asRenderer, 'canvas')
    const made = objects.createRenderObject('body')
    const first = made.geometry
    const second = triangle()
    made.setGeometry(second)
    expect(made.geometry).toBe(second)
    expect(made.listening(first)).toBe(false)
    expect(made.listening(second)).toBe(true)
    release()
    expect(made.listening(second)).toBe(false)
  })

  test('takes the dispose listeners of the textures it uploaded off them once released', () => {
    const { renderer, asRenderer } = fakeRenderer(fakeDevice().device)
    const textures = fakeTextures()
    Object.assign(renderer, { _textures: textures })
    const update = textures.updateTexture
    const release = prepareWebGPURenderer(asRenderer, 'canvas')
    const shared = new Texture()
    const reused = new Texture()
    textures.updateTexture(shared)
    textures.updateTexture(shared)
    textures.updateTexture(reused)
    reused.dispose()
    textures.updateTexture(reused)
    const listeners = [shared, reused].map((texture) => textures.get(texture).onDispose!)
    expect(shared.hasEventListener('dispose', listeners[0]!)).toBe(true)
    expect(reused.hasEventListener('dispose', listeners[1]!)).toBe(true)
    release()
    expect(shared.hasEventListener('dispose', listeners[0]!)).toBe(false)
    expect(reused.hasEventListener('dispose', listeners[1]!)).toBe(false)
    expect(textures.updateTexture).toBe(update)
  })

  test('logs uncaptured errors under its scope until released', () => {
    const { device, listeners, error } = fakeDevice()
    const { asRenderer } = fakeRenderer(device)
    const printed = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const release = prepareWebGPURenderer(asRenderer, 'canvas')
      error('Vertex buffer slot 0 was not set.')
      expect(printed.mock.calls[0]?.[0]).toBe('[canvas] WebGPU uncaptured error:')
      release()
      expect(listeners.size).toBe(0)
    } finally {
      printed.mockRestore()
    }
  })
})

describe('watchGpuDevice', () => {
  test('reports a lost device, but not one the renderer destroyed', async () => {
    const printed = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const lost = fakeDevice()
      watchGpuDevice(fakeRenderer(lost.device).asRenderer, 'canvas')
      lost.lose({ reason: 'unknown', message: 'GPU reset' })
      await tick()
      expect(String(printed.mock.calls[0]?.[0])).toStartWith('[canvas] WebGPU device lost')

      const destroyed = fakeDevice()
      watchGpuDevice(fakeRenderer(destroyed.device).asRenderer, 'canvas')
      destroyed.lose({ reason: 'destroyed' })
      await tick()
      expect(printed.mock.calls.length).toBe(1)
    } finally {
      printed.mockRestore()
    }
  })

  test('says so when the renderer runs on the WebGL fallback', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const stop = watchGpuDevice(fakeRenderer(null).asRenderer, 'canvas')
      expect(String(warn.mock.calls[0]?.[0])).toStartWith('[canvas] No WebGPU device')
      stop()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('rendererForCanvas', () => {
  test('makes one renderer per canvas however often it is asked', async () => {
    const canvas = {} as HTMLCanvasElement
    let made = 0
    const create = async () => ({ id: ++made })
    const first = rendererForCanvas(canvas, create)
    const second = rendererForCanvas(canvas, create)
    expect(second).toBe(first)
    expect(await first).toEqual({ id: 1 })
    expect(await rendererForCanvas(canvas, create)).toEqual({ id: 1 })
    expect(await rendererForCanvas({} as HTMLCanvasElement, create)).toEqual({ id: 2 })
  })

  test('tries again after a failed init', async () => {
    const canvas = {} as HTMLCanvasElement
    const failed = rendererForCanvas(canvas, async () => {
      throw new Error('no adapter')
    })
    await expect(failed).rejects.toThrow('no adapter')
    await tick()
    expect(await rendererForCanvas(canvas, async () => 'second')).toBe('second')
  })
})
