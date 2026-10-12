import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { imageStream } from '../ai-photo/handlers'
import { type AiPhotoLimiter, createAiPhotoLimiter } from '../ai-photo/rate-limit'
import { npcClientIp } from '../npc-ai/rate-limit'
import { readBodyCapped } from '../npc-ai/tts'
import { guardSceneApiRequest, sceneApiJson, withSceneApiHeaders } from '../scene-api-security'
import { type PhotorealAiConfig, photorealAiStoreDir, readPhotorealAiConfig } from './config'
import {
  type AvatarJob,
  advanceJob,
  avatarView,
  isAvatarJob,
  type JobSettlement,
  jobView,
  stageProgress,
} from './jobs'
import { createMetaPersonService } from './metaperson'
import { createMetaPersonFake } from './metaperson-fake'
import { checkNotes } from './notes-check'
import { portraitImage, producePortrait } from './portrait'
import { portraitSha, signPortrait, verifyPortrait } from './portrait-token'
import type { AvatarService, ServiceFetch } from './service'
import {
  AI_PERSON_AGES,
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
 * Everything but the files needs a signed-in user. Portraits and 3D builds
 * have their own daily caps (the AI 실사 사진 limiter, a second and a third
 * instance). Log lines carry counts and codes only: never choices, notes,
 * prompts, images, user ids, tokens or keys.
 */

export type PhotorealAiUsage =
  | {
      step: 'portrait'
      provider: string
      mock: boolean
      sex: AiPersonChoices['sex']
      age: AiPersonChoices['age']
      notes: boolean
      moderated: boolean
      status: number
      outcome: PhotorealAiRouteError | 'ok'
      detail?: string
      ms: number
      bytesOut: number
    }
  | {
      step: 'avatar'
      event: 'start' | 'done' | 'failed'
      mock: boolean
      status?: number
      outcome: string
      detail?: string
      ms: number
    }

export type PhotorealAiHandlerDeps = {
  /** The verified user id (Firebase uid), or null when signed out. */
  userId: (request: Request) => Promise<string | null>
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
}

const TIMEOUTS = {
  /** Text moderation, generation and image moderation of one portrait. */
  portraitMs: 150_000,
  mockPortraitMs: 1500,
  /** The photo upload that starts a build. */
  createMs: 60_000,
  /** One status ask. */
  callMs: 30_000,
  downloadMs: 120_000,
  /** A whole build, from upload to saved avatar. */
  jobMs: 10 * 60_000,
}

const MAX_JSON_BODY = 4096
/** The portrait and its token as multipart: under the 4.5 MB request cap of serverless hosts. */
const MAX_AVATAR_BODY = 4_400_000
const MAX_AVATARS_PER_USER = 24
const JOB_KEEP_MS = 24 * 60 * 60_000

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
    notes: z.string().max(400).default(''),
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
  const stores = new Map<string, AvatarStore>()
  const services = new Map<string, AvatarService>()
  /** Portraits already sent to the service, until their token would have expired. */
  const usedPortraits = new Map<string, number>()
  /** One step at a time per job, and the allowance each running job holds. */
  const stepping = new Map<string, Promise<AvatarJob | null>>()
  const holds = new Map<string, { release: (refund: boolean) => void; timer: NodeJS.Timeout }>()
  /** The 목업's in-process service, one per handler set so its builds outlive a request. */
  let mockFetch: ServiceFetch | undefined

  /** The store, from the environment alone: avatars stay listed and loadable when making new ones is off. */
  const storeOf = (dir: string = photorealAiStoreDir(env, cwd)) => {
    let store = stores.get(dir)
    if (!store) {
      store = makeStore(dir)
      stores.set(dir, store)
    }
    return store
  }

  function serviceOf(config: PhotorealAiConfig): AvatarService {
    const { service } = config
    const key = config.mock
      ? 'mock'
      : `${service.baseUrl}|${service.clientId}|${service.clientSecret}`
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
        players: storeOf(config.storeDir).players(`${service.baseUrl}|${service.clientId}`),
      })
    }
    services.set(key, found)
    return found
  }

  /** The signed-in user, or the refusal. */
  async function signedIn(request: Request): Promise<{ uid: string } | { refused: Response }> {
    const guard = guardSceneApiRequest(request)
    if (guard) return { refused: guard }
    const uid = await deps.userId(request)
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
    const uid = await deps.userId(request)
    if (!uid) return { refused: refuse(request, 401, 'sign_in_required') }
    return { config: ai.config, uid }
  }

  function settle(jobId: string, settled: JobSettlement) {
    const hold = holds.get(jobId)
    if (!hold) return
    clearTimeout(hold.timer)
    holds.delete(jobId)
    hold.release(settled.refund)
  }

  function sweepUsed() {
    const t = now()
    for (const [sha, until] of usedPortraits) if (until <= t) usedPortraits.delete(sha)
  }

  async function status(request: Request): Promise<Response> {
    const guard = guardSceneApiRequest(request)
    if (guard) return guard
    const ai = readPhotorealAiConfig(env, cwd)
    if (!ai.ok) {
      const body: PhotorealAiStatus = { available: false, reason: ai.reason, part: ai.part }
      return sceneApiJson(request, body)
    }
    const uid = await deps.userId(request)
    const key = uid ? `uid:${uid}` : null
    const body: PhotorealAiStatus = {
      available: true,
      mock: ai.config.mock,
      signedIn: uid !== null,
      portraitsLeft: key ? portraitLimiter.remaining(key, false, ai.config.portraitLimits) : null,
      avatarsLeft: key ? avatarLimiter.remaining(key, false, ai.config.avatarLimits) : null,
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
    let parsed: z.infer<typeof PortraitBody>
    try {
      const body = PortraitBody.safeParse(JSON.parse(new TextDecoder().decode(raw)))
      if (!body.success) return refuse(request, 400, 'invalid_request')
      parsed = body.data
    } catch {
      return refuse(request, 400, 'invalid_request')
    }
    // A refused description costs nothing: checked before the allowance is touched.
    const notes = checkNotes(parsed.choices.notes)
    if (!notes.ok) return refuse(request, 422, notes.code)
    const choices: AiPersonChoices = { ...parsed.choices, notes: notes.notes }

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
        notes: choices.notes.length > 0,
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

  async function startAvatar(request: Request): Promise<Response> {
    const started = now()
    const begun = await begin(request)
    if ('refused' in begun) return begun.refused
    const { config, uid } = begun

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
    sweepUsed()
    if (usedPortraits.has(claim.sha)) return refuse(request, 409, 'portrait_used')

    const store = storeOf(config.storeDir)
    const userKey = store.userKey(uid)
    await store.sweepJobs(userKey, now() - JOB_KEEP_MS).catch(() => {})
    if ((await store.listAvatars(userKey)).length >= MAX_AVATARS_PER_USER) {
      return refuse(request, 409, 'too_many_avatars')
    }

    const ip = npcClientIp(request)
    const limit = avatarLimiter.take({
      userKey: `uid:${uid}`,
      anonymous: false,
      ip,
      limits: config.avatarLimits,
    })
    if (!limit.ok) {
      if (limit.code === 'busy') return refuse(request, 429, 'busy')
      return refuse(request, 429, 'rate_limited', {
        retryAfter: limit.retryAfter,
        scope: limit.scope,
      })
    }
    usedPortraits.set(claim.sha, verified.expires)

    const { sha: _sha, mock: _mock, ...look } = claim
    const job: AvatarJob = {
      id: randomBytes(12).toString('hex'),
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
    const service = serviceOf(config)
    // Nothing was built when the start fails, so the allowance and the portrait come back.
    const fail = (
      status: number,
      code: PhotorealAiRouteError,
      detail: string,
      extra: Record<string, unknown> = {},
    ) => {
      limit.release(true)
      usedPortraits.delete(claim.sha)
      log({
        step: 'avatar',
        event: 'failed',
        mock: config.mock,
        status,
        outcome: code,
        detail,
        ms: now() - started,
      })
      return refuse(request, status, code, extra)
    }
    try {
      await store.savePortrait(job.avatarId, checked.image.bytes, checked.image.type)
    } catch {
      return fail(503, 'unavailable', 'store')
    }
    const created = await service.create(
      { photo: checked.image, look, name: 'ai-person' },
      AbortSignal.any([request.signal, AbortSignal.timeout(timeouts.createMs)]),
    )
    if (!created.ok) {
      await store.deleteAvatar(job.avatarId).catch(() => false)
      if (created.code === 'rate_limited') {
        return fail(429, 'rate_limited', created.detail, {
          retryAfter: created.retryAfter ?? 30,
          scope: 'burst',
        })
      }
      if (created.code === 'unavailable') return fail(503, 'unavailable', created.detail)
      return fail(502, 'upstream', created.detail)
    }
    const running: AvatarJob = {
      ...job,
      ref: created.ref,
      stage: 'queued',
      progress: stageProgress('queued'),
    }
    try {
      await store.saveJob(userKey, running.id, running)
    } catch {
      await service.remove(created.ref, AbortSignal.timeout(timeouts.callMs)).catch(() => false)
      await store.deleteAvatar(job.avatarId).catch(() => false)
      return fail(503, 'unavailable', 'store')
    }
    // The allowance is held until the job ends; past its deadline it is let go unrefunded.
    const timer = setTimeout(
      () => settle(running.id, { refund: false, detail: 'deadline' }),
      timeouts.jobMs + 60_000,
    )
    timer.unref?.()
    holds.set(running.id, { release: limit.release, timer })
    log({
      step: 'avatar',
      event: 'start',
      mock: config.mock,
      status: 202,
      outcome: 'ok',
      ms: now() - started,
    })
    return sceneApiJson(request, jobView(running), {
      status: 202,
      headers: { [PHOTOREAL_AI_REMAINING_HEADER]: String(limit.remainingToday) },
    })
  }

  /** One step of a job, shared by concurrent asks; null when it is gone. */
  function step(config: PhotorealAiConfig, userKey: string, jobId: string) {
    const running = stepping.get(jobId)
    if (running) return running
    const store = storeOf(config.storeDir)
    const work = (async (): Promise<AvatarJob | null> => {
      const loaded = await store.loadJob(userKey, jobId)
      if (!isAvatarJob(loaded) || loaded.userKey !== userKey) return null
      if (loaded.state !== 'working' || now() - loaded.checkedAt < AVATAR_JOB_POLL_MS) {
        return loaded
      }
      if (loaded.mock !== config.mock) return loaded
      const { job, settled } = await advanceJob(loaded, {
        service: serviceOf(config),
        store,
        now,
        callTimeoutMs: timeouts.callMs,
        downloadTimeoutMs: timeouts.downloadMs,
      })
      await store.saveJob(userKey, jobId, job)
      if (settled) {
        settle(jobId, settled)
        if (job.state === 'failed') await store.deleteAvatar(job.avatarId).catch(() => false)
        log({
          step: 'avatar',
          event: job.state === 'done' ? 'done' : 'failed',
          mock: job.mock,
          outcome: job.state === 'done' ? 'ok' : (job.error ?? 'upstream'),
          detail: settled.detail,
          ms: now() - job.createdAt,
        })
      }
      return job
    })().finally(() => stepping.delete(jobId))
    stepping.set(jobId, work)
    return work
  }

  async function pollAvatar(request: Request, jobId: string): Promise<Response> {
    const begun = await begin(request)
    if ('refused' in begun) return begun.refused
    const { config, uid } = begun
    if (!JOB_ID.test(jobId)) return refuse(request, 404, 'not_found')
    const store = storeOf(config.storeDir)
    const userKey = store.userKey(uid)
    let job: AvatarJob | null
    try {
      job = await step(config, userKey, jobId)
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
    const store = storeOf()
    const metas = await store.listAvatars(store.userKey(user.uid))
    const body: PhotorealAiAvatarList = { avatars: metas.map(avatarView) }
    return sceneApiJson(request, body)
  }

  async function avatarFile(request: Request, id: string, file: string): Promise<Response> {
    const guard = guardSceneApiRequest(request)
    if (guard) return guard
    const store = storeOf()
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
    const store = storeOf()
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
