/**
 * MediaPipe's tasks (tasks-vision 1.0) report their use — which task, its
 * running mode, how long each frame took — to Google once a minute and when
 * closed (`https://odml.pa.googleapis.com/v1/log`), through the page's
 * `fetch`. No pixel goes, but the photo features promise that nothing about
 * a player's photos leaves this browser, so the report is refused before it
 * is sent: MediaPipe takes it as a failed send and stops trying. Every other
 * request goes through untouched.
 */

const USAGE_LOG = 'https://odml.pa.googleapis.com/'

let quiet = false

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

/** Refuses MediaPipe's usage reports from now on (call before a task is created; once is enough). */
export function quietMediaPipe() {
  if (quiet || typeof globalThis.fetch !== 'function') return
  quiet = true
  const send = globalThis.fetch.bind(globalThis)
  globalThis.fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) =>
      urlOf(input).startsWith(USAGE_LOG)
        ? Promise.reject(new TypeError('MediaPipe usage reports stay in this browser'))
        : send(input, init),
    send,
  )
}
