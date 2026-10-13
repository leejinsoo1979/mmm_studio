// The bench's browser: its own X display, a static server for the page and the repo's assets, and
// Chromium driven over a plain CDP connection (Playwright's CDP client does not run under Bun).
// Only processes this module started are ever stopped (by PID).
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

export type BenchPorts = { display: number; cdp: number; http: number }

export const PORTS: BenchPorts = {
  display: Number(process.env.BENCH_DISPLAY ?? 75),
  cdp: Number(process.env.BENCH_CDP ?? 9375),
  http: Number(process.env.BENCH_HTTP ?? 8075),
}

/** Chromium: BENCH_CHROME, else Playwright's. */
const CHROME = process.env.BENCH_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
/** Software WebGPU (no GPU here); BENCH_GPU=1 uses the machine's GPU instead. */
const SOFTWARE = [
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--disable-vulkan-surface',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
]

const started: ChildProcess[] = []

process.on('exit', () => {
  for (const child of started) if (child.exitCode === null) child.kill()
})

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** An X display for Chromium (Linux): Xvfb on `display` unless one is already there. */
export async function startDisplay(display: number) {
  if (process.platform !== 'linux' || existsSync(`/tmp/.X11-unix/X${display}`)) return
  const child = spawn('Xvfb', [`:${display}`, '-screen', '0', '1280x900x24'], { stdio: 'ignore' })
  started.push(child)
  for (let i = 0; i < 50 && !existsSync(`/tmp/.X11-unix/X${display}`); i++) await sleep(100)
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

/** Serves the page (`dist`), three, the app's characters and MediaPipe files, and the bench's cache (/heads). */
export function startServer(port: number, repo: string, dist: string, cache: string) {
  const roots: [string, string][] = [
    ['/three/', join(repo, 'node_modules/three')],
    ['/characters/', join(repo, 'apps/editor/public/characters')],
    ['/mediapipe/', join(repo, 'apps/editor/public/mediapipe')],
    ['/heads/', cache],
    ['/', dist],
  ]
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname)
      for (const [prefix, root] of roots) {
        if (!path.startsWith(prefix)) continue
        const file = normalize(join(root, path.slice(prefix.length) || 'index.html'))
        if (!file.startsWith(normalize(root))) return new Response('no', { status: 403 })
        if (!existsSync(file) || !statSync(file).isFile())
          return new Response('not found', { status: 404 })
        return new Response(Bun.file(file), {
          headers: {
            'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
            'cache-control': 'no-store',
          },
        })
      }
      return new Response('not found', { status: 404 })
    },
  })
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

/** A CDP connection to one page, with the workers it starts attached (flattened sessions). */
class Cdp {
  private next = 1
  private readonly pending = new Map<number, Pending>()
  private readonly listeners: ((method: string, params: any, session?: string) => void)[] = []

  constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id !== undefined) {
        const waiting = this.pending.get(message.id)
        if (!waiting) return
        this.pending.delete(message.id)
        if (message.error) waiting.reject(new Error(message.error.message))
        else waiting.resolve(message.result)
        return
      }
      for (const listener of this.listeners) listener(message.method, message.params, message.sessionId)
    }
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.next++
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  on(listener: (method: string, params: any, session?: string) => void) {
    this.listeners.push(listener)
  }

  close() {
    this.socket.close()
  }
}

export type Request = { method: string; url: string; postBytes: number; type: string; from: 'page' | 'worker' }

export type Chrome = {
  process: ChildProcess
  cdp: Cdp
  logs: string[]
  requests: Request[]
}

/** Chromium on the display, CDP on `ports.cdp`; `fakeVideo` plays a clip (.mjpeg or .y4m) as its camera. */
export async function startChrome(ports: BenchPorts, profile: string, fakeVideo?: string): Promise<Chrome> {
  mkdirSync(profile, { recursive: true })
  const args = [
    ...(process.env.BENCH_GPU ? [] : SOFTWARE),
    '--no-proxy-server',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${ports.cdp}`,
    `--user-data-dir=${profile}`,
    '--window-size=1200,800',
    ...(fakeVideo
      ? [
          '--use-fake-device-for-media-stream',
          '--use-fake-ui-for-media-stream',
          `--use-file-for-fake-video-capture=${fakeVideo}`,
        ]
      : []),
    'about:blank',
  ]
  const child = spawn(CHROME, args, {
    env: { ...process.env, DISPLAY: `:${ports.display}` },
    stdio: 'ignore',
  })
  started.push(child)
  type Target = { type: string; webSocketDebuggerUrl: string }
  let target: Target | undefined
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500)
    try {
      const list = (await (await fetch(`http://127.0.0.1:${ports.cdp}/json/list`)).json()) as Target[]
      target = list.find((t) => t.type === 'page')
    } catch {}
  }
  if (!target) throw new Error('Chromium did not start')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  const cdp = new Cdp(socket)
  const logs: string[] = []
  const requests: Request[] = []
  cdp.on((method, params, session) => {
    if (method === 'Runtime.consoleAPICalled')
      logs.push(`[${params.type}] ${params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' ')}`)
    else if (method === 'Runtime.exceptionThrown') logs.push(`[exception] ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`)
    else if (method === 'Network.requestWillBeSent')
      requests.push({
        method: params.request.method,
        url: params.request.url,
        postBytes: params.request.postData?.length ?? (params.request.hasPostData ? -1 : 0),
        type: params.type ?? '',
        from: session ? 'worker' : 'page',
      })
    else if (method === 'Target.attachedToTarget') {
      const id = params.sessionId as string
      void cdp.send('Network.enable', {}, id).catch(() => {})
      void cdp.send('Runtime.enable', {}, id).catch(() => {})
      void cdp.send('Runtime.runIfWaitingForDebugger', {}, id).catch(() => {})
    }
  })
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Page.enable')
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false })
  return { process: child, cdp, logs, requests }
}

export async function stopChrome(chrome: Chrome) {
  try {
    await Promise.race([chrome.cdp.send('Browser.close'), sleep(2000)])
  } catch {}
  chrome.cdp.close()
  for (let i = 0; i < 30 && chrome.process.exitCode === null; i++) await sleep(100)
  if (chrome.process.exitCode === null) chrome.process.kill()
}

async function evaluate(chrome: Chrome, expression: string): Promise<any> {
  const result = await chrome.cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    const d = result.exceptionDetails
    throw new Error(d.exception?.description ?? d.text ?? 'evaluation failed')
  }
  return result.result.value
}

/** The bench page opened and initialised; `call(name, ...args)` runs `window.bench[name](...args)` and returns its value. */
export async function openBench(chrome: Chrome, port: number) {
  await chrome.cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?${Date.now()}` })
  for (let i = 0; ; i++) {
    await sleep(500)
    const state = await evaluate(chrome, '[window.ready === true, window.loadError ?? null]').catch(() => [false, null])
    if (state[1]) throw new Error(state[1])
    if (state[0]) break
    if (i > 240) throw new Error('the bench page did not load')
  }
  return <T = any>(name: string, ...args: unknown[]): Promise<T> =>
    evaluate(chrome, `window.bench[${JSON.stringify(name)}](...${JSON.stringify(args)})`)
}

export type Call = Awaited<ReturnType<typeof openBench>>
