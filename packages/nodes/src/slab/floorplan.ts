import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getMaterialPresetByRef,
  getRenderableSlabPolygon,
  parseMaterialRef,
  resolveMaterial,
  type SceneMaterialId,
  type SlabNode,
} from '@pascal-app/core'
import { roomDisplayName } from './room-name'

function resolveFloorMaterial(node: SlabNode, ctx: GeometryContext) {
  const ref = node.slots?.surface ?? node.materialPreset
  const parsed = parseMaterialRef(ref)
  if (parsed?.kind === 'library') {
    const preset = getMaterialPresetByRef(ref)
    if (preset) {
      return {
        color: preset.mapProperties.color,
        url: preset.maps.albedoMap,
        repeat: [preset.mapProperties.repeatX, preset.mapProperties.repeatY] as FloorplanPoint,
        rotation: preset.mapProperties.rotation,
        offset: [0, 0] as FloorplanPoint,
      }
    }
  }
  if (parsed?.kind === 'scene') {
    const material = ctx.materials?.[parsed.id as SceneMaterialId]?.material
    if (material) {
      const props = resolveMaterial(material)
      return {
        color: props.color,
        url: material.texture?.url,
        repeat: (material.texture?.repeat ?? [
          material.texture?.scale ?? 1,
          material.texture?.scale ?? 1,
        ]) as FloorplanPoint,
        rotation: material.texture?.rotation ?? 0,
        offset: (material.texture?.offset ?? [0, 0]) as FloorplanPoint,
      }
    }
  }
  const props = resolveMaterial(node.material)
  return {
    color: props.color,
    url: node.material?.texture?.url,
    repeat: (node.material?.texture?.repeat ?? [
      node.material?.texture?.scale ?? 1,
      node.material?.texture?.scale ?? 1,
    ]) as FloorplanPoint,
    rotation: node.material?.texture?.rotation ?? 0,
    offset: (node.material?.texture?.offset ?? [0, 0]) as FloorplanPoint,
  }
}

/**
 * Stage C floor-plan builder for slab. Renders the slab polygon as a
 * filled path with holes cut out; when selected, overlays themed
 * chrome (accent stroke, hatch fill) plus the full boundary editor:
 *
 *   - Vertex handles on every polygon corner (orange dots).
 *   - Midpoint `+` handles between vertices to insert a new vertex.
 *   - Edge handles along each edge so the user can drag the whole
 *     edge perpendicular.
 *   - Same three handle sets for every hole in `node.holes`, with the
 *     `holeIndex` carried in each handle's payload.
 *
 * Uses `getRenderableSlabPolygon` for the visible fill (auto-slabs
 * generated from walls clip to wall footprints), but vertex / edge /
 * midpoint handles live on the **raw** `node.polygon` — matches the
 * legacy slab boundary editor which always operates on raw data.
 */
