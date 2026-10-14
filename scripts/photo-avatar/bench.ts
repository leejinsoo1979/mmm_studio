// The photo avatar acceptance bench (see README.md): known heads photographed under known cameras
// and lights, avatars made from those photos by the app's real reading and worker, and every gate
// measured against the truth. Per head a JSON and Markdown report, and a gate table across heads.
//
//   bun scripts/photo-avatar/bench.ts --set tuning
//   bun scripts/photo-avatar/bench.ts --heads f01,m12 --configs five,perturbed
//   bun scripts/photo-avatar/bench.ts --heldout rocketbox:Business_Male_03,mpfb:101
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { brotliCompressSync, constants as zlib } from 'node:zlib'
import type { FixtureView } from '../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/fixture'
import {
  type Check,
  g1Checks,
  g2Checks,
  g4SingleChecks,
  g4ThreeChecks,
} from '../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/gates'
import {
  type Call,
  type Chrome,
  openBench,
  PORTS,
  startChrome,
  startDisplay,
  startServer,
  stopChrome,
} from './lib/browser'
import { deltaERgb } from '../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/colour'
import { buildPage } from './lib/build-page'
import { STYLE_NAMES, styleGlb } from './lib/hair-styles'
import { type Head, heldOutHead, TUNING } from './lib/heads'
import {
  g3Checks,
  g5Checks,
  g6Checks,
  g7Checks,
  g8Checks,
  g9Checks,
  gateTable,
  headMarkdown,
} from './lib/report'
import {
  cleanShots,
  perturbedShots,
  referenceShot,
  SLOTS,
  type ShotSpec,
  seedOf,
  skinShots,
  turntable,
} from './lib/shots'

const REPO = resolve(import.meta.dir, '../..')
const CONFIGS = ['five', 'three', 'single', 'perturbed', 'webcam', 'safari'] as const
type Config = (typeof CONFIGS)[number]

const { values: flags } = parseArgs({
  options: {
    set: { type: 'string' },
    heads: { type: 'string' },
    heldout: { type: 'string' },
    configs: { type: 'string' },
    out: { type: 'string' },
    cache: { type: 'string' },
    fixtures: { type: 'boolean', default: false },
    'fixtures-out': { type: 'string' },
    'keep-images': { type: 'boolean', default: true },
    'hair-styles': { type: 'boolean', default: false },
    styles: { type: 'string' },
  },
})

const cache = resolve(flags.cache ?? process.env.BENCH_CACHE ?? join(tmpdir(), 'photo-avatar-bench'))
const heldout = Boolean(flags.heldout)
let heads: Head[]
if (flags['hair-styles']) heads = []
else if (flags.heldout) {
  if (flags.set || flags.heads) throw new Error('--heldout runs held-out heads only')
  heads = flags.heldout.split(',').map((id) => heldOutHead(id.trim(), REPO, cache))
} else if (flags.heads) {
  heads = flags.heads.split(',').map((id) => {
    const found = TUNING.find((h) => h.id === id.trim())
    if (!found) throw new Error(`${id} is not a tuning head (held-out heads need --heldout)`)
    return found
  })
} else if (flags.set === 'tuning') heads = TUNING
else throw new Error('pick --set tuning, --heads <tuning ids> or --heldout <ids>')

const configs = new Set<Config>(
  (flags.configs ? flags.configs.split(',') : CONFIGS).map((c) => {
    if (!(CONFIGS as readonly string[]).includes(c)) throw new Error(`unknown config ${c}`)
    return c as Config
  }),
)
const out = resolve(flags.out ?? join(cache, 'out', flags['hair-styles'] ? 'hair-styles' : heldout ? 'heldout' : 'tuning'))
const dist = join(cache, 'dist')
mkdirSync(out, { recursive: true })

const commit = execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim()
const dirty = execSync('git status --porcelain', { cwd: REPO }).toString().trim() ? '+changes' : ''

for (const head of heads) {
  if (head.kind === 'mpfb' && !existsSync(join(cache, `${head.id}.glb`)))
    throw new Error(`${head.id}: make it first (README.md, "MPFB heads")`)
  if (head.kind === 'scan' && !existsSync(join(cache, head.url.replace('./heads/', ''))))
    throw new Error(`${head.id}: its scan is not in ${cache}`)
}

console.log(`bench ${commit}${dirty}: ${heads.map((h) => h.id).join(', ')} × ${[...configs].join(', ')} → ${out}`)
console.log((await buildPage(dist)).join('\n'))
await startDisplay(PORTS.display)
const server = startServer(PORTS.http, REPO, dist, cache)

