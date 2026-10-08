// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, spyOn, test } from 'bun:test'
import { BufferGeometry, Float32BufferAttribute, Mesh, Scene } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
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

/** The renderer's surface the guards use: render(), the render-object hook, renderObject(). */
function fakeRenderer(device: object | null) {
  const drawn: object[] = []
  let renderObjectFunction: ((...args: any[]) => void) | null = null
  const renderer = {
    backend: { device },
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('prepareWebGPURenderer', () => {
  test('skips draws with an empty position buffer and passes the rest on', () => {
    const { device } = fakeDevice()
    const { renderer, drawn, asRenderer } = fakeRenderer(device)
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const release = prepareWebGPURenderer(asRenderer, 'studio')
      const scene = new Scene()
      const full = new Mesh(triangle())
      const empty = new Mesh(triangle(0))
      scene.add(full, empty)
      renderer.render(scene)
      expect(drawn).toEqual([full])
      expect(full.geometry.getAttribute('position')).toBeDefined()
      expect(String(warn.mock.calls[0]?.[0])).toStartWith('[studio] skipped a draw')
      release()
    } finally {
      warn.mockRestore()
    }
  })

  test('holds back the dispose of a drawn geometry, and lets it through once released', () => {
    const { device } = fakeDevice()
    const { renderer, asRenderer } = fakeRenderer(device)
    const release = prepareWebGPURenderer(asRenderer, 'studio')
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

  test('logs uncaptured errors under its scope until released', () => {
    const { device, listeners, error } = fakeDevice()
    const { asRenderer } = fakeRenderer(device)
    const printed = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const release = prepareWebGPURenderer(asRenderer, 'studio')
      error('Vertex buffer slot 0 was not set.')
      expect(printed.mock.calls[0]?.[0]).toBe('[studio] WebGPU uncaptured error:')
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
      watchGpuDevice(fakeRenderer(lost.device).asRenderer, 'studio')
      lost.lose({ reason: 'unknown', message: 'GPU reset' })
      await tick()
      expect(String(printed.mock.calls[0]?.[0])).toStartWith('[studio] WebGPU device lost')

      const destroyed = fakeDevice()
      watchGpuDevice(fakeRenderer(destroyed.device).asRenderer, 'studio')
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
      const stop = watchGpuDevice(fakeRenderer(null).asRenderer, 'studio')
      expect(String(warn.mock.calls[0]?.[0])).toStartWith('[studio] No WebGPU device')
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
