import { describe, expect, test } from 'bun:test'
import { connectSources, contentSecurityPolicy } from './connect-policy'

/** Whether a URL may be fetched under the sources, as a browser matches them (scheme, host, port). */
function allowed(sources: string[], url: string): boolean {
  const target = new URL(url)
  return sources.some((source) => {
    if (source === "'self'") return target.origin === 'http://localhost:3002'
    if (/^[a-z]+:$/.test(source)) return target.protocol === source
    const pattern = new RegExp(
      `^${source.replace(/[.]/g, '\\.').replace(/:\*$/, '(:\\d+)?').replace(/\*/g, '[^.]+')}$`,
    )
    return pattern.test(target.origin)
  })
}

describe('connect policy', () => {
  test('refuses MediaPipe’s usage log and any other host the app has no use for', () => {
    const sources = connectSources({ NODE_ENV: 'production' })!
    expect(allowed(sources, 'https://odml.pa.googleapis.com/v1/log')).toBe(false)
    expect(allowed(sources, 'https://example.com/upload')).toBe(false)
    expect(sources.some((source) => source.includes('*.googleapis.com'))).toBe(false)
    expect(sources).not.toContain('https:')
    expect(sources).not.toContain('*')
  })

  test('lets through what the app loads: itself, local files, assets, catalog, sign-in, shared worlds, decoders, icons', () => {
    const sources = connectSources({ NODE_ENV: 'production' })!
    for (const url of [
      'http://localhost:3002/api/photo-avatar',
      'https://editor.pascal.app/items/chair/model.glb',
      'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system/cactus/model.glb',
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup',
      'https://securetoken.googleapis.com/v1/token',
      'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel',
      'https://firebasestorage.googleapis.com/v0/b/x/o/deck.pdf',
      'https://mmm-studio-7a14c.firebaseapp.com/__/auth/handler',
      'https://www.gstatic.com/draco/versioned/decoders/1.5.5/draco_decoder.wasm',
      'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/basis_transcoder.wasm',
      'https://api.iconify.design/lucide.json?icons=swatch-book',
      'https://api.simplesvg.com/charm.json?icons=stack-push',
      'https://api.unisvg.com/lucide.json?icons=square',
    ]) {
      expect(allowed(sources, url)).toBe(true)
    }
    expect(sources).toContain('blob:')
    expect(sources).toContain('data:')
  })

  test('follows the configured asset CDN and auth domain', () => {
    const sources = connectSources({
      NEXT_PUBLIC_ASSETS_CDN_URL: 'https://cdn.example.com/assets',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'other-app.firebaseapp.com',
    })!
    expect(sources).toContain('https://cdn.example.com')
    expect(sources).toContain('https://other-app.firebaseapp.com')
    expect(sources).not.toContain('https://editor.pascal.app')
  })

  test('takes in the origins scenes may load assets from, when the owner lists them', () => {
    const sources = connectSources({
      PASCAL_ALLOWED_ASSET_ORIGINS: 'https://models.example.org, https://cdn.other.com/x,ftp://no',
    })!
    expect(allowed(sources, 'https://models.example.org/a/chair.glb')).toBe(true)
    expect(allowed(sources, 'https://cdn.other.com/tex.jpg')).toBe(true)
    expect(sources.some((source) => source.startsWith('ftp'))).toBe(false)
  })

  test('the dev server’s hot-reload socket only in development', () => {
    expect(connectSources({ NODE_ENV: 'development' })).toContain('ws://localhost:*')
    expect(connectSources({ NODE_ENV: 'production' })).not.toContain('ws://localhost:*')
  })

  test('an owner adds their own hosts, or turns the policy off; nothing malformed gets in', () => {
    const sources = connectSources({
      CSP_CONNECT_SRC:
        "https://models.example.org  wss://*.example.net:443 'unsafe-inline' a;b x.example.io",
    })!
    expect(sources).toContain('https://models.example.org')
    expect(sources).toContain('wss://*.example.net:443')
    expect(sources).toContain('https://x.example.io')
    expect(sources.some((source) => source.includes('unsafe') || source.includes(';'))).toBe(false)
    expect(connectSources({ CSP_CONNECT_SRC: 'off' })).toBeNull()
    expect(contentSecurityPolicy({ CSP_CONNECT_SRC: 'off' })).toBeNull()
    expect(contentSecurityPolicy({})).toMatch(/^connect-src 'self' blob: data: /)
  })
})
