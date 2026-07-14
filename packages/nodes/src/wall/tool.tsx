import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  calculateLevelMiters,
  collectAlignmentAnchors,
  detectSpacesForLevel,
  emitter,
  type GridEvent,
  getWallMiterBoundaryPoints,
  type LevelNode,
  type Point2D,
  pauseSceneHistory,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  projectAutoSlabsForPlan,
  resolveAlignment,
  resolveBuildingForLevel,
  resumeSceneHistory,
  type SlabNode,
  useScene,
  type WallMiterData,
  type WallNode,
  wallClosesRoom,
} from '@pascal-app/core'
import {
  CursorSphere,
  createWallOnCurrentLevel,
  EDITOR_LAYER,
  formatAngleRadians,
  formatLinearMeasurement,
  getAngleArcToSegmentReference,
  getAngleToSegmentReference,
  getRectangleRoomCenterlineCorners,
  getSegmentAngleReferenceAtPoint,
  inferOrthogonalWallPoint,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isMagneticSnapActive,
  type LinearUnit,
  markToolCancelConsumed,
  type SegmentAngleReference,
  snapWallDraftPointDetailed,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useSegmentDraftChain,
  useWallSnapIndicator,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_JOIN_SNAP_RADIUS,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, BufferGeometry, DoubleSide, type Group, type Mesh, Vector3 } from 'three'

/**
 * Phase 5 Stage D — wall placement tool (kind-owned).
 *
 * 1:1 port of the legacy `WallTool`. Two-click flow: click 1 sets the
 * start, click 2 creates the wall. Between clicks a vertical preview
 * rectangle + length/angle measurement HUD follow the pointer. Snapping is
 * governed by the global snapping mode (`'off'` is the bypass); Esc cancels.
 *
 * Not a `DragAction` — same reasoning as fence/slab/ceiling placement:
 * stateful sequence of grid:click events, not a single drag-up.
 *
 * Mounted via `def.tool` from `wall/definition.ts`.
 */
const WALL_HEIGHT = 2.5
const DRAFT_WALL_THICKNESS = 0.1
/** Figma-style alignment-snap threshold (meters), matching the move tools. */
const ALIGNMENT_THRESHOLD_M = 0.08
// HUD label heights are measured from the top of the preview bar, so they
// track whatever height a seeded preset draws at (`previewHeight`).
const DRAFT_LABEL_Y_OFFSET = 0.22
const DRAFT_DIMENSION_OFFSET = 0.36
const DRAFT_DIMENSION_TICK_SIZE = 0.09
const DRAFT_ANGLE_LABEL_Y_OFFSET = 0.08
const DRAFT_ANGLE_ARC_Y_OFFSET = 0.012
const DRAFT_ANGLE_ARC_MIN_RADIUS = 0.32
const DRAFT_ANGLE_ARC_MAX_RADIUS = 0.72
const DRAFT_ANGLE_ARC_SEGMENTS = 24
const DRAFT_AXIS_GUIDE_LENGTH = 2000
const DRAFT_AXIS_GUIDE_WIDTH = 0.035
const DRAFT_AXIS_GUIDE_HEIGHT = 0.004
const DRAFT_AXIS_GUIDE_Y_OFFSET = 0.026
const DRAFT_AXIS_ANGLE_ARC_Y_OFFSET = 0.05
const DRAFT_AXIS_ANGLE_LABEL_Y_OFFSET = 0.16
const DRAFT_AXIS_ANGLE_ARC_MIN_RADIUS = 0.36
const DRAFT_AXIS_ANGLE_ARC_MAX_RADIUS = 0.82
const AXIS_ANGLE_REFERENCES: SegmentAngleReference[] = [
  { vector: [1, 0], orientation: 'axis' },
  { vector: [0, 1], orientation: 'axis' },
]

type DraftAngleLabel = {
  id: string
  label: string
  position: [number, number, number]
  arc: {
    center: WallPlanPoint
    radius: number
    startAngle: number
    endAngle: number
    y: number
  }
}

type DraftMeasurementState = {
  start: WallPlanPoint
  end: WallPlanPoint
  guideY: number
  lengthLabel: string
  lengthPosition: [number, number, number]
  angleLabels: DraftAngleLabel[]
} | null

type DraftAxisGuideState = {
  origin: WallPlanPoint
  y: number
  lockedAxis: 'x' | 'z' | null
  angleLabel: DraftAngleLabel | null
} | null

type AxisAngleCandidate = {
  angle: number
  arc: {
    startAngle: number
    endAngle: number
    midAngle: number
  }
}

type FaceAngleCandidate = {
  index: number
  point: WallPlanPoint
  vector: WallPlanPoint
}

type FaceAnglePair = {
  draft: FaceAngleCandidate
  connected: FaceAngleCandidate
  distance: number
}

type AngleSource = {
  arcCenter: WallPlanPoint
  connectedVector: WallPlanPoint
  draftVector: WallPlanPoint
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function distanceSquared(a: WallPlanPoint, b: WallPlanPoint) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]

  return dx * dx + dz * dz
}

function pointMatches(a: WallPlanPoint, b: WallPlanPoint, tolerance = 1e-5) {
  return distanceSquared(a, b) <= tolerance * tolerance
}

function getLockedOrthogonalAxis(start: WallPlanPoint, end: WallPlanPoint): 'x' | 'z' | null {
  const dx = Math.abs(end[0] - start[0])
  const dz = Math.abs(end[1] - start[1])
  if (dx < 0.01 && dz < 0.01) return null
  if (dz < 1e-6) return 'x'
  if (dx < 1e-6) return 'z'
  return null
}

function isWithinWallJoinSnapRadius(point: WallPlanPoint, vertex: Vector3) {
  const dx = point[0] - vertex.x
  const dz = point[1] - vertex.z

  return dx * dx + dz * dz <= WALL_JOIN_SNAP_RADIUS * WALL_JOIN_SNAP_RADIUS
}

