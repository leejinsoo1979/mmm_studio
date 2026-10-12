import { describe, expect, test } from 'bun:test'
import {
  AVATAR_JOB_MAX_MS,
  type AvatarJob,
  applyAnswer,
  createAvatarJobTracker,
  pollDelay,
  readStoredJob,
} from './avatar-job'
import type { AiAvatarStartResult, AvatarJobAnswer, AvatarJobReport } from './client'
import { AVATAR_JOB_POLL_MS } from './shared'

const ID = 'a'.repeat(24)
const AVATAR = {
  id: `${'b'.repeat(16)}-${'c'.repeat(24)}`,
  gender: 'female' as const,
  name: 'AI 인물 1',
}

const report = (patch: Partial<AvatarJobReport> = {}): AvatarJobReport => ({
  jobId: ID,
  state: 'working',
  stage: 'queued',
  progress: 5,
  avatar: null,
  error: null,
  ...patch,
})

const JOB: AvatarJob = { ...report(), startedAt: 1_000, seen: false }

const working = (progress: number): AvatarJobAnswer => ({
  ok: true,
  job: report({ stage: 'computing', progress }),
})
const done: AvatarJobAnswer = {
  ok: true,
  job: report({ state: 'done', stage: 'done', progress: 100, avatar: AVATAR }),
}

describe('applyAnswer', () => {
  test('takes the server’s view, keeping when it started and whether it was seen', () => {
    const next = applyAnswer(JOB, working(30), 2_000)
    expect(next).toEqual({ ...JOB, stage: 'computing', progress: 30 })
    expect(applyAnswer(next, done, 3_000)).toMatchObject({
      state: 'done',
      avatar: AVATAR,
      startedAt: 1_000,
    })
    // Another job's view changes nothing.
    expect(applyAnswer(JOB, { ok: true, job: report({ jobId: 'f'.repeat(24) }) }, 2_000)).toBe(JOB)
  })

  test('a final refusal fails it; a passing one waits, until the job has run too long', () => {
    expect(applyAnswer(JOB, { ok: false, retry: false, code: 'not_found' }, 2_000)).toMatchObject({
      state: 'failed',
      stage: 'failed',
      error: 'not_found',
    })
    expect(applyAnswer(JOB, { ok: false, retry: true }, 2_000)).toBe(JOB)
    expect(
      applyAnswer(JOB, { ok: false, retry: true }, JOB.startedAt + AVATAR_JOB_MAX_MS + 1),
    ).toMatchObject({ state: 'failed', error: 'timeout' })
  })

  test('a finished job stays as it ended', () => {
    const ended: AvatarJob = { ...JOB, state: 'done', avatar: AVATAR }
    expect(applyAnswer(ended, working(10), 2_000)).toBe(ended)
  })
})

describe('pollDelay', () => {
  test('as often as the server moves a job on, then less, backing off after failures to 30 s', () => {
    expect(pollDelay(0, 0)).toBe(AVATAR_JOB_POLL_MS)
    expect(pollDelay(10 * 60_000, 0)).toBe(AVATAR_JOB_POLL_MS * 2)
    expect(pollDelay(0, 1)).toBe(AVATAR_JOB_POLL_MS * 2)
    expect(pollDelay(10 * 60_000, 9)).toBe(30_000)
  })
})

describe('readStoredJob', () => {
  test('reads back what was kept and nothing else', () => {
    expect(readStoredJob(JSON.stringify(JOB))).toEqual(JOB)
    const finished = { ...JOB, state: 'done', stage: 'done', avatar: AVATAR, seen: true }
    expect(readStoredJob(JSON.stringify(finished))).toEqual(finished as AvatarJob)
    for (const raw of [
      null,
      '',
      '{',
      '"job"',
      'null',
      JSON.stringify({ ...JOB, jobId: '../x' }),
      JSON.stringify({ ...JOB, state: 'paused' }),
      JSON.stringify({ ...JOB, startedAt: 'yesterday' }),
      JSON.stringify({ ...JOB, state: 'done', avatar: null }),
    ]) {
      expect(readStoredJob(raw)).toBeNull()
    }
  })
})

