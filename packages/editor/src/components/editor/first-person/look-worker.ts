/// <reference lib="webworker" />
// Puts looks together off the main thread (see look-job.ts): reading a
// body's textures, dyeing them and swapping a face takes a second or more,
// which in the game would freeze it whenever a player with a look joins.
import {
  BODIES_KEPT,
  type LookBody,
  type LookMessage,
  type LookReply,
  runLookJob,
} from './look-job'

declare const self: DedicatedWorkerGlobalScope

/** The bodies the page has sent, oldest first: a job names one it sent before by its key. */
const bodies = new Map<string, LookBody>()

const reply = (message: LookReply, transfer: Transferable[] = []) =>
  self.postMessage(message, transfer)

self.onmessage = async (event: MessageEvent<LookMessage>) => {
  const { job, key, body } = event.data
  const found = body ?? bodies.get(key)
  if (!found) {
    reply({ missing: true })
    return
  }
  bodies.delete(key)
  bodies.set(key, found)
  if (bodies.size > BODIES_KEPT) bodies.delete(bodies.keys().next().value!)
  try {
    const result = await runLookJob({ ...job, body: found })
    reply({ result }, Object.values(result.parts))
  } catch (error) {
    reply({ error: error instanceof Error ? error.message : String(error) })
  }
}
