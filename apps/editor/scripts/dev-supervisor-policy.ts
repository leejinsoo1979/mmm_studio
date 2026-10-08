// Decision logic for scripts/dev-supervisor.ts, kept free of process and network access so it
// can be unit tested. Messages are Korean because they are written for the person running
// `bun dev`, and they land in the same terminal as Next's own output.

export type ProbeResult = 'open' | 'refused' | 'timeout' | 'error'

export interface SupervisorTiming {
  /** How often the port is probed while `next dev` runs. */
  probeMs: number
  /** Refusal window while `next dev` still has its server child (covers Next's own re-fork). */
  refusedWithServerMs: number
  /** Refusal window once `next dev` has no child process left. */
  refusedWithoutServerMs: number
  /** First restart delay; doubles with every death inside the window. */
  backoffMs: number
  maxBackoffMs: number
  /** Restarts allowed inside `windowMs`; one more death stops the supervisor. */
  maxRestarts: number
  windowMs: number
}

export const DEFAULT_TIMING: SupervisorTiming = {
  probeMs: 2_000,
  refusedWithServerMs: 30_000,
  refusedWithoutServerMs: 5_000,
  backoffMs: 1_000,
  maxBackoffMs: 16_000,
  maxRestarts: 5,
  windowMs: 10 * 60_000,
}

const TIMING_ENV: Record<keyof SupervisorTiming, string> = {
  probeMs: 'DEV_SUPERVISOR_PROBE_MS',
  refusedWithServerMs: 'DEV_SUPERVISOR_REFUSED_MS',
  refusedWithoutServerMs: 'DEV_SUPERVISOR_ORPHAN_REFUSED_MS',
  backoffMs: 'DEV_SUPERVISOR_BACKOFF_MS',
  maxBackoffMs: 'DEV_SUPERVISOR_MAX_BACKOFF_MS',
  maxRestarts: 'DEV_SUPERVISOR_MAX_RESTARTS',
  windowMs: 'DEV_SUPERVISOR_WINDOW_MS',
}

export function readTiming(env: Record<string, string | undefined>): SupervisorTiming {
  const timing = { ...DEFAULT_TIMING }
  for (const key of Object.keys(TIMING_ENV) as (keyof SupervisorTiming)[]) {
    const value = Number(env[TIMING_ENV[key]])
    if (Number.isFinite(value) && value > 0) timing[key] = value
  }
  return timing
}

function flagValue(args: readonly string[], names: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    for (const name of names) {
      if (arg === name) return args[i + 1]
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
    }
  }
  return undefined
}

export function parseDevPort(
  args: readonly string[],
  env: Record<string, string | undefined>,
): number {
  const port = Number(flagValue(args, ['--port', '-p']) ?? env.PORT ?? 3000)
  return Number.isInteger(port) && port > 0 ? port : 3000
}

/** Where to probe: Next listens on every interface unless `--hostname` narrows it. */
export function parseProbeHost(args: readonly string[]): string {
  const host = flagValue(args, ['--hostname', '-H'])
  if (!host || host === '0.0.0.0' || host === 'localhost') return '127.0.0.1'
  if (host === '::') return '::1'
  return host
}

export function classifyConnectError(code: string | undefined): ProbeResult {
  if (code === 'ECONNREFUSED') return 'refused'
  if (code === 'ETIMEDOUT') return 'timeout'
  return 'error'
}

export interface Liveness {
  /** The port accepted a connection since this `next dev` was started. */
  ready: boolean
  /** Start of the current unbroken run of refused probes. */
  refusedSince: number | null
}

export const INITIAL_LIVENESS: Liveness = { ready: false, refusedSince: null }

// A server busy compiling or collecting garbage still completes the TCP handshake (the kernel
// does it), so only a refusal means nothing listens. Timeouts and other errors never count, and
// refusals before the first successful probe are just the server booting.
export function nextLiveness(previous: Liveness, probe: ProbeResult, now: number): Liveness {
  if (probe === 'open') return { ready: true, refusedSince: null }
  if (probe === 'refused' && previous.ready) {
    return { ready: true, refusedSince: previous.refusedSince ?? now }
  }
  return { ready: previous.ready, refusedSince: null }
}

export function refusedTooLong(
  liveness: Liveness,
  now: number,
  hasServerProcess: boolean,
  timing: SupervisorTiming,
): boolean {
  if (liveness.refusedSince === null) return false
  const limit = hasServerProcess ? timing.refusedWithServerMs : timing.refusedWithoutServerMs
  return now - liveness.refusedSince >= limit
}

export type RestartDecision =
  | { action: 'restart'; delayMs: number; attempt: number; deaths: number[] }
  | { action: 'give-up'; deaths: number[] }

