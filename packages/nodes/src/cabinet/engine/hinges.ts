import { HINGE_END_OFFSET_MM, hingeCount } from './rules'

/**
 * Door hinge layout, ported from mmmcraft `hingeCalculator.ts` and
 * `doorGeometryCalculator.ts`. Door positions are mm from the leaf bottom;
 * side positions are mm on the side panel from the carcass body bottom.
 */

/** Hinges closer than this to a shelf are moved above or below it. */
const SHELF_CLEARANCE_MM = 50

export type ShelfRange = { bottomMm: number; topMm: number }

/** mmmcraft calculateHingePositions: 2 at the margins, 3+ evenly spaced. */
export function defaultDoorHingePositions(doorHeightMm: number): number[] {
  const count = hingeCount(doorHeightMm)
  const margin = HINGE_END_OFFSET_MM
  if (count === 2) return [margin, doorHeightMm - margin]
  const spacing = (doorHeightMm - 2 * margin) / (count - 1)
  return Array.from({ length: count }, (_, i) => margin + spacing * i)
}

/** Integer mm within the leaf, unique, ascending. */
export function normalizeDoorHingePositions(positions: number[], doorHeightMm: number): number[] {
  if (!(doorHeightMm > 0)) return []
  const max = Math.max(1, doorHeightMm - 1)
  const values = positions
    .map((p) => Math.round(p))
    .filter(Number.isFinite)
    .map((p) => Math.max(1, Math.min(max, p)))
  return Array.from(new Set(values)).sort((a, b) => a - b)
}

/** mmmcraft avoidHingePositionsForShelves (side coordinates; `heightMm` is
 *  the leaf top on the side, used to break ties at a shelf centre). */
export function avoidShelves(
  positions: number[],
  shelves: ShelfRange[],
  minY: number,
  maxY: number,
  heightMm: number,
): number[] {
  const sorted = [...shelves].sort((a, b) => a.bottomMm - b.bottomMm)
  if (sorted.length === 0 || maxY <= minY) return positions.map(round3)
  const collision = (p: number) =>
    sorted.find((s) => {
      if (p < s.bottomMm) return s.bottomMm - p < SHELF_CLEARANCE_MM
      if (p > s.topMm) return p - s.topMm < SHELF_CLEARANCE_MM
      return true
    })
  const clamp = (p: number) => Math.max(minY, Math.min(maxY, p))
  return positions
    .map((original) => {
      let p = original
      for (let attempt = 0; attempt < sorted.length + 2; attempt += 1) {
        const shelf = collision(p)
        if (!shelf) break
        const below = shelf.bottomMm - SHELF_CLEARANCE_MM
        const above = shelf.topMm + SHELF_CLEARANCE_MM
        const centre = (shelf.bottomMm + shelf.topMm) / 2
        const preferBelow = p < centre || (p === centre && p <= heightMm / 2)
        const candidates = preferBelow ? [below, above] : [above, below]
        const valid = candidates.map(clamp).filter((c) => !collision(c))
        p =
          valid.length > 0
            ? (valid.sort((a, b) => Math.abs(a - original) - Math.abs(b - original))[0] as number)
            : clamp(candidates[0] as number)
      }
      return round3(p)
    })
    .sort((a, b) => a - b)
}

export type DoorHingeInput = {
  doorHeightMm: number
  /** Leaf bottom on the side panel (mm from the body bottom). */
  doorBottomOnSideMm: number
  /** Fixed first / last hinge heights on the side panel. */
  firstSideMm: number
  lastSideMm: number
  shelves: ShelfRange[]
  /** User-set side positions (경첩 위치 변경). */
  customSideMm?: number[]
}

/** Hinge cup heights on the leaf (from its bottom), mmmcraft
 *  resolveSidePanelMatchedHingePositions with side anchoring. */
