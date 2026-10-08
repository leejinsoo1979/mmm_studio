import { afterAll, afterEach, expect, test } from 'bun:test'
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Stands in for `next dev`: forks a server child and, like next-dev.js, ignores that child dying
// by a signal, so the parent then exits 0 on its own (or, with --linger, stays alive).
const FAKE_NEXT_DEV = `
import { fork } from 'node:child_process'
console.log('NEXT_DEV_PID=' + process.pid)
const port = process.argv[process.argv.indexOf('--port') + 1]
const server = fork(new URL('./fake-server.mjs', import.meta.url).pathname, [port])
server.on('exit', (code, signal) => { if (!signal) process.exit(code ?? 0) })
if (process.argv.includes('--linger')) setInterval(() => {}, 1000)
for (const name of ['SIGINT', 'SIGTERM']) {
  process.on(name, () => {
    if (server.exitCode !== null || server.signalCode !== null) process.exit(0)
    server.kill(name)
    server.once('exit', () => process.exit(0))
  })
}
`
// SIGUSR2 closes the listener but keeps the process alive. While the routes-missing file holds a
// count above zero, the scene events route answers like Turbopack's broken restart: an HTML 404.
const FAKE_SERVER = `
import http from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
const missing = new URL('./routes-missing', import.meta.url).pathname
const server = http.createServer((req, res) => {
  if (!/^\\/api\\/scenes\\/[^/]+\\/events$/.test(req.url)) return res.end('ok')
  const left = existsSync(missing) ? Number(readFileSync(missing, 'utf8')) : 0
  if (left > 0) {
    writeFileSync(missing, String(left - 1))
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    return res.end('<!DOCTYPE html><title>404: This page could not be found.</title>')
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{"error":"not_found"}')
}).listen(Number(process.argv[2]), '127.0.0.1', () => console.log('SERVER_PID=' + process.pid))
process.on('SIGUSR2', () => { server.close(); setInterval(() => {}, 1000) })
`

const dir = mkdtempSync(path.join(tmpdir(), 'dev-supervisor-'))
writeFileSync(path.join(dir, 'fake-next-dev.mjs'), FAKE_NEXT_DEV)
writeFileSync(path.join(dir, 'fake-server.mjs'), FAKE_SERVER)
const supervisorPath = path.join(import.meta.dir, 'dev-supervisor.ts')

const routesMissingFile = path.join(dir, 'routes-missing')

const FAST = {
  DEV_SUPERVISOR_PROBE_MS: '100',
  DEV_SUPERVISOR_BACKOFF_MS: '100',
  DEV_SUPERVISOR_REFUSED_MS: '1000',
  DEV_SUPERVISOR_ORPHAN_REFUSED_MS: '500',
  DEV_SUPERVISOR_TERM_GRACE_MS: '500',
}

const running: ChildProcess[] = []

function signalGroup(proc: ChildProcess, name: NodeJS.Signals) {
  try {
    process.kill(-proc.pid!, name)
  } catch {
    // The group is gone.
  }
}

// Each supervisor leads its own process group, so a failed test cannot leave fake servers
// holding ports.
afterEach(async () => {
  rmSync(routesMissingFile, { force: true })
  for (const proc of running.splice(0)) {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise((resolve) => proc.once('exit', resolve))
      proc.kill('SIGTERM')
      await Promise.race([exited, Bun.sleep(5_000)])
    }
    signalGroup(proc, 'SIGKILL')
  }
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 10_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return
    await Bun.sleep(50)
  }
  throw new Error(`timed out waiting for ${what}`)
}