export function decideRestart(
  previousDeaths: readonly number[],
  now: number,
  timing: SupervisorTiming,
): RestartDecision {
  const deaths = [...previousDeaths.filter((t) => now - t < timing.windowMs), now]
  if (deaths.length > timing.maxRestarts) return { action: 'give-up', deaths }
  const delayMs = Math.min(timing.maxBackoffMs, timing.backoffMs * 2 ** (deaths.length - 1))
  return { action: 'restart', delayMs, attempt: deaths.length, deaths }
}

/** Exit status a shell would report for the child, so a normal stop passes it through. */
export function exitStatusOf(
  code: number | null,
  signal: string | null,
  signalNumbers: Record<string, number | undefined>,
): number {
  if (code !== null) return code
  const number = signal ? signalNumbers[signal] : undefined
  return number === undefined ? 1 : 128 + number
}

export function childrenByParent(psOutput: string): Map<number, number[]> {
  const children = new Map<number, number[]>()
  for (const line of psOutput.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!(pid && ppid !== undefined && Number.isInteger(ppid))) continue
    const list = children.get(ppid)
    if (list) list.push(pid)
    else children.set(ppid, [pid])
  }
  return children
}

/** All descendants of `root` (not `root` itself), parents before children. */
export function descendantsOf(root: number, children: Map<number, number[]>): number[] {
  const result: number[] = []
  const queue = [root]
  const seen = new Set(queue)
  while (queue.length > 0) {
    for (const pid of children.get(queue.shift()!) ?? []) {
      if (seen.has(pid)) continue
      seen.add(pid)
      result.push(pid)
      queue.push(pid)
    }
  }
  return result
}

const seconds = (ms: number) => `${Math.round(ms / 100) / 10}초`

export const messages = {
  exited(code: number | null, signal: string | null): string {
    if (signal) return `next dev 프로세스가 ${signal} 신호로 종료됐습니다.`
    if (code === 0) {
      return (
        '에디터 개발 서버(next-server)가 갑자기 죽었습니다. 오류 메시지 없이 끝났다면 보통 ' +
        '메모리 부족(macOS가 강제 종료했거나 V8 힙 한계 초과) 또는 네이티브 크래시입니다.'
      )
    }
    return `next dev가 종료 코드 ${code}로 끝났습니다. 원인은 바로 위 로그에 있습니다.`
  },
  refused(port: number, ms: number, hasServerProcess: boolean): string {
    const state = hasServerProcess
      ? '서버 프로세스는 남아 있지만 포트를 열지 않습니다'
      : 'next-server 프로세스가 사라졌습니다'
    return `포트 ${port}가 ${seconds(ms)} 동안 연결을 거부했습니다(${state}). 남은 프로세스를 정리합니다.`
  },
  restarting(delayMs: number, attempt: number, timing: SupervisorTiming): string {
    const window = Math.round(timing.windowMs / 60_000)
    return `${seconds(delayMs)} 후 다시 시작합니다 (최근 ${window}분 동안 ${attempt}/${timing.maxRestarts}번째 재시작).`
  },
  recovered(port: number, attempt: number): string {
    return `에디터 개발 서버가 다시 열렸습니다: http://localhost:${port} (${attempt}번째 재시작)`
  },
  giveUp(deaths: number, port: number, timing: SupervisorTiming): string {
    const window = Math.round(timing.windowMs / 60_000)
    return [
      `에디터 개발 서버가 ${window}분 안에 ${deaths}번 죽어서 자동 재시작을 멈춥니다. 포트 ${port}는 닫혀 있습니다.`,
      '  해볼 것:',
      '  1) 메모리 확보: Chrome 탭, 데스크톱 앱(MMM Studio), 다른 개발 서버를 닫은 뒤 bun dev를 다시 실행하세요.',
      '  2) 에디터만 실행하기: bun dev --filter=editor...',
      '  3) Turbopack 캐시가 깨졌을 수 있으면: bun clean:cache 후 bun dev',
      '  4) 위 로그에서 첫 오류를 찾으세요 (next.config 오류, FATAL ERROR 등).',
    ].join('\n')
  },
  portBusy(port: number): string {
    return (
      `포트 ${port}를 이미 다른 프로세스가 쓰고 있어서 next dev를 시작하지 않고 기다립니다. ` +
      `그 프로세스는 건드리지 않습니다. 확인: lsof -nP -iTCP:${port} -sTCP:LISTEN`
    )
  },
  portFreed(port: number): string {
    return `포트 ${port}가 비었습니다. 에디터 개발 서버를 시작합니다.`
  },
  stopTimedOut(): string {
    return 'next dev가 10초 안에 멈추지 않아 남은 프로세스를 강제로 종료합니다.'
  },
}