const save = (file: string, dataUrl: string) => {
  const path = join(out, file)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1]!, 'base64'))
}
const saveGlb = (file: string, base64: string) => {
  const path = join(out, file)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, Buffer.from(base64, 'base64'))
}
const saveJson = (file: string, value: unknown) => {
  const path = join(out, file)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 1))
}

async function session(fakeVideo?: string): Promise<{ chrome: Chrome; call: Call }> {
  const chrome = await startChrome(PORTS, join(cache, 'profile'), fakeVideo)
  const call = await openBench(chrome, PORTS.http)
  await call('init')
  return { chrome, call }
}

/** The truth loaded and its landmarks lifted from a straight-on photo: the page's truth summary. */
async function prepareTruth(call: Call, head: Head) {
  const loaded = await call('loadTruth', head)
  const shot = referenceShot()
  const [reference] = await call<{ url: string }[]>('photograph', [shot])
  const lifted = await call('liftLandmarks', reference!.url, shot)
  return { loaded, lifted, referenceUrl: reference!.url }
}

const elapsed = (t0: number) => Math.round((performance.now() - t0) / 100) / 10

async function runHead(head: Head, first: boolean) {
  const t0 = performance.now()
  const result: any = { head: head.id, at: new Date().toISOString(), commit: `${commit}${dirty}`, configs: {}, errors: [] as string[] }
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      const value = await run()
      console.log(`  ${head.id} ${name} ${elapsed(t0)} s`)
      return value
    } catch (error) {
      const message = `${name}: ${error instanceof Error ? error.message : String(error)}`
      console.log(`  ${head.id} FAILED ${message}`)
      result.errors.push(message)
      return null
    }
  }
  let { chrome, call } = await session()
  try {
    const truth = await prepareTruth(call, head)
    result.truth = {
      ...truth.loaded,
      // A head with no hair of its own geometry (a buzz cut) has its hair's colour painted on.
      hairAlbedo: truth.loaded.hairAlbedo ?? (head.hair === 'bald' ? null : truth.lifted.paintedHair),
      bareShare: truth.lifted.bareShare,
      lifted: truth.lifted.lifted,
    }
    save(`${head.id}/reference.jpg`, truth.referenceUrl)
    const summary = truth.lifted.summary
    const base = await call('measureBase', head.gender)
    result.base = base

    const clean = cleanShots()
    const cleanPhotos = await call<{ url: string }[]>('photograph', clean)
    cleanPhotos.forEach((p, k) => save(`${head.id}/inputs/clean-${SLOTS[k]}.png`, p.url))
    const photos = (shots: ShotSpec[], urls: { url: string }[], slots: readonly string[]) =>
      slots.map((slot) => ({ url: urls[SLOTS.indexOf(slot as never)]!.url, slot }))

    const requestsBefore = chrome.requests.length
    const build = async (name: string, list: { url: string; slot: string }[], worker?: string) => {
      const built = await call('build', { name, photos: list, gender: head.gender, ...(worker ? { worker } : {}) })
      const measured = await call('measure', name)
      return { ...built, geometry: measured.report, legacy: measured.legacy, exact: measured.exact }
    }

    const fixtures: any = {}
    if (configs.has('five')) {
      const five = await step('five', () => build('five', photos(clean, cleanPhotos, SLOTS)))
      if (five) {
        result.configs.five = five
        saveGlb(`${head.id}/avatar-five.glb`, await call('glbBase64', 'five'))
        fixtures.five = await step('five fixture', async () => compressMaps(await call('fixtureViews', 'five', clean)))
        result.network = summariseNetwork(chrome.requests.slice(requestsBefore))
        result.likeness = await step('likeness', () => call('likeness', 'five', clean, cleanPhotos.map((p) => p.url)))
        for (const view of result.likeness ?? []) {
          save(`${head.id}/likeness/${view.slot}.jpg`, view.avatarUrl)
          delete view.avatarUrl
        }
        result.skin = {
          soft: await step('skin (soft photos)', () => skin(call, head, 'five', five.geometry.alignment.transform)),
        }
        result.hair = await step('hair', () => hair(call, head, 'five'))
        result.eyes = await step('eyes', () => eyes(call, 'five', five.geometry.alignment.transform))
      }
    }
    if (configs.has('three'))
      result.configs.three = await step('three', () => build('three', photos(clean, cleanPhotos, ['front', 'left45', 'right45'])))
    if (configs.has('single'))
      result.configs.single = await step('single', () => build('single', photos(clean, cleanPhotos, ['front'])))

    const perturbed = perturbedShots(seedOf(head.id))
    result.perturbation = perturbed.map(({ yaw, pitch, roll, focal, fill, expression }) => ({ yaw, pitch, roll, focal, fill, expression }))
    if (configs.has('perturbed')) {
      const shots = await call<{ url: string }[]>('photograph', perturbed)
      shots.forEach((p, k) => save(`${head.id}/inputs/perturbed-${SLOTS[k]}.jpg`, p.url))
      const built = await step('perturbed', () => build('perturbed', SLOTS.map((slot, k) => ({ url: shots[k]!.url, slot }))))
      if (built) {
        result.configs.perturbed = built
        saveGlb(`${head.id}/avatar-perturbed.glb`, await call('glbBase64', 'perturbed'))
        fixtures.perturbed = await step('perturbed fixture', async () =>
          compressMaps(await call('fixtureViews', 'perturbed', perturbed)),
        )
        result.skin ??= {}
        result.skin.hard = await step('skin (hard photos)', () =>
          skin(call, head, 'perturbed', built.geometry.alignment.transform),
        )
      }
    }
    if (configs.has('safari') && first)
      result.safari = await step('safari', async () => {
        await call('build', { name: 'safari', photos: photos(clean, cleanPhotos, SLOTS), gender: head.gender, worker: './safari-worker.js' })
        return call('glbFacts', 'safari')
      })
    for (const name of ['five', 'three', 'single', 'perturbed', 'safari']) await call('forget', name).catch(() => {})

    if (configs.has('webcam')) {
      await stopChrome(chrome)
      const clip = await step('webcam clip', () => writeClip(head, perturbed[0]!))
      if (clip) {
        ;({ chrome, call } = await session(clip))
        result.configs.webcam = await step('webcam', async () => {
          await prepareTruth(call, head)
          const capture = await call('webcamCapture', 240_000)
          capture.shots.forEach((s: { slot: string; url: string }) => save(`${head.id}/inputs/webcam-${s.slot}.png`, s.url))
          const summaryOfCapture = { found: capture.shots.map((s: { slot: string; at: number }) => [s.slot, s.at]), seconds: capture.seconds, size: capture.size, messages: capture.messages }
          if (capture.shots.length < 5) return { capture: summaryOfCapture }
          const built = await build('webcam', capture.shots.map((s: { slot: string; url: string }) => ({ url: s.url, slot: s.slot })))
          return { capture: { ...summaryOfCapture, shots: capture.shots.map((s: { slot: string }) => s.slot) }, ...built }
        })
        rmSync(clip, { force: true })
      }
    }

    result.checks = verdicts(head, result, base)
    if (fixtures.five && fixtures.perturbed)
      result.fixture = {
        id: head.id,
        gender: head.gender,
        source: head.source,
        licence: head.licence,
        truth: summary,
        views: { five: fixtures.five, perturbed: fixtures.perturbed },
        bench: Object.fromEntries(
          ['five', 'three', 'single', 'perturbed'].map((c) => [c, result.configs[c]?.geometry ?? null]),
        ),
      }
  } finally {
    await stopChrome(chrome)
  }
  result.seconds = elapsed(t0)
  return result
}

