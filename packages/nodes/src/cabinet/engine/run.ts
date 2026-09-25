import { SLOT_MAX_MM, SLOT_MIN_MM } from './rules'

/**
 * Configurator-style equal division: the fewest slots no wider than 600 mm,
 * each at least 400 mm. Widths are floored to 0.5 mm and the remainder goes
 * to the last slot so the run adds up exactly. Returns [] when `totalMm` is
 * narrower than one minimum slot.
 */
export function equalSlotWidths(
  totalMm: number,
  minMm: number = SLOT_MIN_MM,
  maxMm: number = SLOT_MAX_MM,
): number[] {
  if (totalMm < minMm) return []
  const count = Math.max(1, Math.ceil(totalMm / maxMm))
  const each = Math.floor((totalMm / count) * 2) / 2
  const widths = Array.from({ length: count }, () => each)
  widths[count - 1] = Math.round((totalMm - each * (count - 1)) * 10) / 10
  return widths
}

export type RunModule = { presetId: string; widthMm: number; offsetMm: number }

export type KitchenRunPlan = {
  base: RunModule[]
  upper: RunModule[]
  countertop: {
    lengthMm: number
    sink?: { centerMm: number; widthMm: number; depthMm: number }
    cooktop?: { centerMm: number; widthMm: number; depthMm: number }
  }
  /** Length left over (filler) when the run cannot be divided exactly. */
  leftoverMm: number
}

export type KitchenRunOptions = {
  lengthMm: number
  dishwasher?: boolean
  sinkWidthMm?: number
  cooktopWidthMm?: number
}

const SINK_BOWL = { widthMm: 800, depthMm: 460 }
const COOKTOP = { widthMm: 560, depthMm: 490 }

/**
 * Lay out a straight (ㅡ자) kitchen along `lengthMm`: sink, optional
 * dishwasher, filler base units, cooktop, and a row of upper cabinets that
 * skips the space above the cooktop (hood).
 */
export function planKitchenRun(options: KitchenRunOptions): KitchenRunPlan {
  const length = Math.max(0, options.lengthMm)
  const sinkW = options.sinkWidthMm ?? 900
  const cooktopW = options.cooktopWidthMm ?? 600
  const dishwasherW = options.dishwasher ? 600 : 0
  const fixed = sinkW + cooktopW + dishwasherW
  const fillWidths = equalSlotWidths(length - fixed)
  const fillSum = fillWidths.reduce((a, b) => a + b, 0)
  const leftoverMm = Math.max(0, Math.round((length - fixed - fillSum) * 10) / 10)

  const split = Math.ceil(fillWidths.length / 2)
  const sequence: { presetId: string; widthMm: number }[] = [
    { presetId: 'lower-sink-cabinet', widthMm: sinkW },
    ...(dishwasherW ? [{ presetId: 'lower-dishwasher-cabinet', widthMm: dishwasherW }] : []),
    ...fillWidths.slice(0, split).map((w) => ({ presetId: 'lower-half-cabinet', widthMm: w })),
    { presetId: 'lower-induction-cabinet', widthMm: cooktopW },
    ...fillWidths.slice(split).map((w) => ({ presetId: 'lower-drawer-3tier', widthMm: w })),
  ]
  if (length < fixed) {
    return { base: [], upper: [], countertop: { lengthMm: length }, leftoverMm: length }
  }

  const base: RunModule[] = []
  let cursor = 0
  for (const item of sequence) {
    base.push({ ...item, offsetMm: cursor })
    cursor += item.widthMm
  }
  const sinkModule = base.find((m) => m.presetId === 'lower-sink-cabinet')
  const cooktopModule = base.find((m) => m.presetId === 'lower-induction-cabinet')

  // Upper row: equal slots either side of the hood gap above the cooktop.
  const upper: RunModule[] = []
  const fillUpper = (from: number, to: number) => {
    let x = from
    for (const w of equalSlotWidths(to - from)) {
      upper.push({ presetId: 'upper-cabinet-shelf', widthMm: w, offsetMm: x })
      x += w
    }
  }
  if (cooktopModule) {
    fillUpper(0, cooktopModule.offsetMm)
    fillUpper(cooktopModule.offsetMm + cooktopModule.widthMm, length - leftoverMm)
  } else {
    fillUpper(0, length - leftoverMm)
  }

  return {
    base,
    upper,
    countertop: {
      lengthMm: length,
      sink: sinkModule
        ? { centerMm: sinkModule.offsetMm + sinkModule.widthMm / 2, ...SINK_BOWL }
        : undefined,
      cooktop: cooktopModule
        ? { centerMm: cooktopModule.offsetMm + cooktopModule.widthMm / 2, ...COOKTOP }
        : undefined,
    },
    leftoverMm,
  }
}
