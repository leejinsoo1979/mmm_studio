// The heads the bench photographs: the tuning set (fix tracks may render, fit and tune on these) and
// the held-out pool (only verifiers pick from it, with --heldout). Each is turned into the page's
// HeadSpec; files outside the repo live in the bench's cache (see README.md).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type HairLabel = 'bald' | 'buzz' | 'short' | 'medium' | 'long' | 'long-tied'

export type Head = {
  id: string
  kind: 'rocketbox' | 'mpfb' | 'scan'
  gender: 'male' | 'female'
  /** Served path of its file (under the bench's server). */
  url: string
  expressionUrl?: string
  map?: string
  scale?: number
  absoluteScale: boolean
  tint?: [number, number, number]
  bald?: boolean
  /** Its hair as a person would class it (null: left to the bench's own reading). */
  hair: HairLabel | null
  source: string
  licence: string
  /** Committed fixtures may be made from it (licence allows redistribution). */
  redistributable: boolean
}

const rocketbox = (
  id: string,
  name: string,
  gender: Head['gender'],
  hair: HairLabel | null,
): Head => ({
  id,
  kind: 'rocketbox',
  gender,
  url: `./characters/rocketbox/${name}.glb`,
  absoluteScale: true,
  hair,
  source: `Microsoft Rocketbox ${name} (apps/editor/public/characters/rocketbox)`,
  licence: 'MIT',
  redistributable: true,
})

/** The MPFB heads the bench makes (make-mpfb-heads.py, then mpfb-truth.ts) from a seed. */
export const MPFB_SEEDS: Record<number, { gender: Head['gender']; tint?: Head['tint']; bald?: boolean; hair: HairLabel }> = {
  1: { gender: 'male', hair: 'short' },
  2: { gender: 'female', tint: [0.55, 0.42, 0.34], bald: true, hair: 'bald' },
}

export function mpfbHead(seed: number): Head {
  const known = MPFB_SEEDS[seed]
  const gender = known?.gender ?? (seed % 2 ? 'male' : 'female')
  return {
    id: `mpfb-${seed}`,
    kind: 'mpfb',
    gender,
    url: `./heads/mpfb-${seed}.glb`,
    expressionUrl: `./heads/mpfb-${seed}-expression.glb`,
    absoluteScale: true,
    tint: known?.tint,
    bald: known?.bald,
    hair: known?.hair ?? (gender === 'male' ? 'short' : 'long-tied'),
    source: `MakeHuman/MPFB2 v2.0.18 targets, seed ${seed} (scripts/photo-avatar/make-mpfb-heads.py)`,
    licence: 'CC0 1.0',
    redistributable: true,
  }
}

export const TUNING: Head[] = [
  // A blonde ponytail reaching past the shoulders (its own cards end 23 cm under the eyes).
  rocketbox('f01', 'Female_Adult_01', 'female', 'long-tied'),
  rocketbox('m01', 'Male_Adult_01', 'male', 'short'),
  rocketbox('m05', 'Male_Adult_05', 'male', 'short'),
  rocketbox('m10', 'Male_Adult_10', 'male', 'short'),
  rocketbox('m12', 'Male_Adult_12', 'male', 'buzz'),
  rocketbox('f03', 'Female_Adult_03', 'female', 'long'),
  {
    id: 'lps',
    kind: 'scan',
    gender: 'male',
    url: './heads/lps/LeePerrySmith.glb',
    map: './heads/lps/Map-COL.jpg',
    // Its units are not metres; this makes its eyes' outer corners about 92 mm apart.
    scale: 0.047,
    absoluteScale: false,
    hair: 'bald',
    source: 'Lee Perry-Smith head scan, Infinite-Realities, via three.js r170 examples',
    licence: 'CC BY 3.0 (scratch only: never committed)',
    redistributable: false,
  },
  mpfbHead(1),
  mpfbHead(2),
]

const TUNING_ROCKETBOX = new Set(TUNING.filter((h) => h.kind === 'rocketbox').map((h) => h.url))

/**
 * A held-out head by its id: `rocketbox:<Name>` (an adult Rocketbox
 * character not in the tuning set), `mpfb:<seed ≥ 100>`, or `scan:<file>`
 * (a CC0 real-person scan placed in the cache's scans folder, with a
 * `<file>.json` beside it giving gender, scale and licence).
 */
export function heldOutHead(id: string, repo: string, cache: string): Head {
  const [kind, rest] = id.split(':') as [string, string]
  if (kind === 'rocketbox') {
    if (/_Child_/i.test(rest)) throw new Error(`${id}: children are never used`)
    const url = `./characters/rocketbox/${rest}.glb`
    if (TUNING_ROCKETBOX.has(url)) throw new Error(`${id} is in the tuning set`)
    if (!existsSync(join(repo, 'apps/editor/public/characters/rocketbox', `${rest}.glb`)))
      throw new Error(`${id}: no such Rocketbox character`)
    const gender = /female/i.test(rest) ? 'female' : 'male'
    return { ...rocketbox(rest, rest, gender, null), id: `rocketbox-${rest}` }
  }
  if (kind === 'mpfb') {
    const seed = Number(rest)
    if (!(seed >= 100)) throw new Error(`${id}: held-out MPFB heads have seeds of 100 or more`)
    return mpfbHead(seed)
  }
  if (kind === 'scan') {
    const meta = JSON.parse(readFileSync(join(cache, 'scans', `${rest}.json`), 'utf8')) as Partial<Head> & {
      file: string
    }
    return {
      id: `scan-${rest}`,
      kind: 'scan',
      gender: meta.gender ?? 'male',
      url: `./heads/scans/${meta.file}`,
      map: meta.map ? `./heads/scans/${meta.map}` : undefined,
      scale: meta.scale ?? 1,
      absoluteScale: meta.absoluteScale ?? false,
      hair: meta.hair ?? null,
      source: meta.source ?? rest,
      licence: meta.licence ?? 'see scans folder',
      redistributable: false,
    }
  }
  throw new Error(`unknown head ${id}`)
}

/** Every adult Rocketbox character outside the tuning set (the held-out pool's Rocketbox part). */
export function heldOutRocketbox(repo: string): string[] {
  return readdirSync(join(repo, 'apps/editor/public/characters/rocketbox'))
    .filter((f) => f.endsWith('.glb') && /(Male|Female)/.test(f) && !/Child/i.test(f))
    .map((f) => f.replace(/\.glb$/, ''))
    .filter((name) => !TUNING_ROCKETBOX.has(`./characters/rocketbox/${name}.glb`))
}
