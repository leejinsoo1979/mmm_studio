/// <reference lib="webworker" />
// Cuts borrowed hairstyles' pictures off the main thread (see hair-cap.ts).
import { type CapMessage, type CapReply, cutPictures } from './hair-cap'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (event: MessageEvent<CapMessage>) => {
  const { ticket } = event.data
  try {
    const cut = cutPictures(event.data)
    const transfer: Transferable[] = []
    if (cut.picture.cap) {
      transfer.push(cut.picture.cap.pixels.data.buffer, cut.picture.cap.dyeMask.buffer)
    }
    if (cut.opacity) transfer.push(cut.opacity.data.buffer)
    self.postMessage({ ticket, cut } satisfies CapReply, transfer)
  } catch (error) {
    self.postMessage({
      ticket,
      error: error instanceof Error ? error.message : String(error),
    } satisfies CapReply)
  }
}
