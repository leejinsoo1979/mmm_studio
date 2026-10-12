import type { AiPersonChoices } from './shared'

/**
 * The 3D avatar service behind AI 인물, as the job runner sees it: start a
 * build from one frontal photo, ask where it is, download the finished GLB,
 * delete the service's copy. One implementation today (metaperson.ts); the
 * 목업 runs that same implementation against an in-process fake of its
 * protocol (metaperson-fake.ts).
 */

export type AvatarPhoto = { bytes: Uint8Array<ArrayBuffer>; type: 'image/jpeg' | 'image/png' }

/** What the build may take from the signed portrait claim. */
export type AvatarLook = Pick<AiPersonChoices, 'sex' | 'hairStyle' | 'hairColour' | 'outfit'>

/** The service's own handles for one build (codes and URLs), kept with the job; never sent to the browser. */
export type ServiceRef = Record<string, string>

export type ServiceStage = 'uploading' | 'queued' | 'computing' | 'exporting'

export type ServiceErrorCode =
  /** Our credentials, plan or setup were refused: the owner must act. */
  | 'unavailable'
  /** The service refused the photo or request (a 4xx about the input). */
  | 'rejected'
  | 'rate_limited'
  /** Network, 5xx, or an answer this adapter can't read: may pass. */
  | 'upstream'
  /** The service tried and could not build an avatar from this photo. */
  | 'failed'
  /** The service judged the person a child. */
  | 'blocked'
  /** The build is gone (deleted, or another player's). */
  | 'gone'

export type ServiceFailure = {
  ok: false
  code: ServiceErrorCode
  /** A short machine reason for the log (an HTTP status, a status name), never content or secrets. */
  detail: string
  retryAfter?: number
}

export type ServicePoll =
  | { ok: true; state: 'working'; stage: ServiceStage; progress: number; ref: ServiceRef }
  | { ok: true; state: 'ready'; ref: ServiceRef }
  | ServiceFailure

export interface AvatarService {
  /** Shown on the avatar's card after "AI 생성 인물 · ". */
  readonly credit: string
  create(
    input: { photo: AvatarPhoto; look: AvatarLook; name: string },
    signal: AbortSignal,
  ): Promise<{ ok: true; ref: ServiceRef } | ServiceFailure>
  poll(ref: ServiceRef, signal: AbortSignal): Promise<ServicePoll>
  download(
    ref: ServiceRef,
    signal: AbortSignal,
  ): Promise<{ ok: true; glb: Uint8Array<ArrayBuffer> } | ServiceFailure>
  /** Deletes the service's copy (the photo and the model); true when it is gone. */
  remove(ref: ServiceRef, signal: AbortSignal): Promise<boolean>
}

export type ServiceFetch = (input: string, init: RequestInit) => Promise<Response>
