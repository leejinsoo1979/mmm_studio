import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { type CaptureView, fitCapture } from '../avatar-job'
import { shapePositions } from '../head-model'
import { loadBaseForTests } from './base-for-tests'
import { decodeTruth, decodeView, type HeadFixture } from './fixture'
import { type Check, g1Checks, g2Checks, g4SingleChecks, g4ThreeChecks } from './gates'
import { type GeometryReport, measureFit, type TruthHead } from './measure'

/**
 * The geometry gates (G1, G2, G4) at their own limits, on the bench's
 * fixtures: each truth head's views as the app read them from the bench's
 * photos, fitted here as the worker fits them and measured against the
 * truth. Regenerate the fixtures with the bench (scripts/photo-avatar,
 * `--fixtures`) when what the app reads from a photo changes.
 */

const DIR = join(import.meta.dir, 'fixtures')
const FIXTURES = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as HeadFixture)

/** A fit takes seconds a view; five views on a slow machine, more. */
const TIMEOUT = 240_000

const decompress = (bytes: Uint8Array) => new Uint8Array(brotliDecompressSync(bytes))

const misses = (checks: Check[]) =>
  checks
    .filter((check) => check.pass === false)
    .map((check) => `${check.gate} ${check.name} ${check.value.toFixed(3)} (${check.limit})`)

async function measured(
  fixture: HeadFixture,
  truth: TruthHead,
  views: CaptureView[],
): Promise<GeometryReport> {
  const base = await loadBaseForTests(fixture.gender)
  const fit = fitCapture(base, views)
  return measureFit(truth, base.head, fit.positions)
}

describe('photo avatar geometry gates', () => {
  test('there are fixtures', () => {
    expect(FIXTURES.length).toBeGreaterThan(0)
  })

  for (const fixture of FIXTURES) {
    const truth = decodeTruth(fixture.truth)
    const five = () => fixture.views.five.map((view) => decodeView(view, decompress))
    const perturbed = () => fixture.views.perturbed.map((view) => decodeView(view, decompress))

    describe(fixture.id, () => {
      test(
        'G1: five clean photos',
        async () => {
          const report = await measured(fixture, truth, five())
          expect(misses(g1Checks(report, truth.absoluteScale))).toEqual([])
        },
        TIMEOUT,
      )

      test(
        'G2: five perturbed photos',
        async () => {
          const report = await measured(fixture, truth, perturbed())
          expect(misses(g2Checks(report, truth.absoluteScale))).toEqual([])
        },
        TIMEOUT,
      )

      test(
        'G4: three photos',
        async () => {
          const views = five().filter((view) => ['front', 'left45', 'right45'].includes(view.slot))
          const report = await measured(fixture, truth, views)
          expect(misses(g4ThreeChecks(report))).toEqual([])
        },
        TIMEOUT,
      )

      test(
        'G4: one photo beats the base head',
        async () => {
          const views = five().filter((view) => view.slot === 'front')
          const report = await measured(fixture, truth, views)
          const base = await loadBaseForTests(fixture.gender)
          const untouched = measureFit(
            truth,
            base.head,
            shapePositions(base.head, new Float64Array(base.head.targetNames.length)),
          )
          expect(misses(g4SingleChecks(report, untouched))).toEqual([])
        },
        TIMEOUT,
      )
    })
  }
})
