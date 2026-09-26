import {
  type AnyNode,
  CAD_BOARD_BACK_MM,
  CAD_STUD_SIZE_MM,
  calculateLevelMiters,
  type FloorplanGeometry,
  type FloorplanPoint,
  finishDepthToOffsetMm,
  type GeometryContext,
  getWallCurveLength,
  getWallInnerFaceLine,
  getWallMidpointHandlePoint,
  getWallPlanFootprint,
  isCurvedWall,
  timberStudCentresMm,
  type WallMiterData,
  type WallNode,
  wallConstructionLayers,
  wallLeftNormal,
} from '@pascal-app/core'

// Same constants the legacy `getFloorplanWall` uses (editor/lib/floorplan/walls.ts).
// Slightly exaggerates thin walls so the 2D plan stays legible without
// drifting from BIM data. Inlined to keep nodes/wall self-contained.
const FLOORPLAN_WALL_THICKNESS_SCALE = 1.18
const FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS = 0.13
const FLOORPLAN_MAX_EXTRA_THICKNESS = 0.035

function floorplanWallThickness(wall: WallNode): number {
  const baseThickness = wall.thickness ?? 0.1
  // A constructed wall draws its real layers, so it keeps its true thickness.
  if (wall.construction) return baseThickness
  const scaledThickness = baseThickness * FLOORPLAN_WALL_THICKNESS_SCALE
  return Math.min(
    baseThickness + FLOORPLAN_MAX_EXTRA_THICKNESS,
    Math.max(baseThickness, scaledThickness, FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS),
  )
}

function exaggerateWallThickness(wall: WallNode): WallNode {
  return { ...wall, thickness: floorplanWallThickness(wall) }
}

function formatLengthMetric(
  meters: number,
  unit: 'metric' | 'imperial' | 'millimeter' | 'centimeter' = 'millimeter',
): string {
  if (unit === 'imperial') {
    const feetValue = Math.abs(meters) / 0.3048
    let feet = Math.floor(feetValue)
    let inches = Math.round((feetValue - feet) * 12)
    if (inches === 12) {
      feet += 1
      inches = 0
    }
    const sign = meters < 0 && (feet !== 0 || inches !== 0) ? '-' : ''
    return `${sign}${feet}'${inches}"`
  }
  if (unit === 'centimeter') {
    return `${Math.round(meters * 1000) / 10}cm`
  }
  return `${Math.round(meters * 1000)}mm`
}

export function computeWallFloorplanLevelData({
  siblings,
}: {
  siblings: ReadonlyArray<WallNode>
  nodes: Record<string, AnyNode>
}): WallMiterData {
  return calculateLevelMiters(siblings.map(exaggerateWallThickness))
}

/**
 * Stage C floor-plan builder for wall — emits the full chrome stack the
 * legacy `floorplan-panel.tsx` rendered inline:
 *
 *   1. The mitered footprint polygon (themed fill + stroke).
 *   2. A diagonal hatch overlay when selected.
 *   3. A transparent hit-line on the centerline so the user can grab the
 *      wall body easily.
 *   4. Two endpoint handles (start + end) when selected — the registry
 *      layer hosts the 5-circle stack + hover transitions + 2D drag.
 *   5. A small dimension label at the midpoint when selected.
 *
 * `ctx.levelData` provides the shared level miter graph when the floor-plan
 * dispatcher precomputes it; `ctx.siblings` remains the fallback path for
 * direct builder callers.
 */
