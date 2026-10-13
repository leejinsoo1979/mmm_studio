// The bench's verdicts past geometry (G3, G5–G9) from a head's raw results, and its Markdown: a
// report per head and the gate table across heads.
import {
  type Check,
  GATE_POINTS,
  GATES,
} from '../../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/gates'
import { deltaERgb } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/colour'
import type { Head } from './heads'

type Num = number | null | undefined

const finite = (v: Num): v is number => typeof v === 'number' && Number.isFinite(v)
const check = (gate: string, name: string, value: Num, limit: string, pass: boolean | null): Check => ({
  gate,
  name,
  value: finite(value) ? value : Number.NaN,
  limit,
  pass,
})

/** G3: the webcam path found every pose, and its errors are within G3's slack of G2's. */
export function g3Checks(webcam: any, perturbed: any): Check[] {
  if (!webcam) return [check('G3', 'run', Number.NaN, 'ran', false)]
  const found = webcam.capture?.shots?.length ?? 0
  const out = [check('G3', 'posesFound', found, '= 5', found === 5)]
  if (!(webcam.geometry && perturbed?.geometry)) return out
  for (const name of [...GATE_POINTS]) {
    const w = webcam.geometry.points[name]
    const p = perturbed.geometry.points[name]
    out.push(
      check(
        'G3',
        name,
        w,
        `|e| ≤ |G2 ${finite(p) ? p.toFixed(2) : '?'}| + ${GATES.G3.slack}`,
        finite(w) && finite(p) ? Math.abs(w) <= Math.abs(p) + GATES.G3.slack : false,
      ),
    )
  }
  return out
}

/** G5: each photo's view of the avatar against the photo. */
export function g5Checks(likeness: any[]): Check[] {
  const out: Check[] = []
  for (const view of likeness ?? []) {
    if (!finite(view.nme)) continue
    out.push(check('G5', `${view.slot} NME`, view.nme, `≤ ${GATES.G5.nme * 100} %`, view.nme <= GATES.G5.nme))
    out.push(
      check('G5', `${view.slot} outline IoU`, view.ovalIou, `≥ ${GATES.G5.iou}`, view.ovalIou >= GATES.G5.iou),
    )
    if (view.slot === 'front')
      out.push(
        check('G5', 'front width', view.width, `|e| ≤ ${GATES.G5.width * 100} %`, Math.abs(view.width) <= GATES.G5.width),
      )
  }
  return out
}

/** G6: skin colour under the same light, tone across face, neck and body, balance, seams. */
export function g6Checks(skin: Record<string, any>): Check[] {
  const out: Check[] = []
  for (const [capture, result] of Object.entries(skin ?? {})) {
    for (const [light, renders] of Object.entries(result.renders ?? {}) as [string, any[]][]) {
      const values = renders.flatMap((r) => Object.values(r.cheeks).map((c: any) => c.deltaE)).filter(finite)
      const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN
      out.push(
        check('G6', `cheek ΔE (${capture} photos, ${light} light)`, mean, `≤ ${GATES.G6.cheek}`, mean <= GATES.G6.cheek),
      )
    }
    const t = result.texture
    if (!t) continue
    for (const [name, value] of [
      ['face–neck ΔE', t.faceNeck],
      ['face–body ΔE', t.faceBody],
    ] as const)
      out.push(check('G6', `${name} (${capture})`, value, `≤ ${GATES.G6.tone}`, finite(value) && value <= GATES.G6.tone))
    for (const [part, ratio] of Object.entries(t.balance ?? {}) as [string, number][])
      out.push(
        check(
          'G6',
          `L/R ${part} (${capture})`,
          ratio,
          `${GATES.G6.balance[0]}–${GATES.G6.balance[1]}`,
          finite(ratio) && ratio >= GATES.G6.balance[0] && ratio <= GATES.G6.balance[1],
        ),
      )
    out.push(
      check(
        'G6',
        `neck seam ΔE (${capture})`,
        t.neckSeam?.mean,
        `≤ ${GATES.G6.seam}`,
        finite(t.neckSeam?.mean) && t.neckSeam.mean <= GATES.G6.seam,
      ),
    )
    out.push(check('G6', `forehead not skin (${capture})`, t.foreheadNotSkin, 'review (truth may have a fringe)', null))
  }
  return out
}

