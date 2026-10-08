import { getHeapStatistics } from 'node:v8'

// Next restarts its dev server cleanly once the heap passes 80% of the limit, but it only checks
// after an HTTP request completes. Scene event streams (SSE) and the HMR socket never complete,
// so with only open tabs the heap can run into V8's hard limit, which aborts the server instead.
// This checks on a timer and asks for the same restart.

/** `next dev` re-forks its server child when it exits with this code (next/dist/server/lib/utils.js). */
export const NEXT_RESTART_EXIT_CODE = 77
export const DEFAULT_HEAP_RESTART_RATIO = 0.8
const CHECK_INTERVAL_MS = 5_000
const ARMED = Symbol.for('mmm-studio.dev-heap-watchdog')

export interface HeapUsage {
  used_heap_size: number
  heap_size_limit: number
}

/** `EDITOR_DEV_HEAP_RESTART_RATIO`, a fraction of the heap limit between 0 and 1. */
export function heapRestartRatio(value: string | undefined): number {
  const ratio = Number(value)
  return value && Number.isFinite(ratio) && ratio > 0 && ratio < 1
    ? ratio
    : DEFAULT_HEAP_RESTART_RATIO
}

export function heapOverThreshold(heap: HeapUsage, ratio: number): boolean {
  return heap.used_heap_size > ratio * heap.heap_size_limit
}

export function heapRestartMessage(heap: HeapUsage, ratio: number): string {
  const mb = (bytes: number) => Math.round(bytes / 1024 / 1024)
  const percent = Math.round((heap.used_heap_size / heap.heap_size_limit) * 100)
  return (
    `[힙 감시] 서버 JS 힙이 ${mb(heap.used_heap_size)} / ${mb(heap.heap_size_limit)} MB(${percent}%)로 ` +
    `기준(${Math.round(ratio * 100)}%)을 넘어서 개발 서버를 깨끗하게 다시 시작합니다. ` +
    '힙 한계에 부딪혀 서버가 죽기 전에 Next가 새 서버 프로세스를 띄웁니다.'
  )
}

interface WatchdogDeps {
  readHeap: () => HeapUsage
  warn: (message: string) => void
  exit: (code: number) => void
  repeat: (run: () => void, ms: number) => void
}

const defaultDeps: WatchdogDeps = {
  readHeap: getHeapStatistics,
  warn: (message) => console.warn(message),
  exit: (code) => process.exit(code),
  repeat: (run, ms) => setInterval(run, ms).unref(),
}

/**
 * Arms the watchdog in the server child that `next dev` forks, and nowhere else: Next sets
 * `__NEXT_DEV_SERVER` only there, so `next start` and the standalone server (desktop app) never
 * exit with the restart code, which nothing would act on.
 */
export function startDevHeapWatchdog(
  env: Record<string, string | undefined> = process.env,
  deps: WatchdogDeps = defaultDeps,
  scope: Record<symbol, unknown> = globalThis,
): boolean {
  if (env.__NEXT_DEV_SERVER !== '1' || scope[ARMED]) return false
  scope[ARMED] = true
  const ratio = heapRestartRatio(env.EDITOR_DEV_HEAP_RESTART_RATIO)
  deps.repeat(() => {
    const heap = deps.readHeap()
    if (!heapOverThreshold(heap, ratio)) return
    deps.warn(heapRestartMessage(heap, ratio))
    deps.exit(NEXT_RESTART_EXIT_CODE)
  }, CHECK_INTERVAL_MS)
  return true
}
