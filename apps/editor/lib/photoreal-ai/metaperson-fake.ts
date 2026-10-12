import { randomBytes } from 'node:crypto'
import { sniffImage } from '../ai-photo/image-header'
import { METAPERSON_BASE_URL } from './config'
import { METAPERSON_PIPELINE } from './metaperson'
import type { ServiceFetch } from './service'
import { writeZip } from './zip'

/**
 * The MetaPerson cloud API answered in-process, for the 목업
 * (`AI_AVATAR_MOCK=true`) and the tests: the real adapter runs against it
 * unchanged. It checks what the real service needs (credentials, the bearer
 * token, the player, a JPEG/PNG photo, the pipeline, export parameters that
 * ask for a clothed GLB with embedded textures) and answers in the shapes
 * the vendor's clients read (see metaperson.ts): `model_info` carries the age
 * only when the computation parameters asked for it, and the account's
 * builds are listed newest first, a page at a time. Builds move through
 * Uploading → Queued → Computing → Completed with the clock. Codes, names and
 * timings are made up; nothing here is a recording.
 */

export type MetaPersonFakeOptions = {
  /** The avatar handed back (inside a ZIP as `avatar/model.glb`, unless `zip` is false). */
  glb: () => Uint8Array | Promise<Uint8Array>
  now?: () => number
  clientId?: string
  clientSecret?: string
  /** From creation to Completed. */
  buildMs?: number
  /** From Completed to a finished export. */
  exportMs?: number
  /** `failed`: the build ends Failed (no face found, say). */
  outcome?: 'completed' | 'failed'
  /** What `model_info` says about age (when it was asked for). */
  age?: 'child' | 'not_child'
  /** Builds per page of `GET /avatars/`. */
  pageSize?: number
  zip?: boolean
  tokenTtlS?: number
  /** Answers one call differently (a test's failure); undefined lets the fake answer. */
  override?: (call: FakeCall) => Response | undefined | Promise<Response | undefined>
}

export type FakeCall = { method: string; path: string; init: RequestInit }

type FakeAvatar = {
  code: string
  player: string
  name: string
  subtype: string
  createdAt: number
  parameters: Record<string, unknown>
  exportParameters: Record<string, unknown>
}

/** Made-up outfit names in the shape the service lists them. */
export const FAKE_OUTFITS = {
  female: ['fake_casual_tshirt', 'fake_knit_sweater', 'fake_business_suit', 'fake_sport_track'],
  male: ['fake_casual_tshirt', 'fake_business_suit', 'fake_hoodie', 'fake_work_overall'],
} as const

const json = (body: unknown, status = 200) => Response.json(body, { status })
const detail = (message: string, status: number) => json({ detail: message }, status)