export function buildWallFloorplan(node: WallNode, ctx: GeometryContext): FloorplanGeometry | null {
  const self = exaggerateWallThickness(node)
  // Prefer the level-batch miter graph the floor-plan dispatcher precomputes
  // once per pass (`computeWallFloorplanLevelData`). Only the fallback path —
  // a direct builder caller with no shared data — pays the O(N) exaggerate +
  // level-wide miter calc per wall; the dispatcher path is O(1) here, which is
  // what keeps a wall drag from being O(N²) across the level.
  const miters =
    (ctx.levelData as WallMiterData | undefined) ??
    calculateLevelMiters([
      self,
      ...ctx.siblings
        .filter((s): s is AnyNode & WallNode => s.type === 'wall')
        .map(exaggerateWallThickness),
    ])

  const polygon = getWallPlanFootprint(self, miters)
  if (!polygon || polygon.length < 3) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const isHovered = view?.hovered ?? false
  const unit = view?.unit ?? 'millimeter'
  const showSelectedChrome = isSelected || isHighlighted

  const points = polygon.map((p) => [p.x, p.y] as FloorplanPoint)

  const fill = isHovered && !isSelected ? '#6557e8' : '#111111'

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points,
      fill,
      stroke: isHovered && !isSelected ? '#8b82ff' : 'transparent',
      strokeWidth: isHovered && !isSelected ? 0.035 : 0,
      opacity: 1,
      // Once the wall is selected, the body keeps catching the pointer
      // so the cursor stays neutral (no drag/pointer affordance from
      // the slab below leaking through), but only the side-arrows and
      // endpoint handles should start a drag — the wrapper g's click
      // handler is a no-op re-select for the already-selected wall.
      cursor: isSelected ? 'default' : undefined,
    },
  ]

  if (node.construction && !isCurvedWall(node)) {
    children.push(...constructionLayers(node, points, ctx.children))
  }

  // Hit-line on the centerline. Stroke width is in screen pixels so it
  // stays clickable at any zoom. Replaced by the body-drag handle below
  // once the wall is selected.
  if (!isSelected) {
    children.push({
      kind: 'hit-line',
      x1: node.start[0],
      y1: node.start[1],
      x2: node.end[0],
      y2: node.end[1],
      strokeWidthPx: 18,
      cursor: 'pointer',
    })
  }

  // The selected wall's body drags the wall sideways along its normal —
  // the same move as the side arrows (`wallFloorplanMoveTarget`); linked
  // walls follow. Pushed before the handles so they stay on top.
  if (isSelected && !isCurvedWall(node)) {
    children.push({
      kind: 'edge-handle',
      x1: node.start[0],
      y1: node.start[1],
      x2: node.end[0],
      y2: node.end[1],
      affordance: 'move',
      payload: { wallId: node.id },
      cursor: 'move',
    })
  }

  // Corner handles on hover as well as when selected, so a corner can be
  // grabbed and dragged (freely, linked walls following) without selecting
  // the wall first.
  if (isSelected || isHovered) {
    children.push({
      kind: 'endpoint-handle',
      point: [node.start[0], node.start[1]],
      state: 'idle',
      affordance: 'move-endpoint',
      payload: { wallId: node.id, endpoint: 'start' as const },
    })
    children.push({
      kind: 'endpoint-handle',
      point: [node.end[0], node.end[1]],
      state: 'idle',
      affordance: 'move-endpoint',
      payload: { wallId: node.id, endpoint: 'end' as const },
    })
  }

  if (isSelected) {
    // Side move arrows — two directional arrows at the wall midpoint,
    // pointing outward perpendicular to the wall. Mirrors the 3D
    // `WallMoveSideHandles` arrows so users can grab the wall body
    // from the floor plan. PointerDown on either arrow activates
    // `wallFloorplanMoveTarget` via the registry-layer dispatcher.
    {
      const dx = node.end[0] - node.start[0]
      const dz = node.end[1] - node.start[1]
      const wallLength = Math.hypot(dx, dz)
      if (wallLength > 1e-6) {
        const midX = (node.start[0] + node.end[0]) / 2
        const midZ = (node.start[1] + node.end[1]) / 2
        const nx = -dz / wallLength
        const nz = dx / wallLength
        const offset = floorplanWallThickness(node) / 2 + 0.05
        children.push({
          kind: 'move-arrow',
          point: [midX + nx * offset, midZ + nz * offset],
          angle: Math.atan2(nz, nx),
        })
        children.push({
          kind: 'move-arrow',
          point: [midX - nx * offset, midZ - nz * offset],
          angle: Math.atan2(-nz, -nx),
        })
      }
    }

    // Curve sagitta handle — teal dot at the wall midpoint that
    // controls `curveOffset`. Only on walls that are already curved: on a
    // straight wall the midpoint belongs to the body drag, and bending
    // starts from the inspector's curve field instead. Hidden when the
    // wall hosts a door / window / wall-attached item: bending the wall
    // would tear those children (see
    // `wallCurveHandles.hasWallChildrenBlockingCurve`).
    if (isCurvedWall(node) && !hasCurveBlockingChildren(ctx.children)) {
      const handle = getWallMidpointHandlePoint(node)
      children.push({
        kind: 'endpoint-handle',
        point: [handle.x, handle.y],
        state: 'idle',
        variant: 'curve',
        affordance: 'curve',
        payload: { wallId: node.id },
      })
    }

    // Length measurement. Curved walls use the simple rounded label
    // (the chord-vs-arc thing is hard to express with a dimension line);
    // straight walls get the full architect's overlay with extension
    // marks + ticks, offset to the side facing away from the level
    // centroid (matches the legacy `getWallMeasurementOverlay`).
    const length = getWallCurveLength(node)
    if (length >= 0.1) {
      const dx = node.end[0] - node.start[0]
      const dz = node.end[1] - node.start[1]
      const midX = (node.start[0] + node.end[0]) / 2
      const midZ = (node.start[1] + node.end[1]) / 2

      if (isCurvedWall(node)) {
        children.push({
          kind: 'dimension-label',
          cx: midX,
          cy: midZ,
          text: formatLengthMetric(length, unit),
          angle: Math.atan2(dz, dx),
        })
      } else {
        // Outward unit normal = perpendicular to (dx, dz), choose the
        // side facing away from other walls' centroid so the dimension
        // line sits outside the building.
        const nx = -dz / length
        const nz = dx / length
        const wallSiblings = ctx.siblings.filter((s): s is AnyNode & WallNode => s.type === 'wall')
        const centroid = wallCentroid([node, ...wallSiblings])
        const cx = midX - centroid[0]
        const cz = midZ - centroid[1]
        const facingAway = cx * nx + cz * nz >= 0 ? 1 : -1
        // The measured span is the wall's INNER face (내경, real thickness —
        // not the exaggerated plan outline), matching the rectangle-room
        // tool's dragged rect and the 3D measurement label.
        const levelWalls = [node, ...wallSiblings.filter((s) => s.id !== node.id)]
        const innerFace = getWallInnerFaceLine(node, calculateLevelMiters(levelWalls), levelWalls)
        const dimensionStart: [number, number] = innerFace
          ? [innerFace.start.x, innerFace.start.y]
          : [node.start[0], node.start[1]]
        const dimensionEnd: [number, number] = innerFace
          ? [innerFace.end.x, innerFace.end.y]
          : [node.end[0], node.end[1]]
        const dimensionLength = innerFace
          ? Math.hypot(dimensionEnd[0] - dimensionStart[0], dimensionEnd[1] - dimensionStart[1])
          : length
        children.push({
          kind: 'dimension',
          start: dimensionStart,
          end: dimensionEnd,
          offsetNormal: [nx * facingAway, nz * facingAway],
          offsetDistance: 0.75,
          extensionOvershoot: 0.12,
          text: formatLengthMetric(dimensionLength, unit),
        })
      }
    }
  }

  return { kind: 'group', children }
}

