/**
 * Where the app's pages (and their workers) may send or fetch anything: a
 * Content-Security-Policy `connect-src`, sent with every response
 * (next.config.ts). It backs up the promise the photo avatar makes — no
 * photo, and nothing read from one, leaves the browser — against any
 * library that would report home (MediaPipe's usage log, see
 * mediapipe-quiet.ts): a request to anywhere not listed is refused by the
 * browser before it is sent. Only fetches, XHR, WebSockets, EventSource and
 * beacons are limited; images, video and scripts load as before.
 *
 * Listed: this server, blob: and data: URLs, and what the app's own code
 * loads from elsewhere —
 * - the asset CDN (`NEXT_PUBLIC_ASSETS_CDN_URL`, else editor.pascal.app) and
 *   the item catalog's storage;
 * - Firebase sign-in, Firestore (shared worlds, presentations) and Storage;
 * - the GLB decoders three.js fetches (Draco from gstatic, KTX2's Basis
 *   transcoder from jsDelivr);
 * - the editor's icons, which @iconify/react fetches by name from Iconify's
 *   API or its two fallback hosts;
 * - the origins scenes may take assets from (`PASCAL_ALLOWED_ASSET_ORIGINS`,
 *   core's asset-url allowlist), when the owner lists them;
 * - in development, the dev server's hot-reload socket.
 * Anything else an owner's own content needs goes in `CSP_CONNECT_SRC`
 * (space-separated origins), and `CSP_CONNECT_SRC=off` sends no policy.
 * Never a wildcard over googleapis.com: MediaPipe reports to one of its hosts.
 */

type Env = Record<string, string | undefined>

const CATALOG_STORAGE = 'https://byrpxoiotywskoojsrzd.supabase.co'
const DEFAULT_ASSETS = 'https://editor.pascal.app'
const DEFAULT_AUTH_DOMAIN = 'https://mmm-studio-7a14c.firebaseapp.com'
const FIREBASE = [
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://firestore.googleapis.com',
  'https://firebasestorage.googleapis.com',
]
const DECODERS = ['https://www.gstatic.com', 'https://cdn.jsdelivr.net']
const ICONS = ['https://api.iconify.design', 'https://api.simplesvg.com', 'https://api.unisvg.com']
const DEV_SOCKETS = ['ws://localhost:*', 'ws://127.0.0.1:*']

/** A URL's origin, or null when it is not an http(s) URL. */
function originOf(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/** A source an owner listed, as CSP takes it: an origin (wildcards allowed), else nothing. */
function sourceOf(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || /[;,'"\s]/.test(trimmed)) return null
  if (/^(https?|wss?):\/\/[a-z0-9*.-]+(:(\d+|\*))?$/i.test(trimmed)) return trimmed
  return originOf(trimmed)
}

/** The `connect-src` sources, or null when the owner turned the policy off. */
export function connectSources(env: Env = process.env): string[] | null {
  const extra = env.CSP_CONNECT_SRC?.trim()
  if (extra === 'off') return null
  const sources = [
    "'self'",
    'blob:',
    'data:',
    originOf(env.NEXT_PUBLIC_ASSETS_CDN_URL) ?? DEFAULT_ASSETS,
    CATALOG_STORAGE,
    ...FIREBASE,
    originOf(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) ?? DEFAULT_AUTH_DOMAIN,
    ...DECODERS,
    ...ICONS,
    ...(env.PASCAL_ALLOWED_ASSET_ORIGINS?.split(',').map(originOf) ?? []),
    ...(env.NODE_ENV === 'development' ? DEV_SOCKETS : []),
    ...(extra ? extra.split(/\s+/).map(sourceOf) : []),
  ]
  return [...new Set(sources.filter((source): source is string => Boolean(source)))]
}

/** The policy header's value, or null when there is none to send. */
export function contentSecurityPolicy(env: Env = process.env): string | null {
  const sources = connectSources(env)
  return sources ? `connect-src ${sources.join(' ')}` : null
}