/** A tracker on a hand-driven clock, with the polls answered from a list. */
function harness(options: { kept?: string | null; start?: AiAvatarStartResult } = {}) {
  let clock = 10_000
  let stored: string | null = options.kept ?? null
  const pending: { run: () => void; at: number }[] = []
  const answers: AvatarJobAnswer[] = []
  const polled: string[] = []
  const finished: AvatarJob[] = []
  const started: [Blob, string][] = []
  const tracker = createAvatarJobTracker({
    start: async (image, token) => {
      started.push([image, token])
      return options.start ?? { ok: true, job: report(), avatarsLeft: 1 }
    },
    poll: async (jobId) => {
      polled.push(jobId)
      return answers.shift() ?? { ok: false, retry: true }
    },
    storage: {
      read: () => stored,
      write: (value) => {
        stored = value
      },
    },
    now: () => clock,
    schedule: (run, ms) => {
      const entry = { run, at: clock + ms }
      pending.push(entry)
      return () => pending.splice(pending.indexOf(entry), 1)
    },
    onFinished: (job) => finished.push(job),
  })
  /** Runs the next scheduled poll. */
  const tick = async () => {
    const next = pending.shift()
    if (!next) throw new Error('nothing scheduled')
    clock = next.at
    next.run()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { tracker, answers, polled, finished, pending, started, tick, stored: () => stored }
}

describe('the job tracker', () => {
  test('starts a job from the portrait and its token, follows it to its end once, and keeps it', async () => {
    const h = harness()
    let heard = 0
    h.tracker.subscribe(() => {
      heard += 1
    })
    const portrait = new Blob(['jpeg'])
    expect(await h.tracker.begin(portrait, 'tok')).toMatchObject({ ok: true, avatarsLeft: 1 })
    expect(h.started).toEqual([[portrait, 'tok']])
    expect(h.tracker.get()).toMatchObject({ jobId: ID, state: 'working', startedAt: 10_000 })
    expect(readStoredJob(h.stored())?.jobId).toBe(ID)
    expect(h.pending[0]!.at).toBe(10_000 + AVATAR_JOB_POLL_MS)

    h.answers.push(working(50), done)
    await h.tick()
    expect(h.tracker.get()).toMatchObject({ state: 'working', progress: 50 })
    await h.tick()
    expect(h.tracker.get()).toMatchObject({ state: 'done', avatar: AVATAR })
    expect(h.polled).toEqual([ID, ID])
    expect(h.finished).toHaveLength(1)
    expect(h.pending).toHaveLength(0)
    expect(heard).toBe(3)

    h.tracker.markSeen()
    expect(h.tracker.get()?.seen).toBe(true)
    h.tracker.clear()
    expect(h.tracker.get()).toBeNull()
    expect(h.stored()).toBeNull()
  })

  test('one job at a time; a refused start leaves nothing behind', async () => {
    const h = harness()
    await h.tracker.begin(new Blob(['a']), 't')
    expect(await h.tracker.begin(new Blob(['b']), 't')).toEqual({ ok: false, code: 'busy' })
    const refused = harness({ start: { ok: false, code: 'portrait_expired' } })
    expect(await refused.tracker.begin(new Blob(['a']), 't')).toEqual({
      ok: false,
      code: 'portrait_expired',
    })
    expect(refused.tracker.get()).toBeNull()
    expect(refused.pending).toHaveLength(0)
  })

  test('a job already done when started is heard at once', async () => {
    const h = harness({ start: { ok: true, job: done.ok ? done.job : report(), avatarsLeft: 0 } })
    await h.tracker.begin(new Blob(['a']), 't')
    expect(h.finished).toHaveLength(1)
    expect(h.pending).toHaveLength(0)
  })

  test('failed polls back off; a job gone ends it', async () => {
    const h = harness()
    await h.tracker.begin(new Blob(['a']), 't')
    await h.tick()
    expect(h.pending[0]!.at - (10_000 + AVATAR_JOB_POLL_MS)).toBe(AVATAR_JOB_POLL_MS * 2)
    h.answers.push({ ok: false, retry: false, code: 'not_found' })
    await h.tick()
    expect(h.tracker.get()).toMatchObject({ state: 'failed', error: 'not_found' })
    expect(h.finished).toHaveLength(1)
  })

  test('a running job kept from before the reload is followed again', async () => {
    const h = harness({ kept: JSON.stringify({ ...JOB, progress: 20 }) })
    h.tracker.resume()
    h.tracker.resume()
    expect(h.tracker.get()).toMatchObject({ jobId: ID, progress: 20 })
    expect(h.pending).toHaveLength(1)
    h.answers.push(done)
    await h.tick()
    expect(h.finished.map(({ avatar }) => avatar?.id)).toEqual([AVATAR.id])
  })

  test('an end not yet taken up is shown again; one taken up is dropped', () => {
    const unseen = harness({
      kept: JSON.stringify({ ...JOB, state: 'done', stage: 'done', avatar: AVATAR }),
    })
    unseen.tracker.resume()
    expect(unseen.tracker.get()).toMatchObject({ state: 'done', seen: false })
    expect(unseen.pending).toHaveLength(0)
    // Already finished before: not announced as a new end.
    expect(unseen.finished).toHaveLength(0)

    const seen = harness({ kept: JSON.stringify({ ...JOB, state: 'failed', seen: true }) })
    seen.tracker.resume()
    expect(seen.tracker.get()).toBeNull()
    expect(seen.stored()).toBeNull()
  })

  test('storage that refuses does not stop the job', async () => {
    const tracker = createAvatarJobTracker({
      start: async () => ({ ok: true, job: report(), avatarsLeft: null }),
      poll: async () => ({ ok: false, retry: true }),
      storage: {
        read: () => {
          throw new Error('denied')
        },
        write: () => {
          throw new Error('denied')
        },
      },
      schedule: () => () => {},
    })
    tracker.resume()
    expect((await tracker.begin(new Blob(['a']), 't')).ok).toBe(true)
    expect(tracker.get()?.jobId).toBe(ID)
  })
})
