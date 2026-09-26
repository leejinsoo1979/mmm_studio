/**
 * mmmcraft 칸 내경 editing (PlacedModulePropertiesPanel). Gaps run bottom →
 * top: floor → shelf 1, …, last shelf → ceiling of the compartment. Shelf
 * positions are centres above the compartment floor; `t` is the board.
 */

export function gapsFromCentres(centres: number[], innerH: number, t: number): number[] {
  const n = centres.length
  if (n === 0) return [Math.round(innerH)]
  const gaps = [Math.max(0, Math.round((centres[0] as number) - t / 2))]
  for (let k = 1; k < n; k += 1) {
    gaps.push(Math.max(0, Math.round((centres[k] as number) - (centres[k - 1] as number) - t)))
  }
  gaps.push(Math.max(0, Math.round(innerH - (centres[n - 1] as number) - t / 2)))
  return gaps
}

function centresFromGaps(gaps: number[], n: number, t: number): number[] {
  const out: number[] = []
  let sum = 0
  for (let k = 0; k < n; k += 1) {
    sum += gaps[k] as number
    out.push(Math.round(sum + k * t + t / 2))
  }
  return out
}

/**
 * Set gap `i` (bottom-up index). mmmcraft resets every other gap to an even
 * share of what is left and squares the rounding on the last one (the one
 * below it when the top gap was edited).
 */
export function applyShelfGap(
  innerH: number,
  count: number,
  t: number,
  i: number,
  value: number,
): number[] {
  const n = count
  const newGap = Math.max(0, Math.round(value))
  const each = Math.round((innerH - newGap - n * t) / n)
  const gaps = Array.from({ length: n + 1 }, () => each)
  gaps[i] = newGap
  const last = i === n ? n - 1 : n
  const total = gaps.reduce((a, b) => a + b, 0)
  gaps[last] = (gaps[last] as number) + Math.round(innerH - total - n * t)
  return centresFromGaps(gaps, n, t)
}

/** 초기화: equal gaps (floored), the remainder added to the bottom gap. */
export function resetShelfGaps(innerH: number, count: number, t: number): number[] {
  const inner = innerH - count * t
  const each = Math.floor(inner / (count + 1))
  const gaps = Array.from({ length: count + 1 }, () => each)
  gaps[0] = (gaps[0] as number) + (inner - each * (count + 1))
  return centresFromGaps(gaps, count, t)
}

/**
 * 옷봉선반 default: mmmcraft puts the shelf 2050 above the compartment
 * floor, at most 200 below its ceiling; the gap is ceiling → shelf top.
 */
export function defaultRodShelfTopGapMm(innerH: number, t: number): number {
  const centre = Math.min(2050, innerH - 200)
  return Math.max(0, Math.round(innerH - centre - t / 2))
}