export function createMetaPersonFake(options: MetaPersonFakeOptions) {
  const now = options.now ?? Date.now
  const clientId = options.clientId ?? 'mock-client'
  const clientSecret = options.clientSecret ?? 'mock-secret'
  const buildMs = options.buildMs ?? 8000
  const exportMs = options.exportMs ?? 1500
  const tokens = new Map<string, number>()
  const players = new Set<string>()
  const avatars = new Map<string, FakeAvatar>()
  const calls: { method: string; path: string; status: number }[] = []
  const base = METAPERSON_BASE_URL
  const code = () => randomBytes(8).toString('hex')

  function avatarJson(avatar: FakeAvatar) {
    const age = now() - avatar.createdAt
    const url = `${base}/avatars/${avatar.code}/`
    const done = age >= buildMs
    const failed = done && options.outcome === 'failed'
    const status = failed
      ? 'Failed'
      : done
        ? 'Completed'
        : age < 500
          ? 'Uploading'
          : age < 1500
            ? 'Queued'
            : 'Computing'
    return {
      code: avatar.code,
      status,
      status_verbose: failed ? { code: 7, message: 'Face not found' } : null,
      progress: done ? 100 : status === 'Computing' ? Math.round((age / buildMs) * 100) : 0,
      name: avatar.name,
      description: '',
      created_on: new Date(avatar.createdAt).toISOString(),
      pipeline: METAPERSON_PIPELINE,
      url,
      thumbnail: `${url}thumbnail/`,
      mesh: '',
      texture: '',
      preview: `${url}preview/`,
      haircuts: '',
      blendshapes: '',
      exports: `${url}exports/`,
    }
  }

  function exportJson(avatar: FakeAvatar) {
    const ready = now() - avatar.createdAt >= buildMs + exportMs
    const url = `${base}/avatars/${avatar.code}/exports/e-${avatar.code}/`
    return {
      avatar_code: avatar.code,
      code: `e-${avatar.code}`,
      created_on: new Date(avatar.createdAt + buildMs).toISOString(),
      status: ready ? 'Completed' : 'Computing',
      url,
      files: ready
        ? [{ file: `${url}files/avatar/file/`, identity: 'avatar', category: '', static_files: [] }]
        : [],
      public_file: '',
      comment: '',
    }
  }

  function availableExport(subtype: string) {
    const outfits = subtype === 'male' ? FAKE_OUTFITS.male : FAKE_OUTFITS.female
    return {
      blendshapes: { list: ['mobile_51', 'visemes_15'] },
      haircuts: {
        list: ['HaircutGenerated', 'fake_haircut_short'],
        textures: ['Color', 'Normal', 'AO', 'GltfMetallicRoughness'],
      },
      outfits: { list: [...outfits], textures: ['Color', 'Normal', 'GltfMetallicRoughness'] },
      glasses: ['fake_glasses'],
    }
  }

  /** Why an export request can't be met, or null. */
  function exportProblem(raw: string, subtype: string): string | null {
    let parameters: Record<string, unknown>
    try {
      parameters = JSON.parse(raw)
    } catch {
      return 'export_parameters is not JSON'
    }
    if (parameters.format !== 'glb') return 'format'
    const textures = parameters.textures as { embed?: unknown } | undefined
    if (textures?.embed !== true) return 'textures.embed'
    const listed = availableExport(subtype).outfits.list as readonly string[]
    const outfits = (parameters.outfits as { list?: unknown } | undefined)?.list
    if (!Array.isArray(outfits) || outfits.length === 0) return 'outfits'
    if (outfits.some((name) => !listed.includes(name))) return 'unknown outfit'
    return null
  }

  async function answer(method: string, url: URL, init: RequestInit): Promise<Response> {
    const path = url.pathname
    const headers = new Headers(init.headers)

    if (method === 'POST' && path === '/o/token/') {
      const form = new URLSearchParams(String(init.body ?? ''))
      const basic = headers.get('authorization')?.match(/^Basic (.+)$/)?.[1]
      const [id, secret] = basic
        ? Buffer.from(basic, 'base64').toString().split(':')
        : [form.get('client_id'), form.get('client_secret')]
      if (form.get('grant_type') !== 'client_credentials') {
        return json({ error: 'unsupported_grant_type' }, 400)
      }
      if (id !== clientId || secret !== clientSecret) return json({ error: 'invalid_client' }, 401)
      const access = code()
      const ttl = options.tokenTtlS ?? 36000
      tokens.set(access, now() + ttl * 1000)
      return json({
        access_token: access,
        token_type: 'Bearer',
        expires_in: ttl,
        scope: 'read write',
      })
    }

    const bearer = headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
    const expires = bearer ? tokens.get(bearer) : undefined
    if (!expires || expires <= now()) {
      return detail('Authentication credentials were not provided.', 401)
    }

    if (method === 'POST' && path === '/players/') {
      const player = code()
      players.add(player)
      return json(
        {
          url: `${base}/players/${player}/`,
          code: player,
          created_on: new Date(now()).toISOString(),
          comment: '',
        },
        201,
      )
    }

    const player = headers.get('x-playeruid') ?? ''
    if (!players.has(player)) return detail('Unknown player.', 400)

    const available = path.match(/^\/(parameters|export_parameters)\/available\/([^/]+)\/$/)
    if (method === 'GET' && available) {
      const subtype = url.searchParams.get('pipeline_subtype') ?? ''
      if (available[2] !== METAPERSON_PIPELINE || !['male', 'female'].includes(subtype)) {
        return detail('Pipeline is not available.', 400)
      }
      return available[1] === 'parameters'
        ? json({ avatar_modifications: { base: ['remove_smile', 'remove_glasses'] } })
        : json(availableExport(subtype))
    }

    if (method === 'POST' && path === '/avatars/') {
      let form: FormData
      try {
        form = await new Response(init.body as BodyInit, { headers }).formData()
      } catch {
        return detail('Multipart body expected.', 400)
      }
      const photo = form.get('photo')
      const subtype = String(form.get('pipeline_subtype') ?? '')
      if (!(photo instanceof Blob)) return json({ photo: ['This field is required.'] }, 400)
      const header = sniffImage(new Uint8Array(await photo.arrayBuffer()))
      if (!header || header.type === 'image/webp') {
        return json({ photo: ['Unsupported image.'] }, 400)
      }
      if (form.get('pipeline') !== METAPERSON_PIPELINE || !['male', 'female'].includes(subtype)) {
        return json({ pipeline: ['Invalid pipeline.'] }, 400)
      }
      let parameters: Record<string, unknown>
      try {
        parameters = JSON.parse(String(form.get('parameters') ?? ''))
      } catch {
        return json({ parameters: ['Invalid JSON.'] }, 400)
      }
      const exportRaw = String(form.get('export_parameters') ?? '')
      const problem = exportProblem(exportRaw, subtype)
      if (problem) return json({ export_parameters: [problem] }, 400)
      const avatar: FakeAvatar = {
        code: code(),
        player,
        name: String(form.get('name') ?? ''),
        subtype,
        createdAt: now(),
        parameters,
        exportParameters: JSON.parse(exportRaw),
      }
      avatars.set(avatar.code, avatar)
      return json(avatarJson(avatar), 201)
    }

    if (method === 'GET' && path === '/avatars/') {
      const size = options.pageSize ?? 20
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
      const own = [...avatars.values()]
        .filter((avatar) => avatar.player === player)
        .sort((a, b) => b.createdAt - a.createdAt)
      const items = own.slice((page - 1) * size, page * size).map(avatarJson)
      const more = page * size < own.length
      return new Response(JSON.stringify(items), {
        headers: {
          'content-type': 'application/json',
          ...(more ? { link: `<${base}/avatars/?page=${page + 1}>; rel="next"` } : {}),
        },
      })
    }

    const match = path.match(/^\/avatars\/([^/]+)\/(.*)$/)
    const avatar = match ? avatars.get(match[1]!) : undefined
    if (!match || !avatar || avatar.player !== player) return detail('Not found.', 404)
    const rest = match[2]
    if (method === 'GET' && rest === '') return json(avatarJson(avatar))
    if (method === 'DELETE' && rest === '') {
      avatars.delete(avatar.code)
      return new Response(null, { status: 204 })
    }
    if (method === 'GET' && rest === 'exports/') {
      return json(now() - avatar.createdAt >= buildMs ? [exportJson(avatar)] : [])
    }
    if (method === 'GET' && rest === 'model_info/') {
      const asked = avatar.parameters.model_info
      const age = Array.isArray(asked) && asked.includes('age')
      return json({
        pipeline: METAPERSON_PIPELINE,
        pipeline_subtype: avatar.subtype,
        ...(age ? { age: options.age ?? 'not_child', age_confidence: 0.97 } : {}),
      })
    }
    if (method === 'GET' && rest === `exports/e-${avatar.code}/files/avatar/file/`) {
      if (exportJson(avatar).status !== 'Completed') return detail('Not ready.', 404)
      const glb = await options.glb()
      if (options.zip === false) {
        return new Response(new Uint8Array(glb), {
          headers: { 'content-type': 'model/gltf-binary' },
        })
      }
      return new Response(writeZip([{ name: 'avatar/model.glb', bytes: glb }]), {
        headers: { 'content-type': 'application/zip' },
      })
    }
    return detail('Not found.', 404)
  }

  const fetch: ServiceFetch = async (input, init) => {
    const url = new URL(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const signal = init.signal
    if (signal?.aborted) throw signal.reason
    const overridden = await options.override?.({ method, path: url.pathname, init })
    const response =
      overridden ??
      (url.origin === new URL(base).origin
        ? await answer(method, url, init)
        : detail('Unknown host.', 404))
    calls.push({ method, path: url.pathname, status: response.status })
    return response
  }

  return { fetch, avatars, calls }
}
