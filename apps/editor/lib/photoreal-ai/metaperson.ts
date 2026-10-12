import { readBodyCapped } from '../npc-ai/tts'
import type { AvatarServiceConfig } from './config'
import { isGlb, MAX_GLB_BYTES } from './glb'
import type {
  AvatarLook,
  AvatarService,
  ServiceFailure,
  ServiceFetch,
  ServicePoll,
  ServiceRef,
  ServiceStage,
} from './service'
import { isZip, readZip } from './zip'

/**
 * Avatar SDK's MetaPerson cloud REST API: one frontal photo in, a rigged,
 * textured full-body GLB (Mixamo-style bones, ARKit blend shapes) out.
 * Written from the protocol as the vendor's own public clients use it; no
 * code is copied from them:
 *
 * - avatarsdk/metaperson-unity-plugin @ af6a698450160a820aa668940a0a573962c6bb55,
 *   Assets/AvatarSdk/MetaPerson/: sdk_core/scripts/communication/ConnectionBase.cs
 *   (GetUrl adds a trailing slash; `POST /o/token/` with grant_type, client_id,
 *   client_secret), sdk_cloud/scripts/Connection.cs (auth headers L74-84:
 *   `Authorization: <token_type> <token>`, `X-PlayerUID`; retries L236-290: 3
 *   attempts, 429 waits for Retry-After, 401 re-authorizes once; players L736-750;
 *   `POST /avatars/` multipart L827-850 with `photo` (photo.jpg,
 *   application/octet-stream), name, pipeline, pipeline_subtype, parameters,
 *   export_parameters; exports L1191-1235; `parameters/available` L1071-1076),
 *   sdk_cloud/scripts/server_data/AvatarData.cs (statuses, L22) and ExportData.cs
 *   (files[].identity / file), sdk_core/scripts/computation_parameters/
 *   ExportParameters.cs (GetExportJsonObject L157-200) and AvatarAssetsParameters.cs
 *   (ToExportJson, the available-parameters shapes), samples_core/scripts/
 *   GettingStartedSample.cs L161-230 (remove_smile; GLB, embedded 1K JPEG
 *   textures, Color/Normal/GltfMetallicRoughness, the generated haircut).
 * - avatarsdk/samples-js @ 36f76d5158809059eac03e7e1b0cc9e28dbfb859, js/asdk.js
 *   (create_avatar L94-111, the status switch in _poll_impl L122-150, export
 *   files read as a ZIP L208-296).
 * - RodkinIvan/Text-to-3D-face @ 9f09772a gen3d/gen_3d_file.py L142-149: the
 *   export file is a ZIP holding `avatar/model.glb`.
 *
 * Every URL the service hands back is followed only on the service's own
 * origin with our token (a redirect elsewhere goes without it). Secrets,
 * tokens and the photo are never logged; failures carry a status code only.
 * `scripts/photoreal/check-avatar-service.ts` runs this file against the
 * real service and reports where the answers differ from what it expects.
 */

export const METAPERSON_PIPELINE = 'metaperson_2.1'
export const METAPERSON_CREDIT = 'Avatar SDK MetaPerson'

/** The body parts of a full avatar (ExportParameters' IncludeAllAvailableParts). */
const BODY_PARTS = [
  'AvatarBody',
  'AvatarHead',
  'AvatarEyelashes',
  'AvatarLeftCornea',
  'AvatarRightCornea',
  'AvatarLeftEyeball',
  'AvatarRightEyeball',
  'AvatarTeethLower',
  'AvatarTeethUpper',
]
const MATERIAL_TEXTURES = ['Color', 'Normal', 'GltfMetallicRoughness']
const GENERATED_HAIRCUT = 'HaircutGenerated'

