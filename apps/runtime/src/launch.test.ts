import { afterEach, describe, expect, test } from 'bun:test'
import {
  backoffDelay,
  chooseLaunchUrl,
  parsePlayUrl,
  planLaunch,
  resolveLaunchUrl,
  shouldRetryLoad,
  waitForServer,
  waitingPageUrl,
} from './launch.cjs'

const PLAY_URL = 'http://localhost:3002/play/1265aa1fbfeb'

describe('backoffDelay', () => {
  test('doubles from 250ms and caps at 2s', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(backoffDelay)).toEqual([
      250, 500, 1000, 2000, 2000, 2000, 2000,
    ])
  })
})

describe('parsePlayUrl', () => {
  test('splits a play URL into origin and scene id', () => {
    expect(parsePlayUrl(PLAY_URL)).toEqual({
      origin: 'http://localhost:3002',
      sceneId: '1265aa1fbfeb',
    })
  })

  test('ignores a trailing slash, query and hash', () => {
    expect(parsePlayUrl('https://studio.example.com/play/abc/?quality=high#cam')).toEqual({
      origin: 'https://studio.example.com',
      sceneId: 'abc',
    })
  })

  test('decodes an encoded scene id', () => {
    expect(parsePlayUrl('http://localhost:3002/play/my%20scene')?.sceneId).toBe('my scene')
  })

  test('has no scene id off the /play/:id route or for a malformed escape', () => {
    expect(parsePlayUrl('http://localhost:3002/dashboard')).toEqual({
      origin: 'http://localhost:3002',
      sceneId: null,
    })
    expect(parsePlayUrl('http://localhost:3002/play/abc/extra')?.sceneId).toBeNull()
    expect(parsePlayUrl('http://localhost:3002/play/%E0%A4%A')?.sceneId).toBeNull()
  })

  test('rejects non-http URLs and garbage', () => {
    expect(parsePlayUrl('file:///Users/me/play/abc')).toBeNull()
    expect(parsePlayUrl('not a url')).toBeNull()
    expect(parsePlayUrl(undefined)).toBeNull()
  })
})

describe('planLaunch', () => {
  test('a dev launch checks the editor server first', () => {
    expect(planLaunch(PLAY_URL, { packaged: false })).toEqual({
      url: PLAY_URL,
      origin: 'http://localhost:3002',
      sceneId: '1265aa1fbfeb',
    })
  })

  test('a packaged runtime loads its published URL directly', () => {
    const url = 'https://studio.example.com/play/abc'
    expect(planLaunch(url, { packaged: true })).toEqual({ url, origin: null, sceneId: null })
  })

  test('an unparseable URL is loaded as-is', () => {
    expect(planLaunch('nope', { packaged: false })).toEqual({
      url: 'nope',
      origin: null,
      sceneId: null,
    })
  })
})

describe('chooseLaunchUrl', () => {
  const plan = planLaunch(PLAY_URL, { packaged: false })

  test('a missing scene opens the dashboard', () => {
    expect(chooseLaunchUrl(plan, { serverUp: true, sceneStatus: 404 })).toEqual({
      url: 'http://localhost:3002/dashboard',
      reason: 'scene-missing',
    })
  })

  test('an existing or unverifiable scene opens the play URL', () => {
    for (const sceneStatus of [200, 403, 500, null]) {
      expect(chooseLaunchUrl(plan, { serverUp: true, sceneStatus })).toEqual({
        url: PLAY_URL,
        reason: null,
      })
    }
  })

  test('a server that never came up still gets the play URL', () => {
    expect(chooseLaunchUrl(plan, { serverUp: false, sceneStatus: null })).toEqual({
      url: PLAY_URL,
      reason: 'server-timeout',
    })
  })
})

describe('shouldRetryLoad', () => {
  test('retries a main-frame failure once', () => {
    expect(shouldRetryLoad({ errorCode: -102, isMainFrame: true, retried: false })).toBe(true)
    expect(shouldRetryLoad({ errorCode: -102, isMainFrame: true, retried: true })).toBe(false)
  })

  test('leaves superseded navigations and subframes alone', () => {
    expect(shouldRetryLoad({ errorCode: -3, isMainFrame: true, retried: false })).toBe(false)
    expect(shouldRetryLoad({ errorCode: -102, isMainFrame: false, retried: false })).toBe(false)
  })
})