export function buildSlabFloorplan(node: SlabNode, ctx: GeometryContext): FloorplanGeometry | null {
  const polygon = node.polygon
  if (!polygon || polygon.length < 3) return null

  const visualPolygon = getRenderableSlabPolygon(node)
  if (!visualPolygon || visualPolygon.length < 3) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  const outer: FloorplanPoint[] = visualPolygon.map(([x, z]) => [x, z] as FloorplanPoint)

  const ring = (points: FloorplanPoint[]) => {
    const [first, ...rest] = points
    if (!first) return ''
    return [`M ${first[0]} ${first[1]}`, ...rest.map(([x, y]) => `L ${x} ${y}`), 'Z'].join(' ')
  }
  const segments: string[] = [ring(outer)]

  const holes = node.holes ?? []
  for (const hole of holes) {
    if (hole.length < 3) continue
    const holePts: FloorplanPoint[] = hole.map(([x, z]) => [x, z] as FloorplanPoint)
    segments.push(ring(holePts))
  }

  const stroke = showSelectedChrome && palette ? palette.selectedStroke : '#475569'
  const floorMaterial = resolveFloorMaterial(node, ctx)
  const fill = floorMaterial.color

  // Slab body. Uses `fillOpacity` / `strokeOpacity` independently so the
  // outline stays crisp while the fill stays translucent — zones under
  // the slab read through, and on the selected state the hatch overlay
  // (`{ kind: 'hatch' }` below) carries the visual weight without the
  // background going opaque-white.
  const children: FloorplanGeometry[] = []
  if (floorMaterial.url) {
    const xs = outer.map((point) => point[0])
    const ys = outer.map((point) => point[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    children.push({
      kind: 'texture-path',
      d: segments.join(' '),
      url: floorMaterial.url,
      bounds: {
        x: minX,
        y: minY,
        width: Math.max(0.01, maxX - minX),
        height: Math.max(0.01, maxY - minY),
      },
      repeat: floorMaterial.repeat,
      rotation: floorMaterial.rotation,
      offset: floorMaterial.offset,
      opacity: 0.92,
    })
  }
  children.push({
    kind: 'path',
    d: segments.join(' '),
    fill: floorMaterial.url ? 'transparent' : fill,
    fillOpacity: floorMaterial.url ? 0 : 0.82,
    stroke,
    strokeWidth: showSelectedChrome ? 0.04 : 0.03,
    strokeOpacity: showSelectedChrome ? 0.96 : 0.85,
  })

  // Hatch overlay on selected — same `<defs>` pattern as the wall.
  if (isSelected && palette && !floorMaterial.url) {
    children.push({
      kind: 'hatch',
      points: outer,
      color: palette.selectedHatch,
      opacity: 0.7,
    })
  }

  const label = roomLabel(node, ctx, outer)
  if (label) children.push(label)

  // Boundary editor — visible only when the slab is the active selection.
  if (isSelected) {
    appendRingEditor(children, polygon, undefined)
    holes.forEach((hole, holeIndex) => {
      if (hole.length >= 3) appendRingEditor(children, hole, holeIndex)
    })
  }

  return { kind: 'group', children }
}

const ROOM_LABEL_FONT_SIZE = 0.16

function ringArea(points: readonly (readonly [number, number])[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

function ringCentroid(points: FloorplanPoint[]): FloorplanPoint {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    const cross = x1 * y2 - x2 * y1
    a += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  if (Math.abs(a) < 1e-9) {
    const n = points.length
    return [points.reduce((t, p) => t + p[0], 0) / n, points.reduce((t, p) => t + p[1], 0) / n]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/**
 * mmmcraft's room label on a floor found from a closed wall loop:
 * "공간 N · 12.34 m²", the area on the wall centre lines (as mmmcraft
 * measures it) less any holes. A named floor shows its name instead.
 */
function roomLabel(
  node: SlabNode,
  ctx: GeometryContext,
  outer: FloorplanPoint[],
): FloorplanGeometry | null {
  if (!node.autoFromWalls) return null
  const area =
    ringArea(node.polygon) - (node.holes ?? []).reduce((sum, hole) => sum + ringArea(hole), 0)
  const rooms = ctx.siblings.filter((n) => n.type === 'slab' && (n as SlabNode).autoFromWalls)
  const index = rooms.findIndex((n) => n.id === node.id)
  const name = roomDisplayName(node) ?? `공간 ${index >= 0 ? index + 1 : rooms.length + 1}`
  const [x, y] = ringCentroid(outer)
  return {
    kind: 'text',
    x,
    y,
    text: `${name} · ${area.toFixed(2)} m²`,
    fontSize: ROOM_LABEL_FONT_SIZE,
    fill: '#3d3a52',
    stroke: '#ffffff',
    strokeWidth: ROOM_LABEL_FONT_SIZE * 0.3,
    paintOrder: 'stroke',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: 600,
    textAnchor: 'middle',
    dominantBaseline: 'central',
    upright: true,
  }
}

/**
 * Push vertex / midpoint / edge handles for a single ring (boundary or
 * hole). `holeIndex === undefined` targets `node.polygon`; otherwise
 * `node.holes[holeIndex]`. Emits in this order so the hit-test
 * priority is sensible: edges first (largest hit area, lowest z),
 * then midpoints, then vertices on top.
 */
function appendRingEditor(
  children: FloorplanGeometry[],
  ring: ReadonlyArray<readonly [number, number]>,
  holeIndex: number | undefined,
): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    children.push({
      kind: 'edge-handle',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      affordance: 'move-edge',
      payload: { holeIndex, edgeIndex: i },
    })
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    children.push({
      kind: 'midpoint-handle',
      point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      affordance: 'add-vertex',
      payload: { holeIndex, edgeIndex: i },
    })
  }
  for (let i = 0; i < ring.length; i++) {
    const [x, z] = ring[i]!
    children.push({
      kind: 'endpoint-handle',
      point: [x, z],
      state: 'idle',
      affordance: 'move-vertex',
      payload: { holeIndex, vertexIndex: i },
    })
  }
}
