import type { AvatarGender } from '../avatar-catalog'
import type { AvatarJobReport, CaptureColors, CaptureView } from './avatar-job'
import type { WorkerReply } from './avatar-worker'

/**
 * Asking a worker to make a photo avatar: the photos as read on the page
 * (pixels, landmarks, masks) go in, the avatar's GLB comes out. Everything
 * stays in this browser.
 */

export type PhotoAvatarRequest = {
  gender: AvatarGender
  views: CaptureView[]
  colors: CaptureColors
  /** Where the base bodies are served (the app's own by default). */
  root?: string
}

export type PhotoAvatarProgress = { fraction: number; stage: 'fit' | 'texture' | 'pack' }

export function buildPhotoAvatar(
  request: PhotoAvatarRequest,
  onProgress: (progress: PhotoAvatarProgress) => void,
  signal?: AbortSignal,
  makeWorker: () => Worker = () =>
    new Worker(new URL('./avatar-worker.ts', import.meta.url), { type: 'module' }),
): Promise<{ glb: Uint8Array; report: AvatarJobReport }> {
  return new Promise((resolve, reject) => {
    const worker = makeWorker()
    const stop = () => {
      worker.terminate()
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', stop, { once: true })
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const message = event.data
      if ('progress' in message) {
        onProgress({ fraction: message.progress, stage: message.stage })
        return
      }
      signal?.removeEventListener('abort', stop)
      worker.terminate()
      if ('error' in message) reject(new Error(message.error))
      else resolve(message)
    }
    worker.onerror = (event) => {
      signal?.removeEventListener('abort', stop)
      worker.terminate()
      reject(new Error(event.message || 'worker failed'))
    }
    // The photos' pixels go across without a copy.
    const transfer = request.views.flatMap((view) =>
      [view.rgba, view.mask, view.skin, view.covered, view.landmarks]
        .filter((part): part is NonNullable<typeof part> => Boolean(part))
        .map((part) => part.buffer as ArrayBuffer),
    )
    worker.postMessage(request, [...new Set(transfer)])
  })
}
