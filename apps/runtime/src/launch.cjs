// `electron .` under `bun dev` starts before the editor's Next server is listening,
// and the committed playUrl names a scene that may only exist on the machine that
// last ran a build. In dev the runtime therefore waits for the server and falls
// back to the dashboard when the scene is missing. A packaged runtime opens its
// published URL as-is: it must never surface the editor dashboard.

const SERVER_TIMEOUT_MS = 5 * 60_000
const PROBE_TIMEOUT_MS = 10_000
const SCENE_CHECK_TIMEOUT_MS = 60_000
const RETRY_DELAY_MS = 1500

const BACKOFF_INITIAL_MS = 250
const BACKOFF_MAX_MS = 2000

// Chromium's ERR_ABORTED: a navigation superseded by another loadURL, not a failure.
const ERR_ABORTED = -3

function backoffDelay(attempt) {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * 2 ** attempt)
}

/** `{ origin, sceneId }` for an http(s) URL; `sceneId` is null unless the path is `/play/:id`. */
function parsePlayUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const match = url.pathname.match(/^\/play\/([^/]+)\/?$/)
  let sceneId = null
  if (match) {
    try {
      sceneId = decodeURIComponent(match[1])
    } catch {}
  }
  return { origin: url.origin, sceneId }
}

/** A plan with a null `origin` means "load `url` directly". */
function planLaunch(playUrl, { packaged }) {
  const parsed = packaged ? null : parsePlayUrl(playUrl)
  return { url: playUrl, origin: parsed?.origin ?? null, sceneId: parsed?.sceneId ?? null }
}

function chooseLaunchUrl(plan, { serverUp, sceneStatus }) {
  if (!serverUp) return { url: plan.url, reason: 'server-timeout' }
  if (sceneStatus === 404) return { url: `${plan.origin}/dashboard`, reason: 'scene-missing' }
  return { url: plan.url, reason: null }
}

function shouldRetryLoad({ errorCode, isMainFrame, retried }) {
  return isMainFrame && errorCode !== ERR_ABORTED && !retried
}

function waitingPageUrl(origin) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>에디터 서버를 기다리는 중…</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#111;color:#eee;font:15px/1.6 system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;text-align:center}small{color:#888;font-size:12px}</style></head><body><div><p>에디터 서버를 기다리는 중…</p><small>${origin}</small></div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/** The HTTP status of a GET, or null when nothing answered in time. */
async function fetchStatus(url, timeoutMs) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    void response.body?.cancel()
    return response.status
  } catch {
    return null
  }
}

/** Any HTTP answer counts: a broken editor should show its own error page, not this wait. */
async function waitForServer(
  origin,
  {
    probe = fetchStatus,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    timeoutMs = SERVER_TIMEOUT_MS,
  } = {},
) {
  const deadline = now() + timeoutMs
  for (let attempt = 0; ; attempt++) {
    if ((await probe(`${origin}/api/health`, PROBE_TIMEOUT_MS)) !== null) return true
    const delay = backoffDelay(attempt)
    if (now() + delay > deadline) return false
    await sleep(delay)
  }
}

async function resolveLaunchUrl(plan, options = {}) {
  if (!plan.origin) return { url: plan.url, reason: null }
  const probe = options.probe ?? fetchStatus
  const serverUp = await waitForServer(plan.origin, options)
  const sceneStatus =
    serverUp && plan.sceneId
      ? await probe(
          `${plan.origin}/api/scenes/${encodeURIComponent(plan.sceneId)}`,
          SCENE_CHECK_TIMEOUT_MS,
        )
      : null
  return chooseLaunchUrl(plan, { serverUp, sceneStatus })
}

module.exports = {
  RETRY_DELAY_MS,
  SERVER_TIMEOUT_MS,
  backoffDelay,
  chooseLaunchUrl,
  parsePlayUrl,
  planLaunch,
  resolveLaunchUrl,
  shouldRetryLoad,
  waitForServer,
  waitingPageUrl,
}
