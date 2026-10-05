import { dye, hexToRgb, type Pixels } from './look-pixels'

/**
 * A borrowed hairstyle's dye (see avatar-hair.ts), made in a worker: a dye
 * drag re-dyes two 1024² pictures a step, a tenth of a second or more of
 * the page's time each.
 */

/**
 * Pixels of a hairstyle's part dyed `hex`, every texel — those cut away
 * too, which hold the colour bled under them when it loaded (see
 * `loadHairAsset`), so the dye needs no bleeding again. `lum` is the hair's
 * usual lightness.
 */
export function dyedPixels(pixels: Pixels, lum: number, hex: string): Pixels {
  const dyed: Pixels = {
    data: new Uint8ClampedArray(pixels.data),
    width: pixels.width,
    height: pixels.height,
  }
  for (let p = 3; p < dyed.data.length; p += 4) dyed.data[p] = 255
  dye(dyed, hexToRgb(hex), lum)
  for (let p = 3; p < dyed.data.length; p += 4) dyed.data[p] = pixels.data[p]!
  return dyed
}

/** How many parts' pixels the dye worker keeps, the page sending each once. */
export const PARTS_KEPT = 8

/** A dye for the worker: the part's pixels by number, the pixels themselves when the worker hasn't them. */
export type DyeMessage = {
  ticket: number
  part: number
  pixels: Pixels | null
  lum: number
  hex: string
}

/** The worker's answer: the dyed pixels, why it failed, or that it lacks the part's pixels. */
export type DyeReply = { ticket: number; pixels?: Pixels; error?: string; missing?: boolean }

type Request = {
  message: DyeMessage
  source: Pixels
  resolve: (pixels: Pixels) => void
  reject: (error: unknown) => void
}

let worker: Worker | null | undefined
let tickets = 0
let numbered = 0
const requests = new Map<number, Request>()
const numbers = new WeakMap<Pixels, number>()
/** The parts the worker holds, oldest first: as it keeps them (see hair-dye-worker.ts). */
const sent = new Set<number>()

function post(request: Request, to: Worker) {
  const { part } = request.message
  const known = sent.delete(part)
  sent.add(part)
  if (sent.size > PARTS_KEPT) sent.delete(sent.values().next().value!)
  to.postMessage({ ...request.message, pixels: known ? null : request.source })
}

const dyeHere = ({ message, source, resolve, reject }: Request) => {
  try {
    resolve(dyedPixels(source, message.lum, message.hex))
  } catch (error) {
    reject(error)
  }
}

/** The dye worker, started on first use; null where there are no workers, or it failed to start. */
function dyeWorker(): Worker | null {
  if (worker !== undefined) return worker
  worker = null
  if (typeof Worker === 'undefined') return null
  try {
    const started = new Worker(new URL('./hair-dye-worker.ts', import.meta.url), {
      type: 'module',
    })
    started.onmessage = (event: MessageEvent<DyeReply>) => {
      const { ticket, pixels, error, missing } = event.data
      const request = requests.get(ticket)
      if (!request) return
      if (missing) {
        sent.delete(request.message.part)
        post(request, started)
        return
      }
      requests.delete(ticket)
      if (pixels) request.resolve(pixels)
      else request.reject(new Error(error))
    }
    // It didn't load: what it was asked, and all that comes later, is dyed here.
    started.onerror = (event) => {
      event.preventDefault()
      started.terminate()
      worker = null
      for (const request of requests.values()) dyeHere(request)
      requests.clear()
    }
    worker = started
  } catch {
    worker = null
  }
  return worker
}

/** A part's `pixels` dyed `hex` (see `dyedPixels`), in the dye worker where there is one. */
export function dyeHair(pixels: Pixels, lum: number, hex: string): Promise<Pixels> {
  return new Promise((resolve, reject) => {
    let part = numbers.get(pixels)
    if (part === undefined) {
      part = ++numbered
      numbers.set(pixels, part)
    }
    const request: Request = {
      message: { ticket: ++tickets, part, pixels: null, lum, hex },
      source: pixels,
      resolve,
      reject,
    }
    const to = dyeWorker()
    if (!to) {
      dyeHere(request)
      return
    }
    requests.set(request.message.ticket, request)
    post(request, to)
  })
}