const LAYER_STROKE = '#697586'
const STUD_COLOR = '#bd9969'
const STUD_DEPTH_MM: [number, number] = [CAD_BOARD_BACK_MM, CAD_BOARD_BACK_MM + CAD_STUD_SIZE_MM]

/** Sutherland–Hodgman: keep the part of `poly` where f(p) ≥ 0 (f linear). */
function clipHalfPlane(poly: FloorplanPoint[], f: (p: FloorplanPoint) => number): FloorplanPoint[] {
  const out: FloorplanPoint[] = []
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i] as FloorplanPoint
    const b = poly[(i + 1) % poly.length] as FloorplanPoint
    const fa = f(a)
    const fb = f(b)
    if (fa >= 0) out.push(a)
    if (fa >= 0 !== fb >= 0) {
      const t = fa / (fa - fb)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

function polygonArea(poly: FloorplanPoint[]): number {
  let area = 0
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i] as FloorplanPoint
    const b = poly[(i + 1) % poly.length] as FloorplanPoint
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area) / 2
}

/**
 * mmmcraft `WallConstruction2D`: each finish / core layer (and 목상 stud)
 * is the mitred footprint clipped to its depth band, on the floor-level
 * pieces between doors, so corners wrap like the plain wall and door gaps
 * stay open. Unfilled bands are the stud / adhesive cavities.
 */