export function resolveDoorHinges(input: DoorHingeInput): number[] {
  const { doorHeightMm: h, doorBottomOnSideMm: b } = input
  if (!(h > 0)) return []
  const avoid = (side: number[]) =>
    avoidShelves(side, input.shelves, b + HINGE_END_OFFSET_MM, b + h - HINGE_END_OFFSET_MM, b + h)
  if (input.customSideMm?.length) {
    const clamped = input.customSideMm
      .filter(Number.isFinite)
      .map((p) => Math.max(b + 1, Math.min(b + h - 1, p)))
    return normalizeDoorHingePositions(
      avoid(clamped).map((p) => p - b),
      h,
    )
  }
  const base = normalizeDoorHingePositions(defaultDoorHingePositions(h), h)
  if (base.length >= 2) {
    base[0] = input.firstSideMm - b
    base[base.length - 1] = input.lastSideMm - b
    const first = base[0] as number
    const step = ((base[base.length - 1] as number) - first) / (base.length - 1)
    for (let i = 1; i < base.length - 1; i += 1) base[i] = first + step * i
  }
  const door = normalizeDoorHingePositions(base, h)
  return normalizeDoorHingePositions(
    avoid(door.map((p) => p + b)).map((p) => p - b),
    h,
  )
}

/**
 * mmmcraft resolveHingeGapEditPlan. `boundaries` = [0, top distances…,
 * door height]. The edited gap takes the requested value; one unlocked
 * absorber gap changes the other way (middle gaps below, middle gaps above,
 * then the bottom edge gap, then the top edge gap). Null when none can.
 */
export function hingeGapEdit(
  boundaries: number[],
  segment: number,
  requestedMm: number,
  locked: number[] = [],
): number[] | null {
  const count = boundaries.length - 1
  const last = count - 1
  if (count < 2 || segment < 0 || segment > last) return null
  const isEdge = (i: number) => i === 0 || i === last
  const below: number[] = []
  for (let i = segment + 1; i <= last; i += 1) below.push(i)
  const above: number[] = []
  for (let i = segment - 1; i >= 0; i -= 1) above.push(i)
  const absorber = [
    ...below.filter((i) => !isEdge(i)),
    ...above.filter((i) => !isEdge(i)),
    ...below.filter(isEdge),
    ...above.filter(isEdge),
  ].find((i) => !locked.includes(i))
  if (absorber === undefined) return null
  const gap = (i: number) => (boundaries[i + 1] as number) - (boundaries[i] as number)
  const delta = Math.max(
    1 - gap(segment),
    Math.min(gap(absorber) - 1, Math.round(requestedMm) - gap(segment)),
  )
  const next = [...boundaries]
  if (absorber > segment) {
    for (let i = segment + 1; i <= absorber; i += 1) next[i] = (next[i] as number) + delta
  } else {
    for (let i = absorber + 1; i <= segment; i += 1) next[i] = (next[i] as number) - delta
  }
  return next.slice(1, -1)
}

/** mmmcraft resolveHingeGapEqualizePlan (등분): locked gaps keep their size,
 *  the rest share what is left; spare mm go to the upper gaps first. */
export function hingeGapEqualize(boundaries: number[], locked: number[] = []): number[] | null {
  const count = boundaries.length - 1
  if (count < 2) return null
  const height = boundaries[boundaries.length - 1] as number
  const lockedSet = new Set(locked)
  const gap = (i: number) => (boundaries[i + 1] as number) - (boundaries[i] as number)
  let lockedTotal = 0
  const unlocked: number[] = []
  for (let i = 0; i < count; i += 1) {
    if (lockedSet.has(i)) lockedTotal += gap(i)
    else unlocked.push(i)
  }
  if (unlocked.length === 0) return null
  const remaining = Math.round(height - lockedTotal)
  if (remaining < unlocked.length) return null
  const base = Math.floor(remaining / unlocked.length)
  let extra = remaining - base * unlocked.length
  const next = [0]
  for (let i = 0; i < count; i += 1) {
    let g: number
    if (lockedSet.has(i)) g = gap(i)
    else {
      g = base + (extra > 0 ? 1 : 0)
      if (extra > 0) extra -= 1
    }
    next.push((next[i] as number) + g)
  }
  return next.slice(1, -1)
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
