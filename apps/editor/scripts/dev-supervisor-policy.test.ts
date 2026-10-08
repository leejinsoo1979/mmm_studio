import { describe, expect, test } from 'bun:test'
import {
  classifyConnectError,
  DEFAULT_TIMING,
  decideRestart,
  descendantsOf,
  exitStatusOf,
  hasLiveProcess,
  INITIAL_LIVENESS,
  type Liveness,
  messages,
  nextLiveness,
  parseDevPort,
  parseProbeHost,
  parsePs,
  readTiming,
  refusedTooLong,
  stillRunning,
} from './dev-supervisor-policy'

describe('parseDevPort', () => {
  test('reads --port, --port=, -p and falls back to PORT then 3000', () => {
    expect(parseDevPort(['next', 'dev', '--port', '3002'], {})).toBe(3002)
    expect(parseDevPort(['next', 'dev', '--port=4000'], {})).toBe(4000)
    expect(parseDevPort(['next', 'dev', '-p', '5000'], { PORT: '6000' })).toBe(5000)
    expect(parseDevPort(['next', 'dev'], { PORT: '6000' })).toBe(6000)
    expect(parseDevPort(['next', 'dev'], {})).toBe(3000)
    expect(parseDevPort(['next', 'dev', '--port', 'abc'], {})).toBe(3000)
  })
})

describe('parseProbeHost', () => {
  test('probes loopback unless --hostname names a specific address', () => {
    expect(parseProbeHost(['next', 'dev'])).toBe('127.0.0.1')
    expect(parseProbeHost(['next', 'dev', '-H', '0.0.0.0'])).toBe('127.0.0.1')
    expect(parseProbeHost(['next', 'dev', '--hostname', 'localhost'])).toBe('127.0.0.1')
    expect(parseProbeHost(['next', 'dev', '--hostname=::'])).toBe('::1')
    expect(parseProbeHost(['next', 'dev', '-H', '192.168.0.5'])).toBe('192.168.0.5')
  })
})

test('only ECONNREFUSED is a refusal', () => {
  expect(classifyConnectError('ECONNREFUSED')).toBe('refused')
  expect(classifyConnectError('ETIMEDOUT')).toBe('timeout')
  expect(classifyConnectError('ECONNRESET')).toBe('error')
  expect(classifyConnectError(undefined)).toBe('error')
})

describe('liveness', () => {
  const ready: Liveness = { ready: true, refusedSince: null }

  test('refusals before the first open probe are the server booting', () => {
    const booting = nextLiveness(INITIAL_LIVENESS, 'refused', 1_000)
    expect(booting).toEqual(INITIAL_LIVENESS)
    expect(refusedTooLong(booting, 1_000_000, false, DEFAULT_TIMING)).toBe(false)
  })

  test('an unbroken run of refusals after ready starts the clock', () => {
    let state = nextLiveness(INITIAL_LIVENESS, 'open', 0)
    state = nextLiveness(state, 'refused', 1_000)
    state = nextLiveness(state, 'refused', 3_000)
    expect(state).toEqual({ ready: true, refusedSince: 1_000 })
  })

  test('timeouts and other errors never count as death and break the run', () => {
    let state = nextLiveness(ready, 'refused', 1_000)
    state = nextLiveness(state, 'timeout', 2_000)
    expect(state.refusedSince).toBeNull()
    state = nextLiveness(state, 'refused', 3_000)
    state = nextLiveness(state, 'error', 4_000)
    expect(state.refusedSince).toBeNull()
    for (let t = 0; t < 600_000; t += 2_000) state = nextLiveness(state, 'timeout', t)
    expect(refusedTooLong(state, 600_000, true, DEFAULT_TIMING)).toBe(false)
  })

  test('waits longer while next dev still has its server child', () => {
    const state = nextLiveness(ready, 'refused', 10_000)
    const { refusedWithServerMs, refusedWithoutServerMs } = DEFAULT_TIMING
    expect(refusedTooLong(state, 10_000 + refusedWithoutServerMs - 1, false, DEFAULT_TIMING)).toBe(
      false,
    )
    expect(refusedTooLong(state, 10_000 + refusedWithoutServerMs, false, DEFAULT_TIMING)).toBe(true)
    expect(refusedTooLong(state, 10_000 + refusedWithServerMs - 1, true, DEFAULT_TIMING)).toBe(
      false,
    )
    expect(refusedTooLong(state, 10_000 + refusedWithServerMs, true, DEFAULT_TIMING)).toBe(true)
  })
})

