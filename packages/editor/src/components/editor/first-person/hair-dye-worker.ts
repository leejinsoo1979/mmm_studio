/// <reference lib="webworker" />
// Dyes borrowed hairstyles off the main thread (see hair-dye.ts).
import { type DyeMessage, type DyeReply, dyedPixels, PARTS_KEPT } from './hair-dye'
import type { Pixels } from './look-pixels'

declare const self: DedicatedWorkerGlobalScope

/** The parts' pixels the page has sent, oldest first: a dye names one it sent before by number. */
const parts = new Map<number, Pixels>()

self.onmessage = (event: MessageEvent<DyeMessage>) => {
  const { ticket, part, pixels, lum, hex } = event.data
  const reply = (message: DyeReply, transfer: Transferable[] = []) =>
    self.postMessage(message, transfer)
  const found = pixels ?? parts.get(part)
  if (!found) {
    reply({ ticket, missing: true })
    return
  }
  parts.delete(part)
  parts.set(part, found)
  if (parts.size > PARTS_KEPT) parts.delete(parts.keys().next().value!)
  try {
    const dyed = dyedPixels(found, lum, hex)
    reply({ ticket, pixels: dyed }, [dyed.data.buffer])
  } catch (error) {
    reply({ ticket, error: error instanceof Error ? error.message : String(error) })
  }
}