/** G7: hair colour, length and style, and holes. */
export function g7Checks(hair: any, head: Head, truthHair: any): Check[] {
  if (!hair) return [check('G7', 'run', Number.NaN, 'ran', false)]
  const out: Check[] = []
  const wanted = head.hair ?? truthHair?.length ?? null
  const got = hair.avatar?.class?.length ?? 'unknown'
  out.push({
    gate: 'G7',
    name: 'length and style',
    value: wanted === got ? 1 : 0,
    limit: 'same class',
    pass: wanted ? wanted === got : null,
    note: `truth ${wanted}, avatar ${got}`,
  })
  if (wanted && wanted !== 'bald') {
    out.push(
      check(
        'G7',
        'hair colour ΔE',
        hair.colourDeltaE,
        `≤ ${GATES.G7.colour}`,
        finite(hair.colourDeltaE) && hair.colourDeltaE <= GATES.G7.colour,
      ),
    )
  }
  if (wanted && !['bald', 'buzz'].includes(wanted)) {
    const worst = Math.max(...(hair.holes?.results ?? []).map((r: any) => (finite(r.holes) ? r.holes : 1)))
    out.push(check('G7', 'holes (worst of 8 views × 3 poses)', worst, `≤ ${GATES.G7.holes * 100} %`, worst <= GATES.G7.holes))
  }
  return out
}

/** Closer than this (ΔE2000) to the shut lids the truth shows where its irises would be is a flesh-coloured iris. */
const FLESH_IRIS = 20

/**
 * G8's iris: the avatar's against the truth's (ΔE). A truth with its eyes
 * shut shows lids where its irises would be, which an avatar must not copy
 * (it falls back to the neutral iris): for it a second row says how far the
 * avatar's iris is from that lid colour, the gate's own row standing.
 */
