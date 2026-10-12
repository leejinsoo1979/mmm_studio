import { type AiPhotoConfig, readAiPhotoConfig } from '../ai-photo/config'
import { sniffImage } from '../ai-photo/image-header'
import { moderateImages } from '../ai-photo/moderation'
import { readAiPhotoResponse } from '../ai-photo/provider'
import { readJobService, readPhotorealAiConfig } from './config'
import { inspectGlb, isHumanoidRig, KEPT_MORPH_TARGETS, prepareAvatarGlb, readGlb } from './glb'
import {
  buildExportParameters,
  createMetaPersonService,
  type MetaPersonService,
} from './metaperson'
import { portraitImage } from './portrait'
import { aiPortraitRequest } from './portrait-provider'
import { buildAiPortraitPrompt } from './prompt'
import type { AvatarPhoto, ServiceFetch, ServiceRef } from './service'
import { AI_PERSON_DEFAULTS, AI_PERSON_OUTFITS, AI_PERSON_SEXES } from './shared'
import { isZip, readZip } from './zip'

/**
 * The owner's check of the real services, run on their machine with their
 * keys (scripts/photoreal/check-avatar-service.ts is the command). It drives
 * the same adapter the app uses, records every exchange (status, timing,
 * the shape of each JSON answer, never its secrets), and lists where the
 * real answers differ from what the adapter was built from. Nothing billable
 * happens without `--yes`. The 3D check uploads only a portrait it has just
 * made itself through the app's own portrait step (a fictional adult): it
 * takes no photo file, so no real person's photo can be sent with it.
 */

type Env = Record<string, string | undefined>

export type CheckOptions = {
  env: Env
  fetch: ServiceFetch
  args: readonly string[]
  log: (line: string) => void
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** How long a build may take before the check gives up. */
  buildTimeoutMs?: number
}

type Exchange = {
  method: string
  path: string
  status: number
  ms: number
  type: string
  /** Sent with HTTP Basic credentials (the token request's second style). */
  basic: boolean
  shape?: string
  bytes?: Uint8Array<ArrayBuffer>
}

/** What the adapter was built from (see metaperson.ts), checked against the real answers. */
const EXPECTED_KEYS = {
  token: ['access_token', 'token_type', 'expires_in'],
  player: ['code'],
  avatar: ['code', 'status', 'progress', 'url', 'exports'],
  export: ['code', 'status', 'files', 'created_on'],
}
const KNOWN_STATUSES = new Set([
  'Pending',
  'Uploading',
  'Queued',
  'Preprocessing',
  'Computing',
  'Completed',
  'Failed',
  'Timed Out',
])
/** Joints of a MetaPerson export (metaperson-loader-threejs sample_avatar.glb) the 실사 retarget uses. */
const EXPECTED_JOINTS = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToeBase',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToeBase',
  'LeftEye',
  'RightEye',
]
const EXPECTED_MATERIALS = ['AvatarBody', 'AvatarHead', 'AvatarEyelashes']

const flag = (args: readonly string[], name: string) => args.includes(name)
function option(args: readonly string[], name: string): string | null {
  const at = args.indexOf(name)
  const value = at >= 0 ? args[at + 1] : undefined
  return value && !value.startsWith('--') ? value : null
}

/** The shape of a JSON answer: its keys and value types, arrays by length and first item. */
export function shapeOf(json: unknown, depth = 0): string {
  if (Array.isArray(json)) {
    return `[${json.length}${json.length ? ` × ${shapeOf(json[0], depth)}` : ''}]`
  }
  if (json && typeof json === 'object') {
    if (depth > 1) return '{…}'
    const entries = Object.entries(json).map(
      ([key, value]) => `${key}: ${value === null ? 'null' : shapeOf(value, depth + 1)}`,
    )
    return `{ ${entries.join(', ')} }`
  }
  return typeof json
}

/** A path with every code-like segment replaced, so no id or player code is printed. */
function plainPath(url: string): string {
  const { pathname } = new URL(url)
  return pathname
    .split('/')
    .map((part) => (/^[0-9a-f-]{8,}$|^[A-Za-z0-9_-]{20,}$/.test(part) ? '<id>' : part))
    .join('/')
}

