/**
 * mmmcraft Room "슬롯 생성" slot layout on one wall face (all mm), ported
 * from mmmcraft `SpaceCalculator` (column count, integer slot width frame
 * adjustment), `ColumnIndexer` (0.5 mm floored slot width, slot origin) and
 * `roomSlotGuideModel` (vertical extent, occupancy).
 */

export type SlotFrameMode = 'surround' | 'no-surround'

/** mmmcraft default space: surround frames 50/50 (adjustable 40–60), top
 *  frame 30, no-surround builtin gaps 1.5, a 60 mm floor base. */
export const SLOT_DEFAULTS = {
  frameMm: 50,
  frameMinMm: 40,
  frameMaxMm: 60,
  topFrameMm: 30,
  gapMm: 1.5,
  baseMm: 60,
  minSlotMm: 400,
  maxSlotMm: 600,
} as const

export type Slot = { index: number; left: number; right: number; center: number; width: number }

export type SlotLayout = {
  mode: SlotFrameMode
  columnCount: number
  /** Surround frames or no-surround gaps at each end of the run. */
  leftMm: number
  rightMm: number
  slots: Slot[]
  /** Height of the slot bottom (on the base) and top (under the top frame). */
  bottomMm: number
  topMm: number
}

/** mmmcraft `getDefaultColumnCount`: one slot up to 600, else ⌈W / 600⌉. */
export function defaultColumnCount(internalWidthMm: number): number {
  return internalWidthMm <= SLOT_DEFAULTS.maxSlotMm
    ? 1
    : Math.ceil(internalWidthMm / SLOT_DEFAULTS.maxSlotMm)
}

/** mmmcraft `getColumnCountLimits`: slots stay between 400 and 600 wide. */
export function columnCountLimits(internalWidthMm: number): { min: number; max: number } {
  return {
    min: Math.max(1, Math.ceil(internalWidthMm / SLOT_DEFAULTS.maxSlotMm)),
    max: Math.max(1, Math.floor(internalWidthMm / SLOT_DEFAULTS.minSlotMm)),
  }
}

const isInteger = (v: number) => Math.abs(v - Math.round(v)) < 0.001
const clampFrame = (v: number) =>
  Math.max(SLOT_DEFAULTS.frameMinMm, Math.min(SLOT_DEFAULTS.frameMaxMm, v))

/** mmmcraft `adjustForIntegerSlotWidth` (surround, walls on both sides):
 *  move both frames together, then apart, looking for an integer slot. */
function adjustSurroundFrames(lengthMm: number, count: number): { left: number; right: number } {
  const base = SLOT_DEFAULTS.frameMm
  for (let adjust = -10; adjust <= 10; adjust += 1) {
    const f = clampFrame(base + adjust)
    if (isInteger((lengthMm - 2 * f) / count)) return { left: f, right: f }
  }
  for (let diff = 1; diff <= 20; diff += 1) {
    for (let leftAdjust = -10; leftAdjust <= 10; leftAdjust += 1) {
      for (const rightAdjust of [leftAdjust + diff, leftAdjust - diff]) {
        if (rightAdjust < -10 || rightAdjust > 10) continue
        const left = clampFrame(base + leftAdjust)
        const right = clampFrame(base + rightAdjust)
        if (Math.abs(left - right) !== diff) continue
        const w = (lengthMm - left - right) / count
        if (isInteger(w) && w >= SLOT_DEFAULTS.minSlotMm && w <= SLOT_DEFAULTS.maxSlotMm) {
          return { left, right }
        }
      }
    }
  }
  let best: { left: number; right: number } | null = null
  let smallest = Number.MAX_VALUE
  for (let leftAdjust = -10; leftAdjust <= 10; leftAdjust += 1) {
    for (let rightAdjust = -10; rightAdjust <= 10; rightAdjust += 1) {
      const left = clampFrame(base + leftAdjust)
      const right = clampFrame(base + rightAdjust)
      const w = (lengthMm - left - right) / count
      const rounded = Math.round(w * 100) / 100
      const remainder = Math.abs(w - rounded)
      if (
        remainder < smallest &&
        rounded >= SLOT_DEFAULTS.minSlotMm &&
        rounded <= SLOT_DEFAULTS.maxSlotMm
      ) {
        smallest = remainder
        best = { left, right }
      }
    }
  }
  return best && smallest < 0.1 ? best : { left: base, right: base }
}

/**
 * Slots across a wall run of `lengthMm` (the clear inner face) and wall
 * height `heightMm`. `columnCount` overrides mmmcraft's default count.
 */
export function slotLayout(args: {
  lengthMm: number
  heightMm: number
  mode?: SlotFrameMode
  columnCount?: number
}): SlotLayout {
  const mode = args.mode ?? 'surround'
  const L = args.lengthMm
  let left: number
  let right: number
  let count: number
  if (mode === 'surround') {
    count = args.columnCount ?? defaultColumnCount(L - 2 * SLOT_DEFAULTS.frameMm)
    ;({ left, right } = adjustSurroundFrames(L, count))
  } else {
    left = SLOT_DEFAULTS.gapMm
    right = SLOT_DEFAULTS.gapMm
    count = args.columnCount ?? defaultColumnCount(L - left - right)
  }
  const width = Math.floor(((L - left - right) / count) * 2) / 2
  const slots: Slot[] = []
  for (let i = 0; i < count; i += 1) {
    const l = left + i * width
    slots.push({ index: i, left: l, right: l + width, center: l + width / 2, width })
  }
  return {
    mode,
    columnCount: count,
    leftMm: left,
    rightMm: right,
    slots: slots.filter((s) => s.width > 0),
    bottomMm: SLOT_DEFAULTS.baseMm,
    topMm: args.heightMm - SLOT_DEFAULTS.topFrameMm,
  }
}

/**
 * The wall face split by door openings (mmmcraft `wallPlacementSegments`:
 * doors cut the run, windows do not; pieces ≤ 0.5 mm are dropped).
 * `doors` are [start, end] along the run in mm.
 */
export function wallSegments(lengthMm: number, doors: [number, number][]): [number, number][] {
  const cuts = doors
    .map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(lengthMm, Math.max(a, b))] as const)
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0])
  const out: [number, number][] = []
  let cursor = 0
  for (const [a, b] of cuts) {
    if (a - cursor > 0.5) out.push([cursor, a])
    cursor = Math.max(cursor, b)
  }
  if (lengthMm - cursor > 0.5) out.push([cursor, lengthMm])
  return out
}

/** The widest segment's index (mmmcraft's default reference segment). */
export function widestSegment(segments: [number, number][]): number {
  let best = 0
  segments.forEach(([a, b], i) => {
    const [ba, bb] = segments[best] ?? [0, 0]
    if (b - a > bb - ba) best = i
  })
  return best
}

/**
 * mmmcraft `firstFreeSlotPose`: the first run of `needed` consecutive free
 * slots from the left. A slot is taken when a placed item's centre (along
 * the run) falls inside it and the item stands within 1.5 × `depthMm` of
 * the wall. Returns the first slot index or null.
 */
export function firstFreeSlot(
  slots: Slot[],
  needed: number,
  placed: { along: number; away: number }[],
  depthMm: number,
): number | null {
  const occupied = placed.filter((p) => p.away < depthMm * 1.5).map((p) => p.along)
  const free = slots.map((s) => !occupied.some((x) => x > s.left - 1 && x < s.right + 1))
  for (let i = 0; i + needed <= slots.length; i += 1) {
    if (free.slice(i, i + needed).every(Boolean)) return i
  }
  return null
}
