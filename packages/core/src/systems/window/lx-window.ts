import type { WindowNode } from '../../schema'

/**
 * LX Z:IN 시스템창호 E9-PTT85 PHI, ported from mmmcraft `lxWindowCatalog.ts`,
 * `lxWindowProfile.ts`, `lxWindowGeometry.ts` and `lxWindowOpening.ts`.
 * Catalog PDF p.30 (printed p.59). The section vertices are mmmcraft's
 * display traces of that page (pixel coordinates of a 500 dpi crop), not
 * manufacturing contours. Units are mm; local axes: x along the wall
 * (centred), y up from the sill, z across the wall (fixed frame faces at
 * z = ±42.5).
 */

export const LX_WINDOW_SOURCE = {
  url: 'https://www.zinonpartners.com/proxy/api/file/download/2734ca86-c597-4a2f-8926-bd4b7bcb4a95',
  sha256: '6cf1a3fb32bc9c2231745c01265183f8a7f5ef0668bdccac5d92989d31ea3955',
  pdfPage: 30,
  printedPage: 59,
} as const

export const LX_WINDOW_MODELS = {
  'E9-PTT85-PHI': {
    label: 'LX Z:IN E9-PTT85 PHI',
    material: 'PVC',
    openingMethod: 'tilt-and-turn',
    /** A-A′ 아래 가로 치수선: 창틀의 앞뒤 외측면 사이. 정면 테두리 폭이 아니다. */
    frameDepthMm: 85,
    glazingThicknessesMm: [47, 51],
    /** 표의 Vent size. 외곽 창틀·벽 개구부의 허용 치수로 적용하지 않는다. */
    ventSizeMm: { minWidth: 490, maxWidth: 1300, minHeight: 490, maxHeight: 1600 },
    sectionFaceChainMm: [40, 87],
  },
} as const

export type LxWindowSelection = NonNullable<WindowNode['windowSystem']>

/** 화면 최초 선택값일 뿐 제조사 기본 사양이라는 뜻은 아니다. */
export const DEFAULT_LX_WINDOW_SELECTION: LxWindowSelection = {
  model: 'E9-PTT85-PHI',
  glassThicknessMm: 47,
}

export function isPublishedVentSize(widthMm: number, heightMm: number): boolean {
  const range = LX_WINDOW_MODELS['E9-PTT85-PHI'].ventSizeMm
  return (
    Number.isFinite(widthMm) &&
    Number.isFinite(heightMm) &&
    widthMm >= range.minWidth &&
    widthMm <= range.maxWidth &&
    heightMm >= range.minHeight &&
    heightMm <= range.maxHeight
  )
}

export type LxPoint = readonly [number, number]
export type LxFrameKind = 'fixed-frame' | 'sash-frame'
export type LxEdge = 'head' | 'sill' | 'left-jamb' | 'right-jamb'
export interface LxTrace {
  outline: readonly LxPoint[]
  cavities: readonly (readonly LxPoint[])[]
  /** Cross-hatched inner contours; the PDF does not identify their material. */
  hatchedInserts: readonly (readonly LxPoint[])[]
}

function orient(a: LxPoint, b: LxPoint, c: LxPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function onSegment(a: LxPoint, b: LxPoint, p: LxPoint): boolean {
  return (
    Math.abs(orient(a, b, p)) < 1e-7 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-7 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-7 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-7 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-7
  )
}

function intersects(a: LxPoint, b: LxPoint, c: LxPoint, d: LxPoint): boolean {
  const abC = orient(a, b, c)
  const abD = orient(a, b, d)
  const cdA = orient(c, d, a)
  const cdB = orient(c, d, b)
  if (abC * abD < 0 && cdA * cdB < 0) return true
  return (
    (Math.abs(abC) < 1e-7 && onSegment(a, b, c)) ||
    (Math.abs(abD) < 1e-7 && onSegment(a, b, d)) ||
    (Math.abs(cdA) < 1e-7 && onSegment(c, d, a)) ||
    (Math.abs(cdB) < 1e-7 && onSegment(c, d, b))
  )
}

function edges(poly: readonly LxPoint[]): [LxPoint, LxPoint][] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]!])
}