describe('waitingPageUrl', () => {
  test('is a Korean HTML page naming the server', () => {
    const url = waitingPageUrl('http://localhost:3002')
    const prefix = 'data:text/html;charset=utf-8,'
    expect(url.startsWith(prefix)).toBe(true)
    const html = decodeURIComponent(url.slice(prefix.length))
    expect(html).toContain('<title>에디터 서버를 기다리는 중…</title>')
    expect(html).toContain('<p>에디터 서버를 기다리는 중…</p>')
    expect(html).toContain('http://localhost:3002')
  })
})

function fakeClock() {
  let time = 0
  const slept: number[] = []
  return {
    slept,
    now: () => time,
    sleep: async (ms: number) => {
      slept.push(ms)
      time += ms
    },
  }
}

describe('waitForServer', () => {
  test('polls /api/health with backoff until the server answers', async () => {
    const clock = fakeClock()
    const probed: string[] = []
    const up = await waitForServer('http://localhost:3002', {
      ...clock,
      probe: async (url: string) => {
        probed.push(url)
        return probed.length > 3 ? 200 : null
      },
    })
    expect(up).toBe(true)
    expect(clock.slept).toEqual([250, 500, 1000])
    expect(new Set(probed)).toEqual(new Set(['http://localhost:3002/api/health']))
    expect(probed).toHaveLength(4)
  })

  test('gives up before overrunning the timeout', async () => {
    const clock = fakeClock()
    const up = await waitForServer('http://localhost:3002', {
      ...clock,
      timeoutMs: 5000,
      probe: async () => null,
    })
    expect(up).toBe(false)
    expect(clock.slept).toEqual([250, 500, 1000, 2000])
  })

  test('counts any HTTP status as the server being up', async () => {
    const clock = fakeClock()
    expect(await waitForServer('http://x', { ...clock, probe: async () => 500 })).toBe(true)
    expect(clock.slept).toEqual([])
  })
})

describe('resolveLaunchUrl against a real server', () => {
  let server: ReturnType<typeof Bun.serve> | null = null
  afterEach(() => {
    server?.stop(true)
    server = null
  })

  const editor = (port: number) =>
    Bun.serve({
      port,
      fetch(request) {
        const { pathname } = new URL(request.url)
        if (pathname === '/api/health') return Response.json({ status: 'ok' })
        if (pathname === '/api/scenes/present') return Response.json({ id: 'present' })
        return Response.json({ error: 'not_found' }, { status: 404 })
      },
    })

  test('opens the dashboard when the configured scene is missing', async () => {
    server = editor(0)
    const origin = `http://localhost:${server.port}`
    const plan = planLaunch(`${origin}/play/1265aa1fbfeb`, { packaged: false })
    expect(await resolveLaunchUrl(plan)).toEqual({
      url: `${origin}/dashboard`,
      reason: 'scene-missing',
    })
  })

  test('waits for a server that starts late, then opens the scene', async () => {
    const probe = editor(0)
    const port = probe.port as number
    probe.stop(true)
    const origin = `http://localhost:${port}`
    const plan = planLaunch(`${origin}/play/present`, { packaged: false })
    const late = setTimeout(() => {
      server = editor(port)
    }, 600)
    try {
      expect(await resolveLaunchUrl(plan, { timeoutMs: 10_000 })).toEqual({
        url: `${origin}/play/present`,
        reason: null,
      })
    } finally {
      clearTimeout(late)
    }
  })

  test('reports a timeout when nothing ever listens', async () => {
    const probe = editor(0)
    const port = probe.port
    probe.stop(true)
    const plan = planLaunch(`http://localhost:${port}/play/present`, { packaged: false })
    expect(await resolveLaunchUrl(plan, { timeoutMs: 600 })).toEqual({
      url: plan.url,
      reason: 'server-timeout',
    })
  })
})
