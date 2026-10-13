import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { imageStream } from '../ai-photo/handlers'
import { type AiPhotoLimiter, createAiPhotoLimiter } from '../ai-photo/rate-limit'
import { npcClientIp } from '../npc-ai/rate-limit'
import { readBodyCapped } from '../npc-ai/tts'
import { guardSceneApiRequest, sceneApiJson, withSceneApiHeaders } from '../scene-api-security'
import {
  type JobServiceConfig,
  type PhotorealAiConfig,
  photorealAiMockOn,
  photorealAiStoreDir,
  readJobService,
  readPhotorealAiConfig,
} from './config'
import {
  type AvatarJob,
  advanceJob,
  avatarView,
  cleanupJob,
  endJob,
  isAvatarJob,
  type JobContext,
  type JobSettlement,
  jobView,
  stageProgress,
} from './jobs'
import { createSendLedger, type LedgerRefusal, type SendLedger } from './ledger'
import { createMetaPersonService } from './metaperson'
import { createMetaPersonFake } from './metaperson-fake'
import { portraitImage, producePortrait } from './portrait'
import { portraitSha, signPortrait, verifyPortrait } from './portrait-token'
import type { AvatarService, ServiceFetch } from './service'
import {
  AI_PERSON_AGES,
  AI_PERSON_DETAILS,
  AI_PERSON_DETAILS_MAX,
  AI_PERSON_FACE_SHAPES,
  AI_PERSON_FACIAL_HAIR,
  AI_PERSON_HAIR_COLOURS,
  AI_PERSON_HAIR_STYLES,
  AI_PERSON_HERITAGES,
  AI_PERSON_IMPRESSIONS,
  AI_PERSON_NOTICE,
  AI_PERSON_OUTFIT_COLOURS,
  AI_PERSON_OUTFITS,
  AI_PERSON_SEXES,
  AI_PERSON_SKIN_TONES,
  AI_PORTRAIT_MAX_BYTES,
  AI_PORTRAIT_TOKEN_HEADER,
  type AiPersonChoices,
  AVATAR_JOB_POLL_MS,
  detailsAllowed,
  PHOTOREAL_AI_REMAINING_HEADER,
  type PhotorealAiAvatarList,
  type PhotorealAiRouteError,
  type PhotorealAiStatus,
} from './shared'
import { type AvatarStore, createFileAvatarStore, JOB_ID } from './store'

/**
 * `/api/photoreal-ai/*`, AI 인물: a photorealistic portrait of a fictional
 * adult made from fixed choices, turned by the 3D avatar service into a
 * rigged avatar that joins the user's 실사 list.
 *
 *   GET    /                          availability and what is left today
 *   POST   /portrait                  { choices } → the image, with a signed token header
 *   POST   /avatar                    multipart portrait + token → a 3D job (202)
 *   GET    /avatar/<job>              advances and reports the job
 *   GET    /avatars                   the user's finished AI avatars
 *   GET    /avatars/<id>/model.glb    the avatar (the id is the key: no sign-in, so a loader can fetch it)
 *   GET    /avatars/<id>/portrait     the portrait it was made from
 *   DELETE /avatars/<id>              deletes one of the user's avatars
 *
 * Everything but the files needs a signed-in user: a verified sign-in token,
 * or in the development 목업 also the dev user header. Portraits and 3D
 * builds have their own daily caps (the AI 실사 사진 limiter, a second and a
 * third instance); builds sent to the paid service and the portraits used
 * are also kept in the store's ledger, which a restart doesn't reset. A
 * build goes on while nobody asks about it (`sweep`, run on a timer by the
 * route), and every ended build has the service's copy deleted. Log lines
 * carry counts and codes only: never choices, prompts, images, user ids,
 * tokens or keys.
 */

export type PhotorealAiUsage =
  | {
      step: 'portrait'
      provider: string
      mock: boolean
      sex: AiPersonChoices['sex']
      age: AiPersonChoices['age']
      details: number
      moderated: boolean
      status: number
      outcome: PhotorealAiRouteError | 'ok'
      detail?: string
      ms: number
      bytesOut: number
    }
  | {
      step: 'avatar'
      event: 'start' | 'done' | 'failed' | 'cleanup_failed'
      mock: boolean
      status?: number
      outcome: string
      detail?: string
      ms: number
    }