/** Words in the service's outfit names that fit each AI 인물 outfit, best first. */
const OUTFIT_WORDS: Record<AvatarLook['outfit'], string[]> = {
  tshirt: ['tshirt', 't-shirt', 't_shirt', 'tee', 'casual'],
  knit: ['sweater', 'knit', 'jumper', 'pullover', 'casual'],
  shirt: ['shirt', 'casual'],
  suit: ['suit', 'business', 'formal', 'office'],
  blouse: ['blouse', 'shirt', 'casual'],
  hoodie: ['hoodie', 'hood', 'sweatshirt', 'casual'],
  sport: ['sport', 'track', 'athlet', 'training', 'jogging'],
  workwear: ['work', 'overall', 'uniform', 'jacket'],
}

const IN_PROGRESS: Record<string, ServiceStage> = {
  Pending: 'uploading',
  Uploading: 'uploading',
  Queued: 'queued',
  Preprocessing: 'computing',
  Computing: 'computing',
}
const FAILED = new Set(['Failed', 'Timed Out'])
const DONE = 'Completed'

/** A ZIP of a 1K-textured avatar is about 11 MB. */
const MAX_DOWNLOAD_BYTES = 96 * 1024 * 1024
const MAX_JSON_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const ATTEMPTS = 3
const AVAILABLE_TTL_MS = 60 * 60_000
const USER_AGENT = 'mmm-studio (photoreal-ai)'

export type AvailableExportParameters = Record<string, string[]>

export type MetaPersonOptions = {
  config: AvatarServiceConfig
  fetch: ServiceFetch
  now?: () => number
  /** Waits between retries; abortable. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** Keeps the registered player across restarts (the store); a player only sees its own avatars. */
  players?: { load: () => Promise<string | null>; save: (code: string) => Promise<void> }
}

export type MetaPersonService = AvatarService & {
  /** `GET /parameters/available/<pipeline>/`: 200 when the plan may build this body, else the status. */
  pipelineAvailable(sex: AvatarLook['sex'], signal: AbortSignal): Promise<number>
  availableExportParameters(
    sex: AvatarLook['sex'],
    signal: AbortSignal,
  ): Promise<{ ok: true; available: AvailableExportParameters } | ServiceFailure>
  /** `GET /avatars/<code>/model_info/`, when the service has one. */
  modelInfo(ref: ServiceRef, signal: AbortSignal): Promise<Record<string, unknown> | null>
}

const sleepFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
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

const fail = (
  code: ServiceFailure['code'],
  detail: string,
  retryAfter?: number,
): ServiceFailure => ({
  ok: false,
  code,
  detail,
  ...(retryAfter !== undefined ? { retryAfter } : {}),
})

/** A refused HTTP status, by who must act: the owner (credentials, plan), the input, or nobody. */
export function httpFailure(status: number, retryAfter?: number): ServiceFailure {
  const detail = `http_${status}`
  if (status === 429) return fail('rate_limited', detail, retryAfter ?? 30)
  if (status === 401 || status === 402 || status === 403) return fail('unavailable', detail)
  if (status === 404 || status === 410) return fail('gone', detail)
  if (status === 408 || status >= 500) return fail('upstream', detail)
  return fail('rejected', detail)
}

const retryable = (status: number) => status === 408 || status >= 500

function retryAfterOf(response: Response): number | undefined {
  const seconds = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
  return seconds > 0 ? Math.min(seconds, 3600) : undefined
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) return null
  const bytes = await readBodyCapped(response.body, MAX_JSON_BYTES).catch(() => null)
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** `{ category: [names] | { list: [names], textures: [...] } }` as name lists per category. */
export function parseAvailableExportParameters(json: unknown): AvailableExportParameters {
  const out: AvailableExportParameters = {}
  if (!json || typeof json !== 'object' || Array.isArray(json)) return out
  for (const [category, entry] of Object.entries(json)) {
    const list = Array.isArray(entry) ? entry : (entry as { list?: unknown } | null)?.list
    if (Array.isArray(list)) out[category] = list.filter((name) => typeof name === 'string')
  }
  return out
}

