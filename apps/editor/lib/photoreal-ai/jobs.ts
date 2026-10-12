import { prepareAvatarGlb } from './glb'
import type { PortraitClaim } from './portrait-token'
import type { AvatarService, ServiceFailure, ServiceStage } from './service'
import type { AvatarJobError, AvatarJobStage, AvatarJobView, PhotorealAiAvatar } from './shared'
import { AI_PERSON_LABEL } from './shared'
import type { AvatarMeta, AvatarStore } from './store'

/**
 * A 3D avatar build, advanced one step each time the browser asks about it
 * (so no work runs between requests, and any server instance with the store
 * can carry it on): ask the service where the build is, at most once per
 * poll interval; once it is ready, download the GLB, check and trim it, save
 * it with its name and the portrait, and delete the service's copy. A job
 * that fails or runs past its deadline also deletes the service's copy.
 */

export type AvatarJob = {
  id: string
  userKey: string
  avatarId: string
  createdAt: number
  deadline: number
  /** When the service was last asked. */
  checkedAt: number
  state: 'working' | 'done' | 'failed'
  stage: AvatarJobStage
  progress: number
  /** Failed asks in a row (network, 5xx, rate limit). */
  errors: number
  mock: boolean
  look: Omit<PortraitClaim, 'sha' | 'mock'>
  /** The service's handles; never sent to the browser. */
  ref: Record<string, string> | null
  error?: AvatarJobError
}

/** How a finished job settles the user's 3D allowance. */
export type JobSettlement = { refund: boolean; detail: string }

export type JobContext = {
  service: AvatarService
  store: AvatarStore
  now: () => number
  /** Each service call gets its own deadline. */
  callTimeoutMs: number
  downloadTimeoutMs: number
}

const MAX_POLL_ERRORS = 5
const MAX_DOWNLOAD_ERRORS = 3

/** The progress shown for each stage (the service's own percentage fills `computing`). */
export function stageProgress(stage: AvatarJobStage | ServiceStage, serviceProgress = 0): number {
  switch (stage) {
    case 'uploading':
      return 5
    case 'queued':
      return 10
    case 'computing':
      return 10 + Math.round(Math.min(100, Math.max(0, serviceProgress)) * 0.7)
    case 'exporting':
      return 85
    case 'downloading':
      return 90
    case 'saving':
      return 95
    case 'done':
      return 100
    case 'failed':
      return 0
  }
}

export function avatarView(meta: AvatarMeta): PhotorealAiAvatar {
  const base = `/api/photoreal-ai/avatars/${meta.id}`
  return {
    id: meta.id,
    name: meta.name,
    gender: meta.gender,
    url: `${base}/model.glb`,
    thumbnail: `${base}/portrait`,
    createdAt: meta.createdAt,
    ai: true,
    credit: `${AI_PERSON_LABEL} · ${meta.service}`,
  }
}

export function jobView(job: AvatarJob, avatar?: AvatarMeta | null): AvatarJobView {
  return {
    job: job.id,
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    mock: job.mock,
    ...(job.state === 'done' && avatar ? { avatar: avatarView(avatar) } : {}),
    ...(job.error ? { error: job.error } : {}),
  }
}

/** Whether a stored record is a job (records from another version are treated as missing). */
export function isAvatarJob(value: unknown): value is AvatarJob {
  const job = value as AvatarJob | null
  return (
    !!job &&
    typeof job.id === 'string' &&
    typeof job.avatarId === 'string' &&
    typeof job.deadline === 'number' &&
    (job.state === 'working' || job.state === 'done' || job.state === 'failed')
  )
}

function end(job: AvatarJob, error: AvatarJobError): AvatarJob {
  return { ...job, state: 'failed', stage: 'failed', progress: 0, error }
}