function irisChecks(eyes: any): Check[] {
  const out = [
    check('G8', 'iris ΔE', eyes.irisDeltaE, `≤ ${GATES.G8.iris}`, finite(eyes.irisDeltaE) && eyes.irisDeltaE <= GATES.G8.iris),
  ]
  const [truth, avatar] = (eyes.irisColours ?? [null, null]) as [string | null, string | null]
  if (eyes.truthEyesShut && truth && avatar) {
    const rgb = (hex: string) =>
      [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
    const fromLids = deltaERgb(rgb(truth), rgb(avatar))
    out.push({
      gate: 'G8',
      name: 'iris, truth’s eyes shut: ΔE from the lids',
      value: fromLids,
      limit: `≥ ${FLESH_IRIS} (not flesh)`,
      pass: fromLids >= FLESH_IRIS,
      note: `avatar ${avatar}, lids ${truth}`,
    })
  }
  return out
}

/** G8: iris colour, the face's morphs, and no white line on closed lips. */
export function g8Checks(eyes: any): Check[] {
  if (!eyes) return [check('G8', 'run', Number.NaN, 'ran', false)]
  const morphs: string[] = eyes.facts?.morphs ?? []
  const has = (re: RegExp) => morphs.some((m) => re.test(m))
  return [
    ...irisChecks(eyes),
    {
      gate: 'G8',
      name: 'morphs',
      value: morphs.length,
      limit: 'jawOpen, mouthSmile, brow',
      pass: has(/^jawOpen$/) && has(/^mouthSmile/) && has(/^brow/),
      note: morphs.join(', ') || 'none',
    },
    check('G8', 'white on closed lips', eyes.lip?.whiteShare, '≤ 2 % of the lip line', finite(eyes.lip?.whiteShare) && eyes.lip.whiteShare <= 0.02),
  ]
}

/** G9: time, size, the photos staying in the browser, and the file Safari gets. */
export function g9Checks(engineering: any): Check[] {
  const out: Check[] = []
  const e = engineering ?? {}
  out.push(check('G9', 'five-photo build (s)', e.seconds, `≤ ${GATES.G9.seconds}`, finite(e.seconds) && e.seconds <= GATES.G9.seconds))
  out.push(check('G9', 'GLB bytes', e.bytes, `≤ ${GATES.G9.bytes}`, finite(e.bytes) && e.bytes <= GATES.G9.bytes))
  out.push(
    check('G9', 'requests leaving the page’s server, or sending a body', e.network?.outside, '= 0', e.network ? e.network.outside === 0 : null),
  )
  if (e.safari) {
    out.push(
      check('G9', 'Safari: hair keeps its alpha (min alpha)', e.safari.hairAlpha?.min, '< 255', e.safari.hairAlpha ? e.safari.hairAlpha.min < 255 : false),
    )
    out.push(check('G9', 'Safari: textures naming a non-WebP picture as WebP', e.safari.invalidWebpTextures, '= 0', e.safari.invalidWebpTextures === 0))
  }
  return out
}

const fmt = (c: Check) => {
  if (!Number.isFinite(c.value)) return '—'
  const v = Math.abs(c.value) < 1 && !/mm|ΔE|bytes|\(s\)/.test(c.limit) ? c.value.toFixed(3) : c.value.toFixed(2)
  return v
}
const mark = (c: Check) => (c.pass === null ? '·' : c.pass ? '✓' : '✗')
const n = (value: unknown, digits = 2) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'

export function headMarkdown(head: Head, result: any): string {
  const lines = [
    `# ${head.id}`,
    '',
    `${head.source} — ${head.licence}. Bench ${result.at}, ${result.commit}.`,
    '',
    '| gate | check | value | limit | |',
    '|---|---|---:|---|:-:|',
  ]
  for (const c of result.checks as Check[])
    lines.push(`| ${c.gate} | ${c.name}${c.note ? ` (${c.note})` : ''} | ${fmt(c)} | ${c.limit} | ${mark(c)} |`)
  for (const [config, value] of Object.entries(result.configs ?? {}) as [string, any][]) {
    if (!value?.geometry) continue
    const g = value.geometry
    lines.push(
      '',
      `## ${config}`,
      '',
      `skull alignment: scale ${n(g.alignment.scaleError * 100, 1)} %, residual ${n(g.alignment.residualMm)} mm on ${n(g.alignment.skullPoints, 0)} points; face offset ${n(g.faceOffset)} mm; profile mean ${n(g.profile.mean)} / max ${n(g.profile.max)} mm; 45° outline ${n(g.outline45.mean)} mm; width cheek ${n(g.width.cheek * 100, 1)} % jaw ${n(g.width.jaw * 100, 1)} %`,
      '',
      `points (mm): ${Object.entries(g.points).map(([k, v]) => `${k} ${n(v)}`).join(', ')}`,
    )
    if (value.seconds)
      lines.push('', `time: read ${n(value.seconds.read, 1)} s, build ${n(value.seconds.build, 1)} s; ${value.bytes} bytes`)
    if (value.error) lines.push('', `error: ${value.error}`)
  }
  if (result.errors?.length) lines.push('', '## errors', '', ...result.errors.map((e: string) => `- ${e}`))
  return `${lines.join('\n')}\n`
}

/** The gate table: one row per check, one column per head. */
export function gateTable(results: { head: Head; result: any }[]): string {
  const rows = new Map<string, Map<string, Check>>()
  for (const { head, result } of results) {
    for (const c of result.checks as Check[]) {
      const key = `${c.gate} | ${c.name}`
      if (!rows.has(key)) rows.set(key, new Map())
      rows.get(key)!.set(head.id, c)
    }
  }
  const order = (key: string) => Number(key.slice(1, 2))
  const keys = [...rows.keys()].sort((a, b) => order(a) - order(b))
  const ids = results.map((r) => r.head.id)
  const lines = [`| gate | check | limit | ${ids.join(' | ')} | pass |`, `|---|---|---|${ids.map(() => '---:').join('|')}|:-:|`]
  for (const key of keys) {
    const cells = rows.get(key)!
    const any = [...cells.values()][0]!
    const all = [...cells.values()]
    const verdict = all.some((c) => c.pass === false) ? '✗' : all.every((c) => c.pass === null) ? '·' : '✓'
    lines.push(
      `| ${key} | ${any.limit.replace(/and < base .*/, 'and < base').replace(/\|G2 [^|]*\|/, '|G2|')} | ${ids.map((id) => (cells.get(id) ? `${fmt(cells.get(id)!)} ${mark(cells.get(id)!)}` : '')).join(' | ')} | ${verdict} |`,
    )
  }
  return `${lines.join('\n')}\n`
}
