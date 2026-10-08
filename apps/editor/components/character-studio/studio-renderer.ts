import { prepareWebGPURenderer, rendererForCanvas } from '@pascal-app/viewer'
import { useCallback, useEffect, useState } from 'react'
import { WebGPURenderer } from 'three/webgpu'

/**
 * The stage draws with three's WebGPURenderer, as the game's viewer does (on
 * WebGL 2 through the same renderer where WebGPU is missing): one renderer,
 * one set of node materials and attribute formats for every body both draw,
 * and no second WebGL context to lose. R3F does not dispose a WebGPURenderer
 * when its canvas goes, so the stage does, its GPU device with it.
 */

/** How long a closed stage's renderer outlives it: R3F lets go of its scene half a second after unmounting. */
export const RENDERER_GRACE_MS = 1000

type Disposable = { dispose(): void }

/**
 * The renderers a stage made, let go (their safety nets undone, then
 * disposed) a grace period after it closes, once R3F has taken the scene
 * down. Opening again within the grace — React StrictMode's remount — keeps
 * them; one that finishes starting after the stage closed goes the same way.
 */
export class RendererKeeper<R extends Disposable> {
  private readonly held = new Map<R, () => void>()
  private open = true

  constructor(private readonly later: (run: () => void) => void) {}

  opened() {
    this.open = true
  }

  closed() {
    this.open = false
    this.later(() => this.letGoIfClosed())
  }

  keep(renderer: R, release: () => void) {
    this.held.set(renderer, release)
    if (!this.open) this.later(() => this.letGoIfClosed())
  }

  get size() {
    return this.held.size
  }

  private letGoIfClosed() {
    if (this.open) return
    for (const [renderer, release] of this.held) {
      this.held.delete(renderer)
      release()
      renderer.dispose()
    }
  }
}

/** The stage canvas's `gl`: a WebGPURenderer per canvas, kept until the stage closes. */
export function useStudioRenderer() {
  const [keeper] = useState(
    () =>
      new RendererKeeper<WebGPURenderer>((run) => {
        window.setTimeout(run, RENDERER_GRACE_MS)
      }),
  )
  useEffect(() => {
    keeper.opened()
    return () => keeper.closed()
  }, [keeper])
  return useCallback(
    (props: { canvas?: unknown }) =>
      rendererForCanvas(props.canvas as HTMLCanvasElement | undefined, async () => {
        const renderer = new WebGPURenderer({
          canvas: props.canvas as HTMLCanvasElement | undefined,
          antialias: true,
          powerPreference: 'high-performance',
        })
        await renderer.init()
        keeper.keep(renderer, prepareWebGPURenderer(renderer, 'studio'))
        return renderer
      }),
    [keeper],
  )
}
