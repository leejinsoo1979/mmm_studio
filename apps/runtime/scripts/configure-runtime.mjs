import { readFile, writeFile } from 'node:fs/promises'

const playUrl = process.argv[2]
const sceneName = process.argv[3] || 'MMM Studio Experience'
if (!playUrl) throw new Error('Usage: node scripts/configure-runtime.mjs <play-url> [scene-name]')

const target = new URL('../runtime-config.json', import.meta.url)
const current = JSON.parse(await readFile(target, 'utf8'))
await writeFile(target, `${JSON.stringify({ ...current, playUrl, sceneName }, null, 2)}\n`)
