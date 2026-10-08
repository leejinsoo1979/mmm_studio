/// <reference lib="webworker" />
// Grows generated hair off the main thread (see hair-jobs.ts): a head's
// base and its grows take a tenth of a second or more each, and a drag
// must never wait behind them on the page. Started twice by the page: once
// for the studio and the player, once for everyone else.

import type { HairRequest } from './hair-grow'
import { HairJobs } from './hair-jobs'
import { loadHairLibrary } from './hair-styles'

declare const self: DedicatedWorkerGlobalScope

// A tick through a message channel lets the page's next request in between
// a grow's stages, without the clamped delay of a timeout.
const channel = new MessageChannel()
const ticks: (() => void)[] = []
channel.port1.onmessage = () => ticks.shift()?.()

const jobs = new HairJobs({
  library: loadHairLibrary,
  post: (reply, transfer) => self.postMessage(reply, transfer),
  tick: () =>
    new Promise<void>((resolve) => {
      ticks.push(resolve)
      channel.port2.postMessage(0)
    }),
})

self.onmessage = (event: MessageEvent<HairRequest>) => jobs.handle(event.data)
