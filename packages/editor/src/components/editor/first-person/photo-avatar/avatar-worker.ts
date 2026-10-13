/// <reference lib="webworker" />
// Makes a photo avatar off the main thread (see avatar-job.ts): fitting the
// head to the photos and laying their skin on it takes tens of seconds.
import { type AvatarJobReport, runAvatarJob } from './avatar-job'
import { loadBaseBody } from './base-files'
import type { PhotoAvatarRequest } from './build-client'
import { canvasCodec } from './picture-codec'

declare const self: DedicatedWorkerGlobalScope

export type WorkerReply =
  | { progress: number; stage: 'fit' | 'texture' | 'pack' }
  | { glb: Uint8Array; report: AvatarJobReport }
  | { error: string }

const codec = canvasCodec()

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
      progress: (progress, stage) => reply({ progress, stage }),
    })
    reply({ glb, report }, [glb.buffer])
  } catch (error) {
    reply({ error: error instanceof Error ? error.message : String(error) })
  }
}