function supervise(args: string[], env: Record<string, string> = {}) {
  const proc = spawn(process.execPath, [supervisorPath, ...args], {
    env: { ...process.env, ...FAST, NO_COLOR: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  running.push(proc)
  const out = { stdout: '', stderr: '' }
  proc.stdout!.on('data', (chunk) => {
    out.stdout += chunk
  })
  proc.stderr!.on('data', (chunk) => {
    out.stderr += chunk
  })
  const exited = new Promise<number | null>((resolve) => proc.once('exit', (code) => resolve(code)))
  const pids = (name: string) =>
    [...out.stdout.matchAll(new RegExp(`${name}=(\\d+)`, 'g'))].map((m) => Number(m[1]))
  return {
    proc,
    out,
    exited,
    serverPids: () => pids('SERVER_PID'),
    nextDevPids: () => pids('NEXT_DEV_PID'),
  }
}

const count = (text: string, part: string) => text.split(part).length - 1

test('restarts after the server child is SIGKILLed and stops the whole tree on SIGINT', async () => {
  const port = await freePort()
  const run = supervise(['node', path.join(dir, 'fake-next-dev.mjs'), '--port', String(port)])

  await until(() => run.serverPids().length === 1, 'first server')
  await until(() => portOpen(port), 'port open')
  const [first] = run.serverPids()
  process.kill(first!, 'SIGKILL')

  await until(() => run.serverPids().length === 2, 'restarted server')
  await until(() => portOpen(port), 'port open again')
  await until(() => run.out.stderr.includes('다시 열렸습니다'), 'recovery message')
  expect(run.out.stderr).toContain('갑자기 죽었습니다')
  expect(run.out.stderr).toContain('1/5번째 재시작')

  const second = run.serverPids()[1]!
  run.proc.kill('SIGINT')
  expect(await run.exited).toBe(0)
  expect(await portOpen(port)).toBe(false)
  expect(alive(second)).toBe(false)
}, 30_000)

test('restarts when the server stays alive but stops listening', async () => {
  const port = await freePort()
  const run = supervise(['node', path.join(dir, 'fake-next-dev.mjs'), '--port', String(port)])
  await until(() => run.serverPids().length === 1, 'first server')
  await until(() => portOpen(port), 'port open')
  await Bun.sleep(300) // the supervisor only counts refusals once it has seen the port open
  const [first] = run.serverPids()
  process.kill(first!, 'SIGUSR2')

  await until(() => run.serverPids().length === 2, 'restarted server')
  expect(run.out.stderr).toContain('서버 프로세스는 남아 있지만 포트를 열지 않습니다')
  expect(alive(first!)).toBe(false)
  run.proc.kill('SIGTERM')
  expect(await run.exited).toBe(0)
}, 30_000)

test('restarts quickly when next dev outlives its server child', async () => {
  const port = await freePort()
  const args = ['node', path.join(dir, 'fake-next-dev.mjs'), '--port', String(port), '--linger']
  const run = supervise(args)
  await until(() => run.serverPids().length === 1, 'first server')
  await until(() => portOpen(port), 'port open')
  await Bun.sleep(300)
  process.kill(run.serverPids()[0]!, 'SIGKILL')

  await until(() => run.serverPids().length === 2, 'restarted server')
  expect(run.out.stderr).toContain('next-server 프로세스가 사라졌습니다')
  run.proc.kill('SIGTERM')
  expect(await run.exited).toBe(0)
}, 30_000)

test('tears a frozen next dev down once and restarts it once', async () => {
  const port = await freePort()
  const run = supervise(['node', path.join(dir, 'fake-next-dev.mjs'), '--port', String(port)])
  await until(() => run.serverPids().length === 1, 'first server')
  await until(() => portOpen(port), 'port open')
  await Bun.sleep(300)
  // A frozen `next dev` ignores SIGTERM and cannot reap its dead server, which stays a zombie.
  const [frozen] = run.nextDevPids()
  process.kill(frozen!, 'SIGSTOP')
  process.kill(run.serverPids()[0]!, 'SIGKILL')

  await until(() => run.serverPids().length === 2, 'restarted server')
  await until(() => run.out.stderr.includes('다시 열렸습니다'), 'recovery message')
  await Bun.sleep(1_000)
  expect(run.out.stderr).toContain('next-server 프로세스가 사라졌습니다')
  expect(run.out.stderr).not.toContain('서버 프로세스는 남아 있지만')
  expect(count(run.out.stderr, '후 다시 시작합니다')).toBe(1)
  expect(run.out.stderr).not.toContain('이미 다른 프로세스')
  expect(run.nextDevPids()).toHaveLength(2)
  expect(alive(frozen!)).toBe(false)

  const second = run.nextDevPids()[1]!
  run.proc.kill('SIGINT')
  expect(await run.exited).toBe(0)
  expect(alive(second)).toBe(false)
  expect(await portOpen(port)).toBe(false)
}, 30_000)

test('restarts once more when the scene API routes come back as an HTML 404', async () => {
  const port = await freePort()
  const run = supervise(['node', path.join(dir, 'fake-next-dev.mjs'), '--port', String(port)])
  await until(() => run.serverPids().length === 1, 'first server')
  await until(() => portOpen(port), 'port open')
  writeFileSync(routesMissingFile, '1')
  process.kill(run.serverPids()[0]!, 'SIGKILL')

  await until(() => run.out.stderr.includes('다시 열렸습니다'), 'recovery message')
  expect(run.out.stderr).toContain('404 페이지를 돌려줍니다')
  expect(run.out.stderr).toContain('2/5번째 재시작')
  expect(run.out.stderr.indexOf('404 페이지')).toBeLessThan(
    run.out.stderr.indexOf('다시 열렸습니다'),
  )
  expect(run.serverPids()).toHaveLength(3)
  run.proc.kill('SIGTERM')
  expect(await run.exited).toBe(0)
}, 30_000)

test('gives advice instead of restarting again when the routes stay missing', async () => {
  const port = await freePort()
  const run = supervise(['node', path.join(dir, 'fake-next-dev.mjs'), '--port', String(port)])
  await until(() => run.serverPids().length === 1, 'first server')
  await until(() => portOpen(port), 'port open')
  writeFileSync(routesMissingFile, '2')
  process.kill(run.serverPids()[0]!, 'SIGKILL')

  await until(() => run.out.stderr.includes('bun clean:cache 후'), 'advice')
  await Bun.sleep(500)
  expect(count(run.out.stderr, '후 다시 시작합니다')).toBe(2)
  expect(run.out.stderr).not.toContain('다시 열렸습니다')
  expect(run.serverPids()).toHaveLength(3)
  run.proc.kill('SIGTERM')
  expect(await run.exited).toBe(0)
}, 30_000)

test('a hangup during the restart delay stops without starting again', async () => {
  const port = await freePort()
  const run = supervise(['node', '-e', "console.log('SPAWNED'); process.exit(3)"], {
    PORT: String(port),
    DEV_SUPERVISOR_BACKOFF_MS: '5000',
  })
  await until(() => run.out.stderr.includes('다시 시작합니다'), 'restart scheduled')
  run.proc.kill('SIGHUP')
  expect(await run.exited).toBe(0)
  expect(count(run.out.stdout, 'SPAWNED')).toBe(1)
}, 30_000)

test('leaves a foreign listener alone and starts once the port is free', async () => {
  const port = await freePort()
  const foreign = net.createServer((socket) => socket.end())
  await new Promise<void>((resolve) => foreign.listen(port, '127.0.0.1', resolve))
  const run = supervise(['node', path.join(dir, 'fake-next-dev.mjs'), '--port', String(port)])

  await until(() => run.out.stderr.includes('이미 다른 프로세스'), 'port busy message')
  await Bun.sleep(500)
  expect(run.serverPids()).toEqual([])

  await new Promise((resolve) => foreign.close(resolve))
  await until(() => run.serverPids().length === 1, 'server after the port was freed')
  expect(run.out.stderr).toContain('비었습니다')

  run.proc.kill('SIGTERM')
  expect(await run.exited).toBe(0)
}, 30_000)

test('gives up with exit 1 when the command keeps dying', async () => {
  const port = await freePort()
  const run = supervise(['node', '-e', 'process.exit(3)'], {
    PORT: String(port),
    DEV_SUPERVISOR_MAX_RESTARTS: '2',
    DEV_SUPERVISOR_BACKOFF_MS: '50',
  })
  expect(await run.exited).toBe(1)
  expect(run.out.stderr).toContain('종료 코드 3')
  expect(run.out.stderr).toContain('3번 죽어서 자동 재시작을 멈춥니다')
}, 30_000)