/** The job error and allowance refund for a service failure that ends the job. */
function failureOf(failure: ServiceFailure): { error: AvatarJobError; refund: boolean } {
  switch (failure.code) {
    case 'failed':
      return { error: 'avatar_failed', refund: true }
    case 'blocked':
      return { error: 'blocked', refund: false }
    case 'unavailable':
      return { error: 'unavailable', refund: true }
    default:
      return { error: 'upstream', refund: true }
  }
}

async function removeQuietly(context: JobContext, ref: Record<string, string> | null) {
  if (!ref) return
  await context.service.remove(ref, AbortSignal.timeout(context.callTimeoutMs)).catch(() => false)
}

async function finish(
  job: AvatarJob,
  glb: Uint8Array<ArrayBuffer>,
  context: JobContext,
): Promise<{ job: AvatarJob; settled: JobSettlement }> {
  const prepared = prepareAvatarGlb(glb)
  if (!prepared.ok) {
    await removeQuietly(context, job.ref)
    return {
      job: end(job, 'invalid_model'),
      settled: { refund: false, detail: `glb_${prepared.problem}` },
    }
  }
  const owned = await context.store.listAvatars(job.userKey)
  const meta: AvatarMeta = {
    id: job.avatarId,
    name: `AI 인물 ${owned.length + 1}`,
    gender: job.look.sex,
    age: job.look.age,
    createdAt: context.now(),
    service: job.mock ? '목업' : context.service.credit,
    mock: job.mock,
    bytes: prepared.bytes.byteLength,
    ai: true,
  }
  await context.store.saveAvatar(job.avatarId, prepared.bytes, meta)
  // The photo and the model are ours now: the service keeps no copy.
  await removeQuietly(context, job.ref)
  return {
    job: { ...job, state: 'done', stage: 'done', progress: 100, ref: null, errors: 0 },
    settled: { refund: false, detail: prepared.trimmed ? 'saved_trimmed' : 'saved' },
  }
}

/** One step of a working job; `settled` is set when the job has just ended. */
export async function advanceJob(
  job: AvatarJob,
  context: JobContext,
): Promise<{ job: AvatarJob; settled?: JobSettlement }> {
  if (job.state !== 'working') return { job }
  const now = context.now()
  if (now > job.deadline || !job.ref) {
    await removeQuietly(context, job.ref)
    return { job: end(job, 'timeout'), settled: { refund: false, detail: 'deadline' } }
  }
  const ref = job.ref
  const checked = { ...job, checkedAt: now }

  if (job.stage !== 'downloading') {
    const poll = await context.service.poll(ref, AbortSignal.timeout(context.callTimeoutMs))
    if (!poll.ok) {
      const transient = poll.code === 'upstream' || poll.code === 'rate_limited'
      if (transient && checked.errors + 1 < MAX_POLL_ERRORS) {
        return { job: { ...checked, errors: checked.errors + 1 } }
      }
      const { error, refund } = failureOf(poll)
      await removeQuietly(context, ref)
      return { job: end(checked, error), settled: { refund, detail: poll.detail } }
    }
    if (poll.state === 'working') {
      return {
        job: {
          ...checked,
          ref: poll.ref,
          stage: poll.stage,
          progress: stageProgress(poll.stage, poll.progress),
          errors: 0,
        },
      }
    }
    checked.ref = poll.ref
    checked.stage = 'downloading'
    checked.progress = stageProgress('downloading')
    checked.errors = 0
  }

  const download = await context.service.download(
    checked.ref!,
    AbortSignal.timeout(context.downloadTimeoutMs),
  )
  if (!download.ok) {
    if (checked.errors + 1 < MAX_DOWNLOAD_ERRORS && download.code !== 'gone') {
      return { job: { ...checked, errors: checked.errors + 1 } }
    }
    await removeQuietly(context, checked.ref)
    return { job: end(checked, 'upstream'), settled: { refund: false, detail: download.detail } }
  }
  return finish(
    { ...checked, stage: 'saving', progress: stageProgress('saving') },
    download.glb,
    context,
  )
}