export async function runAvatarServiceCheck(options: CheckOptions): Promise<number> {
  const { env, args } = options
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const secrets = new Set<string>()
  const log = (line = '') => {
    let safe = line
    for (const secret of secrets) if (secret.length >= 4) safe = safe.replaceAll(secret, '***')
    options.log(safe)
  }
  const diffs: string[] = []
  const oks: string[] = []
  const diff = (line: string) => {
    diffs.push(line)
    log(`  ✗ 다름: ${line}`)
  }
  const ok = (line: string) => {
    oks.push(line)
    log(`  ✓ ${line}`)
  }

  const exchanges: Exchange[] = []
  /** Every build status the service answered with, in order of first sight. */
  const statuses = new Set<string>()
  /** While downloading: the raw bytes of each successful answer that is not JSON. */
  let capturing = false
  const recording: ServiceFetch = async (url, init) => {
    const started = now()
    let response: Response
    try {
      response = await options.fetch(url, init)
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error'
      log(`    ${(init.method ?? 'GET').toUpperCase()} ${plainPath(url)} → 연결 실패 (${name})`)
      throw error
    }
    const type = response.headers.get('content-type') ?? ''
    const exchange: Exchange = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: plainPath(url),
      status: response.status,
      ms: now() - started,
      type,
      basic: /^Basic /.test(new Headers(init.headers).get('authorization') ?? ''),
    }
    if (/json/i.test(type)) {
      const json = await response
        .clone()
        .json()
        .catch(() => undefined)
      if (json && typeof json === 'object') {
        for (const key of ['access_token', 'refresh_token', 'code']) {
          const value = (json as Record<string, unknown>)[key]
          if (typeof value === 'string') secrets.add(value)
        }
        const status = (json as { status?: unknown }).status
        if (typeof status === 'string' && /^\/avatars\/<id>\/?$/.test(plainPath(url))) {
          statuses.add(status)
        }
      }
      exchange.shape = json === undefined ? '(JSON 아님)' : shapeOf(json)
    } else if (capturing && response.status === 200) {
      exchange.bytes = new Uint8Array(await response.clone().arrayBuffer())
    }
    exchanges.push(exchange)
    log(
      `    ${exchange.method} ${exchange.path} → ${exchange.status} (${exchange.ms} ms, ${type || '형식 없음'})${exchange.shape ? `\n      ${exchange.shape}` : ''}`,
    )
    return response
  }
  const lastShape = (path: RegExp) =>
    exchanges.filter((exchange) => path.test(exchange.path) && exchange.shape).at(-1)?.shape ?? ''
  const expectKeys = (what: string, shape: string, keys: string[]) => {
    const missing = keys.filter((key) => !shape.includes(`${key}:`))
    if (missing.length) diff(`${what} 응답에 ${missing.join(', ')} 없음 (받은 모양: ${shape})`)
    else ok(`${what} 응답 모양이 예상과 같아요`)
  }

  const command = args[0] && !args[0].startsWith('--') ? args[0] : 'service'
  if (command === 'portrait') return portraitCheck({ ...options, log, recording, now })

  log('== 3D 아바타 서비스 (Avatar SDK MetaPerson) 확인 ==')
  for (const key of [
    'AI_AVATAR_CLIENT_ID',
    'AI_AVATAR_CLIENT_SECRET',
    'AI_AVATAR_BASE_URL',
    'AI_AVATAR_PLAYER_UID',
  ]) {
    log(`  ${key}: ${env[key]?.trim() ? '설정됨' : '비어 있음'}`)
    const value = env[key]?.trim()
    if (value && key !== 'AI_AVATAR_BASE_URL') secrets.add(value)
  }
  const real = { ...env, AI_AVATAR_MOCK: undefined }
  const reached = readJobService(real, '', false)
  if (!reached) {
    log(
      '  설정이 모자라요. .env.local의 AI_AVATAR_CLIENT_ID / AI_AVATAR_CLIENT_SECRET (와 AI_AVATAR_BASE_URL)을 확인해 주세요.',
    )
    return 2
  }
  const config = readPhotorealAiConfig(real)
  if (!config.ok && config.part === 'portrait') {
    log(`  (AI 사진 설정은 꺼져 있어요: ${config.reason}. 3D 서비스만 확인해요.)`)
  }
  const adapter: MetaPersonService = createMetaPersonService({
    // The age answer is reported below rather than refused here.
    config: { ...reached.service, requireAgeCheck: false },
    fetch: recording,
    now,
    sleep: (ms) => sleep(ms),
  })
  const signal = () => AbortSignal.timeout(60_000)

  log('\n1) 토큰·플레이어·요금제 확인 (비용 없음)')
  for (const sex of AI_PERSON_SEXES) {
    const status = await adapter.pipelineAvailable(sex, signal())
    if (status === 200) ok(`metaperson_2.1 / ${sex}: 이 계정으로 만들 수 있어요`)
    else if (status === 400 || status === 402 || status === 403) {
      diff(
        `metaperson_2.1 / ${sex}: ${status} — 지금 요금제로는 만들 수 없어요 (Avatar SDK에 문의)`,
      )
    } else {
      diff(
        `metaperson_2.1 / ${sex}: 확인 실패 (${status ? `HTTP ${status}` : '토큰이나 플레이어 단계에서 멈춤, 위 기록 참고'})`,
      )
    }
  }
  const tokenShape = lastShape(/^\/o\/token\/?$/)
  if (!tokenShape) {
    diff('토큰을 받지 못했어요. Client ID / Secret과 "Client credentials" 방식을 확인해 주세요.')
    return finish()
  }
  expectKeys('토큰', tokenShape, EXPECTED_KEYS.token)
  if (exchanges.some((exchange) => exchange.basic && exchange.status === 200)) {
    diff('토큰: 폼 방식이 거절되고 HTTP Basic 방식으로 받았어요 (어댑터가 자동으로 맞춰요)')
  }
  if (!reached.service.playerUid)
    expectKeys('플레이어 등록', lastShape(/^\/players\/?$/), EXPECTED_KEYS.player)
  // The avatar list finds a build whose start went unanswered (by its name).
  const listed = await adapter.find('mmm-check-no-such-build', signal())
  if (listed.ok && listed.ref === null) ok('아바타 목록(GET /avatars/)을 읽을 수 있어요')
  else if (listed.ok) diff('아바타 목록에 없어야 할 이름이 있어요')
  else diff(`아바타 목록을 읽지 못했어요 (${listed.detail}): 답이 끊긴 만들기를 찾을 수 없어요`)

  log('\n2) 고를 수 있는 옷·헤어 (비용 없음)')
  for (const sex of AI_PERSON_SEXES) {
    const listed = await adapter.availableExportParameters(sex, signal())
    if (!listed.ok) {
      diff(`${sex} 내보내기 목록을 받지 못했어요 (${listed.detail})`)
      continue
    }
    const available = listed.available
    for (const [category, names] of Object.entries(available)) {
      log(
        `    ${sex} ${category} (${names.length}): ${names.slice(0, 12).join(', ')}${names.length > 12 ? ' …' : ''}`,
      )
    }
    if (!(available.haircuts ?? []).includes('HaircutGenerated')) {
      diff(`${sex}: haircuts에 HaircutGenerated(사진으로 만든 머리)가 없어요`)
    }
    if (!(available.blendshapes ?? []).includes('mobile_51')) {
      diff(`${sex}: blendshapes에 mobile_51(ARKit 표정)이 없어요 — 눈 깜빡임이 안 될 수 있어요`)
    }
    for (const outfit of AI_PERSON_OUTFITS) {
      const params = buildExportParameters(available, { ...AI_PERSON_DEFAULTS, sex, outfit })
      if (!params) {
        diff(`${sex} / ${outfit}: 입힐 옷을 고르지 못했어요 (옷 목록이 비어 있음)`)
        continue
      }
      const chosen = ['outfits', 'outfits_top', 'outfits_bottom', 'outfits_shoes']
        .map((key) => (params[key] as { list?: string[] } | undefined)?.list?.[0])
        .filter(Boolean)
      log(`    ${sex} / ${outfit} → ${chosen.join(' + ')}`)
    }
  }

  if (!flag(args, '--yes')) {
    log(
      '\n3) 실제 아바타 만들기는 건너뛰었어요. 아바타 1개 비용이 들어요: --yes 를 붙이면 만들어 봐요.',
    )
    return finish()
  }

  log('\n3) AI 인물 사진 1장과 아바타 1개 만들기 (사진 1장 비용 + 요금제 사용량 1개 차감)')
  const photo = await makePortrait()
  if (!photo) return finish()
  const started = now()
  const created = await adapter.create(
    { photo, look: { ...AI_PERSON_DEFAULTS, sex: photo.sex }, name: 'ai-person-check' },
    signal(),
  )
  if (!created.ok) {
    diff(`아바타 만들기 요청이 거절됐어요: ${created.code} (${created.detail})`)
    return finish()
  }
  expectKeys('아바타 만들기', lastShape(/^\/avatars\/?$/), EXPECTED_KEYS.avatar)
  let ref: ServiceRef = created.ref
  const deadline = now() + (options.buildTimeoutMs ?? 10 * 60_000)
  let ready = false
  while (now() < deadline) {
    const poll = await adapter.poll(ref, signal())
    if (!poll.ok) {
      diff(`만드는 중 실패: ${poll.code} (${poll.detail})`)
      break
    }
    if (poll.state === 'ready') {
      ref = poll.ref
      ready = true
      break
    }
    log(`    ${Math.round((now() - started) / 1000)}초: ${poll.stage} ${poll.progress}%`)
    ref = poll.ref
    await sleep(4000)
  }
  const unknown = [...statuses].filter((status) => !KNOWN_STATUSES.has(status))
  if (unknown.length) diff(`문서에 없는 상태 값: ${unknown.join(', ')}`)
  else if (statuses.size) ok(`상태 값: ${[...statuses].join(' → ')}`)
  if (!ready) {
    if (now() >= deadline) diff('10분 안에 끝나지 않았어요')
    await cleanup(ref)
    return finish()
  }
  ok(`완성까지 ${Math.round((now() - started) / 1000)}초`)
  expectKeys('내보내기 목록', lastShape(/\/exports\/?$/), EXPECTED_KEYS.export)

  const info = await adapter.modelInfo(ref, signal())
  if (info) {
    log(`    model_info: ${shapeOf(info)}`)
    if (info.age === 'not_child' || info.age === 'child') {
      ok(`model_info.age = ${info.age} (AI_AVATAR_REQUIRE_AGE_CHECK=true 로 켜도 돼요)`)
    } else {
      diff(
        'model_info에 age(child / not_child)가 없어요: 서비스의 나이 확인이 동작하지 않아요. AI_AVATAR_REQUIRE_AGE_CHECK는 켜지 말고 Avatar SDK에 문의해 주세요',
      )
    }
  } else diff('model_info를 받지 못했어요: 서비스의 나이 확인이 동작하지 않아요')

  capturing = true
  const download = await adapter.download(ref, AbortSignal.timeout(180_000))
  capturing = false
  const raw = exchanges.filter((exchange) => exchange.bytes).at(-1)?.bytes
  if (raw && isZip(raw)) {
    const names = readZip(raw, { maxEntryBytes: 1 })?.map((entry) => entry.name) ?? []
    log(`    ZIP 안의 파일: ${names.join(', ')}`)
    if (names.includes('avatar/model.glb')) ok('ZIP 안에 avatar/model.glb')
    else diff(`ZIP 안에 avatar/model.glb 없음 (${names.join(', ')})`)
  } else if (raw) diff('내려받은 파일이 ZIP이 아니라 GLB 그대로예요 (어댑터가 둘 다 받아요)')
  else diff('내려받은 파일의 원래 바이트를 기록하지 못했어요 (다운로드 응답 위 기록 참고)')
  if (!download.ok) {
    diff(`GLB 받기 실패: ${download.code} (${download.detail})`)
    await cleanup(ref)
    return finish()
  }
  checkGlb(download.glb)
  const out = option(args, '--out')
  if (out) {
    await options.writeFile(out, download.glb)
    log(`    받은 GLB를 저장했어요: ${out} (약관 확인 전에는 공유하지 마세요)`)
  }
  if (!flag(args, '--keep')) await cleanup(ref)
  return finish()

  /** A fictional adult's portrait made here and now through the app's portrait step. */
  async function makePortrait(): Promise<(AvatarPhoto & { sex: 'female' | 'male' }) | null> {
    const sex = option(args, '--sex') === 'male' ? 'male' : 'female'
    const photo = readAiPhotoConfig({ ...env, AI_PHOTO_FACE_ENABLED: undefined })
    if (!photo.ok) {
      diff(`AI 사진 설정이 꺼져 있어 확인용 인물 사진을 만들 수 없어요 (${photo.reason})`)
      return null
    }
    const made = await generatePortrait(photo.config, sex, recording)
    if (!made.ok) {
      diff(`확인용 인물 사진을 만들지 못했어요: ${made.detail}`)
      return null
    }
    ok('확인용 AI 인물 사진을 만들었어요 (가상의 성인)')
    return { ...made.image, sex }
  }

  async function cleanup(target: ServiceRef) {
    const removed = await adapter.remove(target, signal())
    if (removed) ok('서비스에 남은 아바타를 지웠어요')
    else diff('서비스의 아바타를 지우지 못했어요 (계정 화면에서 지워 주세요)')
  }

  function checkGlb(glb: Uint8Array<ArrayBuffer>) {
    const read = readGlb(glb)
    if (!read.ok) {
      diff(`GLB를 읽을 수 없어요: ${read.problem}`)
      return
    }
    const info = inspectGlb(read, glb.byteLength)
    log(
      `    GLB ${(glb.byteLength / 1e6).toFixed(1)} MB, 메시 ${info.meshes}, 삼각형 ${info.triangles}, 뼈 ${info.joints.length}, 표정 ${info.morphTargets.length}`,
    )
    log(
      `    루트: ${info.rootNodes.join(', ')} / 재질: ${info.materials.map((m) => `${m.name}(${m.alphaMode})`).join(', ')}`,
    )
    log(
      `    이미지: ${[...new Set(info.images.map((image) => image.mimeType))].join(', ')} / 확장: ${info.extensions.join(', ') || '없음'}`,
    )
    const missingJoints = EXPECTED_JOINTS.filter((name) => !info.joints.includes(name))
    if (missingJoints.length) diff(`예상한 뼈가 없어요: ${missingJoints.join(', ')}`)
    else ok('뼈 이름이 실사 리타겟 표(Mixamo식)와 맞아요')
    if (!isHumanoidRig(info.joints)) diff('사람 뼈대로 알아보지 못했어요')
    const blink = [...KEPT_MORPH_TARGETS].filter((name) => !info.morphTargets.includes(name))
    if (blink.length) diff(`눈 깜빡임 표정이 없어요: ${blink.join(', ')}`)
    else ok('eyeBlinkLeft / eyeBlinkRight 있음')
    const materials = info.materials.map((material) => material.name)
    const missingMaterials = EXPECTED_MATERIALS.filter((name) => !materials.includes(name))
    if (missingMaterials.length) diff(`예상한 재질 이름이 없어요: ${missingMaterials.join(', ')}`)
    const prepared = prepareAvatarGlb(glb)
    if (prepared.ok) {
      ok(
        `앱에 넣을 때 ${(prepared.bytes.byteLength / 1e6).toFixed(1)} MB (${prepared.trimmed ? '안 쓰는 표정 정리됨' : '압축 파일이라 그대로'})`,
      )
    } else diff(`앱이 이 GLB를 받지 않아요: ${prepared.problem}`)
  }

  function finish(): number {
    log('\n== 결과 ==')
    log(`  맞음 ${oks.length}개, 다름 ${diffs.length}개`)
    for (const line of diffs) log(`  - ${line}`)
    if (!diffs.length) log('  모두 어댑터가 기대한 것과 같아요.')
    log('  이 출력을 그대로 보내 주세요. 키·토큰은 *** 로 가려져 있어요.')
    return diffs.length ? 1 : 0
  }
}