function getNearestAxisAngleLabel(
  start: WallPlanPoint,
  end: WallPlanPoint,
  y: number,
): DraftAngleLabel | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return null

  const draftVector: WallPlanPoint = [dx, dz]
  const axisCandidates: AxisAngleCandidate[] = []
  for (const reference of AXIS_ANGLE_REFERENCES) {
    const angle = getAngleToSegmentReference(draftVector, reference)
    const arc = getAngleArcToSegmentReference(draftVector, reference)
    if (!(angle === null || arc === null)) {
      axisCandidates.push({ angle, arc })
    }
  }
  const nearestAxisAngle = axisCandidates.sort((a, b) => a.angle - b.angle)[0]
  if (!nearestAxisAngle) return null

  const radius = clamp(
    length * 0.22,
    DRAFT_AXIS_ANGLE_ARC_MIN_RADIUS,
    DRAFT_AXIS_ANGLE_ARC_MAX_RADIUS,
  )
  const { angle, arc } = nearestAxisAngle

  return {
    id: 'axis',
    label: formatAngleRadians(angle),
    position: [
      start[0] + Math.cos(arc.midAngle) * (radius + 0.16),
      y + DRAFT_AXIS_ANGLE_LABEL_Y_OFFSET,
      start[1] + Math.sin(arc.midAngle) * (radius + 0.16),
    ],
    arc: {
      center: start,
      radius,
      startAngle: arc.startAngle,
      endAngle: arc.endAngle,
      y: y + DRAFT_AXIS_ANGLE_ARC_Y_OFFSET,
    },
  }
}

function toWallPlanPoint(point: Point2D): WallPlanPoint {
  return [point.x, point.y]
}

function getWallEndpointKind(point: WallPlanPoint, wall: WallNode): 'start' | 'end' | null {
  if (pointMatches(point, wall.start)) return 'start'
  if (pointMatches(point, wall.end)) return 'end'

  return null
}

function buildDraftWall(start: WallPlanPoint, end: WallPlanPoint): WallNode {
  return {
    object: 'node',
    id: 'wall_draft' as WallNode['id'],
    type: 'wall',
    name: 'Draft wall',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start,
    end,
    thickness: DRAFT_WALL_THICKNESS,
    frontSide: 'unknown',
    backSide: 'unknown',
  }
}

function getWallFaceAngleCandidates(
  point: WallPlanPoint,
  wall: WallNode,
  miterData: WallMiterData,
): FaceAngleCandidate[] {
  const endpoint = getWallEndpointKind(point, wall)
  const reference = getSegmentAngleReferenceAtPoint(point, wall)
  if (!(endpoint && reference)) return []

  const boundaryPoints = getWallMiterBoundaryPoints(wall, miterData)
  if (!boundaryPoints) return []

  const points =
    endpoint === 'start'
      ? [boundaryPoints.startLeft, boundaryPoints.startRight]
      : [boundaryPoints.endLeft, boundaryPoints.endRight]

  return points.map((facePoint, index) => ({
    index,
    point: toWallPlanPoint(facePoint),
    vector: reference.vector,
  }))
}

function getMatchingFaceAnglePairs(
  draftCandidates: FaceAngleCandidate[],
  connectedCandidates: FaceAngleCandidate[],
) {
  const candidates: FaceAnglePair[] = []

  for (const draftCandidate of draftCandidates) {
    for (const connectedCandidate of connectedCandidates) {
      candidates.push({
        draft: draftCandidate,
        connected: connectedCandidate,
        distance: distanceSquared(draftCandidate.point, connectedCandidate.point),
      })
    }
  }

  candidates.sort((a, b) => a.distance - b.distance)

  const exactPairs = candidates.filter((pair) => pair.distance <= 1e-6)
  const sourcePairs = exactPairs.length > 0 ? exactPairs : candidates.slice(0, 1)
  const usedDraftIndexes = new Set<number>()
  const usedConnectedIndexes = new Set<number>()
  const pairs: FaceAnglePair[] = []

  for (const pair of sourcePairs) {
    if (usedDraftIndexes.has(pair.draft.index) || usedConnectedIndexes.has(pair.connected.index)) {
      continue
    }

    usedDraftIndexes.add(pair.draft.index)
    usedConnectedIndexes.add(pair.connected.index)
    pairs.push(pair)

    if (pairs.length === 2) break
  }

  return pairs
}

function getAngleSource(
  endpointPoint: WallPlanPoint,
  endpointDraftVector: WallPlanPoint,
  connectedReference: SegmentAngleReference,
  facePairs: FaceAnglePair[],
): AngleSource {
  if (facePairs.length === 0) {
    return {
      arcCenter: endpointPoint,
      connectedVector: connectedReference.vector,
      draftVector: endpointDraftVector,
    }
  }

  const arc = getAngleArcToSegmentReference(endpointDraftVector, connectedReference)
  const angleDirection: WallPlanPoint = arc
    ? [Math.cos(arc.midAngle), Math.sin(arc.midAngle)]
    : [endpointDraftVector[0], endpointDraftVector[1]]
  const bestPair =
    facePairs
      .map((pair) => {
        const arcCenter: WallPlanPoint = [
          (pair.draft.point[0] + pair.connected.point[0]) / 2,
          (pair.draft.point[1] + pair.connected.point[1]) / 2,
        ]
        const fromEndpoint: WallPlanPoint = [
          arcCenter[0] - endpointPoint[0],
          arcCenter[1] - endpointPoint[1],
        ]

        return {
          arcCenter,
          pair,
          score: fromEndpoint[0] * angleDirection[0] + fromEndpoint[1] * angleDirection[1],
        }
      })
      .sort((a, b) => b.score - a.score)[0]?.pair ?? facePairs[0]!

  return {
    arcCenter: [
      (bestPair.draft.point[0] + bestPair.connected.point[0]) / 2,
      (bestPair.draft.point[1] + bestPair.connected.point[1]) / 2,
    ],
    connectedVector: bestPair.connected.vector,
    draftVector: bestPair.draft.vector,
  }
}