/** The first name holding one of the words (word order first), else the first name. */
function bestMatch(names: readonly string[], words: readonly string[]): string | undefined {
  for (const word of words) {
    const found = names.find((name) => name.toLowerCase().includes(word))
    if (found) return found
  }
  return names[0]
}

const assetJson = (list: string[], textures: string[]) => ({
  list,
  embed: true,
  textures: { embed: true, list: textures },
})

/**
 * The export: one GLB, embedded 1K JPEG textures, the body, the haircut
 * made from the photo, a whole outfit (or a top, bottoms and shoes), and the
 * ARKit blend shapes. Null when the service lists no outfit for this body:
 * an avatar is never exported unclothed.
 */
export function buildExportParameters(
  available: AvailableExportParameters,
  look: AvatarLook,
): Record<string, unknown> | null {
  const words = OUTFIT_WORDS[look.outfit]
  const clothing: Record<string, unknown> = {}
  const outfit = bestMatch(available.outfits ?? [], words)
  if (outfit) clothing.outfits = assetJson([outfit], MATERIAL_TEXTURES)
  else {
    const top = bestMatch(available.outfits_top ?? [], words)
    const bottom = bestMatch(available.outfits_bottom ?? [], [])
    if (!top || !bottom) return null
    clothing.outfits_top = assetJson([top], MATERIAL_TEXTURES)
    clothing.outfits_bottom = assetJson([bottom], MATERIAL_TEXTURES)
    const shoes = bestMatch(available.outfits_shoes ?? [], [])
    if (shoes) clothing.outfits_shoes = assetJson([shoes], MATERIAL_TEXTURES)
  }
  const haircuts = available.haircuts ?? []
  const haircut =
    look.hairStyle === 'shaved'
      ? undefined
      : haircuts.includes(GENERATED_HAIRCUT)
        ? GENERATED_HAIRCUT
        : haircuts[0]
  const blendshapes = (available.blendshapes ?? []).includes('mobile_51') ? ['mobile_51'] : []
  return {
    format: 'glb',
    lod: 'LOD1',
    finalize: true,
    make_public: false,
    make_public_direct: false,
    transparent_cornea: true,
    avatar: { list: BODY_PARTS, textures: { list: MATERIAL_TEXTURES } },
    textures: { embed: true, profile: '1K.jpg' },
    ...(haircut ? { haircuts: assetJson([haircut], [...MATERIAL_TEXTURES, 'AO']) } : {}),
    ...clothing,
    ...(blendshapes.length ? { blendshapes: { list: blendshapes, embed: true } } : {}),
  }
}

/** The computation parameters: a closed, neutral mouth, as the vendor's sample asks. */
export const METAPERSON_PARAMETERS = { avatar_modifications: { remove_smile: true } }

/** The GLB inside a downloaded export: the bytes themselves, or `…/model.glb` in its ZIP. */
export function exportGlb(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  if (isGlb(bytes)) return bytes
  if (!isZip(bytes)) return null
  const entries = readZip(bytes, { maxEntryBytes: MAX_GLB_BYTES })
  if (!entries) return null
  const glbs = entries.filter((entry) => /\.glb$/i.test(entry.name))
  const entry =
    glbs.find((item) => /(^|\/)avatar\/model\.glb$/i.test(item.name)) ??
    glbs.find((item) => /(^|\/)model\.glb$/i.test(item.name)) ??
    glbs[0]
  if (!entry) return null
  try {
    const glb = entry.read()
    return isGlb(glb) ? glb : null
  } catch {
    return null
  }
}

