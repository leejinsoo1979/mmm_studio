// Dev-only wrapper: `bun --env-file=/dev/null scripts/dev-supervisor.ts next dev --port 3002` (the
// editor's `dev` script). `next build`, `next start` and the standalone server never go through it.
// `--env-file=/dev/null` stops Bun from loading apps/editor/.env* into process.env before Next
// does: Next never overrides an inherited key, so edits to those files would stop applying on its
// env reload. (`--no-env-file` says the same, but Bun 1.3.0 ignores it.)
//
// `next dev` forks the real server (next-server). When that child dies by a signal (V8 heap
// abort, a macOS memory-pressure SIGKILL, a native crash), `next dev` ignores the death and
// quietly exits 0, so turbo marks the task done and nothing listens on the port any more. This
// wrapper restarts `next dev` when it exits on its own, or when the port, after having been
// open, refuses connections for a while although `next dev` is still running.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import net from 'node:net'
import { constants } from 'node:os'
import {
  classifyConnectError,
  decideRestart,
  descendantsOf,
  exitStatusOf,
  hasLiveProcess,
  INITIAL_LIVENESS,
  type Liveness,
  messages,
  nextLiveness,
  type ProbeResult,
  type ProcessEntry,
  parseDevPort,
  parseProbeHost,
  parsePs,
  ROUTE_PROBE_PATH,
  readTiming,
  refusedTooLong,
  routesMissing,
  stillRunning,
} from './dev-supervisor-policy'

const command = process.argv.slice(2)
if (command.length === 0) {
  console.error('usage: bun scripts/dev-supervisor.ts <command> [...args]')
  process.exit(2)
}

const port = parseDevPort(command, process.env)
const host = parseProbeHost(command)
const timing = readTiming(process.env)
const colors = process.stderr.isTTY && !process.env.NO_COLOR
const KILL_WAIT_MS = 5_000
const STOP_TIMEOUT_MS = 10_000
// The first request after a restart compiles the route, and nothing is sent meanwhile.
const ROUTE_PROBE_TIMEOUT_MS = 120_000

function say(text: string, tone: 'warn' | 'error' | 'ok' = 'warn') {
  const time = new Date().toTimeString().slice(0, 8)
  const line = `[개발 서버 감시 ${time}] ${text}`
  const code = { warn: '33', error: '1;31', ok: '32' }[tone]
  process.stderr.write(colors ? `\x1b[${code}m${line}\x1b[0m\n` : `${line}\n`)
}

function probe(): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (result: ProbeResult) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(3_000, () => done('timeout'))
    socket.once('connect', () => done('open'))
    socket.once('error', (error: NodeJS.ErrnoException) => done(classifyConnectError(error.code)))
  })
}

// A raw request rather than an HTTP client: Bun's honours HTTP_PROXY even for localhost.
// `null` when no response came back.
function probeRoutes(): Promise<boolean | null> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    let head = ''
    const done = (result: boolean | null) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(ROUTE_PROBE_TIMEOUT_MS, () => done(null))
    socket.once('connect', () => {
      socket.write(
        `GET ${ROUTE_PROBE_PATH} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`,
      )
    })
    socket.on('data', (chunk: Buffer) => {
      head += chunk.toString('latin1')
      const end = head.indexOf('\r\n\r\n')
      if (end !== -1) done(routesMissing(head.slice(0, end)))
    })
    socket.once('error', () => done(null))
    socket.once('end', () => done(null))
  })
}

function processTable(): ProcessEntry[] | null {
  try {
    const ps = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,stat=,command='], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    return parsePs(ps)
  } catch {
    return null
  }
}

function treeOf(proc: ChildProcess): ProcessEntry[] | null {
  const table = processTable()
  return table && descendantsOf(proc.pid!, table)
}