function getDraftAngleLabels(
  start: WallPlanPoint,
  end: WallPlanPoint,
  walls: WallNode[],
  baseY: number,
  previewHeight: number,
): DraftAngleLabel[] {
  const draftFromStart: WallPlanPoint = [end[0] - start[0], end[1] - start[1]]
  const draftFromEnd: WallPlanPoint = [start[0] - end[0], start[1] - end[1]]
  const draftWall = buildDraftWall(start, end)
  const miterData = calculateLevelMiters([...walls, draftWall])
  const endpoints = [
    { id: 'start', point: start, draftVector: draftFromStart },
    { id: 'end', point: end, draftVector: draftFromEnd },
  ]
  const labels: DraftAngleLabel[] = []

  for (const endpoint of endpoints) {
    const connectedWall = walls.find((wall) =>
      Boolean(getSegmentAngleReferenceAtPoint(endpoint.point, wall)),
    )
    if (!connectedWall) continue
    const connectedReference = getSegmentAngleReferenceAtPoint(endpoint.point, connectedWall)
    if (!connectedReference) continue

    const draftFaceCandidates = getWallFaceAngleCandidates(endpoint.point, draftWall, miterData)
    const connectedFaceCandidates = getWallFaceAngleCandidates(
      endpoint.point,
      connectedWall,
      miterData,
    )
    const facePairs = getMatchingFaceAnglePairs(draftFaceCandidates, connectedFaceCandidates)
    const { arcCenter, connectedVector, draftVector } = getAngleSource(
      endpoint.point,
      endpoint.draftVector,
      connectedReference,
      facePairs,
    )
    const angle = getAngleToSegmentReference(draftVector, {
      ...connectedReference,
      vector: connectedVector,
    })
    if (angle === null) continue
    const arc = getAngleArcToSegmentReference(draftVector, {
      ...connectedReference,
      vector: connectedVector,
    })
    if (!arc || arc.angle < 0.01) continue
    const draftLength = Math.hypot(draftVector[0], draftVector[1])
    const referenceLength = Math.hypot(connectedVector[0], connectedVector[1])
    const radius = clamp(
      Math.min(draftLength, referenceLength) * 0.28,
      DRAFT_ANGLE_ARC_MIN_RADIUS,
      DRAFT_ANGLE_ARC_MAX_RADIUS,
    )
    labels.push({
      id: endpoint.id,
      label: formatAngleRadians(angle),
      position: [
        arcCenter[0] + Math.cos(arc.midAngle) * (radius + 0.16),
        baseY + previewHeight + DRAFT_ANGLE_LABEL_Y_OFFSET,
        arcCenter[1] + Math.sin(arc.midAngle) * (radius + 0.16),
      ],
      arc: {
        center: arcCenter,
        radius,
        startAngle: arc.startAngle,
        endAngle: arc.endAngle,
        y: baseY + previewHeight + DRAFT_ANGLE_ARC_Y_OFFSET,
      },
    })
  }

  return labels
}

function getDraftMeasurementState(
  start: WallPlanPoint,
  end: WallPlanPoint,
  walls: WallNode[],
  unit: LinearUnit,
  baseY: number,
  previewHeight: number,
): DraftMeasurementState {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return null
  const normalX = -dz / length
  const normalZ = dx / length
  const guideY = baseY + previewHeight + DRAFT_ANGLE_ARC_Y_OFFSET
  return {
    start,
    end,
    guideY,
    lengthLabel: formatLinearMeasurement(length, unit),
    lengthPosition: [
      (start[0] + end[0]) / 2 + normalX * DRAFT_DIMENSION_OFFSET,
      baseY + previewHeight + DRAFT_LABEL_Y_OFFSET,
      (start[1] + end[1]) / 2 + normalZ * DRAFT_DIMENSION_OFFSET,
    ],
    angleLabels: getDraftAngleLabels(start, end, walls, baseY, previewHeight),
  }
}

function updateWallPreview(
  mesh: Mesh,
  start: Vector3,
  end: Vector3,
  previewHeight: number,
  previewThickness: number,
) {
  const direction = new Vector3(end.x - start.x, 0, end.z - start.z)
  const length = direction.length()
  if (length < 0.01) {
    mesh.visible = false
    return
  }
  mesh.visible = true
  direction.normalize()

  const geometry = new BoxGeometry(length, previewHeight, previewThickness)
  const angle = Math.atan2(direction.z, direction.x)

  mesh.position.set((start.x + end.x) / 2, start.y + previewHeight / 2, (start.z + end.z) / 2)
  mesh.rotation.y = -angle

  if (mesh.geometry) {
    mesh.geometry.dispose()
  }
  mesh.geometry = geometry
}

function getLevelWalls(levelId: string | null, nodes: Record<string, AnyNode>): WallNode[] {
  if (!levelId) return []
  const levelNode = nodes[levelId]
  if (levelNode?.type !== 'level') return []
  return (levelNode as LevelNode).children
    .map((childId) => nodes[childId])
    .filter((node): node is WallNode => node?.type === 'wall')
}

function getCurrentLevelWalls(): WallNode[] {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()
  return getLevelWalls(currentLevelId ?? null, nodes)
}

function getLevelSlabs(levelId: string, nodes: Record<string, AnyNode>): SlabNode[] {
  return Object.values(nodes).filter(
    (entry): entry is SlabNode => entry?.type === 'slab' && (entry.parentId ?? null) === levelId,
  )
}

function getLevelCeilings(levelId: string, nodes: Record<string, AnyNode>): CeilingNode[] {
  return Object.values(nodes).filter(
    (entry): entry is CeilingNode =>
      entry?.type === 'ceiling' && (entry.parentId ?? null) === levelId,
  )
}

