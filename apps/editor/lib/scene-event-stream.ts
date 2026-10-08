export const SCENE_EVENT_POLL_MS = 250
export const SCENE_EVENT_HEARTBEAT_MS = 15_000

export interface SceneEventStreamOptions<Event extends { eventId: number }> {
  signal: AbortSignal
  cursor: number
  listEvents: (afterEventId: number) => Promise<Event[]>
  pollMs?: number
  heartbeatMs?: number
}

/** Server-sent events for one scene, read by polling the scene store. */
export function createSceneEventStream<Event extends { eventId: number }>({
  signal,
  cursor,
  listEvents,
  pollMs = SCENE_EVENT_POLL_MS,
  heartbeatMs = SCENE_EVENT_HEARTBEAT_MS,
}: SceneEventStreamOptions<Event>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let closed = false
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    closed = true
    clearInterval(pollTimer)
    clearInterval(heartbeatTimer)
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk))
      }
      const close = () => {
        if (closed) return
        stop()
        try {
          controller.close()
        } catch {
          // The client may have already closed the stream.
        }
      }

      // A client that left before the stream existed (a reload while the route compiled, an
      // EventSource retry) has already fired `abort`, which never fires again, and Next drops
      // the response without cancelling the stream: without this check its timers ran forever.
      if (signal.aborted) {
        close()
        return
      }
      signal.addEventListener('abort', close, { once: true })
      enqueue('retry: 1000\n\n')

      // One interval for the stream's lifetime, not a setTimeout re-armed after each poll: in
      // dev, React's async debug hook links every timer created in the previous poll's
      // continuation to that poll, so the chain (and the server heap) grew with every poll.
      let polling = false
      const poll = async () => {
        if (closed || polling) return
        polling = true
        try {
          for (const event of await listEvents(cursor)) {
            cursor = event.eventId
            enqueue(`id: ${event.eventId}\nevent: scene\ndata: ${JSON.stringify(event)}\n\n`)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          enqueue(`event: error\ndata: ${JSON.stringify({ message })}\n\n`)
        } finally {
          polling = false
        }
      }

      heartbeatTimer = setInterval(() => enqueue(': keepalive\n\n'), heartbeatMs)
      pollTimer = setInterval(poll, pollMs)
      void poll()
    },
    cancel: stop,
  })
}