function killRecorded(recorded: readonly ProcessEntry[]) {
  if (recorded.length === 0) return
  const table = processTable()
  for (const pid of table ? stillRunning(recorded, table) : []) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

const hasExited = (proc: ChildProcess) => proc.exitCode !== null || proc.signalCode !== null

function exitedWithin(proc: ChildProcess, ms: number): Promise<boolean> {
  if (hasExited(proc)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

let child: ChildProcess | null = null
/** Every `next dev` started that has not exited yet, so a stop reaches one still being torn down. */
const live = new Set<ChildProcess>()
/** Deaths already counted, so the exit event that ends a teardown does not count a second one. */
const deathHandled = new WeakSet<ChildProcess>()
let liveness: Liveness = INITIAL_LIVENESS
let deaths: number[] = []
let restarts = 0
let awaitingRecovery = false
let restartedForRoutes = false
let stopping = false
let treeAtStop: ProcessEntry[] = []
let waitingForPort = false
let watching = false
let startTimer: ReturnType<typeof setTimeout> | null = null

// The tree is listed before anything is signalled: once `next dev` is gone, its children are
// re-parented and can no longer be found from it, and an orphaned next-server keeps the port.
async function stopTree(proc: ChildProcess) {
  const recorded = treeOf(proc) ?? []
  proc.kill('SIGTERM')
  if (!(await exitedWithin(proc, timing.termGraceMs))) {
    // Listed again for a server that Next re-forked during the grace.
    recorded.push(...(treeOf(proc) ?? []))
    proc.kill('SIGKILL')
  }
  killRecorded(recorded)
  await exitedWithin(proc, KILL_WAIT_MS)
}

async function retire(proc: ChildProcess) {
  deathHandled.add(proc)
  await stopTree(proc)
  if (child === proc) child = null
  if (!stopping) scheduleRestart()
}

function scheduleRestart() {
  const decision = decideRestart(deaths, Date.now(), timing)
  deaths = decision.deaths
  if (decision.action === 'give-up') {
    say(messages.giveUp(decision.deaths.length, port, timing), 'error')
    process.exit(1)
  }
  say(messages.restarting(decision.delayMs, decision.attempt, timing))
  restarts++
  awaitingRecovery = true
  startTimer = setTimeout(start, decision.delayMs)
}

async function start() {
  startTimer = null
  if (stopping) return
  if ((await probe()) === 'open') {
    if (!waitingForPort) say(messages.portBusy(port))
    waitingForPort = true
    startTimer = setTimeout(start, Math.max(timing.probeMs, 1_000))
    return
  }
  if (stopping) return
  if (waitingForPort) say(messages.portFreed(port), 'ok')
  waitingForPort = false
  liveness = INITIAL_LIVENESS
  // Same process group on purpose: a Ctrl+C in a plain terminal reaches `next dev` directly.
  const proc = spawn(command[0]!, command.slice(1), { stdio: 'inherit' })
  child = proc
  live.add(proc)
  proc.once('error', (error) => {
    say(`${command[0]} 실행 실패: ${error.message}`, 'error')
    process.exit(1)
  })
  proc.once('exit', (code, sig) => {
    live.delete(proc)
    if (child === proc) child = null
    if (stopping) {
      if (live.size > 0) return
      // `next dev` stops next-server itself; anything of the tree still alive now would keep
      // the port, so it goes too.
      killRecorded(treeAtStop)
      process.exit(exitStatusOf(code, sig, constants.signals))
    }
    if (deathHandled.has(proc)) return
    deathHandled.add(proc)
    say(messages.exited(code, sig))
    scheduleRestart()
  })
}

// An open port is not enough after a restart, see ROUTE_PROBE_PATH. A plain restart has cleared
// the broken routes before, so that is tried once; a second miss in a row only gets advice.
async function confirmRecovery(proc: ChildProcess) {
  const missing = await probeRoutes()
  if (proc !== child || stopping || deathHandled.has(proc)) return
  if (!missing) {
    if (missing === false) restartedForRoutes = false
    say(messages.recovered(port, restarts), 'ok')
    return
  }
  if (restartedForRoutes) {
    restartedForRoutes = false
    say(messages.routesStillMissing(), 'error')
    return
  }
  restartedForRoutes = true
  say(messages.routesMissing())
  await retire(proc)
}

async function watch() {
  const proc = child
  if (!proc || stopping || watching || deathHandled.has(proc)) return
  watching = true
  const result = await probe()
  watching = false
  if (proc !== child || stopping || deathHandled.has(proc)) return
  liveness = nextLiveness(liveness, result, Date.now())
  if (result === 'open' && awaitingRecovery) {
    awaitingRecovery = false
    void confirmRecovery(proc)
  }
  if (liveness.refusedSince === null) return
  const tree = treeOf(proc)
  // Without `ps`, assume the server child is still there and wait the longer window.
  const hasServer = tree === null || hasLiveProcess(tree)
  if (!refusedTooLong(liveness, Date.now(), hasServer, timing)) return
  say(messages.refused(port, Date.now() - liveness.refusedSince, hasServer))
  await retire(proc)
}

const watcher = setInterval(watch, timing.probeMs)

for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(name, () => {
    if (stopping) return
    stopping = true
    clearInterval(watcher)
    if (startTimer) clearTimeout(startTimer)
    if (live.size === 0) process.exit(0)
    treeAtStop = [...live].flatMap((proc) => treeOf(proc) ?? [])
    for (const proc of live) proc.kill(name)
    setTimeout(() => {
      say(messages.stopTimedOut(), 'error')
      for (const proc of live) proc.kill('SIGKILL')
      killRecorded(treeAtStop)
      process.exit(1)
    }, STOP_TIMEOUT_MS).unref()
  })
}

process.on('exit', () => {
  for (const proc of live) proc.kill('SIGTERM')
})

void start()