export type PhotorealAiHandlerDeps = {
  /**
   * The verified user id (Firebase uid), or null when signed out.
   * `devHeader`: the development user header may name the user too (only in the 목업,
   * where nothing is paid for).
   */
  userId: (request: Request, options: { devHeader: boolean }) => Promise<string | null>
  env?: Record<string, string | undefined>
  cwd?: string
  /** The image API and the real avatar service. */
  fetch?: ServiceFetch
  now?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  log?: (usage: PhotorealAiUsage) => void
  portraitLimiter?: AiPhotoLimiter
  avatarLimiter?: AiPhotoLimiter
  /** The store for a store directory (default: files on disk). */
  store?: (dir: string) => AvatarStore
  timeouts?: Partial<typeof TIMEOUTS>
  /** How often to carry on builds nobody asks about (0, the default: only when `sweep` is called). */
  sweepEveryMs?: number
  /**
   * false: the sweep leaves 목업 builds alone. They live in the in-process
   * fake of the handler set that started them, which another set can't see.
   */
  sweepMockJobs?: boolean
}

const TIMEOUTS = {
  /** Generation and image moderation of one portrait. */
  portraitMs: 150_000,
  mockPortraitMs: 1500,
  /** The photo upload that starts a build. */
  createMs: 60_000,
  /** One status ask (or one delete). */
  callMs: 30_000,
  downloadMs: 120_000,
  /** A whole build, from upload to a ready model (the download may come after). */
  jobMs: 10 * 60_000,
  /** A step quicker than this also deletes the service's copy of a job it ended. */
  inlineCleanupMs: 60_000,
}

const MAX_JSON_BODY = 4096
/** The portrait and its token as multipart: under the 4.5 MB request cap of serverless hosts. */
const MAX_AVATAR_BODY = 4_400_000
const MAX_AVATARS_PER_USER = 24
/** Ended job records are kept this long (the browser may still ask), then swept. */
const JOB_KEEP_MS = 24 * 60 * 60_000
/** A build's portrait with no job left on it is swept after this (by the files' own clock). */
const ORPHAN_FOLDER_MS = 30 * 60_000
const FIRST_SWEEP_MS = 5000
const SWEEPER = Symbol.for('mmm-studio.photoreal-ai.sweeper')

const Choices = z
  .object({
    sex: z.enum(AI_PERSON_SEXES),
    age: z.enum(AI_PERSON_AGES),
    impression: z.enum(AI_PERSON_IMPRESSIONS),
    faceShape: z.enum(AI_PERSON_FACE_SHAPES),
    skinTone: z.enum(AI_PERSON_SKIN_TONES),
    heritage: z.enum(AI_PERSON_HERITAGES),
    hairStyle: z.enum(AI_PERSON_HAIR_STYLES),
    hairColour: z.enum(AI_PERSON_HAIR_COLOURS),
    facialHair: z.enum(AI_PERSON_FACIAL_HAIR),
    outfit: z.enum(AI_PERSON_OUTFITS),
    outfitColour: z.enum(AI_PERSON_OUTFIT_COLOURS),
    details: z
      .array(z.enum(AI_PERSON_DETAILS))
      .max(AI_PERSON_DETAILS_MAX)
      .default([])
      .refine(detailsAllowed),
  })
  .strict() satisfies z.ZodType<AiPersonChoices, unknown>

const PortraitBody = z.object({ choices: Choices }).strict()

const sleepFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })

function refuse(
  request: Request,
  status: number,
  code: PhotorealAiRouteError,
  extra: Record<string, unknown> = {},
) {
  const response = sceneApiJson(request, { error: code, ...extra }, { status })
  if (typeof extra.retryAfter === 'number') {
    response.headers.set('Retry-After', String(extra.retryAfter))
  }
  return response
}

const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png' } as const