/** A fixture's packed maps, brotli'd (as __bench__/gates.test.ts undoes). */
function compressMaps(views: FixtureView[]): FixtureView[] {
  const brotli = (text: string | null) =>
    text === null
      ? null
      : brotliCompressSync(Buffer.from(text, 'base64'), {
          params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_LGWIN]: 24 },
        }).toString('base64')
  return views.map((v) => ({
    ...v,
    mask: brotli(v.mask),
    skin: brotli(v.skin),
    covered: brotli(v.covered),
    classes: brotli(v.classes ?? null),
  }))
}

/** Everything sent from the page or its workers during the five-photo build: none may leave its server or carry a body. */
function summariseNetwork(requests: Chrome['requests']) {
  const local = `http://127.0.0.1:${PORTS.http}/`
  const outside = requests.filter(
    (r) => !(r.url.startsWith(local) || r.url.startsWith('blob:') || r.url.startsWith('data:')) || r.method !== 'GET' || r.postBytes !== 0,
  )
  return {
    requests: requests.length,
    fromWorkers: requests.filter((r) => r.from === 'worker').length,
    outside: outside.length,
    examples: outside.slice(0, 10),
  }
}

async function skin(call: Call, head: Head, name: string, align: unknown) {
  const renders: Record<string, any[]> = {}
  for (const light of ['soft', 'hard'] as const) {
    renders[light] = await call('skinRenders', name, skinShots(light), align)
    for (const r of renders[light]!) {
      save(`${head.id}/skin/${name}-${light}-${r.yaw}-truth.jpg`, r.truthUrl)
      save(`${head.id}/skin/${name}-${light}-${r.yaw}-avatar.jpg`, r.avatarUrl)
      delete r.truthUrl
      delete r.avatarUrl
    }
  }
  return { renders, texture: await call('textureSkin', name) }
}