describe('decideRestart', () => {
  test('backs off exponentially, capped', () => {
    let deaths: number[] = []
    const delays: number[] = []
    for (let i = 0; i < DEFAULT_TIMING.maxRestarts; i++) {
      const decision = decideRestart(deaths, i * 1_000, DEFAULT_TIMING)
      if (decision.action !== 'restart') throw new Error('expected a restart')
      expect(decision.attempt).toBe(i + 1)
      delays.push(decision.delayMs)
      deaths = decision.deaths
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000])
  })

  test('gives up after too many deaths inside the window', () => {
    const deaths = Array.from({ length: DEFAULT_TIMING.maxRestarts }, (_, i) => i * 1_000)
    expect(decideRestart(deaths, 10_000, DEFAULT_TIMING).action).toBe('give-up')
  })

  test('forgets deaths older than the window', () => {
    const deaths = Array.from({ length: DEFAULT_TIMING.maxRestarts }, (_, i) => i * 1_000)
    const decision = decideRestart(deaths, DEFAULT_TIMING.windowMs + 4_500, DEFAULT_TIMING)
    expect(decision).toEqual({
      action: 'restart',
      delayMs: 1_000,
      attempt: 1,
      deaths: [DEFAULT_TIMING.windowMs + 4_500],
    })
  })
})

test('readTiming takes positive numbers from the environment and ignores the rest', () => {
  const timing = readTiming({
    DEV_SUPERVISOR_PROBE_MS: '100',
    DEV_SUPERVISOR_MAX_RESTARTS: '2',
    DEV_SUPERVISOR_REFUSED_MS: 'soon',
    DEV_SUPERVISOR_BACKOFF_MS: '-5',
    DEV_SUPERVISOR_TERM_GRACE_MS: '800',
  })
  expect(timing).toEqual({ ...DEFAULT_TIMING, probeMs: 100, maxRestarts: 2, termGraceMs: 800 })
})

test('exitStatusOf passes codes through and maps signals like a shell', () => {
  const signals = { SIGINT: 2, SIGTERM: 15 }
  expect(exitStatusOf(0, null, signals)).toBe(0)
  expect(exitStatusOf(3, null, signals)).toBe(3)
  expect(exitStatusOf(null, 'SIGINT', signals)).toBe(130)
  expect(exitStatusOf(null, 'SIGTERM', signals)).toBe(143)
  expect(exitStatusOf(null, null, signals)).toBe(1)
})

describe('process table', () => {
  const ps = [
    '    1     0 Ss   /sbin/init',
    '   10     1 S    bun scripts/dev-supervisor.ts next dev --port 3002',
    '   11    10 Sl   node next dev --port 3002',
    '   12    11 Z    [node] <defunct>',
    '   13    11 Sl   next-server (v16.2.9)',
    '   14    13 S    node .next/dev/build/postcss.js 46801',
    '   20     1 S',
    '',
  ].join('\n')
  const table = parsePs(ps)

  test('parsePs reads pid, parent, zombie state and command line', () => {
    expect(table[2]).toEqual({
      pid: 11,
      ppid: 10,
      zombie: false,
      command: 'node next dev --port 3002',
    })
    expect(table[3]!.zombie).toBe(true)
    expect(table[6]).toEqual({ pid: 20, ppid: 1, zombie: false, command: '' })
  })

  test('descendantsOf walks the table breadth-first and skips unrelated processes', () => {
    expect(descendantsOf(10, table).map((entry) => entry.pid)).toEqual([11, 12, 13, 14])
    expect(descendantsOf(20, table)).toEqual([])
    expect(descendantsOf(99, table)).toEqual([])
  })

  test('a zombie the frozen next dev has not reaped is not a live server', () => {
    const [zombie] = descendantsOf(11, table)
    expect(hasLiveProcess([zombie!])).toBe(false)
    expect(hasLiveProcess(descendantsOf(11, table))).toBe(true)
  })

  test('stillRunning only names recorded pids that still run the same command', () => {
    const recorded = descendantsOf(10, table)
    const later = parsePs(
      [
        // 11 exited and its number went to an unrelated process; 12 was reaped.
        '   11     1 S    /usr/bin/ssh-agent',
        '   13     1 Sl   next-server (v16.2.9)',
        '   14     1 S    node .next/dev/build/postcss.js 46801',
      ].join('\n'),
    )
    expect(stillRunning(recorded, later)).toEqual([13, 14])
    expect(stillRunning([...recorded, ...recorded], later)).toEqual([13, 14])
  })
})

describe('messages', () => {
  test('say what happened and how many restarts are left', () => {
    expect(messages.exited(0, null)).toContain('FATAL ERROR: Reached heap limit')
    expect(messages.exited(0, null)).toContain('메모리 부족')
    expect(messages.exited(3, null)).toContain('next dev가 종료됐습니다(종료 코드 3)')
    expect(messages.exited(null, 'SIGKILL')).toContain('SIGKILL')
    expect(messages.restarting(2_000, 2, DEFAULT_TIMING)).toBe(
      '2초 후 다시 시작합니다 (최근 10분 동안 2/5번째 재시작).',
    )
    expect(messages.refused(3000, 30_000, true)).toContain('3000번 포트가 30초 동안')
    expect(messages.portBusy(3000)).toContain('3000번 포트를')
    expect(messages.recovered(3002, 4)).toContain('이번 실행에서 4번째 재시작')
  })

  test('the give-up message names the next steps', () => {
    const text = messages.giveUp(6, 3002, DEFAULT_TIMING)
    expect(text).toContain('10분 안에 6번')
    expect(text).toContain('bun dev --filter=editor...')
    expect(text).toContain('bun clean:cache')
    expect(text).toContain('MMM Studio Experience')
  })
})