export function createPhotorealAiHandlers(deps: PhotorealAiHandlerDeps) {
  const env = deps.env ?? process.env
  const cwd = deps.cwd ?? process.cwd()
  const send: ServiceFetch = deps.fetch ?? ((input, init) => fetch(input, init))
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? sleepFor
  const log = deps.log ?? ((usage: PhotorealAiUsage) => console.info('[photoreal-ai]', usage))
  const portraitLimiter = deps.portraitLimiter ?? createAiPhotoLimiter(now)
  const avatarLimiter = deps.avatarLimiter ?? createAiPhotoLimiter(now)
  const timeouts = { ...TIMEOUTS, ...deps.timeouts }
  const makeStore = deps.store ?? createFileAvatarStore
  const stores = new Map<string, { store: AvatarStore; ledger: SendLedger }>()
  const services = new Map<string, AvatarService>()
  /** One step at a time per job, and the allowance each running job holds. */
  const stepping = new Map<string, Promise<AvatarJob | null>>()
  const holds = new Map<string, { release: (refund: boolean) => void; timer: NodeJS.Timeout }>()
  /** The 목업's in-process service, one per handler set so its builds outlive a request. */
  let mockFetch: ServiceFetch | undefined
  let sweeping: Promise<void> | null = null

  /** The store and its ledger, from the environment alone: builds and avatars outlive switching the feature off. */
  const storeOf = (dir: string = photorealAiStoreDir(env, cwd)) => {
    let found = stores.get(dir)
    if (!found) {
      const store = makeStore(dir)
      found = { store, ledger: createSendLedger(store, now) }
      stores.set(dir, found)
    }
    return found
  }

  function serviceOf(config: JobServiceConfig): AvatarService {
    const { service } = config
    const key = config.mock
      ? 'mock'
      : `${service.baseUrl}|${service.clientId}|${service.clientSecret}|${service.requireAgeCheck}`
    let found = services.get(key)
    if (found) return found
    if (config.mock) {
      mockFetch ??= createMetaPersonFake({
        now,
        glb: async () => new Uint8Array(await readFile(config.mockGlbPath ?? '')),
      }).fetch
      found = createMetaPersonService({ config: service, fetch: mockFetch, now, sleep })
    } else {
      found = createMetaPersonService({
        config: service,
        fetch: send,
        now,
        sleep,
        players: storeOf().store.players(`${service.baseUrl}|${service.clientId}`),
      })
    }
    services.set(key, found)
    return found
  }

  const userOf = (request: Request, mock: boolean) => deps.userId(request, { devHeader: mock })

  /** The signed-in user, or the refusal (whether or not making new ones is on). */
  async function signedIn(request: Request): Promise<{ uid: string } | { refused: Response }> {
    const guard = guardSceneApiRequest(request)
    if (guard) return { refused: guard }
    const uid = await userOf(request, photorealAiMockOn(env))
    if (!uid) return { refused: refuse(request, 401, 'sign_in_required') }
    return { uid }
  }

  /** The config of an available feature and the signed-in user, or the refusal. */
  async function begin(
    request: Request,
  ): Promise<{ config: PhotorealAiConfig; uid: string } | { refused: Response }> {
    const guard = guardSceneApiRequest(request)
    if (guard) return { refused: guard }
    const ai = readPhotorealAiConfig(env, cwd)
    if (!ai.ok) {
      return { refused: refuse(request, 503, 'unavailable', { reason: ai.reason, part: ai.part }) }
    }
    const uid = await userOf(request, ai.config.mock)
    if (!uid) return { refused: refuse(request, 401, 'sign_in_required') }
    return { config: ai.config, uid }
  }

  /** Lets go of the allowance a job holds (this process's limiter), refunded or not. */
  function settle(jobId: string, settled: JobSettlement) {
    const hold = holds.get(jobId)
    if (!hold) return
    clearTimeout(hold.timer)
    holds.delete(jobId)
    hold.release(settled.refund)
  }

  async function status(request: Request): Promise<Response> {
    const guard = guardSceneApiRequest(request)
    if (guard) return guard
    const ai = readPhotorealAiConfig(env, cwd)
    if (!ai.ok) {
      const body: PhotorealAiStatus = { available: false, reason: ai.reason, part: ai.part }
      return sceneApiJson(request, body)
    }
    const { config } = ai
    const uid = await userOf(request, config.mock)
    const key = uid ? `uid:${uid}` : null
    let avatarsLeft: number | null = null
    if (uid && key && config.service) {
      const { store, ledger } = storeOf(config.storeDir)
      const counts = await ledger.counts(store.userKey(uid)).catch(() => null)
      avatarsLeft = Math.min(
        avatarLimiter.remaining(key, false, config.avatarLimits),
        counts ? Math.max(0, config.avatarLimits.userDaily - counts.user) : 0,
        counts ? Math.max(0, config.avatarLimits.globalDaily - counts.global) : 0,
      )
    }
    const body: PhotorealAiStatus = {
      available: true,
      mock: config.mock,
      signedIn: uid !== null,
      portraitsLeft: key ? portraitLimiter.remaining(key, false, config.portraitLimits) : null,
      avatarsLeft,
      avatarService: config.service !== null,
      notice: AI_PERSON_NOTICE,
    }
    return sceneApiJson(request, body)
  }

  async function portrait(request: Request): Promise<Response> {
    const started = now()
    const begun = await begin(request)
    if ('refused' in begun) return begun.refused
    const { config, uid } = begun

    if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
      return refuse(request, 415, 'unsupported_type')
    }
    if (Number(request.headers.get('content-length')) > MAX_JSON_BODY) {
      return refuse(request, 413, 'too_large')
    }
    if (!request.body) return refuse(request, 400, 'invalid_request')
    const raw = await readBodyCapped(request.body, MAX_JSON_BODY).catch(() => undefined)
    if (raw === undefined) return refuse(request, 400, 'invalid_request')
    if (raw === null) return refuse(request, 413, 'too_large')
    let choices: AiPersonChoices
    try {
      // Fixed choices only: any other field (free text above all) is refused, costing nothing.
      const body = PortraitBody.safeParse(JSON.parse(new TextDecoder().decode(raw)))
      if (!body.success) return refuse(request, 400, 'invalid_request')
      choices = body.data.choices
    } catch {
      return refuse(request, 400, 'invalid_request')
    }

    const ip = npcClientIp(request)
    const limit = portraitLimiter.take({
      userKey: `uid:${uid}`,
      anonymous: false,
      ip,
      limits: config.portraitLimits,
    })
    if (!limit.ok) {
      if (limit.code === 'busy') return refuse(request, 429, 'busy')
      return refuse(request, 429, 'rate_limited', {
        retryAfter: limit.retryAfter,
        scope: limit.scope,
      })
    }

    let outcome: Awaited<ReturnType<typeof producePortrait>> | null = null
    try {
      outcome = await producePortrait(
        config,
        choices,
        uid,
        {
          request: request.signal,
          deadline: AbortSignal.timeout(timeouts.portraitMs),
        },
        { fetch: send, sleep, mockDelayMs: timeouts.mockPortraitMs },
      )
    } finally {
      limit.release(outcome === null || (!outcome.ok && outcome.refund))
      log({
        step: 'portrait',
        provider: config.image?.provider ?? 'mock',
        mock: config.mock,
        sex: choices.sex,
        age: choices.age,
        details: choices.details.length,
        moderated: Boolean(config.image?.moderation),
        status: outcome ? (outcome.ok ? 200 : outcome.status) : 500,
        outcome: outcome ? (outcome.ok ? 'ok' : outcome.code) : 'upstream',
        ...(outcome && !outcome.ok && outcome.detail ? { detail: outcome.detail } : {}),
        ms: now() - started,
        bytesOut: outcome?.ok ? outcome.bytes.byteLength : 0,
      })
    }
    if (!outcome.ok) {
      const { status: code, retryAfter, scope } = outcome
      return refuse(request, code, outcome.code, {
        ...(retryAfter !== undefined ? { retryAfter } : {}),
        ...(scope ? { scope } : {}),
      })
    }
    const token = signPortrait(
      {
        sha: portraitSha(outcome.bytes),
        sex: choices.sex,
        age: choices.age,
        hairStyle: choices.hairStyle,
        hairColour: choices.hairColour,
        outfit: choices.outfit,
        outfitColour: choices.outfitColour,
        ...(config.mock ? { mock: true as const } : {}),
      },
      uid,
      { env, now: now() },
    )
    return withSceneApiHeaders(
      request,
      new Response(imageStream(outcome.bytes), {
        headers: {
          'Content-Type': outcome.type,
          'Content-Disposition': `inline; filename="ai-person.${EXTENSION[outcome.type]}"`,
          'Cache-Control': 'no-store',
          [AI_PORTRAIT_TOKEN_HEADER]: token,
          [PHOTOREAL_AI_REMAINING_HEADER]: String(limit.remainingToday),
        },
      }),
    )
  }

  /** Whether the user has a build going (kept in the store: a restart doesn't forget it). */
  async function building(userKey: string): Promise<boolean> {
    const { store } = storeOf()
    for (const { id, job } of await store.listJobs(userKey)) {
      if (!isAvatarJob(job) || job.state !== 'working') continue
      // One nobody carried on past its deadline is settled first.
      const current = now() > job.deadline ? await step(userKey, id, true).catch(() => job) : job
      if (current?.state === 'working') return true
    }
    return false
  }

  async function startAvatar(request: Request): Promise<Response> {
    const started = now()
    const begun = await begin(request)
    if ('refused' in begun) return begun.refused
    const { config, uid } = begun
    const paid = config.service
    // No paid service: the browser makes the avatar from the portrait, and nothing is sent here.
    if (!paid) return refuse(request, 503, 'unavailable')

    const contentType = request.headers.get('content-type') ?? ''
    if (!/^multipart\/form-data\s*;/i.test(contentType)) {
      return refuse(request, 415, 'unsupported_type')
    }
    if (Number(request.headers.get('content-length')) > MAX_AVATAR_BODY) {
      return refuse(request, 413, 'too_large')
    }
    if (!request.body) return refuse(request, 400, 'invalid_request')
    const raw = await readBodyCapped(request.body, MAX_AVATAR_BODY).catch(() => undefined)
    if (raw === undefined) return refuse(request, 400, 'invalid_request')
    if (raw === null) return refuse(request, 413, 'too_large')
    let form: FormData
    try {
      form = await new Response(raw, { headers: { 'content-type': contentType } }).formData()
    } catch {
      return refuse(request, 400, 'invalid_request')
    }
    const names = [...form.keys()]
    const part = form.get('portrait')
    const token = form.get('token')
    if (
      names.length !== 2 ||
      !(part instanceof Blob) ||
      typeof token !== 'string' ||
      part.size > AI_PORTRAIT_MAX_BYTES
    ) {
      return refuse(request, 400, 'invalid_request')
    }
    const bytes = new Uint8Array(await part.arrayBuffer())
    const checked = portraitImage(bytes)
    if (!checked.ok) return refuse(request, 422, 'portrait_invalid')
    // Only a portrait this server made for this user, unchanged and in time, goes to the service.
    const verified = verifyPortrait(token, bytes, uid, { env, now: now() })
    if (!verified.ok) {
      return verified.code === 'expired'
        ? refuse(request, 410, 'portrait_expired')
        : refuse(request, 403, 'portrait_invalid')
    }
    const claim = verified.claim
    if (Boolean(claim.mock) !== config.mock) return refuse(request, 403, 'portrait_invalid')

    const { store, ledger } = storeOf(config.storeDir)
    const userKey = store.userKey(uid)
    // Each portrait makes one build, across restarts too.
    let claimed: boolean
    try {
      claimed = await ledger.claim(claim.sha, verified.expires)
    } catch {
      return refuse(request, 503, 'unavailable')
    }
    if (!claimed) return refuse(request, 409, 'portrait_used')
    const unclaim = () => ledger.unclaim(claim.sha).catch(() => {})

    if ((await store.listAvatars(userKey)).length >= MAX_AVATARS_PER_USER) {
      await unclaim()
      return refuse(request, 409, 'too_many_avatars')
    }
    if (await building(userKey)) {
      await unclaim()
      return refuse(request, 429, 'busy')
    }
    const limit = avatarLimiter.take({
      userKey: `uid:${uid}`,
      anonymous: false,
      ip: npcClientIp(request),
      limits: config.avatarLimits,
    })
    if (!limit.ok) {
      await unclaim()
      if (limit.code === 'busy') return refuse(request, 429, 'busy')
      return refuse(request, 429, 'rate_limited', {
        retryAfter: limit.retryAfter,
        scope: limit.scope,
      })
    }

    const { sha: _sha, mock: _mock, ...look } = claim
    const jobId = randomBytes(12).toString('hex')
    const job: AvatarJob = {
      id: jobId,
      userKey,
      avatarId: store.newAvatarId(userKey),
      createdAt: now(),
      deadline: now() + timeouts.jobMs,
      checkedAt: now(),
      state: 'working',
      stage: 'uploading',
      progress: stageProgress('uploading'),
      errors: 0,
      mock: config.mock,
      look,
      ref: null,
    }
    const service = serviceOf({
      mock: config.mock,
      service: paid,
      mockGlbPath: config.mockGlbPath,
    })
    const logFailure = (status: number, code: PhotorealAiRouteError, detail: string) =>
      log({
        step: 'avatar',
        event: 'failed',
        mock: config.mock,
        status,
        outcome: code,
        detail,
        ms: now() - started,
      })
    const cap: { refusal: LedgerRefusal | null; reserved: boolean } = {
      refusal: null,
      reserved: false,
    }
    // Nothing was built: the allowance and the portrait come back.
    const giveBack = async (
      status: number,
      code: PhotorealAiRouteError,
      detail: string,
      extra: Record<string, unknown> = {},
    ) => {
      limit.release(true)
      if (cap.reserved) await ledger.refund(userKey).catch(() => {})
      await unclaim()
      await store.deleteAvatar(job.avatarId).catch(() => false)
      logFailure(status, code, detail)
      return refuse(request, status, code, extra)
    }
    try {
      await store.savePortrait(job.avatarId, checked.image.bytes, checked.image.type)
    } catch {
      return giveBack(503, 'unavailable', 'store')
    }
    // Not the request's signal: once the upload is sent, a closed tab must not orphan the build.
    const created = await service.create(
      { photo: checked.image, look, name: jobId },
      AbortSignal.timeout(timeouts.createMs),
      async () => {
        const reserved = await ledger
          .reserve(userKey, config.avatarLimits)
          .catch((): LedgerRefusal => ({ ok: false, scope: 'global', retryAfter: 60 }))
        if (reserved.ok) cap.reserved = true
        else cap.refusal = reserved
        return reserved.ok
      },
    )
    if (!created.ok && created.sent !== 'unknown') {
      if (cap.refusal) {
        const { scope, retryAfter } = cap.refusal
        return giveBack(429, 'rate_limited', 'ledger', { retryAfter, scope })
      }
      if (created.code === 'rate_limited') {
        return giveBack(429, 'rate_limited', created.detail, {
          retryAfter: created.retryAfter ?? 30,
          scope: 'burst',
        })
      }
      if (created.code === 'unavailable') return giveBack(503, 'unavailable', created.detail)
      return giveBack(502, 'upstream', created.detail)
    }
    // Sent, and maybe built and billed even without an answer: the job looks for it by name.
    const running: AvatarJob = created.ok
      ? { ...job, ref: created.ref, stage: 'queued', progress: stageProgress('queued') }
      : { ...job, lost: jobId }
    try {
      await store.saveJob(userKey, jobId, running)
    } catch {
      if (created.ok) {
        await service.remove(created.ref, AbortSignal.timeout(timeouts.callMs)).catch(() => false)
      }
      await store.deleteAvatar(job.avatarId).catch(() => false)
      // Our disk failed: the allowance comes back, the portrait stays used (it was sent).
      limit.release(true)
      await ledger.refund(userKey).catch(() => {})
      logFailure(503, 'unavailable', 'store')
      return refuse(request, 503, 'unavailable')
    }
    // The allowance is held until the job ends; past its deadline the job is settled here.
    const timer = setTimeout(() => {
      void step(userKey, jobId, true)
        .catch(() => null)
        .finally(() => settle(jobId, { refund: false, detail: 'deadline' }))
    }, timeouts.jobMs + 60_000)
    timer.unref?.()
    holds.set(jobId, { release: limit.release, timer })
    log({
      step: 'avatar',
      event: 'start',
      mock: config.mock,
      status: 202,
      outcome: 'ok',
      ...(created.ok ? {} : { detail: `unanswered_${created.detail}` }),
      ms: now() - started,
    })
    return sceneApiJson(request, jobView(running), {
      status: 202,
      headers: { [PHOTOREAL_AI_REMAINING_HEADER]: String(limit.remainingToday) },
    })
  }

  function logEnd(job: AvatarJob, detail: string) {
    log({
      step: 'avatar',
      event: job.state === 'done' ? 'done' : 'failed',
      mock: job.mock,
      outcome: job.state === 'done' ? 'ok' : (job.error ?? 'upstream'),
      detail,
      ms: now() - job.createdAt,
    })
  }

  /**
   * One step of a job, shared by concurrent asks (the browser's and the
   * sweep's); null when it is gone. At most once per poll interval unless
   * `force`d: carry a working job on, or delete an ended one's service copy.
   */
  function step(userKey: string, jobId: string, force = false) {
    const running = stepping.get(jobId)
    if (running) return running
    const { store, ledger } = storeOf()
    /** The job ended: the allowance let go here, and given back in the ledger when refunded. */
    const ended = async (job: AvatarJob, settled: JobSettlement) => {
      settle(jobId, settled)
      if (settled.refund) await ledger.refund(userKey).catch(() => {})
      if (job.state === 'failed') await store.deleteAvatar(job.avatarId).catch(() => false)
      logEnd(job, settled.detail)
    }
    const work = (async (): Promise<AvatarJob | null> => {
      const loaded = await store.loadJob(userKey, jobId)
      if (!isAvatarJob(loaded) || loaded.userKey !== userKey) return null
      const busy = loaded.state === 'working' || Boolean(loaded.cleanup)
      if (!busy || (!force && now() - loaded.checkedAt < AVATAR_JOB_POLL_MS)) return loaded
      // The service the job was started on, whatever the feature's switches say now.
      const reached = readJobService(env, cwd, loaded.mock)
      if (!reached) {
        if (loaded.state !== 'working' || now() <= loaded.deadline) return loaded
        // Its service can't be reached any more (keys removed): it ends, refunded.
        const unreachable = endJob({ ...loaded, checkedAt: now() }, 'unavailable')
        await store.saveJob(userKey, jobId, unreachable)
        await ended(unreachable, { refund: true, detail: 'no_service' })
        return unreachable
      }
      const context: JobContext = {
        service: serviceOf(reached),
        store,
        now,
        callTimeoutMs: timeouts.callMs,
        downloadTimeoutMs: timeouts.downloadMs,
      }
      const began = now()
      let next = loaded
      let settled: JobSettlement | undefined
      if (loaded.state === 'working') ({ job: next, settled } = await advanceJob(loaded, context))
      if (next.state !== 'working' && next.cleanup) {
        // Delete the service's copy now if this step left time for it; else the next step does.
        if (!settled || now() - began < timeouts.inlineCleanupMs) {
          const cleaned = await cleanupJob(next, context)
          next = cleaned.job
          if (cleaned.gaveUp) {
            log({
              step: 'avatar',
              event: 'cleanup_failed',
              mock: next.mock,
              outcome: 'left_at_service',
              ms: now() - next.createdAt,
            })
          }
        }
      }
      await store.saveJob(userKey, jobId, next)
      if (settled) await ended(next, settled)
      return next
    })().finally(() => stepping.delete(jobId))
    stepping.set(jobId, work)
    return work
  }

  /**
   * Carries on every build nobody is asking about, deletes the service's
   * copies of ended ones, and clears what is left over: job records a day
   * after they were last stepped, and a build's portrait whose job is gone.
   */
  function sweep(): Promise<void> {
    sweeping ??= (async () => {
      const { store } = storeOf()
      for (const userKey of await store.listUsers()) {
        const live = new Set<string>()
        for (const { id, job, writtenAt } of await store.listJobs(userKey)) {
          if (!isAvatarJob(job)) {
            if (writtenAt < Date.now() - JOB_KEEP_MS) await store.deleteJob(userKey, id)
            continue
          }
          const busy = job.state === 'working' || Boolean(job.cleanup)
          const mine = deps.sweepMockJobs !== false || !job.mock
          const current = busy && mine ? ((await step(userKey, id).catch(() => null)) ?? job) : job
          if (current.state === 'working') live.add(current.avatarId)
          else if (now() - current.checkedAt > JOB_KEEP_MS) await store.deleteJob(userKey, id)
        }
        // File times are the wall clock's.
        for (const folder of await store.listFolders(userKey)) {
          if (folder.finished || live.has(folder.id)) continue
          if (folder.writtenAt < Date.now() - ORPHAN_FOLDER_MS) await store.deleteAvatar(folder.id)
        }
      }
    })().finally(() => {
      sweeping = null
    })
    return sweeping
  }

  if (deps.sweepEveryMs && deps.sweepEveryMs > 0) {
    // One sweeper per process: a reloaded route replaces the last one's.
    const holder = globalThis as { [SWEEPER]?: () => void }
    holder[SWEEPER]?.()
    const run = () => void sweep().catch(() => {})
    const first = setTimeout(run, Math.min(FIRST_SWEEP_MS, deps.sweepEveryMs))
    const every = setInterval(run, deps.sweepEveryMs)
    first.unref?.()
    every.unref?.()
    holder[SWEEPER] = () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }

  async function pollAvatar(request: Request, jobId: string): Promise<Response> {
    // A build goes on (and is cleaned up) even when making new ones is switched off.
    const user = await signedIn(request)
    if ('refused' in user) return user.refused
    if (!JOB_ID.test(jobId)) return refuse(request, 404, 'not_found')
    const { store } = storeOf()
    const userKey = store.userKey(user.uid)
    let job: AvatarJob | null
    try {
      job = await step(userKey, jobId)
    } catch {
      return refuse(request, 502, 'upstream')
    }
    if (!job) return refuse(request, 404, 'not_found')
    const avatar =
      job.state === 'done'
        ? ((await store.listAvatars(userKey)).find((meta) => meta.id === job.avatarId) ?? null)
        : null
    return sceneApiJson(request, jobView(job, avatar))
  }

  async function listAvatars(request: Request): Promise<Response> {
    const user = await signedIn(request)
    if ('refused' in user) return user.refused
    const { store } = storeOf()
    const metas = await store.listAvatars(store.userKey(user.uid))
    const body: PhotorealAiAvatarList = { avatars: metas.map(avatarView) }
    return sceneApiJson(request, body)
  }

  async function avatarFile(request: Request, id: string, file: string): Promise<Response> {
    const guard = guardSceneApiRequest(request)
    if (guard) return guard
    const { store } = storeOf()
    const found =
      file === 'model.glb'
        ? await store.readModel(id)
        : file === 'portrait'
          ? await store.readPortrait(id)
          : null
    if (!found) return refuse(request, 404, 'not_found')
    return withSceneApiHeaders(
      request,
      new Response(found.bytes, {
        headers: {
          'Content-Type': found.type,
          'Content-Length': String(found.bytes.byteLength),
          // An id names one finished file for good.
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      }),
    )
  }

  async function deleteAvatar(request: Request, id: string): Promise<Response> {
    const user = await signedIn(request)
    if ('refused' in user) return user.refused
    const { store } = storeOf()
    if (store.ownerOf(id) !== store.userKey(user.uid)) return refuse(request, 404, 'not_found')
    if (!(await store.deleteAvatar(id))) return refuse(request, 404, 'not_found')
    return sceneApiJson(request, { deleted: id })
  }

  return {
    status,
    portrait,
    startAvatar,
    pollAvatar,
    listAvatars,
    avatarFile,
    deleteAvatar,
    sweep,

    /** The catch-all route's dispatch by method and path segments under `/api/photoreal-ai`. */
    route(method: string, path: readonly string[], request: Request): Promise<Response> {
      const [head, second, third, ...rest] = path
      const notFound = async () => refuse(request, 404, 'not_found')
      if (rest.length > 0) return notFound()
      if (!head && method === 'GET') return status(request)
      if (head === 'portrait' && !second && method === 'POST') return portrait(request)
      if (head === 'avatar' && !second && method === 'POST') return startAvatar(request)
      if (head === 'avatar' && second && !third && method === 'GET') {
        return pollAvatar(request, second)
      }
      if (head === 'avatars' && !second && method === 'GET') return listAvatars(request)
      if (head === 'avatars' && second && third && method === 'GET') {
        return avatarFile(request, second, third)
      }
      if (head === 'avatars' && second && !third && method === 'DELETE') {
        return deleteAvatar(request, second)
      }
      return notFound()
    },
  }
}

export type PhotorealAiHandlers = ReturnType<typeof createPhotorealAiHandlers>

/** Builds nobody is asking about are carried on (and the service's copies deleted) this often. */
export const PHOTOREAL_AI_SWEEP_EVERY_MS = 30_000

/**
 * The sweep from server start (instrumentation.ts), before the route is
 * first asked for: builds left running by the last process are carried on
 * or ended. The route's own handlers take the sweep over once they load.
 */
export function startPhotorealAiSweep(): void {
  createPhotorealAiHandlers({
    userId: async () => null,
    sweepEveryMs: PHOTOREAL_AI_SWEEP_EVERY_MS,
    sweepMockJobs: false,
  })
}