export function createMetaPersonService(options: MetaPersonOptions): MetaPersonService {
  const { config } = options
  const send = options.fetch
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepFor
  const base = config.baseUrl
  const origin = new URL(base).origin
  let token: { header: string; expiresAt: number } | null = null
  /** Which token request the service took last: the plugin's form fields, or HTTP Basic. */
  let tokenStyle: 'form' | 'basic' = 'form'
  let player: string | null = config.playerUid
  const availableCache = new Map<string, { at: number; value: AvailableExportParameters }>()

  const sameOrigin = (url: string) => {
    try {
      return new URL(url).origin === origin
    } catch {
      return false
    }
  }

  async function authorize(signal: AbortSignal): Promise<string | ServiceFailure> {
    if (token && token.expiresAt > now()) return token.header
    const styles =
      tokenStyle === 'form' ? (['form', 'basic'] as const) : (['basic', 'form'] as const)
    let last: ServiceFailure = fail('unavailable', 'token')
    for (const style of styles) {
      const body = new URLSearchParams({ grant_type: 'client_credentials' })
      const headers: Record<string, string> = {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      }
      if (style === 'form') {
        body.set('client_id', config.clientId)
        body.set('client_secret', config.clientSecret)
      } else {
        const pair = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
        headers.authorization = `Basic ${pair}`
      }
      let response: Response
      try {
        response = await send(`${base}/o/token/`, {
          method: 'POST',
          headers,
          body,
          cache: 'no-store',
          redirect: 'error',
          signal,
        })
      } catch {
        return fail('upstream', signal.aborted ? 'aborted' : 'token_network')
      }
      if (response.status === 400 || response.status === 401) {
        await response.body?.cancel().catch(() => {})
        last = fail('unavailable', `token_http_${response.status}`)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        return httpFailure(response.status, retryAfterOf(response))
      }
      const json = (await readJson(response)) as {
        access_token?: unknown
        token_type?: unknown
        expires_in?: unknown
      } | null
      const access = text(json?.access_token)
      if (!access) return fail('upstream', 'token_unreadable')
      const type = text(json?.token_type) || 'Bearer'
      const lifetime = typeof json?.expires_in === 'number' ? json.expires_in : 3600
      token = { header: `${type} ${access}`, expiresAt: now() + Math.max(60, lifetime - 60) * 1000 }
      tokenStyle = style
      return token.header
    }
    return last
  }

  type Call = {
    method: 'GET' | 'POST' | 'DELETE'
    url: string
    body?: BodyInit
    /** The player whose avatars these are; none for the player registration itself. */
    player?: string
    /** Safe to repeat on a 5xx or a dropped connection (never a create). */
    retry?: boolean
    accept?: string
  }

  async function call(
    request: Call,
    signal: AbortSignal,
  ): Promise<{ ok: true; response: Response } | ServiceFailure> {
    let url = request.url
    if (!sameOrigin(url)) return fail('upstream', 'foreign_url')
    let attempts = request.retry ? ATTEMPTS : 1
    let reauthorized = false
    let redirects = 0
    let authenticated = true
    for (;;) {
      const headers: Record<string, string> = { accept: request.accept ?? 'application/json' }
      if (authenticated) {
        const header = await authorize(signal)
        if (typeof header !== 'string') return header
        headers.authorization = header
        headers['x-user-agent'] = USER_AGENT
        if (request.player) headers['x-playeruid'] = request.player
      }
      let response: Response
      try {
        response = await send(url, {
          method: request.method,
          headers,
          body: request.body,
          cache: 'no-store',
          redirect: 'manual',
          signal,
        })
      } catch {
        if (signal.aborted) return fail('upstream', 'aborted')
        if (--attempts > 0) {
          await sleep(500 * (ATTEMPTS - attempts), signal).catch(() => {})
          continue
        }
        return fail('upstream', 'network')
      }
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => {})
        if (++redirects > MAX_REDIRECTS) return fail('upstream', 'redirects')
        url = new URL(location, url).href
        // A file served from storage elsewhere is fetched without our token.
        authenticated = sameOrigin(url)
        continue
      }
      if (response.status === 401 && authenticated && !reauthorized) {
        await response.body?.cancel().catch(() => {})
        token = null
        reauthorized = true
        continue
      }
      if (retryable(response.status) && --attempts > 0) {
        await response.body?.cancel().catch(() => {})
        await sleep(500 * (ATTEMPTS - attempts), signal).catch(() => {})
        continue
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        return httpFailure(response.status, retryAfterOf(response))
      }
      return { ok: true, response }
    }
  }

  async function callJson(
    request: Call,
    signal: AbortSignal,
  ): Promise<{ ok: true; json: unknown } | ServiceFailure> {
    const result = await call(request, signal)
    if (!result.ok) return result
    const json = await readJson(result.response)
    return json === null ? fail('upstream', 'unreadable') : { ok: true, json }
  }

  async function playerCode(signal: AbortSignal): Promise<string | ServiceFailure> {
    if (player) return player
    const stored = await options.players?.load().catch(() => null)
    if (stored) {
      player = stored
      return stored
    }
    const body = new URLSearchParams({ comment: 'mmm-studio photoreal-ai' })
    const result = await callJson({ method: 'POST', url: `${base}/players/`, body }, signal)
    if (!result.ok) return result
    const code = text((result.json as { code?: unknown }).code)
    if (!code) return fail('upstream', 'player_unreadable')
    player = code
    await options.players?.save(code).catch(() => {})
    return code
  }

  async function availableExportParameters(
    sex: AvatarLook['sex'],
    signal: AbortSignal,
  ): Promise<{ ok: true; available: AvailableExportParameters } | ServiceFailure> {
    const cached = availableCache.get(sex)
    if (cached && now() - cached.at < AVAILABLE_TTL_MS) return { ok: true, available: cached.value }
    const owner = await playerCode(signal)
    if (typeof owner !== 'string') return owner
    const url = `${base}/export_parameters/available/${METAPERSON_PIPELINE}/?pipeline_subtype=${sex}`
    const result = await callJson({ method: 'GET', url, player: owner, retry: true }, signal)
    if (!result.ok) return result
    const available = parseAvailableExportParameters(result.json)
    availableCache.set(sex, { at: now(), value: available })
    return { ok: true, available }
  }

  async function modelInfo(ref: ServiceRef, signal: AbortSignal) {
    const url = `${base}/avatars/${encodeURIComponent(ref.avatar ?? '')}/model_info/`
    const result = await callJson({ method: 'GET', url, player: ref.player }, signal)
    return result.ok && result.json && typeof result.json === 'object'
      ? (result.json as Record<string, unknown>)
      : null
  }

  return {
    credit: METAPERSON_CREDIT,

    async pipelineAvailable(sex, signal) {
      const owner = await playerCode(signal)
      if (typeof owner !== 'string') return 0
      const url = `${base}/parameters/available/${METAPERSON_PIPELINE}/?pipeline_subtype=${sex}`
      const result = await call({ method: 'GET', url, player: owner, retry: true }, signal)
      if (result.ok) {
        await result.response.body?.cancel().catch(() => {})
        return result.response.status
      }
      return Number(result.detail.replace(/^http_/, '')) || 0
    },

    availableExportParameters,
    modelInfo,

    async create({ photo, look, name }, signal) {
      const owner = await playerCode(signal)
      if (typeof owner !== 'string') return owner
      const listed = await availableExportParameters(look.sex, signal)
      if (!listed.ok) return listed
      const exportParameters = buildExportParameters(listed.available, look)
      if (!exportParameters) return fail('unavailable', 'no_outfit')
      const form = new FormData()
      const file = new Blob([photo.bytes], { type: 'application/octet-stream' })
      form.append('photo', file, photo.type === 'image/png' ? 'photo.png' : 'photo.jpg')
      form.append('name', name)
      form.append('pipeline', METAPERSON_PIPELINE)
      form.append('pipeline_subtype', look.sex)
      form.append('parameters', JSON.stringify(METAPERSON_PARAMETERS))
      form.append('export_parameters', JSON.stringify(exportParameters))
      const result = await callJson(
        { method: 'POST', url: `${base}/avatars/`, body: form, player: owner },
        signal,
      )
      if (!result.ok) return result
      const avatar = result.json as { code?: unknown; url?: unknown; exports?: unknown }
      const code = text(avatar.code)
      if (!code) return fail('upstream', 'avatar_unreadable')
      const url = text(avatar.url) || `${base}/avatars/${encodeURIComponent(code)}/`
      const exports = text(avatar.exports) || `${url.replace(/\/?$/, '/')}exports/`
      if (!sameOrigin(url) || !sameOrigin(exports)) return fail('upstream', 'foreign_url')
      return { ok: true, ref: { player: owner, avatar: code, url, exports } }
    },

    async poll(ref, signal): Promise<ServicePoll> {
      if (ref.file) return { ok: true, state: 'ready', ref }
      const result = await callJson(
        { method: 'GET', url: ref.url ?? '', player: ref.player, retry: true },
        signal,
      )
      if (!result.ok) return result
      const avatar = result.json as {
        status?: unknown
        progress?: unknown
        status_verbose?: { code?: unknown } | null
      }
      const status = text(avatar.status)
      if (FAILED.has(status)) {
        const verbose = avatar.status_verbose?.code
        const reason = status.toLowerCase().replace(/\W+/g, '_')
        return fail('failed', typeof verbose === 'number' ? `${reason}_${verbose}` : reason)
      }
      if (status !== DONE) {
        const progress = typeof avatar.progress === 'number' ? avatar.progress : 0
        return {
          ok: true,
          state: 'working',
          stage: IN_PROGRESS[status] ?? 'computing',
          progress: Math.min(100, Math.max(0, progress)),
          ref,
        }
      }

      const listed = await callJson(
        { method: 'GET', url: ref.exports ?? '', player: ref.player, retry: true },
        signal,
      )
      if (!listed.ok) return listed
      const raw = Array.isArray(listed.json)
        ? listed.json
        : (listed.json as { results?: unknown }).results
      const exports = (Array.isArray(raw) ? raw : []) as {
        code?: unknown
        created_on?: unknown
        status?: unknown
        files?: { identity?: unknown; file?: unknown }[]
      }[]
      const earliest = exports
        .slice()
        .sort((a, b) => text(a.created_on).localeCompare(text(b.created_on)))[0]
      const exportStatus = text(earliest?.status)
      if (!earliest || (exportStatus !== DONE && !FAILED.has(exportStatus))) {
        return { ok: true, state: 'working', stage: 'exporting', progress: 100, ref }
      }
      if (FAILED.has(exportStatus)) return fail('failed', 'export_failed')
      const file = text(
        (Array.isArray(earliest.files) ? earliest.files : []).find(
          (item) => item?.identity === 'avatar',
        )?.file,
      )
      if (!file) return fail('upstream', 'no_avatar_file')
      if (!sameOrigin(file)) return fail('upstream', 'foreign_url')

      // The service's own age estimate, where it gives one: a child is never kept.
      const info = await modelInfo(ref, signal)
      if (info?.age === 'child') return fail('blocked', 'model_info_child')
      return { ok: true, state: 'ready', ref: { ...ref, export: text(earliest.code), file } }
    },

    async download(ref, signal) {
      const result = await call(
        { method: 'GET', url: ref.file ?? '', player: ref.player, retry: true, accept: '*/*' },
        signal,
      )
      if (!result.ok) return result
      const body = result.response.body
      const bytes = body ? await readBodyCapped(body, MAX_DOWNLOAD_BYTES).catch(() => null) : null
      if (!bytes) return fail('upstream', signal.aborted ? 'aborted' : 'download')
      const glb = exportGlb(bytes)
      return glb ? { ok: true, glb } : fail('upstream', 'not_glb')
    },

    async remove(ref, signal) {
      const result = await call(
        { method: 'DELETE', url: ref.url ?? '', player: ref.player, retry: true },
        signal,
      )
      if (result.ok) {
        await result.response.body?.cancel().catch(() => {})
        return true
      }
      return result.code === 'gone'
    },
  }
}
