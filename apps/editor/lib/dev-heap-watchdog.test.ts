import { expect, test } from 'bun:test'
import {
  DEFAULT_HEAP_RESTART_RATIO,
  type HeapUsage,
  heapOverThreshold,
  heapRestartMessage,
  heapRestartRatio,
  NEXT_RESTART_EXIT_CODE,
  startDevHeapWatchdog,
} from './dev-heap-watchdog'

const MB = 1024 * 1024

function harness(heap: HeapUsage) {
  const calls = { exits: [] as number[], warnings: [] as string[], intervals: 0 }
  let tick: (() => void) | null = null
  const deps = {
    readHeap: () => heap,
    warn: (message: string) => calls.warnings.push(message),
    exit: (code: number) => calls.exits.push(code),
    repeat: (run: () => void) => {
      calls.intervals++
      tick = run
    },
  }
  return { calls, deps, tick: () => tick?.() }
}

test('heapRestartRatio accepts a fraction and falls back to the default', () => {
  expect(heapRestartRatio('0.5')).toBe(0.5)
  expect(heapRestartRatio(undefined)).toBe(DEFAULT_HEAP_RESTART_RATIO)
  expect(heapRestartRatio('')).toBe(DEFAULT_HEAP_RESTART_RATIO)
  expect(heapRestartRatio('0')).toBe(DEFAULT_HEAP_RESTART_RATIO)
  expect(heapRestartRatio('1.5')).toBe(DEFAULT_HEAP_RESTART_RATIO)
  expect(heapRestartRatio('lots')).toBe(DEFAULT_HEAP_RESTART_RATIO)
})

test('heapOverThreshold compares used heap with the ratio of the limit', () => {
  const limit = 1000 * MB
  expect(heapOverThreshold({ used_heap_size: 800 * MB, heap_size_limit: limit }, 0.8)).toBe(false)
  expect(heapOverThreshold({ used_heap_size: 801 * MB, heap_size_limit: limit }, 0.8)).toBe(true)
})

test('the warning says how full the heap is', () => {
  const message = heapRestartMessage({ used_heap_size: 6600 * MB, heap_size_limit: 8192 * MB }, 0.8)
  expect(message).toContain('사용량 6600 MB가 기준 6554 MB(힙 한계 8192 MB의 80%)')
  expect(
    heapRestartMessage({ used_heap_size: 290 * MB, heap_size_limit: 8240 * MB }, 0.035),
  ).toContain('기준 288 MB(힙 한계 8240 MB의 3.5%)')
})

test('only arms in the server child of `next dev`', () => {
  const { calls, deps } = harness({ used_heap_size: 900 * MB, heap_size_limit: 1000 * MB })
  expect(startDevHeapWatchdog({}, deps, {})).toBe(false)
  expect(startDevHeapWatchdog({ NODE_ENV: 'production' }, deps, {})).toBe(false)
  expect(calls.intervals).toBe(0)
})

test('arms once per process', () => {
  const { calls, deps } = harness({ used_heap_size: 0, heap_size_limit: 1000 * MB })
  const scope = {}
  expect(startDevHeapWatchdog({ __NEXT_DEV_SERVER: '1' }, deps, scope)).toBe(true)
  expect(startDevHeapWatchdog({ __NEXT_DEV_SERVER: '1' }, deps, scope)).toBe(false)
  expect(calls.intervals).toBe(1)
})

test('exits with the restart code once the heap passes the threshold', () => {
  const heap = { used_heap_size: 500 * MB, heap_size_limit: 1000 * MB }
  const { calls, deps, tick } = harness(heap)
  const env = { __NEXT_DEV_SERVER: '1', EDITOR_DEV_HEAP_RESTART_RATIO: '0.6' }
  startDevHeapWatchdog(env, deps, {})

  tick()
  expect(calls.exits).toEqual([])
  heap.used_heap_size = 650 * MB
  tick()
  expect(calls.exits).toEqual([NEXT_RESTART_EXIT_CODE])
  expect(calls.warnings[0]).toContain('기준 600 MB(힙 한계 1000 MB의 60%)')
})