function flushAutoSurfacesForCurrentLevel() {
  const levelId = useViewer.getState().selection.levelId
  if (!levelId) return

  const sceneState = useScene.getState()
  const levelWalls = getLevelWalls(levelId, sceneState.nodes)
  const { roomPolygons } = detectSpacesForLevel(levelId, levelWalls)
  const existingSlabs = getLevelSlabs(levelId, sceneState.nodes)
  const slabPlan = planAutoSlabsForLevel(roomPolygons, existingSlabs)
  const ceilingPlan = planAutoCeilingsForLevel(
    roomPolygons,
    getLevelCeilings(levelId, sceneState.nodes),
    {
      walls: levelWalls,
      slabs: projectAutoSlabsForPlan(existingSlabs, slabPlan),
    },
  )

  const update = [
    ...slabPlan.update.map((entry) => ({
      id: entry.id as AnyNodeId,
      data: entry.data,
    })),
    ...ceilingPlan.update.map((entry) => ({
      id: entry.id as AnyNodeId,
      data: entry.data,
    })),
  ]
  const create = [
    ...slabPlan.create.map((slab) => ({
      node: slab,
      parentId: levelId as AnyNodeId,
    })),
    ...ceilingPlan.create.map((ceiling) => ({
      node: ceiling,
      parentId: levelId as AnyNodeId,
    })),
  ]
  const deleteIds = [
    ...slabPlan.delete.map((id) => id as AnyNodeId),
    ...ceilingPlan.delete.map((id) => id as AnyNodeId),
  ]

  if (update.length === 0 && create.length === 0 && deleteIds.length === 0) return

  pauseSceneHistory(useScene)
  try {
    sceneState.applyNodeChanges({
      update,
      create,
      delete: deleteIds,
    })
  } finally {
    resumeSceneHistory(useScene)
  }
}

// Walls on the level directly beneath the active one. Levels share the same
// local XZ origin (they only differ in world Y), so these walls live in the
// identical coordinate frame and can be fed straight into the snap pipeline —
// letting the user draw a new wall aligned with the floor below. They are
// snap references only; `createWallOnCurrentLevel` re-derives its own
// current-level wall list, so the floor below is never split or mutated.
function getBelowLevelWalls(): WallNode[] {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()
  if (!currentLevelId) return []
  const currentLevel = nodes[currentLevelId]
  if (currentLevel?.type !== 'level') return []
  const buildingId = resolveBuildingForLevel(currentLevelId, nodes)
  if (!buildingId) return []
  const building = nodes[buildingId]
  if (building?.type !== 'building') return []
  const currentIndex = (currentLevel as LevelNode).level
  const belowLevel = (building.children ?? [])
    .map((childId) => nodes[childId])
    .filter((node): node is LevelNode => node?.type === 'level' && node.level < currentIndex)
    .sort((a, b) => b.level - a.level)[0]
  return getLevelWalls(belowLevel?.id ?? null, nodes)
}