async function hair(call: Call, head: Head, name: string) {
  const avatar = await call('avatarHair', name)
  const holes = await call('hairHoles', name)
  for (const shot of holes.sheet) {
    save(`${head.id}/hair/${shot.pose}-${shot.view}.jpg`, shot.url)
    save(`${head.id}/hair/holes-${shot.pose}-${shot.view}.png`, shot.holes)
  }
  return { avatar, holes: { results: holes.results, stretch: holes.stretch } }
}

async function eyes(call: Call, name: string, align: unknown) {
  const facts = await call('glbFacts', name)
  const lip = await call('lipLine', name, skinShots('soft')[0], align)
  return { facts, lip }
}

/**
 * How much of the clip's height the head fills: as close as a person sits once the guide has asked
 * them to come closer (its eyes then about a tenth of the frame's width apart; it wants 7 %).
 */
const WEBCAM_FILL = 0.65

/**
 * The turntable clip as MJPEG (Chromium's fake camera plays it in a loop at 30 frames a second),
 * each pose drawn once for two frames.
 */
async function writeClip(head: Head, like: ShotSpec): Promise<string> {
  const { chrome, call } = await session()
  try {
    await call('loadTruth', head)
    const frames = turntable().filter((_, k) => k % 2 === 0)
    const shot: ShotSpec = { ...like, fill: WEBCAM_FILL, shift: [0, 0], expression: 0, format: 'jpeg', quality: 0.9 }
    const path = join(cache, `clip-${head.id}.mjpeg`)
    const parts: Buffer[] = []
    for (let i = 0; i < frames.length; i += 30) {
      const urls = await call<string[]>('clipFrames', shot, frames.slice(i, i + 30))
      for (const url of urls) {
        const frame = Buffer.from(url.split(',')[1]!, 'base64')
        parts.push(frame, frame)
      }
    }
    writeFileSync(path, Buffer.concat(parts))
    return path
  } finally {
    await stopChrome(chrome)
  }
}

/** Whether the app labels a one-photo avatar's profile as estimated (G4). */
function labelsSingle(): boolean {
  const found = Bun.spawnSync(['grep', '-rq', '옆모습 추정', 'apps/editor/components', 'apps/editor/lib'], { cwd: REPO })
  return found.exitCode === 0
}

function verdicts(head: Head, result: any, base: any): Check[] {
  const checks: Check[] = []
  const missing = (gate: string, config: string) =>
    checks.push({ gate, name: `${config} ran`, value: Number.NaN, limit: 'ran', pass: false })
  const geometry = (config: string) => result.configs[config]?.geometry
  const real = head.absoluteScale
  if (configs.has('five')) {
    if (geometry('five')) checks.push(...g1Checks(geometry('five'), real))
    else missing('G1', 'five')
  }
  if (configs.has('perturbed')) {
    if (geometry('perturbed')) checks.push(...g2Checks(geometry('perturbed'), real))
    else missing('G2', 'perturbed')
  }
  if (configs.has('webcam')) checks.push(...g3Checks(result.configs.webcam, result.configs.perturbed))
  if (configs.has('three')) {
    if (geometry('three')) checks.push(...g4ThreeChecks(geometry('three')))
    else missing('G4-three', 'three')
  }
  if (configs.has('single')) {
    if (geometry('single')) checks.push(...g4SingleChecks(geometry('single'), base))
    else missing('G4-single', 'single')
    const labelled = labelsSingle()
    checks.push({ gate: 'G4-single', name: 'UI says 옆모습 추정', value: labelled ? 1 : 0, limit: 'shown', pass: labelled })
  }
  if (configs.has('five')) {
    checks.push(...g5Checks(result.likeness))
    checks.push(...g6Checks(result.skin))
    checks.push(...g7Checks(result.hair && { ...result.hair, colourDeltaE: hairDeltaE(result) }, head, result.truth?.hairClass))
    const front = result.skin?.soft?.renders?.soft?.find((r: { yaw: number }) => r.yaw === 0)
    checks.push(...g8Checks(result.eyes && { ...result.eyes, irisDeltaE: front?.iris }))
    const five = result.configs.five
    checks.push(
      ...g9Checks({
        seconds: five ? five.seconds.read + five.seconds.build : Number.NaN,
        bytes: five?.bytes,
        network: result.network,
        safari: result.safari,
      }),
    )
  }
  return checks
}

