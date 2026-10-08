import type { WebGPURenderer } from 'three/webgpu'
import {
  createInUseDisposeGuard,
  ensureSecondaryUv,
  flushBeforeRender,
  hasDrawableGeometry,
  type InUseDisposeGuard,
} from './drawable-geometry'
import { createGpuErrorReporter } from './gpu-error-log'
import { installSheenSafeMaterial } from './sheen-safe-material'

const warnedEmptyDraw = process.env.NODE_ENV === 'production' ? null : new WeakSet<object>()

/**
 * Renderer-level safety net against the empty-vertex-buffer crash.
 *
 * Wraps the per-object render function so any draw whose geometry has a count-0
 * `position` attribute is skipped instead of submitted. One such draw leaves
 * WebGPU vertex buffer slot 0 unbound, which the validator rejects and which
 * poisons the *whole* command encoder — so a single stray empty mesh (e.g. a
 * transient placeholder, or a derived edge/outline geometry) flickers the entire
 * canvas, not just itself. See `hasDrawableGeometry`.
 *
 * Draws whose group or draw range is empty (the placeholders' count-0 groups)
 * are skipped too, silently: they draw nothing by design.
 *
 * It also keeps a drawn geometry's `dispose()` from freeing buffers a mesh in
 * the scene still draws, which binds a freed buffer on the next draw with the
 * same consequence. Held-back disposes are settled at the start of every
 * `render()`, before any render object can move on to a mesh's new geometry.
 * See `createInUseDisposeGuard`.
 *
 * The custom render-object function is the documented three.js hook for this
 * (`Renderer.setRenderObjectFunction`); it must call `renderObject()` for
 * everything it keeps. `MergedOutlineNode` captures and restores this function
 * around its passes, so the guard survives outline rendering (its own passes
 * carry the same check inline).
 */
export function installDrawGuards(renderer: WebGPURenderer, scope = 'viewer'): InUseDisposeGuard {
  const disposeGuard = createInUseDisposeGuard()
  flushBeforeRender(renderer, disposeGuard)
  renderer.setRenderObjectFunction(
    (
      object: any,
      scene: any,
      camera: any,
      geometry: any,
      material: any,
      group: any,
      lightsNode: any,
      clippingContext: any,
      passId: any,
    ) => {
      if (!hasDrawableGeometry(geometry, group)) {
        const emptyBuffer = !(geometry?.attributes?.position?.count > 0)
        if (emptyBuffer && warnedEmptyDraw && !warnedEmptyDraw.has(geometry ?? object)) {
          warnedEmptyDraw.add(geometry ?? object)
          console.warn(
            `[${scope}] skipped a draw with an empty position buffer (would poison the WebGPU command encoder)`,
            { name: object?.name, type: object?.type, material: material?.name },
          )
        }
        return
      }
      ensureSecondaryUv(geometry)
      disposeGuard.track(object, geometry)
      ;(renderer as any).renderObject(
        object,
        scene,
        camera,
        geometry,
        material,
        group,
        lightsNode,
        clippingContext,
        passId,
      )
    },
  )
  return disposeGuard
}

type WebGPUDeviceLossInfo = {
  reason?: string
  message?: string
}

type WebGPUDeviceLike = {
  lost: Promise<WebGPUDeviceLossInfo>
  addEventListener?: (type: string, listener: (event: any) => void) => void
  removeEventListener?: (type: string, listener: (event: any) => void) => void
}

/**
 * Logs the renderer's WebGPU device being lost (tab backgrounded and the GPU
 * reclaimed, a driver reset, the browser's policy) and its uncaptured errors,
 * which are otherwise silent: once per distinct message, then a periodic count
 * while they repeat (see gpu-error-log.ts). A device the renderer destroyed
 * itself (`renderer.dispose()`) is not reported. Returns what stops it.
 */