export const WallTool: React.FC = () => {
  const unit = useViewer((state) => state.unit)
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  // A placed wall preset seeds `toolDefaults.wall` (height / thickness …)
  // before the tool mounts, so the draft preview is drawn at the preset's
  // dimensions rather than the generic fallbacks — matching the wall that
  // will be created. Read through refs so the live event handlers below see
  // the latest values without re-subscribing.
  const wallDefaults = useEditor((s) => s.toolDefaults.wall)
  const previewHeight = typeof wallDefaults?.height === 'number' ? wallDefaults.height : WALL_HEIGHT
  const previewThickness =
    typeof wallDefaults?.thickness === 'number' ? wallDefaults.thickness : DRAFT_WALL_THICKNESS
  const previewHeightRef = useRef(previewHeight)
  previewHeightRef.current = previewHeight
  const previewThicknessRef = useRef(previewThickness)
  previewThicknessRef.current = previewThickness
  const cursorRef = useRef<Group>(null)
  const wallPreviewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const chainFirstVertex = useRef<Vector3 | null>(null)
  const buildingState = useRef(0)
  const [draftMeasurement, setDraftMeasurement] = useState<DraftMeasurementState>(null)
  const [axisGuide, setAxisGuide] = useState<DraftAxisGuideState>(null)
  // CAD-style numeric entry: with the start point placed and a direction
  // aimed, typed digits accumulate here and Enter commits a segment of
  // exactly that length along the aim. Shown as an accent label at the
  // cursor while typing.
  const [typedLength, setTypedLength] = useState('')
  const measurementColor = isDark ? '#ffffff' : '#111111'
  const measurementShadowColor = isDark ? '#111111' : '#ffffff'
  const typedUnitSuffix = unit === 'imperial' ? 'ft' : unit === 'centimeter' ? 'cm' : 'mm'

  // Clear preset-seeded defaults on deactivation so a later manual wall draw
  // isn't built with a stale preset's parameters. Unmount-only.
  useEffect(
    () => () => {
      // Switching from the straight-wall renderer to RectangleRoomTool
      // unmounts this component while `tool` itself remains `wall`. Preserve
      // the newly selected mode instead of immediately deleting it here.
      if (useEditor.getState().toolDefaults.wall?.placementMode !== 'rectangle-room') {
        useEditor.getState().setToolDefaults('wall', null)
      }
    },
    [],
  )

  useEffect(() => {
    let gridPosition: WallPlanPoint = [0, 0]
    let previousWallEnd: [number, number] | null = null

    // Alignment candidates — anchors of every alignable object. Refreshed
    // after each segment commits (the new wall becomes a candidate too).
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')
    const refreshAlignmentCandidates = () => {
      alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')
    }

    // Align the drafted point onto another object's nearest real anchor and
    // publish the guide. Returns the possibly snapped point.
    const alignPoint = (point: WallPlanPoint, options?: { applySnap?: boolean }): WallPlanPoint => {
      // Figma alignment lines onto existing wall corners / edges are DISPLAYED
      // in every mode except Off (isAlignmentGuideActive); the magnetic pull
      // onto them is applied only in 'lines' mode (isMagneticSnapActive).
      if (!isAlignmentGuideActive() || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return point
      }
      const ar = resolveAlignment({
        moving: [{ nodeId: '__wall-draft__', kind: 'corner', x: point[0], z: point[1] }],
        candidates: alignmentCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      const magnetic = isMagneticSnapActive()
      // In non-magnetic modes nothing pulls the point onto a guide, so an
      // axis-alignment dot on a far corner reads as a false "connect here" cue.
      // Only surface guides whose anchor is within connect distance — the same
      // tight range the wall-body connect uses — so a corner is no more
      // magnetic-looking than any other point on the wall. 'lines' keeps the
      // wider guides since its magnetic snap closes the gap.
      const guides = magnetic
        ? ar.guides
        : ar.guides.filter(
            (guide) =>
              Math.hypot(point[0] - guide.anchor.x, point[1] - guide.anchor.z) <=
              WALL_CONNECT_SNAP_RADIUS,
          )
      useAlignmentGuides.getState().set(guides)
      return ar.snap && options?.applySnap !== false && magnetic
        ? [point[0] + ar.snap.dx, point[1] + ar.snap.dz]
        : point
    }

    let typedBuffer = ''
    const clearTypedLength = () => {
      typedBuffer = ''
      setTypedLength('')
    }

    const stopDrafting = () => {
      buildingState.current = 0
      chainFirstVertex.current = null
      if (wallPreviewRef.current) {
        wallPreviewRef.current.visible = false
      }
      setDraftMeasurement(null)
      setAxisGuide(null)
      clearTypedLength()
      useAlignmentGuides.getState().clear()
      useWallSnapIndicator.getState().clear()
      useSegmentDraftChain.getState().clear('wall')
    }

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && wallPreviewRef.current)) return

      const walls = getCurrentLevelWalls()
      // Add walls on the floor below as extra snap references so the new wall
      // can align with the level beneath it. Kept separate from `walls` so the
      // measurement HUD only reports against the active level.
      const snapWalls = [...walls, ...getBelowLevelWalls()]
      const localPoint: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]
      // Snapping is governed entirely by the snapping mode (grid / lines /
      // angles / off). `'off'` is the bypass — there is no Shift hold-to-bypass.
      const angleLocked = buildingState.current === 1 && isAngleSnapActive()
      const draftStart: WallPlanPoint = [startingPoint.current.x, startingPoint.current.z]
      const orthogonalInput =
        buildingState.current === 1
          ? inferOrthogonalWallPoint(draftStart, localPoint, event.nativeEvent.shiftKey)
          : localPoint
      const snapResult = snapWallDraftPointDetailed({
        point: orthogonalInput,
        walls: snapWalls,
        start: angleLocked ? draftStart : undefined,
        angleSnap: angleLocked,
        magnetic: isMagneticSnapActive(),
      })
      gridPosition = alignPoint(snapResult.point, { applySnap: !angleLocked })
      const orthogonalInferred =
        orthogonalInput[0] !== localPoint[0] || orthogonalInput[1] !== localPoint[1]
      // Magnetic attachment to real wall geometry wins. Otherwise preserve
      // the architectural horizontal/vertical inference after grid/alignment
      // processing so the preview and the committed endpoint are exactly 90°.
      if (buildingState.current === 1 && !snapResult.snap && orthogonalInferred) {
        gridPosition = inferOrthogonalWallPoint(draftStart, gridPosition, true)
        useAlignmentGuides.getState().clear()
      }
      // Stand the magnetic beacon at the endpoint when it locked onto an
      // existing wall corner / wall point; clear it for plain grid/angle moves.
      useWallSnapIndicator
        .getState()
        .set(
          snapResult.snap
            ? { x: gridPosition[0], z: gridPosition[1], kind: snapResult.snap }
            : null,
        )

      if (buildingState.current === 1) {
        const snappedLocal = gridPosition
        endingPoint.current.set(snappedLocal[0], event.localPosition[1], snappedLocal[1])
        cursorRef.current.position.copy(endingPoint.current)
        setAxisGuide({
          origin: [startingPoint.current.x, startingPoint.current.z],
          y: startingPoint.current.y,
          lockedAxis: getLockedOrthogonalAxis(
            [startingPoint.current.x, startingPoint.current.z],
            snappedLocal,
          ),
          angleLabel: getNearestAxisAngleLabel(
            [startingPoint.current.x, startingPoint.current.z],
            snappedLocal,
            startingPoint.current.y,
          ),
        })

        const currentWallEnd: [number, number] = [snappedLocal[0], snappedLocal[1]]
        if (
          previousWallEnd &&
          (currentWallEnd[0] !== previousWallEnd[0] || currentWallEnd[1] !== previousWallEnd[1])
        ) {
          triggerSFX('sfx:grid-snap')
        }
        previousWallEnd = currentWallEnd

        updateWallPreview(
          wallPreviewRef.current,
          startingPoint.current,
          endingPoint.current,
          previewHeightRef.current,
          previewThicknessRef.current,
        )
        setDraftMeasurement(
          getDraftMeasurementState(
            [startingPoint.current.x, startingPoint.current.z],
            snappedLocal,
            walls,
            unit,
            startingPoint.current.y,
            previewHeightRef.current,
          ),
        )
      } else {
        cursorRef.current.position.set(gridPosition[0], event.localPosition[1], gridPosition[1])
        setDraftMeasurement(null)
        setAxisGuide(null)
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (!wallPreviewRef.current) return

      if (buildingState.current === 1 && event.nativeEvent.detail >= 2) {
        stopDrafting()
        return
      }

      const walls = getCurrentLevelWalls()
      const snapWalls = [...walls, ...getBelowLevelWalls()]
      const localClick: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 0) {
        const snappedStart = alignPoint(
          snapWallDraftPointDetailed({
            point: localClick,
            walls: snapWalls,
            magnetic: isMagneticSnapActive(),
          }).point,
        )
        gridPosition = snappedStart
        startingPoint.current.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        chainFirstVertex.current = startingPoint.current.clone()
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        setAxisGuide({
          origin: snappedStart,
          y: event.localPosition[1],
          lockedAxis: null,
          angleLabel: null,
        })
        triggerSFX('sfx:structure-build-start')
        // Visibility is owned by `updateWallPreview` — it flips
        // `mesh.visible` based on segment length. Setting it here
        // (before any geometry data has been written) draws the
        // mesh's empty `<shapeGeometry/>` placeholder, which WebGPU
        // flags as "Vertex buffer slot 0 ... was not set" on the
        // first frame after click. Leaving it false until the next
        // `onGridMove` writes a real BoxGeometry skips that frame.
        setDraftMeasurement(null)
      } else if (buildingState.current === 1) {
        const angleLocked = isAngleSnapActive()
        const draftStart: WallPlanPoint = [startingPoint.current.x, startingPoint.current.z]
        const orthogonalInput = inferOrthogonalWallPoint(
          draftStart,
          localClick,
          event.nativeEvent.shiftKey,
        )
        const snapResult = snapWallDraftPointDetailed({
          point: orthogonalInput,
          walls: snapWalls,
          start: angleLocked ? draftStart : undefined,
          angleSnap: angleLocked,
          magnetic: isMagneticSnapActive(),
        })
        let snappedEnd = alignPoint(snapResult.point, { applySnap: !angleLocked })
        const orthogonalInferred =
          orthogonalInput[0] !== localClick[0] || orthogonalInput[1] !== localClick[1]
        if (!snapResult.snap && orthogonalInferred) {
          snappedEnd = inferOrthogonalWallPoint(draftStart, snappedEnd, true)
          useAlignmentGuides.getState().clear()
        }
        commitSegmentTo(snappedEnd, event.localPosition[1])
      }
    }

    // Commits a segment from the current start to `end`, then either stops
    // (single mode / room closed) or chains the next segment from the new
    // endpoint. Shared by the click commit and the typed-length commit.
    function commitSegmentTo(snappedEnd: WallPlanPoint, baseY: number) {
      const dx = snappedEnd[0] - startingPoint.current.x
      const dz = snappedEnd[1] - startingPoint.current.z
      if (dx * dx + dz * dz < 0.01 * 0.01) return
      // Both start and end are building-local ✓
      const createdWall = createWallOnCurrentLevel(
        [startingPoint.current.x, startingPoint.current.z],
        snappedEnd,
      )
      if (!createdWall) return
      flushAutoSurfacesForCurrentLevel()
      clearTypedLength()

      // The new segment is now a real node — make it an alignment target
      // for the next segment, and drop the just-shown guide.
      refreshAlignmentCandidates()
      useAlignmentGuides.getState().clear()
      useWallSnapIndicator.getState().clear()

      if (useEditor.getState().getContinuation('wall') === 'single') {
        stopDrafting()
        return
      }

      const closedToChainStart =
        chainFirstVertex.current &&
        isWithinWallJoinSnapRadius(createdWall.end, chainFirstVertex.current)

      // Auto-close also fires when the segment seals a room against the
      // existing wall network (e.g. a bay closed onto the middle of another
      // wall), not just when the chain loops back to its own start. Shares the
      // room graph with auto slab/ceiling detection so the two never disagree.
      if (closedToChainStart || wallClosesRoom(getCurrentLevelWalls(), createdWall)) {
        stopDrafting()
        return
      }

      const nextStart = createdWall.end
      // Publish the resolved chain start so the 2D floor-plan draft
      // chains its next segment from the same point (its own snap
      // pipeline can resolve a slightly different endpoint).
      useSegmentDraftChain.getState().setChainStart('wall', [nextStart[0], nextStart[1]])
      startingPoint.current.set(nextStart[0], baseY, nextStart[1])
      endingPoint.current.copy(startingPoint.current)
      cursorRef.current?.position.copy(startingPoint.current)
      buildingState.current = 1
      setAxisGuide({
        origin: nextStart,
        y: baseY,
        lockedAxis: null,
        angleLabel: null,
      })
      // Hide the preview until the next `onGridMove` writes the
      // new segment's geometry. Without this the prior segment's
      // BoxGeometry stays visible for a frame on top of the
      // freshly-committed real wall, producing a brief
      // double-paint at the new wall's position.
      if (wallPreviewRef.current) {
        wallPreviewRef.current.visible = false
      }
      setDraftMeasurement(null)
    }

    // ── CAD-style numeric length entry ─────────────────────────────────
    // With a start point placed, typed digits accumulate; Enter commits a
    // segment of that length along the currently aimed direction. Uses the
    // capture phase so global single-key shortcuts don't swallow digits.
    const parseTypedMeters = (): number | null => {
      const value = Number.parseFloat(typedBuffer)
      if (!Number.isFinite(value) || value <= 0) return null
      if (unit === 'imperial') return value * 0.3048
      if (unit === 'centimeter') return value / 100
      return value / 1000 // millimeter (default)
    }

    const commitTypedLength = () => {
      const meters = parseTypedMeters()
      if (!meters) return
      const dirX = endingPoint.current.x - startingPoint.current.x
      const dirZ = endingPoint.current.z - startingPoint.current.z
      const dirLength = Math.hypot(dirX, dirZ)
      // No aim yet (cursor still on the start point) — nothing to commit.
      if (dirLength < 1e-6) return
      const end: WallPlanPoint = [
        startingPoint.current.x + (dirX / dirLength) * meters,
        startingPoint.current.z + (dirZ / dirLength) * meters,
      ]
      commitSegmentTo(end, startingPoint.current.y)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (buildingState.current !== 1) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }

      if (/^[0-9]$/.test(event.key) || (event.key === '.' && !typedBuffer.includes('.'))) {
        typedBuffer += event.key
      } else if (event.key === 'Backspace' && typedBuffer) {
        typedBuffer = typedBuffer.slice(0, -1)
      } else if (event.key === 'Enter' && typedBuffer) {
        commitTypedLength()
        typedBuffer = ''
      } else if (event.key === 'Escape' && typedBuffer) {
        // First Escape clears the typed value; a second one cancels the
        // draft via the regular tool:cancel flow.
        typedBuffer = ''
      } else {
        return
      }
      setTypedLength(typedBuffer)
      event.preventDefault()
      event.stopPropagation()
    }

    const onCancel = () => {
      if (buildingState.current === 1) {
        markToolCancelConsumed()
        stopDrafting()
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown, { capture: true })

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      useAlignmentGuides.getState().clear()
      useWallSnapIndicator.getState().clear()
      useSegmentDraftChain.getState().clear('wall')
    }
  }, [unit])

  return (
    <group>
      <WallAxisGuides
        guide={axisGuide}
        labelColor={measurementColor}
        labelShadowColor={measurementShadowColor}
      />
      <CursorSphere height={previewHeight} ref={cursorRef} />
      <mesh layers={EDITOR_LAYER} ref={wallPreviewRef} renderOrder={1} visible={false}>
        <shapeGeometry />
        <meshBasicMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          opacity={0.5}
          side={DoubleSide}
          transparent
        />
      </mesh>
      {draftMeasurement && (
        <>
          <DraftLinearDimensionGuide color={measurementColor} measurement={draftMeasurement} />
          <DraftMeasurementLabel
            color={typedLength ? '#8b82ff' : measurementColor}
            label={
              typedLength ? `${typedLength}${typedUnitSuffix} ⏎` : draftMeasurement.lengthLabel
            }
            position={draftMeasurement.lengthPosition}
            shadowColor={measurementShadowColor}
          />
          {draftMeasurement.angleLabels.map((angleLabel) => (
            <group key={angleLabel.id}>
              <DraftAngleArc arc={angleLabel.arc} color={measurementColor} />
              <DraftMeasurementLabel
                color={measurementColor}
                label={angleLabel.label}
                position={angleLabel.position}
                shadowColor={measurementShadowColor}
              />
            </group>
          ))}
        </>
      )}
    </group>
  )
}