/** One portrait from the default choices, checked and moderated as the app does. */
async function generatePortrait(
  config: AiPhotoConfig,
  sex: 'female' | 'male',
  fetch: ServiceFetch,
  extraParams: Record<string, string | number | boolean> = {},
): Promise<{ ok: true; image: AvatarPhoto } | { ok: false; detail: string }> {
  const { url, init } = aiPortraitRequest(config, {
    prompt: buildAiPortraitPrompt({ ...AI_PERSON_DEFAULTS, sex }),
    extraParams,
    user: null,
  })
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) })
  } catch {
    return { ok: false, detail: '연결 실패' }
  }
  const result = await readAiPhotoResponse(config.provider, response)
  if (!result.ok) return { ok: false, detail: `${result.code} (${result.detail ?? ''})` }
  const fits = portraitImage(result.bytes)
  if (!fits.ok) return { ok: false, detail: `3D 단계에 쓸 수 없는 사진 (${fits.detail})` }
  if (config.moderation) {
    const verdict = await moderateImages(config.moderation, [fits.image], {
      fetch,
      signal: AbortSignal.timeout(60_000),
    })
    if (verdict !== 'clear') return { ok: false, detail: `이미지 검사 ${verdict}` }
  }
  return { ok: true, image: fits.image }
}

