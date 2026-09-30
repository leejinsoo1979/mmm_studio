/// <reference lib="webworker" />
// Runs face swaps off the main thread (see face-job.ts): a swap takes a
// second or more, which in the game would freeze it whenever a player with a
// face joins.
import { type FaceJob, runFaceJob } from './face-job'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (event: MessageEvent<{ id: number; job: FaceJob }>) => {
  const { id, job } = event.data
  try {
    const head = runFaceJob(job)
    self.postMessage({ id, head }, [head.data.buffer])
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
