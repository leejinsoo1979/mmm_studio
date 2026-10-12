import type {
  AiAvatarStartResult,
  AvatarJobAnswer,
  AvatarJobReport,
  PhotorealAiRefusal,
} from './client'
import { AVATAR_JOB_POLL_MS, type AvatarJobError } from './shared'

/**
 * The 3D avatar being built. A job takes minutes and goes on at the server
 * whether or not anyone watches; it is followed here, not in the dialog, so
 * the dialog and the studio can close and open again (the page even be
 * reloaded: the job is kept in browser storage, and picked up again from
 * any page) and still find it, and its end is heard once. One job at a time.
 */

/** Browser storage key of the one job. */
export const AVATAR_JOB_STORAGE_KEY = 'mmm-ai-person-job'

/** Why a job ended without an avatar: the service's reason, or the route's (job gone, signed out). */
export type AvatarJobEnd = AvatarJobError | 'not_found' | 'sign_in_required'

export type AvatarJob = Omit<AvatarJobReport, 'error'> & {
  error: AvatarJobEnd | null
  /** When it was asked for (ms since the epoch). */
  startedAt: number
  /** Its end (done or failed) has been taken up by the studio. */
  seen: boolean
  /** The last ask was refused for want of a sign-in: say so while asking on. */
  signInNeeded?: boolean
}

/** Past this, a job still unfinished is given up on (the server's own deadline is shorter). */
export const AVATAR_JOB_MAX_MS = 40 * 60_000

export const isFinished = (job: AvatarJob | null) =>
  job !== null && (job.state === 'done' || job.state === 'failed')

/** How long to wait before asking again: as often as the server moves it on, less later or after failures. */
export function pollDelay(elapsedMs: number, failures: number): number {
  const base = elapsedMs < 5 * 60_000 ? AVATAR_JOB_POLL_MS : AVATAR_JOB_POLL_MS * 2
  return Math.min(30_000, base * 2 ** Math.min(failures, 4))
}

const failed = (job: AvatarJob, error: AvatarJobEnd): AvatarJob => ({
  ...job,
  state: 'failed',
  stage: 'failed',
  error,
})

/**
 * The job after an answer about it. A miss is asked again (the build goes on
 * at the server); only past `AVATAR_JOB_MAX_MS` is it given up, for the last
 * reason heard.
 */
export function applyAnswer(job: AvatarJob, answer: AvatarJobAnswer, now: number): AvatarJob {
  if (isFinished(job)) return job
  if (answer.ok) {
    if (answer.job.jobId !== job.jobId) return job
    const { signInNeeded: _cleared, ...rest } = job
    return { ...rest, ...answer.job }
  }
  if (now - job.startedAt > AVATAR_JOB_MAX_MS) {
    return failed(job, answer.miss === 'unreachable' ? 'timeout' : answer.miss)
  }
  const signInNeeded = answer.miss === 'sign_in_required'
  return Boolean(job.signInNeeded) === signInNeeded ? job : { ...job, signInNeeded }
}

const STATES = ['working', 'done', 'failed'] as const

/** A job as kept in browser storage, or null for anything else. */
export function readStoredJob(raw: string | null): AvatarJob | null {
  if (!raw) return null
  let value: Record<string, unknown>
  try {
    value = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const { jobId, startedAt, avatar } = value
  const state = STATES.find((one) => one === value.state)
  if (typeof jobId !== 'string' || !/^[0-9a-f]{24}$/.test(jobId)) return null
  if (typeof startedAt !== 'number' || !state) return null
  const made = avatar as AvatarJob['avatar']
  const kept =
    made &&
    typeof made.id === 'string' &&
    (made.gender === 'male' || made.gender === 'female') &&
    typeof made.name === 'string'
      ? { id: made.id, gender: made.gender, name: made.name }
      : null
  if (state === 'done' && !kept) return null
  return {
    jobId,
    startedAt,
    state,
    stage: (typeof value.stage === 'string' ? value.stage : state) as AvatarJob['stage'],
    progress: typeof value.progress === 'number' ? value.progress : 0,
    avatar: kept,
    error: typeof value.error === 'string' ? (value.error as AvatarJobEnd) : null,
    seen: value.seen === true,
  }
}

export type AvatarJobTrackerDeps = {
  start: (image: Blob, token: string) => Promise<AiAvatarStartResult>
  poll: (jobId: string) => Promise<AvatarJobAnswer>
  /** Browser storage for the one job (null clears it); it may be missing or refuse. */
  storage: { read(): string | null; write(value: string | null): void }
  now?: () => number
  schedule?: (run: () => void, ms: number) => () => void
  /** A job reached its end here (a new AI 인물 is listed now, or it failed). */
  onFinished?: (job: AvatarJob) => void
}

export function createAvatarJobTracker(deps: AvatarJobTrackerDeps) {
  const now = deps.now ?? Date.now
  const schedule =
    deps.schedule ??
    ((run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    })
  const listeners = new Set<() => void>()
  let job: AvatarJob | null = null
  let resumed = false
  let failures = 0
  let cancelPoll: (() => void) | null = null
  let starting = false

  /** `ended`: the job has just reached its end here (not one read back already ended). */
  function set(next: AvatarJob | null, ended = isFinished(next) && !isFinished(job)) {
    job = next
    try {
      deps.storage.write(next ? JSON.stringify(next) : null)
    } catch {}
    for (const listener of listeners) listener()
    if (next && ended) deps.onFinished?.(next)
  }

  function follow() {
    cancelPoll?.()
    cancelPoll = null
    if (!job || isFinished(job)) return
    const { jobId, startedAt } = job
    cancelPoll = schedule(
      async () => {
        cancelPoll = null
        const answer = await deps.poll(jobId)
        // Cleared or replaced meanwhile.
        if (job?.jobId !== jobId) return
        failures = answer.ok ? 0 : failures + 1
        set(applyAnswer(job, answer, now()))
        follow()
      },
      pollDelay(now() - startedAt, failures),
    )
  }

  return {
    get: () => job,

    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /** Picks up the job kept from before (once a page): an unfinished one is followed again. */
    resume() {
      if (resumed) return
      resumed = true
      let kept: AvatarJob | null = null
      try {
        kept = readStoredJob(deps.storage.read())
      } catch {}
      if (job || !kept) return
      // An end already taken up has nothing left to show.
      if (isFinished(kept) && kept.seen) {
        set(null)
        return
      }
      set(kept, false)
      follow()
    },

    /** Asks for the 3D avatar of a portrait; refused while another job runs. */
    async begin(image: Blob, token: string): Promise<AiAvatarStartResult> {
      if (starting || (job && !isFinished(job))) {
        return { ok: false, code: 'busy' } satisfies PhotorealAiRefusal
      }
      starting = true
      try {
        const result = await deps.start(image, token)
        if (result.ok) {
          failures = 0
          set({ ...result.job, startedAt: now(), seen: false })
          follow()
        }
        return result
      } finally {
        starting = false
      }
    },

    /** The studio has taken up the job's end. */
    markSeen() {
      if (job && isFinished(job) && !job.seen) set({ ...job, seen: true })
    },

    /** Forgets a finished job (the player has read how it ended). */
    clear() {
      if (job && isFinished(job)) set(null)
    },
  }
}

export type AvatarJobTracker = ReturnType<typeof createAvatarJobTracker>