/** The portrait step: one text-to-image request through the app's own modules. */
async function portraitCheck(
  options: CheckOptions & {
    log: (line?: string) => void
    recording: ServiceFetch
    now: () => number
  },
): Promise<number> {
  const { env, args, log } = options
  log('== AI 인물 사진 확인 ==')
  log('  고른 항목만 보내요 (자유 입력 없음): 실존 인물의 이름이나 설명은 보낼 수 없어요.')
  const photo = readAiPhotoConfig({ ...env, AI_PHOTO_FACE_ENABLED: undefined })
  if (!photo.ok) {
    log(`  AI 사진 설정이 꺼져 있어요: ${photo.reason}`)
    return 2
  }
  const config = photo.config
  const portraitConfig = readPhotorealAiConfig({ ...env, AI_AVATAR_MOCK: undefined })
  const extraParams = portraitConfig.ok ? portraitConfig.config.portraitExtraParams : {}
  log(
    `  프로토콜 ${config.provider}, 주소 ${new URL(config.baseUrl).host}, 검사 모델 ${config.moderation ? '있음' : '없음'}`,
  )
  if (!flag(args, '--yes')) {
    log('  사진 1장 비용이 들어요: --yes 를 붙이면 보내요.')
    return 0
  }
  const variants: { label: string; extra: Record<string, string | number | boolean> }[] = [
    { label: '기본', extra: extraParams },
  ]
  if (flag(args, '--probe-person-generation') && config.provider === 'gemini') {
    variants.push({
      label: 'personGeneration=ALLOW_ADULT',
      extra: { ...extraParams, personGeneration: 'ALLOW_ADULT' },
    })
  }
  let code = 0
  for (const variant of variants) {
    const started = options.now()
    const { url, init } = aiPortraitRequest(config, {
      prompt: buildAiPortraitPrompt(AI_PERSON_DEFAULTS),
      extraParams: variant.extra,
      user: null,
    })
    let response: Response
    try {
      response = await options.recording(url, { ...init, signal: AbortSignal.timeout(180_000) })
    } catch {
      log(`  ${variant.label}: 연결 실패`)
      code = 1
      continue
    }
    const result = await readAiPhotoResponse(config.provider, response)
    log(
      `  ${variant.label}: HTTP ${response.status}, ${options.now() - started} ms, 결과 ${result.ok ? 'ok' : `${result.code} (${result.detail ?? ''})`}`,
    )
    if (!result.ok) {
      code = 1
      continue
    }
    const header = sniffImage(result.bytes)
    const fits = portraitImage(result.bytes)
    log(
      `    ${header?.type} ${header?.width}×${header?.height}, ${(result.bytes.byteLength / 1e6).toFixed(2)} MB → ${fits.ok ? '3D 단계에 쓸 수 있어요' : `쓸 수 없어요 (${fits.detail})`}`,
    )
    if (!fits.ok) code = 1
    const out = option(args, '--out')
    if (out && variant.label === '기본') {
      await options.writeFile(out, result.bytes)
      log(`    저장: ${out}`)
    }
  }
  return code
}
