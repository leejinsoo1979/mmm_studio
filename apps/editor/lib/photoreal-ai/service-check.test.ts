import { describe, expect, test } from 'bun:test'
import { base64Of, jpeg } from '../ai-photo/test-images'
import { createMetaPersonFake, type FakeCall } from './metaperson-fake'
import { runAvatarServiceCheck, shapeOf } from './service-check'
import { testAvatarGlb } from './test-glb'
import { writeZip } from './zip'

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
    /** Answers for a storage host the file download is sent on to. */
    storage?: () => Response
    env?: Record<string, string | undefined>
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
  const images: string[] = []
  const done = runAvatarServiceCheck({
    env: { ...ENV, ...options.env },
    args,
    fetch: async (url, init) => {
      if (url.startsWith('https://storage.example.com/') && options.storage) {
        return options.storage()
      }
      if (!url.includes('avatarsdk.com')) {
        images.push(url)
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
    writeFile: async (path, bytes) => {
      written.set(path, bytes)
    },
    now,
    sleep: async (ms) => {
      t += ms
    },
  })
  return { done, lines, written, fake, images }
}

describe('runAvatarServiceCheck', () => {
  test('without --yes: credentials, plan and the clothing lists, nothing billable', async () => {
    const { done, lines, fake } = run([])
    expect(await done).toBe(0)
    const output = lines.join('\n')
    expect(output).toContain('metaperson_2.1 / female: 이 계정으로 만들 수 있어요')
    expect(output).toContain('female / suit → fake_business_suit')
    expect(output).toContain('아바타 목록(GET /avatars/)을 읽을 수 있어요')
    expect(output).toContain('--yes')
    expect(fake.calls.some((call) => call.method === 'POST' && call.path === '/avatars/')).toBe(
      false,
    )
    expect(output).not.toContain(ENV.AI_AVATAR_CLIENT_SECRET)
    expect(output).not.toContain(ENV.AI_AVATAR_CLIENT_ID)
  })

  test('with --yes: a portrait made here, one avatar built from it, checked, saved and deleted, with no secret printed', async () => {
    const { done, lines, written, fake, images } = run(['service', '--yes', '--out', 'check.glb'])
    const code = await done
    const output = lines.join('\n')
    // The photo sent is the one just made through the app's portrait step: no file is read.
    expect(images).toEqual(['https://api.openai.com/v1/images/generations'])
    expect(output).toContain('확인용 AI 인물 사진을 만들었어요')
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
    const { done, lines } = run(['service', '--yes'], {
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

  test('service --yes takes no photo file, and builds nothing without the portrait step', async () => {
    const { done, lines, fake, images } = run(['service', '--yes', '--portrait', 'someone.jpg'], {
      env: { AI_PHOTO_PROVIDER: undefined },
    })
    expect(await done).toBe(1)
    expect(lines.join('\n')).toContain('확인용 인물 사진을 만들 수 없어요')
    expect(images).toEqual([])
    expect(fake.calls.some((call) => call.method === 'POST' && call.path === '/avatars/')).toBe(
      false,
    )
  })

  test('the downloaded file is examined even when it is served from storage elsewhere', async () => {
    const { done, lines } = run(['service', '--yes'], {
      override: ({ path }) =>
        path.endsWith('/files/avatar/file/')
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://storage.example.com/model.zip?sig=1' },
            })
          : undefined,
      storage: () => new Response(writeZip([{ name: 'avatar/model.glb', bytes: testAvatarGlb() }])),
    })
    await done
    expect(lines.join('\n')).toContain('ZIP 안에 avatar/model.glb')
  })

  test('portrait: only the fixed choices, then one request through the app’s modules', async () => {
    const dry = run(['portrait'])
    expect(await dry.done).toBe(0)
    expect(dry.lines.join('\n')).toContain('고른 항목만 보내요')
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