function DraftLinearDimensionGuide({
  color,
  measurement,
}: {
  color: string
  measurement: NonNullable<DraftMeasurementState>
}) {
  const geometry = useMemo(() => {
    const { start, end, guideY } = measurement
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const length = Math.hypot(dx, dz)
    if (length < 0.01) return new BufferGeometry()

    const nx = -dz / length
    const nz = dx / length
    const tx = (dx / length) * DRAFT_DIMENSION_TICK_SIZE
    const tz = (dz / length) * DRAFT_DIMENSION_TICK_SIZE
    const sx = start[0] + nx * DRAFT_DIMENSION_OFFSET
    const sz = start[1] + nz * DRAFT_DIMENSION_OFFSET
    const ex = end[0] + nx * DRAFT_DIMENSION_OFFSET
    const ez = end[1] + nz * DRAFT_DIMENSION_OFFSET
    const extension = DRAFT_DIMENSION_TICK_SIZE * 0.45

    return new BufferGeometry().setFromPoints([
      // Start/end witness lines.
      new Vector3(start[0], guideY, start[1]),
      new Vector3(sx + nx * extension, guideY, sz + nz * extension),
      new Vector3(end[0], guideY, end[1]),
      new Vector3(ex + nx * extension, guideY, ez + nz * extension),
      // Dimension line.
      new Vector3(sx, guideY, sz),
      new Vector3(ex, guideY, ez),
      // Perpendicular end ticks.
      new Vector3(sx - tx, guideY, sz - tz),
      new Vector3(sx + tx, guideY, sz + tz),
      new Vector3(ex - tx, guideY, ez - tz),
      new Vector3(ex + tx, guideY, ez + tz),
    ])
  }, [measurement])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments frustumCulled={false} geometry={geometry} layers={EDITOR_LAYER} renderOrder={3}>
      <lineBasicNodeMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        opacity={0.96}
        transparent
      />
    </lineSegments>
  )
}