function strictlyInside(p: LxPoint, poly: readonly LxPoint[]): boolean {
  if (edges(poly).some(([a, b]) => onSegment(a, b, p))) return false
  let inside = false
  for (const [a, b] of edges(poly)) {
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  return inside
}

function simple(poly: readonly LxPoint[]): boolean {
  if (poly.length < 3) return false
  const all = edges(poly)
  return all.every(([a, b], i) =>
    all.every(
      ([c, d], j) =>
        i === j ||
        (i + 1) % all.length === j ||
        (j + 1) % all.length === i ||
        !intersects(a, b, c, d),
    ),
  )
}

function contained(inner: readonly LxPoint[], outer: readonly LxPoint[]): boolean {
  return (
    inner.every((point) => strictlyInside(point, outer)) &&
    edges(inner).every(([a, b]) => strictlyInside([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], outer)) &&
    edges(inner).every(([a, b]) => edges(outer).every(([c, d]) => !intersects(a, b, c, d)))
  )
}

/** Structural guard for the source traces, not a manufacturing suitability test. */
export function validateLxSectionTrace(trace: LxTrace): string[] {
  const errors: string[] = []
  if (!simple(trace.outline)) errors.push('outer-not-simple')
  trace.cavities.forEach((hole, i) => {
    if (!simple(hole)) errors.push(`cavity-${i}-not-simple`)
    if (!contained(hole, trace.outline)) errors.push(`cavity-${i}-outside-outer`)
    trace.cavities.slice(i + 1).forEach((other, j) => {
      if (
        edges(hole).some(([a, b]) => edges(other).some(([c, d]) => intersects(a, b, c, d))) ||
        hole.some((p) => strictlyInside(p, other)) ||
        other.some((p) => strictlyInside(p, hole))
      ) {
        errors.push(`cavity-${i}-overlaps-${i + j + 1}`)
      }
    })
  })
  trace.hatchedInserts.forEach((insert, i) => {
    if (!simple(insert)) errors.push(`insert-${i}-not-simple`)
    if (!trace.cavities.some((hole) => contained(insert, hole)))
      errors.push(`insert-${i}-outside-cavity`)
  })
  return errors
}

export const LX_PHI_HEAD_CROP = {
  sourcePdfSha256: '6cf1a3fb32bc9c2231745c01265183f8a7f5ef0668bdccac5d92989d31ea3955',
  referencePx: { x: 108, y: 221 },
  /** Head outside faces x108→318; the 85mm arrow is on the lower A-A′ section. */
  depthArrowPx: { from: 108, to: 318, mm: 85 },
  /** A→B=40mm, B→C=87mm. */
  verticalArrowsPx: { a: 221, b: 322, c: 539, firstMm: 40, secondMm: 87 },
} as const

/** A-A′ upper section. Nested cavities stay empty. */
export const LX_PHI_HEAD_TRACES: Record<LxFrameKind, LxTrace> = {
  'fixed-frame': {
    outline: [
      [108, 222],
      [119, 222],
      [120, 236],
      [131, 237],
      [131, 222],
      [147, 222],
      [147, 237],
      [274, 237],
      [274, 222],
      [287, 222],
      [287, 237],
      [302, 237],
      [302, 222],
      [318, 222],
      [318, 323],
      [198, 323],
      [188, 331],
      [163, 327],
      [149, 326],
      [147, 378],
      [132, 398],
      [108, 391],
    ],
    cavities: [
      [
        [180, 245],
        [275, 245],
        [275, 317],
        [180, 317],
      ],
      [
        [115, 315],
        [132, 313],
        [132, 386],
        [115, 383],
      ],
    ],
    hatchedInserts: [
      [
        [184, 249],
        [271, 249],
        [271, 314],
        [184, 314],
      ],
      [
        [118, 319],
        [129, 318],
        [129, 382],
        [118, 380],
      ],
    ],
  },
  'sash-frame': {
    outline: [
      [162, 325],
      [183, 325],
      [197, 335],
      [211, 342],
      [211, 377],
      [263, 377],
      [263, 385],
      [271, 385],
      [271, 413],
      [305, 413],
      [305, 378],
      [327, 378],
      [327, 322],
      [374, 322],
      [374, 476],
      [355, 476],
      [355, 485],
      [371, 486],
      [371, 538],
      [330, 538],
      [330, 491],
      [218, 491],
      [218, 539],
      [162, 526],
      [162, 450],
      [180, 450],
      [180, 408],
      [162, 405],
      [147, 390],
      [147, 340],
    ],
    cavities: [
      [
        [216, 382],
        [259, 382],
        [259, 402],
        [269, 417],
        [307, 417],
        [310, 401],
        [310, 382],
        [324, 382],
        [324, 454],
        [216, 454],
      ],
      [
        [171, 452],
        [193, 452],
        [193, 517],
        [171, 517],
      ],
    ],
    hatchedInserts: [
      [
        [220, 386],
        [256, 386],
        [256, 403],
        [270, 421],
        [312, 421],
        [314, 402],
        [314, 386],
        [320, 386],
        [320, 450],
        [220, 450],
      ],
      [
        [174, 455],
        [190, 455],
        [190, 513],
        [174, 513],
      ],
    ],
  },
}

export const LX_PHI_SILL_TRACES: Record<LxFrameKind, LxTrace> = {
  'fixed-frame': {
    outline: [
      [177, 325],
      [220, 310],
      [234, 310],
      [234, 319],
      [272, 319],
      [272, 335],
      [281, 335],
      [281, 389],
      [390, 389],
      [390, 491],
      [177, 491],
    ],
    cavities: [
      [
        [249, 392],
        [345, 392],
        [345, 468],
        [249, 468],
      ],
      [
        [184, 327],
        [200, 327],
        [200, 398],
        [184, 398],
      ],
    ],
    hatchedInserts: [
      [
        [253, 396],
        [341, 396],
        [341, 464],
        [253, 464],
      ],
      [
        [187, 331],
        [197, 331],
        [197, 393],
        [187, 393],
      ],
    ],
  },
  'sash-frame': {
    outline: [
      [233, 188],
      [281, 174],
      [281, 225],
      [397, 225],
      [397, 174],
      [442, 174],
      [442, 390],
      [390, 390],
      [389, 343],
      [361, 343],
      [361, 325],
      [347, 315],
      [333, 315],
      [325, 325],
      [325, 343],
      [287, 343],
      [281, 336],
      [233, 316],
    ],
    cavities: [
      [
        [285, 257],
        [400, 257],
        [400, 329],
        [369, 329],
        [362, 308],
        [326, 308],
        [319, 329],
        [285, 329],
      ],
      [
        [237, 191],
        [256, 191],
        [256, 264],
        [237, 264],
      ],
    ],
    hatchedInserts: [
      [
        [289, 261],
        [396, 261],
        [396, 325],
        [373, 325],
        [365, 304],
        [323, 304],
        [316, 325],
        [289, 325],
      ],
      [
        [240, 195],
        [253, 195],
        [253, 260],
        [240, 260],
      ],
    ],
  },
}

export const LX_PHI_JAMB_TRACES: Record<LxFrameKind, LxTrace> = {
  'fixed-frame': {
    outline: [
      [122, 149],
      [290, 149],
      [302, 177],
      [286, 188],
      [302, 203],
      [302, 242],
      [273, 247],
      [223, 247],
      [223, 316],
      [238, 316],
      [238, 338],
      [222, 360],
      [122, 360],
    ],
    cavities: [
      [
        [143, 236],
        [222, 236],
        [222, 312],
        [143, 312],
      ],
      [
        [213, 156],
        [288, 156],
        [288, 174],
        [213, 174],
      ],
    ],
    hatchedInserts: [
      [
        [147, 240],
        [218, 240],
        [218, 308],
        [147, 308],
      ],
      [
        [217, 159],
        [284, 159],
        [284, 171],
        [217, 171],
      ],
    ],
  },
  'sash-frame': {
    outline: [
      [222, 203],
      [430, 203],
      [438, 251],
      [388, 251],
      [388, 368],
      [438, 368],
      [438, 413],
      [222, 413],
      [222, 362],
      [237, 358],
      [237, 312],
      [277, 312],
      [277, 266],
      [222, 251],
    ],
    cavities: [
      [
        [278, 279],
        [356, 279],
        [356, 369],
        [278, 369],
        [278, 351],
        [313, 351],
        [313, 315],
        [278, 315],
      ],
      [
        [349, 210],
        [427, 210],
        [427, 228],
        [349, 228],
      ],
    ],
    hatchedInserts: [
      [
        [282, 283],
        [352, 283],
        [352, 365],
        [282, 365],
        [282, 355],
        [317, 355],
        [317, 311],
        [282, 311],
      ],
      [
        [353, 213],
        [423, 213],
        [423, 225],
        [353, 225],
      ],
    ],
  },
}

export const LX_PHI_HEAD_SCALE_PX_PER_MM =
  (LX_PHI_HEAD_CROP.depthArrowPx.to - LX_PHI_HEAD_CROP.depthArrowPx.from) /
  LX_PHI_HEAD_CROP.depthArrowPx.mm
export const LX_PHI_HEAD_VERTICAL_SCALE_PX_PER_MM =
  (LX_PHI_HEAD_CROP.verticalArrowsPx.c - LX_PHI_HEAD_CROP.verticalArrowsPx.a) /
  (LX_PHI_HEAD_CROP.verticalArrowsPx.firstMm + LX_PHI_HEAD_CROP.verticalArrowsPx.secondMm)
export const LX_PHI_SILL_DEPTH_PX_PER_MM = (390 - 177) / 85
export const LX_PHI_SILL_FACE_PX_PER_MM = (491 - 174) / 127
export const LX_PHI_JAMB_FACE_PX_PER_MM = (439 - 122) / 127
export const LX_PHI_JAMB_DEPTH_PX_PER_MM = (360 - 149) / 85

/**
 * A-A′ head and B-B′ left give independent ~107.4mm glass sightline insets.
 * The depicted glazing span is ~47mm; a separate 51mm bead contour has not
 * been identified.
 */
export const LX_PHI_GLAZING_TRACE = {
  insetFromFrameFaceMm:
    ((490 - 221) / LX_PHI_HEAD_VERTICAL_SCALE_PX_PER_MM +
      (390 - 122) / LX_PHI_JAMB_FACE_PX_PER_MM) /
    2,
  centerZMm:
    (((211 + 328) / 2 - 108) / LX_PHI_HEAD_SCALE_PX_PER_MM +
      ((252 + 368) / 2 - 149) / LX_PHI_JAMB_DEPTH_PX_PER_MM) /
      2 -
    42.5,
  depictedGlassThicknessMm:
    ((328 - 211) / LX_PHI_HEAD_SCALE_PX_PER_MM + (368 - 252) / LX_PHI_JAMB_DEPTH_PX_PER_MM) / 2,
} as const

export const LX_WINDOW_COLORS = {
  'fixed-frame': '#ece9e2',
  'sash-frame': '#c9c5bd',
  insert: '#777d80',
  glass: '#98c7d9',
  planGlass: '#b9e2ee',
} as const

export const LX_WINDOW_UNVERIFIED = [
  '도면 수동 추적선의 제작용 정밀도',
  '코너 접합·미터 및 교차 해칭 삽입재 재료',
  '47/51별 비드·패킹 대응',
  '벽 거친 개구부와 외곽 창틀의 시공 여유',
  'Tilt & Turn 개폐 축·기구 궤적',
] as const

/** Head: u = depth from the outside face, v = down from the head. */
function headToMm([x, y]: LxPoint): LxPoint {
  return [
    (x - LX_PHI_HEAD_CROP.referencePx.x) / LX_PHI_HEAD_SCALE_PX_PER_MM,
    (y - LX_PHI_HEAD_CROP.referencePx.y) / LX_PHI_HEAD_VERTICAL_SCALE_PX_PER_MM,
  ]
}
/** Sill: u = depth, v = up from the sill. */
function sillToMm([x, y]: LxPoint): LxPoint {
  return [(x - 177) / LX_PHI_SILL_DEPTH_PX_PER_MM, (491 - y) / LX_PHI_SILL_FACE_PX_PER_MM]
}
/** Jamb: u = outer face towards the glass, v = front to back. */
function jambToMm([x, y]: LxPoint): LxPoint {
  return [(x - 122) / LX_PHI_JAMB_FACE_PX_PER_MM, (y - 149) / LX_PHI_JAMB_DEPTH_PX_PER_MM]
}

export type LxSectionShape = {
  outline: LxPoint[]
  cavities: LxPoint[][]
  inserts: LxPoint[][]
}

/**
 * One edge's section in its own shape space (mm), before extrusion:
 * head/sill (u = depth, v = height measure), jambs (u = inward, v = depth).
 */
export function lxEdgeSection(edge: LxEdge, kind: LxFrameKind): LxSectionShape {
  const trace =
    edge === 'head'
      ? LX_PHI_HEAD_TRACES[kind]
      : edge === 'sill'
        ? LX_PHI_SILL_TRACES[kind]
        : LX_PHI_JAMB_TRACES[kind]
  const convert = edge === 'head' ? headToMm : edge === 'sill' ? sillToMm : jambToMm
  return {
    outline: trace.outline.map(convert),
    cavities: trace.cavities.map((ring) => ring.map(convert)),
    inserts: trace.hatchedInserts.map((ring) => ring.map(convert)),
  }
}

type LxWindowLike = Pick<
  WindowNode,
  'windowSystem' | 'width' | 'height' | 'openingKind' | 'windowType' | 'operationState'
>

/** mmmcraft's messages, or null. Width/height are the frame's outer size. */
export function lxWindowError(window: LxWindowLike): string | null {
  const selection = window.windowSystem
  if (selection === undefined) return null
  if (
    window.openingKind === 'opening' ||
    selection.model !== 'E9-PTT85-PHI' ||
    (selection.glassThicknessMm !== 47 && selection.glassThicknessMm !== 51)
  ) {
    return '창호 모델과 유리 두께를 다시 선택해 주세요.'
  }
  const inset = LX_PHI_GLAZING_TRACE.insetFromFrameFaceMm
  const w = window.width * 1000
  const h = window.height * 1000
  if (![w, h].every(Number.isFinite) || Math.min(w, h) <= 2 * inset) {
    return '창틀 단면이 겹칩니다. 창호 표시 폭과 높이를 늘려 주세요.'
  }
  if ((window.operationState ?? 0) !== 0 || window.windowType !== 'casement') {
    return '이 시스템창호는 닫힌 상태만 지원합니다. 창호 모델을 다시 선택해 주세요.'
  }
  return null
}

/** Node updates for choosing a model (or `null` = 기본 창호), as mmmcraft
 *  `withLxWindowSelection`: an LX window is a closed casement. */
export function lxWindowSelectionUpdates(
  selection: LxWindowSelection | null,
): Pick<WindowNode, 'windowSystem' | 'windowType' | 'operationState'> {
  return {
    windowSystem: selection ? { ...selection } : undefined,
    windowType: selection ? 'casement' : 'fixed',
    operationState: 0,
  }
}

/** Glass slab in local mm: x/y centred span and z centre. */
export function lxWindowGlass(widthMm: number, heightMm: number, selection: LxWindowSelection) {
  const inset = LX_PHI_GLAZING_TRACE.insetFromFrameFaceMm
  return {
    width: widthMm - 2 * inset,
    height: heightMm - 2 * inset,
    thickness: selection.glassThicknessMm,
    centerZ: LX_PHI_GLAZING_TRACE.centerZMm,
  }
}

/**
 * Horizontal cut through B-B′ for the floor plan: each jamb's rings in local
 * (x along the wall, z across) mm. The head/sill are not projected.
 */
export function lxWindowJambPlan(widthMm: number) {
  return ([-1, 1] as const).flatMap((side) => {
    const transform = ([u, v]: LxPoint): LxPoint => [side * (widthMm / 2 - u), v - 42.5]
    return (['fixed-frame', 'sash-frame'] as const).flatMap((kind) => {
      const section = lxEdgeSection('left-jamb', kind)
      return [
        {
          id: `${side}:${kind}`,
          kind,
          rings: [section.outline.map(transform), ...section.cavities.map((h) => h.map(transform))],
        },
        ...section.inserts.map((p, i) => ({
          id: `${side}:${kind}:insert:${i}`,
          kind: 'insert' as const,
          rings: [p.map(transform)],
        })),
      ]
    })
  })
}
