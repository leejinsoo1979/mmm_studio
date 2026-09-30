/// <reference lib="webworker" />
// Puts looks together off the main thread (see look-job.ts): reading a
// body's textures, dyeing them and swapping a face takes a second or more,
// which in the game would freeze it whenever a player with a look joins.
import { type LookJob, runLookJob } from './look-job'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = async (event: MessageEvent<{ job: LookJob }>) => {
  try {
    const result = await runLookJob(event.data.job)
    self.postMessage({ result }, Object.values(result.parts))
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
