// Finds every Rocketbox character's face landmarks on its head's front view
// (the face swap warps a photo onto them) and writes the table the editor
// fetches:
//
//   bun scripts/characters/gen-face-points.ts [previews_dir]
//
// It bundles face-points-harness.ts, serves it with the editor's public files
// (the characters and the vendored MediaPipe), and runs it in headless
// Chromium through Playwright (`bunx playwright install chromium` once, or
// CHROMIUM_PATH for a Chromium already installed). With previews_dir it also saves each front view
// with its landmarks drawn, to check them by eye.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FACE_POINT_COUNT } from '../../packages/editor/src/components/editor/first-person/face-points'
import { ROCKETBOX_AVATARS } from '../../packages/editor/src/components/editor/first-person/rocketbox-catalog'

const root = resolve(import.meta.dir, '../..')
const publicDir = join(root, 'apps/editor/public')
const out = join(publicDir, 'characters/rocketbox/face-points.json')
const previews = process.argv[2] ? resolve(process.argv[2]) : null

const bundle = await Bun.build({
  entrypoints: [join(import.meta.dir, 'face-points-harness.ts')],
  target: 'browser',
  minify: true,
})
if (!bundle.success) throw new AggregateError(bundle.logs, 'harness bundle failed')
const script = await bundle.outputs[0]!.text()

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname)
    if (path === '/') {
      return new Response('<!doctype html><script type="module" src="/harness.js"></script>', {
        headers: { 'content-type': 'text/html' },
      })
    }
    if (path === '/harness.js') {
      return new Response(script, { headers: { 'content-type': 'text/javascript' } })
    }
    const file = Bun.file(join(publicDir, path))
    return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 })
  },
})

const { chromium } = await import('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => console.error('page:', error.message))
  await page.goto(`http://localhost:${server.port}/`)
  await page.waitForFunction(() => 'facePoints' in window)
  const avatars: Record<string, number[]> = {}
  const missed: string[] = []
  const ids = ROCKETBOX_AVATARS.map((avatar) => avatar.id)
  // A batch at a time, so a failure shows where it happened.
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10)
    const found = await page.evaluate(
      (batch) =>
        (window as unknown as { facePoints: (ids: string[]) => Promise<unknown> }).facePoints(
          batch,
        ),
      batch,
    )
    for (const face of found as { id: string; points: number[] | null; yaw: number; preview: string }[]) {
      if (face.points) avatars[face.id] = face.points
      else missed.push(face.id)
      console.log(`${face.id}: ${face.points ? `found, yaw ${face.yaw.toFixed(1)}°` : 'NO FACE'}`)
      if (previews && face.preview) {
        mkdirSync(previews, { recursive: true })
        writeFileSync(
          join(previews, `${face.id}.jpg`),
          Buffer.from(face.preview.split(',')[1]!, 'base64'),
        )
      }
    }
  }
  writeFileSync(out, `${JSON.stringify({ count: FACE_POINT_COUNT, avatars })}\n`)
  console.log(`${Object.keys(avatars).length} faces → ${out}`)
  if (missed.length) console.log(`no face found: ${missed.join(', ')}`)
} finally {
  await browser.close()
  server.stop()
}
