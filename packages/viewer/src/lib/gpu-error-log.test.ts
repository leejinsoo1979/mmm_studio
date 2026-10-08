// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { createGpuErrorReporter, formatRepeatSummary } from './gpu-error-log'

const SLOT =
  'Vertex buffer slot 0 required by [RenderPipeline "renderPipeline_LineBasicNodeMaterial_59"] was not set.\n - While encoding [RenderPassEncoder (unlabeled)].Draw(12, 1, 0, 0).'
const INVALID =
  '[Invalid CommandBuffer from CommandEncoder "renderContext_3"] is invalid due to a previous error.'

function setup() {
  const printed: unknown[][] = []
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
  const reporter = createGpuErrorReporter(
    (...args) => printed.push(args),
    (run, ms) => {
      const timer = { run, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  )
  const fire = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run()
  }
  const frame = () => {
    reporter.report({ message: SLOT })
    reporter.report({ message: INVALID })
  }
  return { reporter, printed, timers, fire, frame }
}

describe('createGpuErrorReporter', () => {
  test('logs each distinct message in full once', () => {
    const { printed, frame } = setup()
    for (let i = 0; i < 300; i++) frame()
    expect(printed.length).toBe(2)
    expect(printed[0]![1]).toBe(SLOT)
    expect(printed[1]![1]).toBe(INVALID)
  })

  test('summarises the repeats once per interval while they keep coming', () => {
    const { printed, timers, fire, frame } = setup()
    frame()
    for (let i = 0; i < 599; i++) frame()
    expect(timers.length).toBe(1)
    expect(timers[0]!.ms).toBe(10_000)
    fire()
    expect(printed.length).toBe(3)
    const summary = String(printed[2]![0])
    expect(summary).toContain('599× Vertex buffer slot 0 required by')
    expect(summary).toContain('599× [Invalid CommandBuffer')
    expect(summary).not.toContain('Draw(12')

    for (let i = 0; i < 50; i++) frame()
    fire()
    expect(printed.length).toBe(4)
    expect(String(printed[3]![0])).toContain('50× Vertex buffer slot 0')
  })

  test('stays quiet once the errors stop', () => {
    const { printed, timers, fire, frame } = setup()
    frame()
    frame()
    fire()
    expect(printed.length).toBe(3)
    expect(timers.length).toBe(0)
    fire()
    expect(printed.length).toBe(3)
  })

  test('dispose prints the pending repeats and cancels the timer', () => {
    const { reporter, printed, timers, frame } = setup()
    frame()
    frame()
    reporter.dispose()
    expect(printed.length).toBe(3)
    expect(String(printed[2]![0])).toContain('1× Vertex buffer slot 0')
    expect(timers[0]!.cancelled).toBe(true)
  })

  test('counts new messages past the distinct limit instead of logging them', () => {
    const { reporter, printed, fire } = setup()
    for (let i = 0; i < 60; i++) reporter.report({ message: `error ${i}` })
    expect(printed.length).toBe(50)
    fire()
    expect(printed.length).toBe(51)
    expect(String(printed[50]![0])).toContain('…and 5 more messages')
  })

  test('reports an error without a message', () => {
    const { reporter, printed } = setup()
    reporter.report(undefined)
    expect(printed[0]![1]).toBe('unknown error')
  })
})

describe('formatRepeatSummary', () => {
  test('lists the most frequent first lines', () => {
    const summary = formatRepeatSummary(
      new Map([
        ['rare', 2],
        [SLOT, 40],
      ]),
      10_000,
    )
    expect(summary.split('\n')).toEqual([
      '[viewer] WebGPU uncaptured errors still occurring (repeats within 10 s, each logged in full once):',
      '  40× Vertex buffer slot 0 required by [RenderPipeline "renderPipeline_LineBasicNodeMaterial_59"] was not set.',
      '  2× rare',
    ])
  })
})
