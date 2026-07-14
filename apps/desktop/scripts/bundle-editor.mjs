import { execSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Builds the editor and stages its Next standalone output under
 * apps/desktop/bundle/ for electron-builder to package.
 *
 * Standalone layout (monorepo): .next/standalone mirrors the repo root, so
 * the server entry lands at bundle/apps/editor/server.js — main.cjs boots
 * that file. Static assets and /public are NOT traced into standalone and
 * must be copied next to it by hand (Next documents this).
 */
const desktopDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(desktopDir, '..', '..')
const editorDir = path.join(repoRoot, 'apps', 'editor')
const bundleDir = path.join(desktopDir, 'bundle')

console.log('[bundle] building editor (next standalone)...')
execSync('npx -y bun@1.3.13 run build --filter=editor', { cwd: repoRoot, stdio: 'inherit' })

const standaloneDir = path.join(editorDir, '.next', 'standalone')
if (!existsSync(standaloneDir)) {
  throw new Error(`standalone output missing at ${standaloneDir} — is output:'standalone' set?`)
}

console.log('[bundle] staging bundle/ ...')
rmSync(bundleDir, { recursive: true, force: true })
cpSync(standaloneDir, bundleDir, { recursive: true })
cpSync(
  path.join(editorDir, '.next', 'static'),
  path.join(bundleDir, 'apps', 'editor', '.next', 'static'),
  { recursive: true },
)
cpSync(path.join(editorDir, 'public'), path.join(bundleDir, 'apps', 'editor', 'public'), {
  recursive: true,
})

console.log(`[bundle] done → ${bundleDir}`)