export function watchGpuDevice(renderer: WebGPURenderer, scope = 'viewer'): () => void {
  const backend = (renderer as any).backend
  const device = backend?.device as WebGPUDeviceLike | undefined
  if (!device) {
    console.warn(`[${scope}] No WebGPU device on backend — running on a fallback renderer.`, {
      backend: backend?.constructor?.name ?? 'unknown',
      rendererType: (renderer as any).constructor?.name ?? 'unknown',
    })
    return () => {}
  }

  let watching = true
  device.lost.then((info) => {
    if (!watching || info.reason === 'destroyed') return
    console.error(
      `[${scope}] WebGPU device lost: reason="${info.reason ?? 'unknown'}", message="${info.message ?? ''}". ` +
        'The page must be reloaded to recover the GPU context.',
    )
  })

  const errors = createGpuErrorReporter(
    (...args) => console.error(...args),
    (run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    undefined,
    scope,
  )
  const onUncapturedError = (event: any) => errors.report(event?.error)
  device.addEventListener?.('uncapturederror', onUncapturedError)

  return () => {
    watching = false
    device.removeEventListener?.('uncapturederror', onUncapturedError)
    errors.dispose()
  }
}

type DisposeListenable = {
  addEventListener(type: 'dispose', listener: () => void): void
  removeEventListener(type: 'dispose', listener: () => void): void
}

type RenderObjectLike = {
  geometry: DisposeListenable
  onGeometryDispose: () => void
  onDispose: () => void
  setGeometry(geometry: DisposeListenable): void
  dispose(): void
}

/**
 * three's `renderer.dispose()` drops its render objects without disposing
 * them, so each keeps listening for its material's and geometry's `dispose`
 * events, and through the listener holds the renderer and the scene it drew.
 * Materials and geometries that outlive the renderer (shared or cached ones,
 * and the one geometry every QuadMesh shares) would keep every renderer ever
 * made, with its scene, alive. This follows the render objects the renderer
 * makes, weakly, and returns what disposes the ones still around.
 *
 * A render object whose mesh swaps geometry leaves its listener on the old
 * one too (`setGeometry`); here the listener moves with it.
 */
export function trackRenderObjects(renderer: WebGPURenderer): () => void {
  const objects = (renderer as any)._objects as
    | { createRenderObject: (...args: unknown[]) => RenderObjectLike }
    | undefined
  if (typeof objects?.createRenderObject !== 'function') return () => {}
  const create = objects.createRenderObject
  const live = new Set<WeakRef<RenderObjectLike>>()
  const gone = new FinalizationRegistry<WeakRef<RenderObjectLike>>((ref) => live.delete(ref))
  objects.createRenderObject = (...args: unknown[]) => {
    const renderObject = create.apply(objects, args)
    const ref = new WeakRef(renderObject)
    live.add(ref)
    gone.register(renderObject, ref, ref)
    const setGeometry = renderObject.setGeometry
    renderObject.setGeometry = (geometry) => {
      renderObject.geometry.removeEventListener('dispose', renderObject.onGeometryDispose)
      setGeometry.call(renderObject, geometry)
      geometry.addEventListener('dispose', renderObject.onGeometryDispose)
    }
    const onDispose = renderObject.onDispose
    renderObject.onDispose = () => {
      live.delete(ref)
      gone.unregister(ref)
      onDispose()
    }
    return renderObject
  }
  return () => {
    objects.createRenderObject = create
    for (const ref of [...live]) {
      try {
        ref.deref()?.dispose()
      } catch (error) {
        console.error('[viewer] disposing a render object threw', error)
      }
    }
    live.clear()
  }
}

/**
 * Gives a WebGPURenderer made outside the viewer (after `await
 * renderer.init()`) the viewer's safety nets: the draw guards, the
 * sheen-safe physical material and the device watch. `scope` names it in
 * the log. Returns what undoes them; call it before `renderer.dispose()`,
 * so the geometries and materials it drew, which may live on in another
 * renderer, no longer hold on to it, its meshes or its scenes.
 */
export function prepareWebGPURenderer(renderer: WebGPURenderer, scope: string): () => void {
  installSheenSafeMaterial(renderer)
  const guard = installDrawGuards(renderer, scope)
  const stop = watchGpuDevice(renderer, scope)
  const disposeRenderObjects = trackRenderObjects(renderer)
  return () => {
    stop()
    guard.release()
    disposeRenderObjects()
  }
}

const renderersByCanvas = new WeakMap<object, Promise<unknown>>()

/**
 * One renderer per canvas for R3F's async `gl` factory, however often R3F asks.
 *
 * R3F's <Canvas> useLayoutEffect has no deps, so any re-render (theme switch,
 * parent re-render, StrictMode double-mount) re-invokes `configure()`. With a
 * sync `gl` factory that's harmless — the renderer is created once and reused.
 * With an async factory (WebGPURenderer needs `await init()`), two configure
 * calls can race: both see `state.gl == null` and both create a renderer. The
 * first to resolve gets `setSize`/`setDpr` called on it; the second overwrites
 * `state.gl` but R3F's store already holds the new size/dpr, so the new
 * renderer is never resized and stays at the canvas's 300×150 default.
 *
 * Keeping the in-flight promise (not just the resolved renderer) by canvas
 * makes concurrent configure() calls await the same init. A failed one is
 * dropped, so a later mount on the same canvas can try again.
 */
export function rendererForCanvas<R>(
  canvas: object | undefined,
  create: () => Promise<R>,
): Promise<R> {
  const known = canvas ? (renderersByCanvas.get(canvas) as Promise<R> | undefined) : undefined
  if (known) return known
  const made = create()
  if (canvas) {
    renderersByCanvas.set(canvas, made)
    made.catch(() => {
      if (renderersByCanvas.get(canvas) === made) renderersByCanvas.delete(canvas)
    })
  }
  return made
}
