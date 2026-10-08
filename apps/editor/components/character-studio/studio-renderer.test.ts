import { describe, expect, test } from 'bun:test'
import { RendererKeeper } from './studio-renderer'

function setup() {
  const timers: Array<() => void> = []
  const keeper = new RendererKeeper<{ dispose(): void }>((run) => timers.push(run))
  const log: string[] = []
  const renderer = (name: string) => ({
    renderer: { dispose: () => log.push(`dispose ${name}`) },
    release: () => log.push(`release ${name}`),
  })
  const elapse = () => {
    for (const run of timers.splice(0)) run()
  }
  return { keeper, log, renderer, elapse }
}

/** Whether `promise` settles within a few turns of the event loop. */
async function settles(promise: Promise<unknown>) {
  let settled = false
  promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  return settled
}

describe('RendererKeeper', () => {
  test('keeps the renderer while the stage is open, and hands it on', async () => {
    const { keeper, log, renderer, elapse } = setup()
    const a = renderer('a')
    expect(await keeper.keep(a.renderer, a.release)).toBe(a.renderer)
    elapse()
    expect(log).toEqual([])
    expect(keeper.size).toBe(1)
  })

  test('undoes its safety nets, then disposes it, a grace period after the stage closes', () => {
    const { keeper, log, renderer, elapse } = setup()
    const a = renderer('a')
    keeper.keep(a.renderer, a.release)
    keeper.closed()
    expect(log).toEqual([])
    elapse()
    expect(log).toEqual(['release a', 'dispose a'])
    expect(keeper.size).toBe(0)
  })

  test('keeps it when the stage opens again within the grace (StrictMode)', () => {
    const { keeper, log, renderer, elapse } = setup()
    const a = renderer('a')
    keeper.keep(a.renderer, a.release)
    keeper.closed()
    keeper.opened()
    elapse()
    expect(log).toEqual([])
    keeper.closed()
    elapse()
    expect(log).toEqual(['release a', 'dispose a'])
  })

  test('never hands on, and lets go of, a renderer that finished starting after the stage closed', async () => {
    const { keeper, log, renderer, elapse } = setup()
    keeper.closed()
    elapse()
    const late = renderer('late')
    const handed = keeper.keep(late.renderer, late.release)
    expect(log).toEqual([])
    elapse()
    expect(log).toEqual(['release late', 'dispose late'])
    expect(await settles(handed)).toBe(false)
  })

  test('disposes each renderer once', () => {
    const { keeper, log, renderer, elapse } = setup()
    const a = renderer('a')
    keeper.keep(a.renderer, a.release)
    keeper.closed()
    keeper.closed()
    elapse()
    expect(log).toEqual(['release a', 'dispose a'])
  })
})