function RectanglePreviewWall({
  end,
  height,
  start,
  thickness,
}: {
  end: WallPlanPoint
  height: number
  start: WallPlanPoint
  thickness: number
}) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return null
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={[(start[0] + end[0]) / 2, height / 2, (start[1] + end[1]) / 2]}
      renderOrder={1}
      rotation={[0, -Math.atan2(dz, dx), 0]}
    >
      <boxGeometry args={[length, height, thickness]} />
      <meshBasicMaterial
        color="#818cf8"
        depthTest={false}
        depthWrite={false}
        opacity={0.5}
        transparent
      />
    </mesh>
  )
}

const RectangleRoomTool: React.FC = () => {
  const unit = useViewer((state) => state.unit)
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  const defaults = useEditor((state) => state.toolDefaults.wall)
  const height = typeof defaults?.height === 'number' ? defaults.height : WALL_HEIGHT
  const thickness =
    typeof defaults?.thickness === 'number' ? defaults.thickness : DRAFT_WALL_THICKNESS
  const [start, setStart] = useState<WallPlanPoint | null>(null)
  const [end, setEnd] = useState<WallPlanPoint | null>(null)
  const cursorRef = useRef<Group>(null)
  const startRef = useRef<WallPlanPoint | null>(null)
  const endRef = useRef<WallPlanPoint | null>(null)
  const color = isDark ? '#ffffff' : '#111111'
  const shadowColor = isDark ? '#111111' : '#ffffff'

  useEffect(() => () => useEditor.getState().setToolDefaults('wall', null), [])

  useEffect(() => {
    const snap = (event: GridEvent): WallPlanPoint => {
      const point: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]
      return snapWallDraftPointDetailed({
        point,
        walls: [...getCurrentLevelWalls(), ...getBelowLevelWalls()],
        magnetic: isMagneticSnapActive(),
      }).point
    }
    const clear = () => {
      startRef.current = null
      endRef.current = null
      setStart(null)
      setEnd(null)
    }
    const onMove = (event: GridEvent) => {
      const point = snap(event)
      endRef.current = point
      setEnd(point)
      cursorRef.current?.position.set(point[0], event.localPosition[1], point[1])
    }
    const onClick = (event: GridEvent) => {
      const point = snap(event)
      if (!startRef.current) {
        startRef.current = point
        endRef.current = point
        setStart(point)
        setEnd(point)
        triggerSFX('sfx:structure-build-start')
        return
      }
      const first = startRef.current
      if (Math.abs(point[0] - first[0]) < 0.01 || Math.abs(point[1] - first[1]) < 0.01) return
      const corners = getRectangleRoomCenterlineCorners(first, point, thickness)
      pauseSceneHistory(useScene)
      try {
        for (let index = 0; index < corners.length; index += 1) {
          createWallOnCurrentLevel(corners[index]!, corners[(index + 1) % corners.length]!, {
            preserveExactEndpoints: true,
          })
        }
        flushAutoSurfacesForCurrentLevel()
      } finally {
        resumeSceneHistory(useScene)
      }
      // The space-detection sync skips store events while scene history is
      // paused, so the batched room commit above never receives its walls'
      // interior/exterior side tags — and cutaway mode needs them to hide
      // camera-facing walls. Apply the side classification explicitly here,
      // like the per-segment draw flow gets from the sync.
      const levelId = useViewer.getState().selection.levelId
      if (levelId) {
        const { wallUpdates } = detectSpacesForLevel(levelId, getCurrentLevelWalls())
        const sideUpdates = wallUpdates.filter(
          (update) => update.frontSide !== 'unknown' || update.backSide !== 'unknown',
        )
        if (sideUpdates.length > 0) {
          useScene.getState().updateNodes(
            sideUpdates.map((update) => ({
              id: update.wallId as AnyNodeId,
              data: { frontSide: update.frontSide, backSide: update.backSide },
            })),
          )
        }
      }
      clear()
    }
    const onCancel = () => {
      if (!startRef.current) return
      markToolCancelConsumed()
      clear()
    }
    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('tool:cancel', onCancel)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [])

  const segments =
    start && end
      ? getRectangleRoomCenterlineCorners(start, end, thickness).map(
          (corner, index, corners) =>
            [corner, corners[(index + 1) % corners.length]!] as [WallPlanPoint, WallPlanPoint],
        )
      : []

  return (
    <group>
      <CursorSphere height={height} ref={cursorRef} />
      {segments.map(([segmentStart, segmentEnd], index) => (
        <RectanglePreviewWall
          end={segmentEnd}
          height={height}
          key={index}
          start={segmentStart}
          thickness={thickness}
        />
      ))}
      {start && end && Math.abs(end[0] - start[0]) >= 0.01 && (
        <DraftMeasurementLabel
          color={color}
          label={formatLinearMeasurement(Math.abs(end[0] - start[0]), unit)}
          position={[(start[0] + end[0]) / 2, height + DRAFT_LABEL_Y_OFFSET, start[1]]}
          shadowColor={shadowColor}
        />
      )}
      {start && end && Math.abs(end[1] - start[1]) >= 0.01 && (
        <DraftMeasurementLabel
          color={color}
          label={formatLinearMeasurement(Math.abs(end[1] - start[1]), unit)}
          position={[end[0], height + DRAFT_LABEL_Y_OFFSET, (start[1] + end[1]) / 2]}
          shadowColor={shadowColor}
        />
      )}
    </group>
  )
}

