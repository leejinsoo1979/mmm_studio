// Dev-only wrapper: `bun scripts/dev-supervisor.ts next dev --port 3002` (the editor's `dev`
// script). `next build`, `next start` and the standalone server never go through it.
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
  childrenByParent,
  classifyConnectError,
  decideRestart,
  descendantsOf,
  exitStatusOf,
  INITIAL_LIVENESS,
  type Liveness,
  messages,
  nextLiveness,
  type ProbeResult,
  parseDevPort,
  parseProbeHost,
  readTiming,
  refusedTooLong,
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

function descendants(pid: number): number[] {
  try {
    const ps = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
    return descendantsOf(pid, childrenByParent(ps))
  } catch {
    return []
  }
}

function signal(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(pid, name)
  } catch {
    // Already gone.
  }
}

const hasExited = (proc: ChildProcess) => proc.exitCode !== null || proc.signalCode !== null

let child: ChildProcess | null = null
let liveness: Liveness = INITIAL_LIVENESS
let deaths: number[] = []
let restarts = 0
let awaitingRecovery = false
let stopping = false
let treeAtStop: number[] = []
let waitingForPort = false
let startTimer: ReturnType<typeof setTimeout> | null = null

// Descendants are listed before anything is signalled: once `next dev` is gone, its children are
// re-parented and can no longer be found from it, and an orphaned next-server keeps the port.
async function stopTree(proc: ChildProcess, graceMs: number) {
  const tree = descendants(proc.pid!)
  if (!hasExited(proc)) {
    const exited = new Promise((resolve) => proc.once('exit', resolve))
    signal(proc.pid!, 'SIGTERM')
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, graceMs))])
  }
  for (const pid of [proc.pid!, ...tree]) signal(pid, 'SIGKILL')
}

function onDeath(reason: string) {
  say(reason)
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
  proc.once('error', (error) => {
    say(`${command[0]} 실행 실패: ${error.message}`, 'error')
    process.exit(1)
  })
  proc.once('exit', (code, sig) => {
    if (child !== proc) return
    child = null
    if (stopping) {
      // `next dev` stops next-server itself; anything of the tree still alive now would keep
      // the port, so it goes too.
      for (const pid of treeAtStop) signal(pid, 'SIGKILL')
      process.exit(exitStatusOf(code, sig, constants.signals))
    }
    onDeath(messages.exited(code, sig))
  })
}

async function watch() {
  const proc = child
  if (!proc || stopping) return
  const result = await probe()
  if (proc !== child || stopping) return
  liveness = nextLiveness(liveness, result, Date.now())
  if (result === 'open' && awaitingRecovery) {
    awaitingRecovery = false
    say(messages.recovered(port, restarts), 'ok')
  }
  if (liveness.refusedSince === null) return
  const hasServer = descendants(proc.pid!).length > 0
  if (!refusedTooLong(liveness, Date.now(), hasServer, timing)) return
  const refusedFor = Date.now() - liveness.refusedSince
  child = null
  await stopTree(proc, 5_000)
  if (!stopping) onDeath(messages.refused(port, refusedFor, hasServer))
}

const watcher = setInterval(watch, timing.probeMs)

for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(name, () => {
    if (stopping) return
    stopping = true
    clearInterval(watcher)
    if (startTimer) clearTimeout(startTimer)
    const proc = child
    if (!proc) process.exit(0)
    treeAtStop = descendants(proc.pid!)
    signal(proc.pid!, name)
    setTimeout(() => {
      say(messages.stopTimedOut(), 'error')
      void stopTree(proc, 0).then(() => process.exit(1))
    }, 10_000).unref()
  })
}

process.on('exit', () => {
  if (child && !hasExited(child)) signal(child.pid!, 'SIGTERM')
})

void start()
