// Bundles the bench page (page/main.ts: this checkout's app and package modules, three left to the
// page's import map), the package's photo avatar worker, and its Safari stand-in, into `out`.
import { copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dir, '../../..')
const PAGE = join(REPO, 'scripts/photo-avatar/page')

type Plugin = Parameters<typeof Bun.build>[0]['plugins'] extends (infer P)[] | undefined ? P : never

const shims: Plugin = {
  name: 'bench-shims',
  setup(build) {
    build.onResolve({ filter: /^@pascal-app\/editor$/ }, () => ({ path: join(PAGE, 'editor-shim.ts') }))
    build.onResolve({ filter: /^@pascal-app\/viewer$/ }, () => ({ path: join(PAGE, 'viewer-shim.ts') }))
    build.onResolve({ filter: /^@\/lib\// }, (args) => ({
      path: join(REPO, 'apps/editor', `${args.path.slice(2)}.ts`),
    }))
  },
}

export async function buildPage(out: string) {
  mkdirSync(out, { recursive: true })
  const define = { 'process.env.NODE_ENV': '"production"' }
  const results = [
    await Bun.build({
      entrypoints: [join(PAGE, 'main.ts')],
      outdir: out,
      naming: 'main.js',
      target: 'browser',
      format: 'esm',
      external: ['three', 'three/*'],
      plugins: [shims],
      define,
    }),
    await Bun.build({
      entrypoints: [
        join(REPO, 'packages/editor/src/components/editor/first-person/photo-avatar/avatar-worker.ts'),
      ],
      outdir: out,
      naming: 'avatar-worker.js',
      target: 'browser',
      format: 'esm',
      define,
    }),
    await Bun.build({
      entrypoints: [join(PAGE, 'safari-worker.ts')],
      outdir: out,
      naming: 'safari-worker.js',
      target: 'browser',
      format: 'esm',
      define,
    }),
  ]
  for (const result of results) {
    if (!result.success) {
      for (const log of result.logs) console.error(log)
      throw new Error('bench page build failed')
    }
  }
  copyFileSync(join(PAGE, 'index.html'), join(out, 'index.html'))
  return results.flatMap((r) => r.outputs.map((o) => `${o.path} ${o.size}`))
}

if (import.meta.main) {
  const out = process.argv[2]
  if (!out) throw new Error('usage: bun build-page.ts <out dir>')
  console.log((await buildPage(out)).join('\n'))
}