function constructionLayers(
  wall: WallNode,
  footprint: FloorplanPoint[],
  children: readonly AnyNode[],
): FloorplanGeometry[] {
  const c = wall.construction
  if (!c) return []
  const T = (wall.thickness ?? 0.1) * 1000
  const [sx, sz] = wall.start
  const len = Math.hypot(wall.end[0] - sx, wall.end[1] - sz)
  if (len < 1e-6) return []
  const u: [number, number] = [(wall.end[0] - sx) / len, (wall.end[1] - sz) / len]
  const n = wallLeftNormal(wall)
  const along = (p: FloorplanPoint) => (p[0] - sx) * u[0] + (p[1] - sz) * u[1]
  const across = (p: FloorplanPoint) => (p[0] - sx) * n[0] + (p[1] - sz) * n[1]

  // Floor-level pieces: doors cut the wall, windows do not.
  const doors = children
    .filter((ch) => ch.type === 'door')
    .map((ch) => {
      const d = ch as unknown as { position: [number, number, number]; width: number }
      return [d.position[0] - d.width / 2, d.position[0] + d.width / 2] as const
    })
    .sort((a, b) => a[0] - b[0])
  const pieces: [number, number][] = []
  let cursor = Number.NEGATIVE_INFINITY
  for (const [a, b] of doors) {
    if (a > cursor) pieces.push([cursor, a])
    cursor = Math.max(cursor, b)
  }
  pieces.push([cursor, Number.POSITIVE_INFINITY])

  const band = (fromMm: number, toMm: number, x0: number, x1: number) => {
    const o1 = finishDepthToOffsetMm(T, c.side, fromMm) / 1000
    const o2 = finishDepthToOffsetMm(T, c.side, toMm) / 1000
    const lo = Math.min(o1, o2)
    const hi = Math.max(o1, o2)
    let poly = clipHalfPlane(footprint, (p) => across(p) - lo)
    poly = clipHalfPlane(poly, (p) => hi - across(p))
    if (Number.isFinite(x0)) poly = clipHalfPlane(poly, (p) => along(p) - x0)
    if (Number.isFinite(x1)) poly = clipHalfPlane(poly, (p) => x1 - along(p))
    return poly.length >= 3 && polygonArea(poly) > 1e-8 ? poly : null
  }
  const style = (fill: string): Partial<FloorplanGeometry> => ({
    fill,
    stroke: LAYER_STROKE,
    strokeWidth: 0.7,
    vectorEffect: 'non-scaling-stroke',
    pointerEvents: 'none',
  })

  const out: FloorplanGeometry[] = []
  for (const [x0, x1] of pieces) {
    for (const layer of wallConstructionLayers(T, c)) {
      const poly = band(layer.fromMm, layer.toMm, x0, x1)
      if (!poly) continue
      out.push({
        kind: 'polygon',
        points: poly,
        ...style(layer.id === 'core' ? 'none' : layer.color),
      } as FloorplanGeometry)
    }
  }
  const half = CAD_STUD_SIZE_MM / 2000
  for (const xMm of timberStudCentresMm(len * 1000, c)) {
    const x = xMm / 1000
    if (!pieces.some(([a, b]) => x - half >= a && x + half <= b)) continue
    const poly = band(STUD_DEPTH_MM[0], STUD_DEPTH_MM[1], x - half, x + half)
    if (poly) out.push({ kind: 'polygon', points: poly, ...style(STUD_COLOR) } as FloorplanGeometry)
  }
  return out
}

function wallCentroid(walls: WallNode[]): [number, number] {
  // Mean of every wall endpoint — cheap approximation of "where the
  // building lives" so we can offset the dimension line away from it.
  let sumX = 0
  let sumZ = 0
  let count = 0
  for (const wall of walls) {
    sumX += wall.start[0] + wall.end[0]
    sumZ += wall.start[1] + wall.end[1]
    count += 2
  }
  if (count === 0) return [0, 0]
  return [sumX / count, sumZ / count]
}

/**
 * Doors, windows, and wall-attached items would tear if the wall bent
 * around them, so the curve sagitta handle hides when any of those
 * children exist. Mirrors the legacy
 * `wallCurveHandles.hasWallChildrenBlockingCurve` check.
 */
function hasCurveBlockingChildren(children: AnyNode[]): boolean {
  for (const child of children) {
    if (child.type === 'door' || child.type === 'window') return true
    if (child.type === 'item') {
      const attachTo = (child as { asset?: { attachTo?: string } }).asset?.attachTo
      if (attachTo === 'wall' || attachTo === 'wall-side') return true
    }
  }
  return false
}