/** The avatar's hair albedo against the truth's (CIEDE2000). */
function hairDeltaE(result: any): number {
  const a = result.hair?.avatar?.albedo
  const t = result.truth?.hairAlbedo
  return a && t ? deltaERgb(a, t) : Number.NaN
}

/**
 * The hair library's styles on both base bodies at rest (and bald): each one's class as the bench
 * reads an avatar's, its picture's colour, and holes from 8 sides in 3 poses, with every view saved.
 */
async function hairStyles() {
  const { chrome, call } = await session()
  const rows: any[] = []
  try {
    for (const gender of ['male', 'female'] as const) {
      for (const style of [null, ...STYLE_NAMES]) {
        const id = `${style ?? 'bald'}-${gender}`
        if (flags.styles && !flags.styles.split(',').includes(id)) continue
        const file = join(cache, 'styles', `${id}.glb`)
        mkdirSync(join(cache, 'styles'), { recursive: true })
        const glb = await styleGlb(style, gender)
        writeFileSync(file, glb)
        await call('adopt', id, `./heads/styles/${id}.glb`, gender)
        const avatar = await call('avatarHair', id)
        const holes = await call('hairHoles', id)
        for (const shot of holes.sheet) {
          save(`${id}/${shot.pose}-${shot.view}.jpg`, shot.url)
          save(`${id}/holes-${shot.pose}-${shot.view}.png`, shot.holes)
        }
        const worst = Math.max(...holes.results.map((r: any) => (Number.isFinite(r.holes) ? r.holes : 1)))
        const torn = Math.max(0, ...holes.stretch.map((s: any) => s.torn))
        rows.push({ style: style ?? 'bald', gender, class: avatar.class, albedo: avatar.albedo, bytes: glb.byteLength, worstHole: worst, torn, holes: holes.results, stretch: holes.stretch })
        console.log(`  ${id}: ${avatar.class.length} (lowest ${avatar.class.lowest?.toFixed(3)}), worst hole ${(worst * 100).toFixed(3)} %, torn ${(torn * 100).toFixed(2)} %, ${glb.byteLength} bytes`)
        await call('forget', id)
      }
    }
  } finally {
    await stopChrome(chrome)
  }
  saveJson('styles.json', rows)
  const table = [
    '| style | body | class | lowest (m) | worst hole | torn or folded (worst pose) | GLB bytes |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const r of rows)
    table.push(`| ${r.style} | ${r.gender} | ${r.class.length} | ${r.class.lowest?.toFixed(3) ?? '—'} | ${(r.worstHole * 100).toFixed(3)} % | ${(r.torn * 100).toFixed(2)} % | ${r.bytes} |`)
  writeFileSync(join(out, 'styles.md'), `${table.join('\n')}\n`)
}

if (flags['hair-styles']) {
  await hairStyles()
  server.stop()
  console.log(`hair styles: ${join(out, 'styles.md')}`)
  process.exit(0)
}

const results: { head: Head; result: any }[] = []
for (const [i, head] of heads.entries()) {
  console.log(`head ${head.id}`)
  const result = await runHead(head, i === 0)
  results.push({ head, result })
  saveJson(`${head.id}/report.json`, { ...result, fixture: undefined })
  writeFileSync(join(out, head.id, 'report.md'), headMarkdown(head, result))
  // Fixtures of heads that may not be shared go only to a folder outside the repo (--fixtures-out).
  const fixtureDir = resolve(
    flags['fixtures-out'] ?? join(REPO, 'packages/editor/src/components/editor/first-person/photo-avatar/__bench__/fixtures'),
  )
  const shareable = head.redistributable || !fixtureDir.startsWith(`${REPO}/`)
  if (flags.fixtures && result.fixture && !heldout && shareable) {
    const dir = fixtureDir
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${head.id}.json`)
    writeFileSync(file, JSON.stringify(result.fixture))
    // Laid out as the repo's formatter wants it, so `bun check` passes over the committed file.
    Bun.spawnSync([join(REPO, 'node_modules/.bin/biome'), 'format', '--write', file], { cwd: REPO })
  }
}
writeFileSync(join(out, 'gates.md'), gateTable(results))
saveJson('gates.json', results.map(({ head, result }) => ({ head: head.id, checks: result.checks })))
server.stop()
console.log(`gate table: ${join(out, 'gates.md')}`)
process.exit(0)
