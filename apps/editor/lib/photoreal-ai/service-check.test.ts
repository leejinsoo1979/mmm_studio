import { describe, expect, test } from 'bun:test'
import { base64Of, jpeg } from '../ai-photo/test-images'
import { createMetaPersonFake, type FakeCall } from './metaperson-fake'
import { runAvatarServiceCheck, shapeOf } from './service-check'
import { testAvatarGlb } from './test-glb'

const ENV = {
  AI_AVATAR_CLIENT_ID: 'check-client-id',
  AI_AVATAR_CLIENT_SECRET: 'check-client-secret',
  AI_PHOTO_PROVIDER: 'openai',
  AI_PHOTO_MODEL: 'test-image-model',
  AI_PHOTO_API_KEY: 'image-api-key',
}

function run(
  args: string[],
  options: {
    override?: (call: FakeCall) => Response | undefined
    /** Rewrites a JSON answer of the fake, by path. */
    edit?: (path: string, json: Record<string, unknown>) => Record<string, unknown>
    image?: () => Response
  } = {},
) {
  let t = 5_000_000
  const now = () => t
  const fake = createMetaPersonFake({
    glb: () => testAvatarGlb(),
    now,
    clientId: ENV.AI_AVATAR_CLIENT_ID,
    clientSecret: ENV.AI_AVATAR_CLIENT_SECRET,
    buildMs: 9000,
    exportMs: 1000,
    override: options.override,
  })
  const lines: string[] = []
  const written = new Map<string, Uint8Array>()
  const done = runAvatarServiceCheck({
    env: ENV,
    args,
    fetch: async (url, init) => {
      if (!url.includes('avatarsdk.com')) {
        return (
          options.image?.() ?? Response.json({ data: [{ b64_json: base64Of(jpeg(1024, 1024)) }] })
        )
      }
      const response = await fake.fetch(url, init)
      if (!options.edit || !response.headers.get('content-type')?.includes('json')) return response
      const json = await response.json()
      return Response.json(options.edit(new URL(url).pathname, json), { status: response.status })
    },
    log: (line) => lines.push(line),
    readFile: async () => jpeg(1024, 1024),
    writeFile: async (path, bytes) => {
      written.set(path, bytes)
    },
    now,
    sleep: async (ms) => {
      t += ms
    },
  })
  return { done, lines, written, fake }
}

describe('runAvatarServiceCheck', () => {
  test('without --yes: credentials, plan and the clothing lists, nothing billable', async () => {
    const { done, lines, fake } = run([])
    expect(await done).toBe(0)
    const output = lines.join('\n')
    expect(output).toContain('metaperson_2.1 / female: 이 계정으로 만들 수 있어요')
    expect(output).toContain('female / suit → fake_business_suit')
    expect(output).toContain('--yes')
    expect(fake.calls.some((call) => call.path === '/avatars/')).toBe(false)
    expect(output).not.toContain(ENV.AI_AVATAR_CLIENT_SECRET)
    expect(output).not.toContain(ENV.AI_AVATAR_CLIENT_ID)
  })

  test('with --yes: one avatar built, checked, saved and deleted, with no secret printed', async () => {
    const { done, lines, written, fake } = run([
      'service',
      '--yes',
      '--portrait',
      'portrait.jpg',
      '--out',
      'check.glb',
    ])
    const code = await done
    const output = lines.join('\n')
    expect(output).toContain('ZIP 안에 avatar/model.glb')
    expect(output).toContain('eyeBlinkLeft / eyeBlinkRight 있음')
    expect(output).toContain('model_info.age = not_child')
    expect(output).toContain('서비스에 남은 아바타를 지웠어요')
    expect(written.get('check.glb')?.byteLength).toBeGreaterThan(0)
    expect(fake.avatars.size).toBe(0)
    // The tiny test GLB lacks most MetaPerson joints and materials: those are reported.
    expect(code).toBe(1)
    expect(output).toContain('예상한 뼈가 없어요')
    for (const secret of [ENV.AI_AVATAR_CLIENT_SECRET, ENV.AI_AVATAR_CLIENT_ID]) {
      expect(output).not.toContain(secret)
    }
    for (const call of fake.calls) expect(output).not.toMatch(/\/avatars\/[0-9a-f]{16}\//)
    expect(output).not.toMatch(/Bearer [0-9a-f]+/)
  })

  test('reports where the service answers differently', async () => {
    let token = ''
    const { done, lines } = run(['service', '--yes', '--portrait', 'p.jpg'], {
      override: ({ method, path }) =>
        method === 'GET' && path.startsWith('/parameters/available/')
          ? Response.json({ detail: 'Not in your plan.' }, { status: 400 })
          : undefined,
      edit: (path, json) => {
        if (path === '/o/token/') {
          token = String(json.access_token)
          const { expires_in: _gone, ...rest } = json
          return rest
        }
        if (/^\/avatars\/[^/]+\/$/.test(path) && json.status === 'Computing') {
          return { ...json, status: 'Rendering' }
        }
        return json
      },
    })
    expect(await done).toBe(1)
    const output = lines.join('\n')
    expect(output).toContain('토큰 응답에 expires_in 없음')
    expect(output).toContain('지금 요금제로는 만들 수 없어요')
    expect(output).toContain('문서에 없는 상태 값: Rendering')
    expect(token.length).toBeGreaterThan(4)
    expect(output).not.toContain(token)
  })

  test('portrait: refuses a real name locally, then one request through the app’s modules', async () => {
    const dry = run(['portrait'])
    expect(await dry.done).toBe(0)
    expect(dry.lines.join('\n')).toContain('서버에 보내기 전에 거절 (name_not_allowed)')
    const real = run(['portrait', '--yes', '--out', 'p.jpg'])
    expect(await real.done).toBe(0)
    expect(real.lines.join('\n')).toContain('3D 단계에 쓸 수 있어요')
    expect(real.written.has('p.jpg')).toBe(true)
    const small = run(['portrait', '--yes'], {
      image: () => Response.json({ data: [{ b64_json: base64Of(jpeg(512, 512)) }] }),
    })
    expect(await small.done).toBe(1)
  })
})

describe('shapeOf', () => {
  test('keys and types, arrays by length, never values', () => {
    expect(shapeOf({ access_token: 'secret', expires_in: 3600, files: [{ file: 'u' }] })).toBe(
      '{ access_token: string, expires_in: number, files: [1 × { file: string }] }',
    )
  })
})
