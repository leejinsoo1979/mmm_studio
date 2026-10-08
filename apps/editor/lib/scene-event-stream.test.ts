import { afterEach, expect, spyOn, test } from 'bun:test'
import { createSceneEventStream } from './scene-event-stream'

const POLL_MS = 5
const decoder = new TextDecoder()

type Event = { eventId: number; kind: string }

function recorder(batches: Event[][] = []) {
  const calls: number[] = []
  const listEvents = async (afterEventId: number) => {
    calls.push(afterEventId)
    return batches.shift() ?? []
  }
  return { calls, listEvents }
}

async function readAll(stream: ReadableStream<Uint8Array>, until: (text: string) => boolean) {
  const reader = stream.getReader()
  let text = ''
  while (!until(text)) {
    const { done, value } = await reader.read()
    if (done) return { text, done: true, reader }
    text += decoder.decode(value)
  }
  return { text, done: false, reader }
}

const spies: { mockRestore(): void }[] = []
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

test('a client that already left gets a closed stream and no polling', async () => {
  const controller = new AbortController()
  controller.abort()
  const { calls, listEvents } = recorder()
  const stream = createSceneEventStream({
    signal: controller.signal,
    cursor: 0,
    listEvents,
    pollMs: POLL_MS,
  })

  const first = await Promise.race([
    stream.getReader().read(),
    Bun.sleep(POLL_MS * 20).then(() => 'still open'),
  ])
  expect(first).toEqual({ done: true, value: undefined })
  expect(calls).toEqual([])
})

test('streams events after the cursor and advances it', async () => {
  const controller = new AbortController()
  const { calls, listEvents } = recorder([
    [
      { eventId: 4, kind: 'a' },
      { eventId: 5, kind: 'b' },
    ],
    [],
    [{ eventId: 7, kind: 'c' }],
  ])
  const stream = createSceneEventStream({
    signal: controller.signal,
    cursor: 3,
    listEvents,
    pollMs: POLL_MS,
  })

  const { text: head, done, reader } = await readAll(stream, (t) => t.includes('id: 7'))
  expect(done).toBe(false)
  controller.abort()
  let text = head
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    text += decoder.decode(chunk.value)
  }
  expect(calls.slice(0, 3)).toEqual([3, 5, 5])
  expect(text).toBe(
    [
      'retry: 1000\n\n',
      'id: 4\nevent: scene\ndata: {"eventId":4,"kind":"a"}\n\n',
      'id: 5\nevent: scene\ndata: {"eventId":5,"kind":"b"}\n\n',
      'id: 7\nevent: scene\ndata: {"eventId":7,"kind":"c"}\n\n',
    ].join(''),
  )
})

test('stops polling when the client aborts or cancels', async () => {
  for (const end of ['abort', 'cancel'] as const) {
    const controller = new AbortController()
    const { calls, listEvents } = recorder()
    const stream = createSceneEventStream({
      signal: controller.signal,
      cursor: 0,
      listEvents,
      pollMs: POLL_MS,
    })
    const reader = stream.getReader()
    await reader.read()
    await Bun.sleep(POLL_MS * 4)
    if (end === 'abort') controller.abort()
    else await reader.cancel()
    const count = calls.length
    await Bun.sleep(POLL_MS * 10)
    expect(calls.length).toBe(count)
  }
})

test('never runs two polls at once when the store is slow', async () => {
  const controller = new AbortController()
  let active = 0
  let most = 0
  let polls = 0
  const stream = createSceneEventStream({
    signal: controller.signal,
    cursor: 0,
    pollMs: POLL_MS,
    listEvents: async () => {
      polls++
      active++
      most = Math.max(most, active)
      await Bun.sleep(POLL_MS * 4)
      active--
      return []
    },
  })
  const reader = stream.getReader()
  await reader.read()
  await Bun.sleep(POLL_MS * 30)
  controller.abort()
  expect(polls).toBeGreaterThan(2)
  expect(most).toBe(1)
})

// Re-arming a setTimeout from each poll's continuation is what React's dev async debug hook
// chained into an ever-growing list; the stream must create its timers once.
test('creates its timers once, not once per poll', async () => {
  const setTimeoutSpy = spyOn(globalThis, 'setTimeout')
  const setIntervalSpy = spyOn(globalThis, 'setInterval')
  spies.push(setTimeoutSpy, setIntervalSpy)
  const controller = new AbortController()
  const { calls, listEvents } = recorder()
  const stream = createSceneEventStream({
    signal: controller.signal,
    cursor: 0,
    listEvents,
    pollMs: POLL_MS,
  })
  const reader = stream.getReader()
  await reader.read()
  await Bun.sleep(POLL_MS * 20)
  controller.abort()

  expect(calls.length).toBeGreaterThan(5)
  expect(setIntervalSpy).toHaveBeenCalledTimes(2)
  expect(setTimeoutSpy).not.toHaveBeenCalled()
})
