/// <reference lib="webworker" />
// Makes a photo avatar off the main thread (see avatar-job.ts): fitting the
// head to the photos and laying their skin on it takes tens of seconds.
import { type AvatarJobReport, type PictureCodec, runAvatarJob } from './avatar-job'
import { loadBaseBody, PHOTO_BASE_URL } from './base-files'
import type { PhotoAvatarRequest } from './build-client'
import { loadHairStyle } from './hair-library'

declare const self: DedicatedWorkerGlobalScope

export type WorkerReply =
  | { progress: number; stage: 'fit' | 'texture' | 'pack' }
  | { glb: Uint8Array; report: AvatarJobReport }
  | { error: string }

/** Pictures through the worker's own image decoder and an offscreen canvas. */
const codec: PictureCodec = {
  async decode(bytes, mimeType) {
    const bitmap = await createImageBitmap(
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }),
    )
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    return { data, width: canvas.width, height: canvas.height }
  },
  async encode(data, width, height, quality) {
    const canvas = new OffscreenCanvas(width, height)
    canvas
      .getContext('2d')!
      .putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
    // WebP where the browser can write it (as the base body's pictures are); where not (Safari),
    // PNG for a picture with any see-through pixel (hair cut from its alpha), else JPEG.
    let blob = await canvas.convertToBlob({ type: 'image/webp', quality })
    if (blob.type !== 'image/webp') {
      let clear = false
      for (let i = 3; i < data.length && !clear; i += 4) clear = data[i]! < 255
      blob = await canvas.convertToBlob(
        clear ? { type: 'image/png' } : { type: 'image/jpeg', quality },
      )
    }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type }
  },
}

const reply = (message: WorkerReply, transfer: Transferable[] = []) =>
  self.postMessage(message, transfer)

self.onmessage = async (event: MessageEvent<PhotoAvatarRequest>) => {
  const request = event.data
  try {
    const base = await loadBaseBody(request.gender, request.root)
    const { glb, report } = await runAvatarJob({
      base,
      views: request.views,
      colors: request.colors,
      codec,
      hair: (name) => loadHairStyle(name, request.root ?? PHOTO_BASE_URL),
      progress: (progress, stage) => reply({ progress, stage }),
    })
    reply({ glb, report }, [glb.buffer])
  } catch (error) {
    reply({ error: error instanceof Error ? error.message : String(error) })
  }
}
