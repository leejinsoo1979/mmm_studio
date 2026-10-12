import { prepareAvatarGlb } from './glb'
import type { PortraitClaim } from './portrait-token'
import type { AvatarService, ServiceFailure, ServiceRef, ServiceStage } from './service'
import type { AvatarJobError, AvatarJobStage, AvatarJobView, PhotorealAiAvatar } from './shared'
import { AI_PERSON_LABEL } from './shared'
import type { AvatarMeta, AvatarStore } from './store'

/**
 * A 3D avatar build, advanced one step at a time: when the browser asks
 * about it, and by the server's own sweep when nobody does (so a closed tab
 * loses nothing, and any server instance with the store can carry it on).
 * A step does one slow thing at most: ask the service where the build is
 * (no more often than the poll interval), or download the finished GLB and
 * check, trim and save it with its name and the portrait. Once a job ends,
 * the service's copy is deleted by a later step (`cleanupJob`).
 *
 * The deadline bounds the build, not the result: a step at or past it still
 * asks the service once, and a build that is ready is downloaded and kept.
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
  /** The service's handles while it builds; never sent to the browser. */
  ref: ServiceRef | null
  /** The answer to the start was lost: the build is looked for by this name. */
  lost?: string
  /** The service's copy of an ended job, still to be deleted. */
  cleanup?: ServiceRef | null
  /** Tries at deleting it. */
  cleanups?: number
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
/** Tries at deleting the service's copy before it is left for the owner (the check script lists it). */
export const MAX_CLEANUPS = 5
/** A build whose start went unanswered and that the service doesn't list after this is given up. */
export const LOST_GRACE_MS = 3 * 60_000

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

/** The next free "AI 인물 n": one more than the highest in use, so a deletion repeats no name. */
export function nextAvatarName(owned: readonly Pick<AvatarMeta, 'name'>[]): string {
  let highest = 0
  for (const { name } of owned) {
    const n = Number(/^AI 인물 (\d+)$/.exec(name)?.[1] ?? 0)
    if (n > highest) highest = n
  }
  return `AI 인물 ${highest + 1}`
}

/** The job ended without an avatar; the service's copy is left for `cleanupJob`. */
export function endJob(job: AvatarJob, error: AvatarJobError): AvatarJob {
  return {
    ...job,
    state: 'failed',
    stage: 'failed',
    progress: 0,
    error,
    ref: null,
    lost: undefined,
    cleanup: job.ref ?? job.cleanup ?? null,
  }
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

async function finish(
  job: AvatarJob,
  glb: Uint8Array<ArrayBuffer>,
  context: JobContext,
): Promise<{ job: AvatarJob; settled: JobSettlement }> {
  const prepared = prepareAvatarGlb(glb)
  if (!prepared.ok) {
    return {
      job: endJob(job, 'invalid_model'),
      settled: { refund: false, detail: `glb_${prepared.problem}` },
    }
  }
  try {
    const owned = await context.store.listAvatars(job.userKey)
    const meta: AvatarMeta = {
      id: job.avatarId,
      name: nextAvatarName(owned),
      gender: job.look.sex,
      age: job.look.age,
      createdAt: context.now(),
      service: job.mock ? '목업' : context.service.credit,
      mock: job.mock,
      bytes: prepared.bytes.byteLength,
      ai: true,
    }
    await context.store.saveAvatar(job.avatarId, prepared.bytes, meta)
  } catch {
    // Our disk failed, not the user: the allowance comes back.
    return { job: endJob(job, 'unavailable'), settled: { refund: true, detail: 'store' } }
  }
  return {
    job: {
      ...job,
      state: 'done',
      stage: 'done',
      progress: 100,
      ref: null,
      errors: 0,
      // The photo and the model are ours now: the service keeps no copy.
      cleanup: job.ref,
    },
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
  const late = now > job.deadline
  const checked: AvatarJob = { ...job, checkedAt: now }
  const call = () => AbortSignal.timeout(context.callTimeoutMs)

  if (!job.ref) {
    // The start may have built it without our hearing: look for it by its name.
    const found = job.lost ? await context.service.find(job.lost, call()) : null
    if (found?.ok && found.ref) {
      return {
        job: {
          ...checked,
          ref: found.ref,
          lost: undefined,
          stage: 'queued',
          progress: stageProgress('queued'),
          errors: 0,
        },
      }
    }
    const gone = !found || (found.ok && now - job.createdAt > LOST_GRACE_MS)
    if (late || gone || checked.errors + 1 >= MAX_POLL_ERRORS) {
      return {
        job: endJob(checked, late ? 'timeout' : 'upstream'),
        settled: { refund: false, detail: late ? 'deadline_lost' : 'lost' },
      }
    }
    return { job: { ...checked, errors: found.ok ? checked.errors : checked.errors + 1 } }
  }

  if (job.stage === 'downloading') {
    const download = await context.service.download(
      job.ref,
      AbortSignal.timeout(context.downloadTimeoutMs),
    )
    if (!download.ok) {
      if (checked.errors + 1 < MAX_DOWNLOAD_ERRORS && download.code !== 'gone') {
        return { job: { ...checked, errors: checked.errors + 1 } }
      }
      return {
        job: endJob(checked, 'upstream'),
        settled: { refund: false, detail: download.detail },
      }
    }
    return finish(
      { ...checked, stage: 'saving', progress: stageProgress('saving') },
      download.glb,
      context,
    )
  }

  const poll = await context.service.poll(job.ref, call())
  if (!poll.ok) {
    const transient = poll.code === 'upstream' || poll.code === 'rate_limited'
    if (transient && !late && checked.errors + 1 < MAX_POLL_ERRORS) {
      return { job: { ...checked, errors: checked.errors + 1 } }
    }
    if (transient && late) {
      return {
        job: endJob(checked, 'timeout'),
        settled: { refund: false, detail: `deadline_${poll.detail}` },
      }
    }
    const { error, refund } = failureOf(poll)
    return { job: endJob(checked, error), settled: { refund, detail: poll.detail } }
  }
  if (poll.state === 'working') {
    if (late) {
      return {
        job: endJob({ ...checked, ref: poll.ref }, 'timeout'),
        settled: { refund: false, detail: 'deadline' },
      }
    }
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
  // Ready, even past the deadline: the next step downloads it.
  return {
    job: {
      ...checked,
      ref: poll.ref,
      stage: 'downloading',
      progress: stageProgress('downloading'),
      errors: 0,
    },
  }
}

/** One try at deleting an ended job's copy at the service; `gaveUp` when it is left there. */
export async function cleanupJob(
  job: AvatarJob,
  context: Pick<JobContext, 'service' | 'now' | 'callTimeoutMs'>,
): Promise<{ job: AvatarJob; gaveUp: boolean }> {
  if (job.state === 'working' || !job.cleanup) return { job, gaveUp: false }
  const removed = await context.service
    .remove(job.cleanup, AbortSignal.timeout(context.callTimeoutMs))
    .catch(() => false)
  const cleanups = (job.cleanups ?? 0) + 1
  const gaveUp = !removed && cleanups >= MAX_CLEANUPS
  return {
    job: {
      ...job,
      checkedAt: context.now(),
      cleanups,
      cleanup: removed || gaveUp ? null : job.cleanup,
    },
    gaveUp,
  }
}