const WallToolRouter: React.FC = () => {
  const placementMode = useEditor((state) => state.toolDefaults.wall?.placementMode)
  return placementMode === 'rectangle-room' ? <RectangleRoomTool /> : <WallTool />
}

function WallAxisGuides({
  guide,
  labelColor,
  labelShadowColor,
}: {
  guide: DraftAxisGuideState
  labelColor: string
  labelShadowColor: string
}) {
  if (!guide) return null

  const [x, z] = guide.origin

  return (
    <>
      {guide.lockedAxis && (
        <group position={[x, guide.y + DRAFT_AXIS_GUIDE_Y_OFFSET, z]}>
          <WallAxisGuideLine axis={guide.lockedAxis} />
        </group>
      )}
      {guide.angleLabel && (
        <>
          <DraftAngleArc arc={guide.angleLabel.arc} color="#818cf8" />
          <DraftMeasurementLabel
            color={labelColor}
            label={guide.angleLabel.label}
            position={guide.angleLabel.position}
            shadowColor={labelShadowColor}
          />
        </>
      )}
    </>
  )
}

function WallAxisGuideLine({ axis }: { axis: 'x' | 'z' }) {
  return (
    <mesh
      frustumCulled={false}
      layers={EDITOR_LAYER}
      renderOrder={0}
      rotation={[0, axis === 'z' ? Math.PI / 2 : 0, 0]}
    >
      <boxGeometry
        args={[DRAFT_AXIS_GUIDE_LENGTH, DRAFT_AXIS_GUIDE_HEIGHT, DRAFT_AXIS_GUIDE_WIDTH]}
      />
      <meshBasicMaterial
        color="#818cf8"
        depthTest={false}
        depthWrite={false}
        opacity={0.9}
        transparent
      />
    </mesh>
  )
}

function DraftAngleArc({ arc, color }: { arc: DraftAngleLabel['arc']; color: string }) {
  const geometry = useMemo(() => {
    const segmentCount = Math.max(
      8,
      Math.ceil((Math.abs(arc.endAngle - arc.startAngle) / Math.PI) * DRAFT_ANGLE_ARC_SEGMENTS),
    )

    const points = Array.from({ length: segmentCount + 1 }, (_, index) => {
      const t = index / segmentCount
      const angle = arc.startAngle + (arc.endAngle - arc.startAngle) * t

      return new Vector3(
        arc.center[0] + Math.cos(angle) * arc.radius,
        arc.y,
        arc.center[1] + Math.sin(angle) * arc.radius,
      )
    })

    return new BufferGeometry().setFromPoints(points)
  }, [arc])

  return (
    // @ts-expect-error - R3F accepts Three line primitives, matching the other editor drawing tools.
    <line frustumCulled={false} geometry={geometry} layers={EDITOR_LAYER} renderOrder={2}>
      <lineBasicNodeMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        linewidth={2}
        opacity={0.95}
        transparent
      />
    </line>
  )
}

function DraftMeasurementLabel({
  color,
  label,
  position,
  shadowColor,
}: {
  color: string
  label: string
  position: [number, number, number]
  shadowColor: string
}) {
  return (
    <Html
      center
      position={position}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      zIndexRange={[100, 0]}
    >
      <div
        className="whitespace-nowrap font-bold font-mono text-[15px]"
        style={{
          color,
          textShadow: `-1.5px -1.5px 0 ${shadowColor}, 1.5px -1.5px 0 ${shadowColor}, -1.5px 1.5px 0 ${shadowColor}, 1.5px 1.5px 0 ${shadowColor}, 0 0 4px ${shadowColor}, 0 0 4px ${shadowColor}`,
        }}
      >
        {label}
      </div>
    </Html>
  )
}

export default WallToolRouter
