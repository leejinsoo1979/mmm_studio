import type { AssetInput, ItemNode } from '@pascal-app/core'
import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  type CeilingEvent,
  collectAlignmentAnchors,
  DEFAULT_WALL_HEIGHT,
  emitter,
  type GridEvent,
  getScaledDimensions,
  type ItemEvent,
  movingFootprintAnchors,
  type RoofEvent,
  resolveLevelId,
  type ShelfEvent,
  sceneRegistry,
  useLiveTransforms,
  useScene,
  useSpatialQuery,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import { ErrorBoundary, GRID_LAYER, useAssetUrl, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { Clone } from '@react-three/drei/core/Clone'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  type Group,
  type LineSegments,
  type Material,
  Matrix4,
  type Mesh,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  Ray,
  Vector3,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import {
  clearPlacementSurface,
  publishPlacementSurface,
} from '../../../lib/active-placement-surface'
import { EDITOR_LAYER } from '../../../lib/constants'
import { isFloorplanInputEvent } from '../../../lib/floorplan-input'
import { formatLinearMeasurement } from '../../../lib/measurements'
import { isFreshPlacementMetadata } from '../../../lib/placement-metadata'
import { subscribeQuickRightClick } from '../../../lib/quick-right-click'
import { sfxEmitter } from '../../../lib/sfx-bus'

import {
  projectAlignmentGuidesWorldToActiveBuildingLocal,
  resolveAlignmentForActiveBuilding,
} from '../../../lib/world-grid-snap'
import useAlignmentGuides from '../../../store/use-alignment-guides'
import useEditor, {
  getActiveContinuationContext,
  isAlignmentGuideActive,
  isMagneticSnapActive,
} from '../../../store/use-editor'

import useFacingPose from '../../../store/use-facing-pose'
import { getMovingNode } from '../../../store/use-interaction-scope'
import { usePlacementFeedback } from '../../../store/use-placement-feedback'
import { getFloorStackPreviewPosition } from '../shared/floor-stack-preview'
import {
  createLineGeometry,
  getBoxEdgePoints,
  type PreviewBounds,
  updateLineGeometry,
} from '../shared/placement-box-geometry'
import { PlacementCursorMarker } from '../shared/placement-cursor-marker'
import {
  createFootprintTileMaterial,
  createGhostEdgeMaterial,
  createGridPatchMaterial,
  createHologramMaterial,
  FOOTPRINT_RING,
  GHOST_CYAN,
} from '../shared/placement-ghost-materials'
import {
  getDetachedAttachmentPreviewLift,
  getGridAlignedDimensions,
  snapToGrid,
  snapToHalf,
  snapUpToGridStep,
  turnRotation,
} from './placement-math'
import { PlacementRoomGrid } from './placement-room-grid'
import {
  ceilingStrategy,
  checkCanPlace,
  floorStrategy,
  itemSurfaceStrategy,
  roofWallStrategy,
  shelfSurfaceStrategy,
  wallStrategy,
} from './placement-strategies'
import type { PlacementState, TransitionResult } from './placement-types'
import type { DraftNodeHandle } from './use-draft-node'

const DEFAULT_DIMENSIONS: [number, number, number] = [1, 1, 1]

/** Figma-style alignment-snap threshold (meters), matching the 2D
 *  floor-plan overlay and the 3D registry move tool. */
const ALIGNMENT_THRESHOLD_M = 0.08
/** Slack around the ghost's screen box within which a first pointer sample
 *  still counts as grabbing the item (see `applyFloorGrabOffset`). */
const GRAB_BOX_MARGIN_PX = 24

/** Right-click cancels an active placement — but the right button also orbits
 *  the camera (CameraControls ROTATE). Only a quick, near-stationary right
 *  press/release counts as a cancel; anything that moves past the pixel
 *  threshold or is held longer is treated as a camera orbit and left alone. */

/**
 * Expand `bounds` outward so each axis is rounded up to the active grid step.
 * The wireframe stays centered on the original bounds centre on each axis we
 * expand, so an off-centre mesh bbox stays off-centre. Wall-side items keep
 * `min.z = 0` (the mounted face flush with the wall plane) and extend into the
 * room along +Z — matching the body and the 2D footprint; the bottom (`min.y`)
 * is preserved so the box still sits on the floor / attachment plane.
 *
 * Floor / ceiling / item-surface: X and Z expand; Y stays exact.
 * Wall / wall-side: X and Y expand; Z stays exact.
 */
function expandBoundsToGrid(
  bounds: PreviewBounds,
  attachTo: AssetInput['attachTo'] | null | undefined,
  step: number,
): PreviewBounds {
  const [w, h, d] = bounds.dimensions
  const [cx, , cz] = bounds.center
  const onWall = attachTo === 'wall' || attachTo === 'wall-side'
  const expandedW = snapUpToGridStep(w, step)
  const expandedH = onWall ? snapUpToGridStep(h, step) : h
  const expandedD = onWall ? d : snapUpToGridStep(d, step)

  const minX = cx - expandedW / 2
  const maxX = cx + expandedW / 2
  const minY = bounds.min[1]
  const maxY = minY + expandedH

  let minZ: number
  let maxZ: number
  let newCz: number
  if (attachTo === 'wall-side') {
    minZ = 0
    maxZ = expandedD
    newCz = expandedD / 2
  } else {
    minZ = cz - expandedD / 2
    maxZ = cz + expandedD / 2
    newCz = cz
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    dimensions: [expandedW, expandedH, expandedD],
    center: [cx, (minY + maxY) / 2, newCz],
  }
}

function getFallbackPreviewBounds(
  item: import('@pascal-app/core').ItemNode | null,
  asset: AssetInput | null | undefined,
  attachTo: AssetInput['attachTo'] | null | undefined,
): PreviewBounds {
  const dims = item ? getScaledDimensions(item) : (asset?.dimensions ?? DEFAULT_DIMENSIONS)
  return {
    min: [-dims[0] / 2, 0, attachTo === 'wall-side' ? 0 : -dims[2] / 2],
    max: [dims[0] / 2, dims[1], attachTo === 'wall-side' ? dims[2] : dims[2] / 2],
    dimensions: dims,
    center: [0, dims[1] / 2, attachTo === 'wall-side' ? dims[2] / 2 : 0],
  }
}

function getGridAlignedPreviewNode(item: ItemNode): ItemNode {
  const scaled = getScaledDimensions(item)
  const aligned = getGridAlignedDimensions(scaled, item.asset.attachTo)
  if (scaled[0] === aligned[0] && scaled[1] === aligned[1] && scaled[2] === aligned[2]) {
    return item
  }

  const scaleAxis = (axis: 0 | 1 | 2) =>
    scaled[axis] === 0 ? item.scale[axis] : item.scale[axis] * (aligned[axis] / scaled[axis])

  return {
    ...item,
    scale: [scaleAxis(0), scaleAxis(1), scaleAxis(2)] as [number, number, number],
  }
}

/** How far the white wall lattice extends past a wall-mounted ghost. */
const WALL_GRID_MARGIN = 1.2

const isWallAttach = (attachTo: AssetInput['attachTo'] | null | undefined): boolean =>
  attachTo === 'wall' || attachTo === 'wall-side'

/** The hologram volume: the preview box, positioned at the bounds centre. */
function createHologramGeometry(bounds: PreviewBounds): BufferGeometry {
  const [w, h, d] = bounds.dimensions
  const geometry = new BoxGeometry(Math.max(w, 0.01), Math.max(h, 0.01), Math.max(d, 0.01))
  geometry.translate(...bounds.center)
  return geometry
}

/**
 * The blocked-state tile plane: the footprint plus a {@link FOOTPRINT_RING}
 * ring. Flat on the floor under floor / ceiling / surface items, upright on
 * the wall face (local z = 0) for wall-mounted ones.
 */
function createFootprintGeometry(
  bounds: PreviewBounds,
  attachTo: AssetInput['attachTo'] | null | undefined,
): { geometry: BufferGeometry; planeSize: [number, number]; footprint: [number, number] } {
  const [w, h, d] = bounds.dimensions
  const [cx, cy, cz] = bounds.center
  if (isWallAttach(attachTo)) {
    const planeSize: [number, number] = [w + FOOTPRINT_RING * 2, h + FOOTPRINT_RING * 2]
    const geometry = new PlaneGeometry(...planeSize)
    geometry.translate(cx, cy, 0)
    return { geometry, planeSize, footprint: [w, h] }
  }
  const planeSize: [number, number] = [w + FOOTPRINT_RING * 2, d + FOOTPRINT_RING * 2]
  const geometry = new PlaneGeometry(...planeSize)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(cx, bounds.min[1] + 0.012, cz)
  return { geometry, planeSize, footprint: [w, d] }
}

/** Closed rectangle outline (line segments) in the XZ plane at height `y`. */
function createRectOutlineGeometry(w: number, d: number, cx: number, cz: number, y: number) {
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const z0 = cz - d / 2
  const z1 = cz + d / 2
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0],
      3,
    ),
  )
  return geometry
}

const measurementMaterial = new LineBasicNodeMaterial({
  color: 0x0f_17_2a,
  linewidth: 2,
  depthTest: false,
  depthWrite: false,
})

const NO_RAYCAST = () => null

const multiplyScales = (
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] => [a[0] * b[0], a[1] * b[1], a[2] * b[2]]

type MutableGhostMaterial = Material & {
  color?: { set: (value: string) => void }
  depthWrite?: boolean
  metalness?: number
  opacity?: number
  roughness?: number
  transparent?: boolean
}

const isBlackSteelMaterialName = (name: string): boolean =>
  /(?:^|[_\s.-])(metal|steel|frame)(?:[_\s.-]|$)/i.test(name)

function makeGhostMaterial(material: Material): Material {
  const next = material.clone() as MutableGhostMaterial
  if (isBlackSteelMaterialName(material.name)) {
    next.color?.set('#050505')
    next.metalness = Math.max(next.metalness ?? 0, 0.85)
    next.roughness = Math.min(next.roughness ?? 0.38, 0.42)
  }
  next.transparent = true
  next.opacity = Math.max(next.opacity ?? 1, 0.9)
  next.depthWrite = false
  next.needsUpdate = true
  return next
}

function disablePreviewRaycast(object: Object3D) {
  object.raycast = () => {}
  object.layers.set(EDITOR_LAYER)
}

function PlacementModelGhost({
  asset,
  nodeScale,
}: {
  asset: AssetInput
  nodeScale: [number, number, number]
}) {
  const modelUrl = useAssetUrl(asset.src)
  if (!modelUrl) return null

  // A model that fails to load must not take the scene down with it — the
  // hologram volume already marks the ghost.
  return (
    <ErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <ResolvedPlacementModelGhost asset={asset} nodeScale={nodeScale} url={modelUrl} />
      </Suspense>
    </ErrorBoundary>
  )
}

function ResolvedPlacementModelGhost({
  asset,
  nodeScale,
  url,
}: {
  asset: AssetInput
  nodeScale: [number, number, number]
  url: string
}) {
  const { scene } = useGLTF(url)
  const scale = multiplyScales(asset.scale ?? [1, 1, 1], nodeScale)

  const ghost = useMemo(() => {
    const cloned = scene.clone(true)
    cloned.traverse((child) => {
      disablePreviewRaycast(child)
      const mesh = child as Mesh
      if (!mesh.isMesh) return

      mesh.castShadow = false
      mesh.receiveShadow = false
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(makeGhostMaterial)
      } else if (mesh.material) {
        mesh.material = makeGhostMaterial(mesh.material)
      }
    })
    return cloned
  }, [scene])

  useEffect(
    () => () => {
      ghost.traverse((child) => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) material?.dispose()
      })
    },
    [ghost],
  )

  return (
    <Clone
      dispose={null}
      object={ghost}
      position={asset.offset ?? [0, 0, 0]}
      renderOrder={997}
      rotation={asset.rotation ?? [0, 0, 0]}
      scale={scale}
    />
  )
}

export interface PlacementCoordinatorConfig {
  asset: AssetInput | null
  draftNode: DraftNodeHandle
  initDraft: (gridPosition: Vector3) => void
  onCommitted: () => boolean
  onCancel?: () => void
  initialState?: PlacementState
  /** Scale to use when lazily creating a draft (e.g. for wall/ceiling duplicates). Defaults to [1,1,1]. */
  defaultScale?: [number, number, number]
  /** Painted slot overrides to seed onto a lazily-created draft (wall/ceiling
   *  duplicates) so the duplicate keeps its materials. */
  slots?: ItemNode['slots']
  /** Move-mode sessions keep the grabbed item offset from the first surface hit
   *  (floor / wall / ceiling / item-surface / shelf) instead of snapping the
   *  item's origin under the cursor. */
  preserveDragOffset?: boolean
}

export function usePlacementCoordinator(config: PlacementCoordinatorConfig): React.ReactNode {
  const cursorGroupRef = useRef<Group>(null!)
  // The ghost's projected screen box, refreshed each frame (see the key-list
  // anchor) — a move whose first pointer sample is off it wasn't a grab.
  const ghostScreenBoxRef = useRef<{
    left: number
    right: number
    top: number
    bottom: number
  } | null>(null)
  const edgesRef = useRef<LineSegments>(null!)
  const measurementWidthRef = useRef<LineSegments>(null!)
  const measurementDepthRef = useRef<LineSegments>(null!)
  const measurementHeightRef = useRef<LineSegments>(null!)
  const basePlaneRef = useRef<Mesh>(null!)
  const hologramRef = useRef<Mesh>(null)
  const edgesGlowRef = useRef<LineSegments>(null)
  const modelGhostRef = useRef<Group>(null)
  const markerRef = useRef<Group>(null)
  const wallGridRef = useRef<Mesh>(null)
  const ceilingColumnRef = useRef<Mesh>(null)
  const ceilingFloorRef = useRef<Mesh>(null)
  const ceilingOutlineRef = useRef<LineSegments>(null)
  const gridPosition = useRef(new Vector3(0, 0, 0))
  const lastRawPos = useRef(new Vector3(0, 0, 0))
  const lastWallDirtyAtRef = useRef(new Map<string, number>())
  const placementState = useRef<PlacementState>(
    config.initialState ?? {
      surface: 'floor',
      wallId: null,
      roofSegmentId: null,
      ceilingId: null,
      surfaceItemId: null,
      shelfId: null,
    },
  )
  const altFreeRef = useRef(false)
  const previewBoundsSignatureRef = useRef<string | null>(null)
  // Footprint shape (depth along local +Z and [x, z] centre) of the current
  // preview box, mirrored from the rendered dimension bounds so the per-frame
  // surface publisher can position the forward-facing triangle without reading
  // React state. Updated in the render body below.
  const facingShapeRef = useRef<{ depth: number; width: number; center: [number, number] }>({
    depth: 0,
    width: 0,
    center: [0, 0],
  })
  // The rendered preview bounds (cursor-group local), mirrored for the
  // per-frame ghost visuals and the screen anchor of the key list.
  const ghostBoundsRef = useRef<PreviewBounds | null>(null)
  // Goes true the first time a 3D pointer event drives this coordinator.
  // The per-frame mesh-position lerp below is only useful for that path;
  // when the move is being driven externally (2D `FloorplanRegistryMoveOverlay`
  // writing scene.position directly), the lerp fights React's render and
  // pulls the rendered item back toward its pre-move position. Gating
  // the lerp on this flag keeps 3D placement smooth without hijacking
  // 2D drags that share the same draft.
  const has3DPointerDrivenMoveRef = useRef(false)
  // The draft mesh's raycast is disabled while placing so the cursor ray
  // passes through it to the surface beneath (grid / item / shelf). Without
  // this, the ray hits the moving draft first and the surface strategy keeps
  // re-deriving the host point from the draft's own (just-moved) geometry —
  // on a multi-row shelf this oscillates the chosen row, jittering the item.
  // Mirrors MoveRegistryNodeTool. Reconciled per-frame (the draft mesh can be
  // recreated mid-session) and restored on unmount.
  const raycastDisabledMeshRef = useRef<Object3D | null>(null)
  const restoreRaycastsRef = useRef<Array<() => void>>([])
  const raycastDisabledChildrenRef = useRef(new WeakSet<Object3D>())
  const [dimensionBounds, setDimensionBounds] = useState<PreviewBounds | null>(null)

  // Live camera ref — the shelf-stickiness test reconstructs the cursor world
  // ray (camera → grid hit) to check it still points at the shelf volume.
  const camera = useThree((s) => s.camera)
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  // Store config callbacks in refs to avoid re-running effect when they change
  const configRef = useRef(config)
  configRef.current = config

  const { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling } = useSpatialQuery()
  const { asset, draftNode } = config
  const unit = useViewer((state) => state.unit)
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  // Per-session ghost materials (the hologram's grid + the footprint tiles
  // carry per-instance uniforms), disposed with the coordinator.
  const ghostMaterials = useMemo(() => {
    const ceilingFloor = new MeshBasicNodeMaterial({
      color: GHOST_CYAN,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })
    return {
      hologram: createHologramMaterial(),
      edge: createGhostEdgeMaterial(0.85),
      edgeGlow: createGhostEdgeMaterial(0.3),
      footprint: createFootprintTileMaterial(),
      wallGrid: createGridPatchMaterial(),
      ceilingOutline: createGhostEdgeMaterial(0.9),
      ceilingFloor,
    }
  }, [])
  useEffect(
    () => () => {
      for (const material of Object.values(ghostMaterials)) material.dispose()
    },
    [ghostMaterials],
  )

  const updatePreviewGeometry = useCallback(
    (bounds: PreviewBounds) => {
      const [width, height, depth] = bounds.dimensions
      const [centerX, centerY, centerZ] = bounds.center
      const signature = `${width.toFixed(4)}:${height.toFixed(4)}:${depth.toFixed(4)}:${centerX.toFixed(4)}:${centerY.toFixed(4)}:${centerZ.toFixed(4)}`

      if (previewBoundsSignatureRef.current === signature) return
      previewBoundsSignatureRef.current = signature

      updateLineGeometry(edgesRef, getBoxEdgePoints(bounds))

      const swap = (ref: React.RefObject<Mesh | null>, next: BufferGeometry) => {
        const mesh = ref.current
        if (!mesh) {
          next.dispose()
          return
        }
        const old = mesh.geometry
        mesh.geometry = next
        old.dispose()
      }
      swap(hologramRef, createHologramGeometry(bounds))
      const footprint = createFootprintGeometry(bounds, configRef.current.asset?.attachTo)
      ghostMaterials.footprint.setFootprint(footprint.planeSize, footprint.footprint)
      swap(basePlaneRef, footprint.geometry)
    },
    [ghostMaterials],
  )

  const updateDimensionGuides = useCallback((bounds: PreviewBounds) => {
    setDimensionBounds((current) => {
      if (
        current &&
        current.dimensions[0] === bounds.dimensions[0] &&
        current.dimensions[1] === bounds.dimensions[1] &&
        current.dimensions[2] === bounds.dimensions[2] &&
        current.center[0] === bounds.center[0] &&
        current.center[1] === bounds.center[1] &&
        current.center[2] === bounds.center[2]
      ) {
        return current
      }
      return bounds
    })

    const [width, , depth] = bounds.dimensions
    const [centerX, , centerZ] = bounds.center
    const minX = centerX - width / 2
    const maxX = centerX + width / 2
    const minZ = centerZ - depth / 2
    const maxZ = centerZ + depth / 2
    const guideOffset = 0.18
    const tick = 0.08
    const y = 0.02

    const widthPoints = [
      minX,
      y,
      maxZ + guideOffset,
      maxX,
      y,
      maxZ + guideOffset,

      minX,
      y,
      maxZ + guideOffset - tick,
      minX,
      y,
      maxZ + guideOffset + tick,

      maxX,
      y,
      maxZ + guideOffset - tick,
      maxX,
      y,
      maxZ + guideOffset + tick,
    ]

    const depthPoints = [
      maxX + guideOffset,
      y,
      minZ,
      maxX + guideOffset,
      y,
      maxZ,

      maxX + guideOffset - tick,
      y,
      minZ,
      maxX + guideOffset + tick,
      y,
      minZ,

      maxX + guideOffset - tick,
      y,
      maxZ,
      maxX + guideOffset + tick,
      y,
      maxZ,
    ]

    const heightPoints = [
      minX - guideOffset,
      0,
      minZ,
      minX - guideOffset,
      bounds.dimensions[1],
      minZ,

      minX - guideOffset - tick,
      0,
      minZ,
      minX - guideOffset + tick,
      0,
      minZ,

      minX - guideOffset - tick,
      bounds.dimensions[1],
      minZ,
      minX - guideOffset + tick,
      bounds.dimensions[1],
      minZ,
    ]

    const applyPoints = (ref: React.RefObject<LineSegments>, points: number[]) => {
      updateLineGeometry(ref, points)
    }

    applyPoints(measurementWidthRef, widthPoints)
    applyPoints(measurementDepthRef, depthPoints)
    applyPoints(measurementHeightRef, heightPoints)
  }, [])

  const getFloorVisualPosition = useCallback(
    (
      position: [number, number, number],
      nodeUpdate?: Partial<ItemNode>,
    ): [number, number, number] => {
      const draft = draftNode.current
      if (!(draft && !asset?.attachTo)) return position
      const previewNode = getGridAlignedPreviewNode({ ...draft, ...nodeUpdate } as ItemNode)
      return getFloorStackPreviewPosition({
        node: previewNode,
        position,
        rotation: previewNode.rotation,
      })
    },
    [asset?.attachTo, draftNode],
  )

  useEffect(() => {
    if (!asset) return
    useScene.temporal.getState().pause()

    const validators = { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling }

    // Lazily-gathered alignment candidates — the corner anchors of every
    // OTHER floor-placed node, excluding the draft. Computed on the first
    // floor move (once the draft id exists) and reused for the rest of the
    // drag; the scene graph is stable during placement. Coords are
    // building-local, matching the draft's grid position and the guide
    // layer's frame.
    let alignmentCandidates: AlignmentAnchor[] | null = null
    let floorDragAnchor: [number, number] | null = null

    // Reset placement state
    placementState.current = configRef.current.initialState ?? {
      surface: 'floor',
      wallId: null,
      roofSegmentId: null,
      ceilingId: null,
      surfaceItemId: null,
      shelfId: null,
    }
    if (!asset.attachTo && placementState.current.surface === 'floor') {
      gridPosition.current.y = 0
      if (cursorGroupRef.current) {
        cursorGroupRef.current.position.y = 0
      }
    }

    // ---- Helpers ----

    const getContext = () => ({
      asset,
      levelId: useViewer.getState().selection.levelId,
      draftItem: draftNode.current,
      gridPosition: gridPosition.current,
      state: { ...placementState.current },
      currentCursorRotationY:
        cursorGroupRef.current?.rotation.y ?? draftNode.current?.rotation[1] ?? 0,
    })

    const getActiveValidators = () =>
      altFreeRef.current
        ? {
            canPlaceOnFloor: () => ({ valid: true }),
            canPlaceOnWall: () => ({ valid: true }),
            canPlaceOnCeiling: () => ({ valid: true }),
          }
        : validators

    const finishCommittedPlacement = (
      committedId: string | null,
      wasAdopted: boolean,
      repeat: () => void,
    ) => {
      if (configRef.current.onCommitted()) {
        repeat()
        return
      }

      useAlignmentGuides.getState().clear()
      useScene.temporal.getState().resume()
      if (committedId) {
        useViewer.getState().setSelection({ selectedIds: [committedId as AnyNodeId] })
      }
      if (!wasAdopted) {
        useEditor.getState().setTool(null)
      }
      // A non-repeating placement is finished: return to select mode so the user
      // lands on the just-placed (now selected) node instead of a tool-less build
      // limbo. Repeat placements took the early return above and stay armed.
      useEditor.getState().setMode('select')
    }

    const revalidate = (): boolean => {
      const placeable = altFreeRef.current || checkCanPlace(getContext(), validators)
      // inZOI: the cyan hologram where it fits, red footprint tiles where it
      // overlaps — the per-frame ghost visuals read this flag.
      usePlacementFeedback.getState().setBlocked(!placeable)
      return placeable
    }

    // Tool visuals are rendered inside the building-local ToolManager group, so all cursor
    // positions must be in building-local space. Wall/ceiling/item-surface strategies return
    // world-space cursor positions (from their event.position); convert them here.
    const worldToBuildingLocal = (x: number, y: number, z: number): Vector3 => {
      const buildingId = useViewer.getState().selection.buildingId
      const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      return buildingMesh ? buildingMesh.worldToLocal(new Vector3(x, y, z)) : new Vector3(x, y, z)
    }

    const buildingLocalToWorld = (x: number, y: number, z: number): Vector3 => {
      const buildingId = useViewer.getState().selection.buildingId
      const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      return buildingMesh ? buildingMesh.localToWorld(new Vector3(x, y, z)) : new Vector3(x, y, z)
    }

    const applyTransition = (result: TransitionResult) => {
      // Alignment guides are floor-only; clear them when the cursor moves
      // onto a wall / ceiling / item surface (only those paths call this).
      useAlignmentGuides.getState().clear()
      // Roof faces carry no grab anchor, but landing on one still counts as
      // anchoring elsewhere — a later return to the grabbed wall must center
      // under the cursor, not restore the stale grab offset.
      if (result.stateUpdate.surface === 'roof-wall') grabForgotten = true
      Object.assign(placementState.current, result.stateUpdate)
      gridPosition.current.set(...result.gridPosition)

      const c = worldToBuildingLocal(...result.cursorPosition)
      if (cursorGroupRef.current) {
        cursorGroupRef.current.position.set(c.x, c.y, c.z)
        if (result.cursorRotation) {
          cursorGroupRef.current.rotation.set(...result.cursorRotation)
        } else {
          cursorGroupRef.current.rotation.set(0, result.cursorRotationY, 0)
        }
      }

      const draft = draftNode.current
      if (draft) {
        // Update ref for validation — no store update during drag
        Object.assign(draft, result.nodeUpdate)
      }
      revalidate()
    }

    const ensureDraft = (result: TransitionResult) => {
      gridPosition.current.set(...result.gridPosition)
      const c = worldToBuildingLocal(...result.cursorPosition)
      if (cursorGroupRef.current) {
        cursorGroupRef.current.position.set(c.x, c.y, c.z)
        if (result.cursorRotation) {
          cursorGroupRef.current.rotation.set(...result.cursorRotation)
        } else {
          cursorGroupRef.current.rotation.set(0, result.cursorRotationY, 0)
        }
      }

      const initRotation: [number, number, number] = result.cursorRotation ?? [
        0,
        result.cursorRotationY,
        0,
      ]

      draftNode.create(
        gridPosition.current,
        asset,
        initRotation,
        configRef.current.defaultScale,
        configRef.current.slots,
      )

      const draft = draftNode.current
      if (draft) {
        Object.assign(draft, result.nodeUpdate)
        // One-time setup: put node in the right parent so it renders correctly
        useScene.getState().updateNode(draft.id, result.nodeUpdate)
      }

      const previewBounds = expandBoundsToGrid(
        getFallbackPreviewBounds(draftNode.current, asset, asset.attachTo),
        asset.attachTo,
        gridSnapStep,
      )
      updatePreviewGeometry(previewBounds)
      updateDimensionGuides(previewBounds)

      if (!revalidate()) {
        draftNode.destroy()
      }
    }

    // ---- Init draft ----
    configRef.current.initDraft(gridPosition.current)
    const preserveDragOffset = configRef.current.preserveDragOffset === true
    // The host the item was grabbed from + its pre-drag host-local position.
    // Each surface's grab anchor preserves the grab offset only on THAT host,
    // and only until the item anchors on ANY other host (another wall/ceiling/
    // shelf, a roof face, or the floor after a host visit) — `grabForgotten`
    // then latches and every host, the original included, centers the item
    // under the cursor. Merely passing through empty space (wall/ceiling items
    // hide between surfaces) does NOT forget the grab.
    const grabWallId =
      placementState.current.surface === 'wall' ? placementState.current.wallId : null
    const grabCeilingId =
      placementState.current.surface === 'ceiling' ? placementState.current.ceilingId : null
    const grabSurfaceHostId =
      placementState.current.surface === 'item-surface'
        ? placementState.current.surfaceItemId
        : placementState.current.surface === 'shelf-surface'
          ? placementState.current.shelfId
          : null
    const grabStartPosition: [number, number, number] | null = draftNode.current
      ? [
          draftNode.current.position[0],
          draftNode.current.position[1],
          draftNode.current.position[2],
        ]
      : null
    let grabForgotten = grabStartPosition === null
    // Anchoring on `hostId`: returns whether the grab offset still applies
    // there, and latches `grabForgotten` the first time it doesn't.
    const preserveGrabOn = (hostId: string | null, grabHostId: string | null): boolean => {
      const preserve = !grabForgotten && hostId !== null && hostId === grabHostId
      if (!preserve) grabForgotten = true
      return preserve
    }
    // Nulled when the item returns to the floor FROM a host (see
    // `detachItemSurfaceToFloor`): the floor grab offset only survives until
    // the item anchors elsewhere, like every other surface's grab anchor.
    let relativeFloorStart =
      preserveDragOffset && placementState.current.surface === 'floor' && !asset.attachTo
        ? gridPosition.current.clone()
        : null

    // Grab anchors for the non-floor surfaces. Each captures the cursor's
    // surface-local position and the item's stored position on the first move
    // for a given host, then offsets every later move by
    // `start + (raw - anchor)` — mirroring the floor path and the door/window
    // move tools so the item tracks the grabbed point instead of teleporting
    // its origin under the cursor. Reset on host change (re-seeded from the
    // item's then-current position) by the surface leave handlers.
    let wallDragAnchor: {
      wallId: string
      rawX: number
      rawY: number
      startX: number
      startY: number
    } | null = null
    let ceilingDragAnchor: {
      ceilingId: string
      rawX: number
      rawZ: number
      startX: number
      startZ: number
    } | null = null
    let hostSurfaceDragAnchor: {
      hostId: string
      rawX: number
      rawZ: number
      startX: number
      startZ: number
    } | null = null

    // Item-surface / shelf moves snap from a WORLD cursor hit projected into the
    // host's local frame. Re-project the offset-corrected local point back to
    // world so the strategy (which re-derives both the stored position and the
    // visual cursor from `event.position`) stays self-consistent.
    const resolveHostSurfaceWorld = (
      hostId: string,
      worldPos: readonly [number, number, number],
    ): [number, number, number] | null => {
      const draft = draftNode.current
      const hostMesh = sceneRegistry.nodes.get(hostId)
      if (!(preserveDragOffset && draft && hostMesh)) return null
      const rawLocal = hostMesh.worldToLocal(new Vector3(worldPos[0], worldPos[1], worldPos[2]))
      if (!hostSurfaceDragAnchor || hostSurfaceDragAnchor.hostId !== hostId) {
        // Grab offset survives only on the host the item was grabbed from and
        // only until it anchors elsewhere — any other shelf/table centers the
        // item under the cursor (same rule as the wall grab anchor).
        const preserveGrab = preserveGrabOn(hostId, grabSurfaceHostId)
        hostSurfaceDragAnchor = {
          hostId,
          rawX: rawLocal.x,
          rawZ: rawLocal.z,
          startX: preserveGrab && grabStartPosition ? grabStartPosition[0] : rawLocal.x,
          startZ: preserveGrab && grabStartPosition ? grabStartPosition[2] : rawLocal.z,
        }
      }
      const correctedX = hostSurfaceDragAnchor.startX + (rawLocal.x - hostSurfaceDragAnchor.rawX)
      const correctedZ = hostSurfaceDragAnchor.startZ + (rawLocal.z - hostSurfaceDragAnchor.rawZ)
      const world = hostMesh.localToWorld(new Vector3(correctedX, rawLocal.y, correctedZ))
      return [world.x, world.y, world.z]
    }

    // Floor grab-offset: the item tracks the grabbed point instead of snapping
    // its origin under the cursor. The offset is computed in building-local space
    // (`event.localPosition`), but `floorStrategy.move` snaps on the WORLD grid
    // (`event.position`), so the corrected local point is re-projected to a
    // corrected world point and both frames carry the offset to stay consistent.
    const applyFloorGrabOffset = (event: GridEvent): GridEvent => {
      if (relativeFloorStart === null) return event
      // A move started away from the item (the action menu's 이동) holds it
      // under the cursor like inZOI; only a grab on the item keeps the offset.
      const box = ghostScreenBoxRef.current
      const { clientX, clientY } = event.nativeEvent
      if (
        floorDragAnchor === null &&
        box &&
        !isFloorplanInputEvent(event.nativeEvent) &&
        (clientX < box.left - GRAB_BOX_MARGIN_PX ||
          clientX > box.right + GRAB_BOX_MARGIN_PX ||
          clientY < box.top - GRAB_BOX_MARGIN_PX ||
          clientY > box.bottom + GRAB_BOX_MARGIN_PX)
      ) {
        relativeFloorStart = null
        return event
      }
      const rawX = event.localPosition[0]
      const rawZ = event.localPosition[2]
      const anchor = floorDragAnchor ?? [rawX, rawZ]
      floorDragAnchor = anchor
      const correctedLocal: [number, number, number] = [
        relativeFloorStart.x + (rawX - anchor[0]),
        event.localPosition[1],
        relativeFloorStart.z + (rawZ - anchor[1]),
      ]
      const correctedWorld = buildingLocalToWorld(
        correctedLocal[0],
        correctedLocal[1],
        correctedLocal[2],
      )
      return {
        ...event,
        position: [correctedWorld.x, event.position[1], correctedWorld.z],
        localPosition: correctedLocal,
      }
    }

    // Sync cursor to the draft mesh's world position and rotation
    if (draftNode.current) {
      const mesh = sceneRegistry.nodes.get(draftNode.current.id)
      if (mesh) {
        const worldPos = new Vector3()
        mesh.getWorldPosition(worldPos)
        const localPos = worldToBuildingLocal(worldPos.x, worldPos.y, worldPos.z)
        if (cursorGroupRef.current) {
          cursorGroupRef.current.position.copy(localPos)
          if (
            draftNode.current.asset.attachTo ||
            placementState.current?.surface === 'item-surface'
          ) {
            // Wall/ceiling items AND items hosted on another item: the mesh is parented
            // to a rotated host, so the box's building-local yaw must come from the mesh's
            // world rotation, not the node's host-local `rotation[1]` (which would leave the
            // box rotated by the host's yaw relative to the item).
            const q = new Quaternion()
            mesh.getWorldQuaternion(q)
            cursorGroupRef.current.rotation.y = new Euler().setFromQuaternion(q, 'YXZ').y
          } else {
            // Floor items: the cursor group lives in building-local space, so use the
            // node's local Y rotation — the same value onGridMove applies. The world
            // quaternion would double-count any building rotation, leaving the initial
            // box mis-rotated until the first cursor move.
            cursorGroupRef.current.rotation.y = draftNode.current.rotation[1] ?? 0
          }
        }
      } else if (cursorGroupRef.current) {
        cursorGroupRef.current.position.copy(gridPosition.current)
        cursorGroupRef.current.rotation.y = draftNode.current.rotation[1] ?? 0
      }
    }

    revalidate()

    // ---- Press-drag commit-on-release ----
    // When the move was engaged by the press-drag move cross (vs. click-to-
    // place), commit on pointer-up instead of waiting for a click. Each surface
    // move handler records how to commit at the current cursor; the release
    // replays it. Captured once at setup — a fresh coordinator mounts per move.
    const dragMode = useEditor.getState().placementDragMode
    let releaseCommit: (() => void) | null = null
    // Eat the click the browser fires after pointer-up so the surface
    // `:click` handlers don't commit a second time.
    const swallowNextClick = () => {
      const swallow = (e: Event) => {
        e.stopPropagation()
        e.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 300)
    }
    const onReleaseCommit = () => {
      if (!releaseCommit) return
      const commit = releaseCommit
      releaseCommit = null
      swallowNextClick()
      commit()
    }

    // ---- Floor Handlers ----

    let previousGridPos: [number, number, number] | null = null

    // Scratch objects reused by the stickiness test (runs per grid:move).
    const stickyRay = new Ray()
    const stickyBox = new Box3()
    const stickyMat = new Matrix4()
    const stickyCamPos = new Vector3()

    // True while the cursor ray still points at the active shelf's volume.
    // Used to keep an item hosted on a shelf "sticky": from an angled camera
    // the cursor ray slips off the shelf's thin boards / through its gaps and
    // lands on the floor *behind* the shelf, which would otherwise thrash the
    // placement between the shelf row and the floor on every micro-move. We
    // reconstruct the world ray (camera → grid hit point) and test it against
    // the shelf's bounding box — so a ray that passes *through* the shelf but
    // lands behind it still counts as "on the shelf". Only a ray that misses
    // the shelf box entirely means the user genuinely moved off it. A simple
    // footprint test on the floor hit point can't distinguish those.
    const cursorRayIntersectsActiveShelf = (gridWorldPoint: [number, number, number]): boolean => {
      const shelfId = placementState.current.shelfId
      if (!shelfId) return false
      const shelfMesh = sceneRegistry.nodes.get(shelfId as AnyNodeId)
      const shelfNode = useScene.getState().nodes[shelfId as AnyNodeId] as
        | { width?: number; depth?: number; height?: number }
        | undefined
      if (!(shelfMesh && shelfNode?.width && shelfNode?.depth && shelfNode?.height)) return false

      cameraRef.current.getWorldPosition(stickyCamPos)
      stickyRay.origin.copy(stickyCamPos)
      stickyRay.direction
        .set(
          gridWorldPoint[0] - stickyCamPos.x,
          gridWorldPoint[1] - stickyCamPos.y,
          gridWorldPoint[2] - stickyCamPos.z,
        )
        .normalize()

      // Into shelf-local space, then test the shelf's local AABB (origin at the
      // base: y ∈ [0, height]) with a small margin.
      stickyRay.applyMatrix4(stickyMat.copy(shelfMesh.matrixWorld).invert())
      const m = 0.08
      stickyBox.min.set(-shelfNode.width / 2 - m, -m, -shelfNode.depth / 2 - m)
      stickyBox.max.set(shelfNode.width / 2 + m, shelfNode.height + m, shelfNode.depth / 2 + m)
      return stickyRay.intersectsBox(stickyBox)
    }

    const onGridMove = (event: GridEvent) => {
      releaseCommit = () => onGridClick(event)
      // Lazy draft creation: if no draft yet (e.g. level wasn't ready during init), create now
      if (draftNode.current === null && asset.attachTo === undefined) {
        configRef.current.initDraft(gridPosition.current)
      }

      has3DPointerDrivenMoveRef.current = true

      // Shelf stickiness: while hosting on a shelf, ignore floor events while
      // the cursor ray still points at the shelf volume (the ray merely slipped
      // off a board / through a gap and hit the floor behind). Detach to the
      // floor only once the ray misses the shelf entirely — without this the
      // item oscillates between the shelf row and the floor on every micro-move.
      if (placementState.current.surface === 'shelf-surface') {
        if (cursorRayIntersectsActiveShelf(event.position)) return
        detachItemSurfaceToFloor(event as unknown as ItemEvent)
      }

      const floorEvent = applyFloorGrabOffset(event)

      lastRawPos.current.set(
        floorEvent.localPosition[0],
        floorEvent.localPosition[1],
        floorEvent.localPosition[2],
      )
      if (!cursorGroupRef.current) return
      const result = floorStrategy.move(getContext(), floorEvent)
      if (!result) return

      // Figma-style alignment snap layered on top of the floor strategy's
      // grid snap: when the draft's edge lines up (on X or Z) with another
      // item's edge, snap and publish a guide. The guide connects to the
      // nearest real corner of the candidate (resolver tie-break), so the dot
      // always sits on an actual point. The delta is applied to BOTH the grid
      // and cursor positions below. Alt is force-place only (it does NOT bypass
      // snapping — 'off' mode is the no-snap bypass); the active snapping mode
      // governs whether alignment runs at all ('off' / 'angles' disable
      // magnetic alignment, 'lines' enables it, matching the wall/fence flow).
      const draft = draftNode.current
      let alignX = 0
      let alignZ = 0
      // Alignment "lines" are DISPLAYED in every snapping mode except Off
      // (isAlignmentGuideActive); the magnetic pull toward them is applied only
      // in 'lines' mode (isMagneticSnapActive). Alt is force-place, not a snap
      // bypass.
      if (isAlignmentGuideActive() && draft) {
        alignmentCandidates ??= collectAlignmentAnchors(
          useScene.getState().nodes,
          draft.id,
          useViewer.getState().selection.levelId,
        )
        const ar = resolveAlignmentForActiveBuilding({
          moving: movingFootprintAnchors(
            draft as unknown as AnyNode,
            result.gridPosition[0],
            result.gridPosition[2],
            cursorGroupRef.current.rotation.y,
          ),
          candidates: alignmentCandidates,
          threshold: ALIGNMENT_THRESHOLD_M,
        })
        if (ar.snap && isMagneticSnapActive()) {
          alignX = ar.snap.dx
          alignZ = ar.snap.dz
        }
        useAlignmentGuides
          .getState()
          .set(projectAlignmentGuidesWorldToActiveBuildingLocal(ar.guides))
      } else {
        useAlignmentGuides.getState().clear()
      }

      const gridPos: [number, number, number] = [
        result.gridPosition[0] + alignX,
        result.gridPosition[1],
        result.gridPosition[2] + alignZ,
      ]

      // Play snap sound when grid position changes
      if (
        previousGridPos &&
        (gridPos[0] !== previousGridPos[0] || gridPos[2] !== previousGridPos[2])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPos = [...gridPos]
      gridPosition.current.set(...gridPos)
      const cursorPosition = getFloorVisualPosition(gridPos)
      if (!draft && asset.attachTo) {
        cursorPosition[1] += getDetachedAttachmentPreviewLift(asset.attachTo)
      }
      cursorGroupRef.current.position.set(cursorPosition[0], cursorPosition[1], cursorPosition[2])
      // Floor items only rotate on Y; keep the preview box (and the live
      // transform the 2D floorplan mirrors) aligned with the draft's
      // rotation. Without this the box stays at its seed rotation until a
      // manual R/T, so a moved already-rotated item shows an axis-aligned box.
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      if (draft) draft.position = gridPos

      // Publish live transform for 2D floorplan
      if (draft) {
        useLiveTransforms.getState().set(draft.id, {
          position: gridPos,
          rotation: cursorGroupRef.current.rotation.y,
        })
      }

      revalidate()
    }

    const onGridClick = (event: GridEvent) => {
      // Drop alignment guides on click — the move commits (guides done) or
      // placement re-arms (the next move republishes them).
      useAlignmentGuides.getState().clear()
      const result = floorStrategy.click(getContext(), event, getActiveValidators())
      if (!result) return

      // Preserve cursor rotation for the next draft
      const currentRotation: [number, number, number] = [
        0,
        cursorGroupRef.current?.rotation.y ?? draftNode.current?.rotation[1] ?? 0,
        0,
      ]

      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }

      const committedId = draftNode.current?.id ?? null
      const wasAdopted = draftNode.isAdopted
      const finalId = draftNode.commit(result.nodeUpdate)
      finishCommittedPlacement(finalId ?? committedId, wasAdopted, () => {
        draftNode.create(
          gridPosition.current,
          asset,
          currentRotation,
          configRef.current.defaultScale,
          configRef.current.slots,
        )
        const previewBounds = expandBoundsToGrid(
          getFallbackPreviewBounds(draftNode.current, asset, asset.attachTo),
          asset.attachTo,
          gridSnapStep,
        )
        updatePreviewGeometry(previewBounds)
        updateDimensionGuides(previewBounds)
        revalidate()
      })
    }

    // ---- Wall Handlers ----

    const onWallEnter = (event: WallEvent) => {
      has3DPointerDrivenMoveRef.current = true
      const nodes = useScene.getState().nodes
      const result = wallStrategy.enter(
        getContext(),
        event,
        resolveLevelId,
        nodes,
        getActiveValidators(),
      )
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to new wall
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
        if (result.stateUpdate.wallId) {
          useScene.getState().dirtyNodes.add(result.stateUpdate.wallId as AnyNodeId)
        }
      }
    }

    const onWallMove = (event: WallEvent) => {
      releaseCommit = () => onWallClick(event)
      has3DPointerDrivenMoveRef.current = true
      if (!cursorGroupRef.current) return
      const ctx = getContext()

      if (ctx.state.surface !== 'wall') {
        const nodes = useScene.getState().nodes
        const enterResult = wallStrategy.enter(
          ctx,
          event,
          resolveLevelId,
          nodes,
          getActiveValidators(),
        )
        if (!enterResult) return

        event.stopPropagation()
        applyTransition(enterResult)
        if (draftNode.current && enterResult.nodeUpdate.parentId) {
          useScene.getState().updateNode(draftNode.current.id, enterResult.nodeUpdate)
          if (enterResult.stateUpdate.wallId) {
            useScene.getState().dirtyNodes.add(enterResult.stateUpdate.wallId as AnyNodeId)
          }
        }
        return
      }

      if (!draftNode.current) {
        const nodes = useScene.getState().nodes
        const setup = wallStrategy.enter(
          getContext(),
          event,
          resolveLevelId,
          nodes,
          getActiveValidators(),
        )
        if (!setup) return

        event.stopPropagation()
        ensureDraft(setup)
        return
      }

      let wallMoveEvent = event
      if (preserveDragOffset && draftNode.current) {
        const rawX = event.localPosition[0]
        const rawY = event.localPosition[1]
        if (!wallDragAnchor || wallDragAnchor.wallId !== event.node.id) {
          // Preserve the grab offset only on the wall the item was grabbed
          // from (no teleport under the pointer at grab time). Any OTHER host
          // centers the item under the cursor — a host change is already a
          // jump, so tracking the pointer exactly is the expected feel, while
          // re-seeding from the carried-over position (the old behavior)
          // baked an arbitrary along-wall offset into the whole stay on that
          // wall. Once anchored elsewhere the grab is forgotten for good, so
          // re-entering the original wall centers under the cursor too.
          const preserveGrab = preserveGrabOn(event.node.id, grabWallId)
          wallDragAnchor = {
            wallId: event.node.id,
            rawX,
            rawY,
            startX: preserveGrab && grabStartPosition ? grabStartPosition[0] : rawX,
            startY: preserveGrab && grabStartPosition ? grabStartPosition[1] : rawY,
          }
        }
        const correctedX = wallDragAnchor.startX + (rawX - wallDragAnchor.rawX)
        const correctedY = wallDragAnchor.startY + (rawY - wallDragAnchor.rawY)
        const wallMesh = sceneRegistry.nodes.get(event.node.id)
        // Derive the world cursor from the corrected wall-local point so the
        // visual cursor (world) and the stored position (wall-local) agree; if
        // the wall mesh is somehow absent, keep the raw world hit unchanged.
        const correctedWorld = wallMesh
          ? wallMesh.localToWorld(new Vector3(correctedX, correctedY, event.localPosition[2]))
          : null
        wallMoveEvent = {
          ...event,
          localPosition: [correctedX, correctedY, event.localPosition[2]],
          position: correctedWorld
            ? [correctedWorld.x, correctedWorld.y, correctedWorld.z]
            : event.position,
        }
      }
      const result = wallStrategy.move(ctx, wallMoveEvent, getActiveValidators())
      if (!result) return

      event.stopPropagation()

      const posChanged =
        gridPosition.current.x !== result.gridPosition[0] ||
        gridPosition.current.y !== result.gridPosition[1] ||
        gridPosition.current.z !== result.gridPosition[2]

      // Play snap sound when grid position changes
      if (posChanged) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      gridPosition.current.set(...result.gridPosition)
      const wc = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(wc.x, wc.y, wc.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft && result.nodeUpdate) {
        if ('side' in result.nodeUpdate) draft.side = result.nodeUpdate.side
        if ('rotation' in result.nodeUpdate)
          draft.rotation = result.nodeUpdate.rotation as [number, number, number]
      }

      const placeable = revalidate()

      if (draft && placeable) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) {
          mesh.position.copy(gridPosition.current)
          const rot = result.nodeUpdate?.rotation
          if (rot) mesh.rotation.y = rot[1]

          // Push wall-side items out by half the parent wall's thickness
          if (asset.attachTo === 'wall-side' && placementState.current.wallId) {
            const parentWall = useScene.getState().nodes[placementState.current.wallId as AnyNodeId]
            if (parentWall?.type === 'wall') {
              const wallThickness = (parentWall as WallNode).thickness ?? 0.1
              mesh.position.z = (wallThickness / 2) * (draft.side === 'front' ? 1 : -1)
            }
          }
        }
        // Mark parent wall dirty so it rebuilds geometry — only when position changed
        if (result.dirtyNodeId && posChanged) {
          const now = globalThis.performance?.now?.() ?? Date.now()
          const last = lastWallDirtyAtRef.current.get(result.dirtyNodeId) ?? 0
          // Wall rebuilds can trigger expensive CSG; throttle live previews to avoid FPS collapse.
          if (now - last > 120) {
            lastWallDirtyAtRef.current.set(result.dirtyNodeId, now)
            useScene.getState().dirtyNodes.add(result.dirtyNodeId)
          }
        }

        // Publish live transform for the 2D floorplan. The floorplan resolves a
        // wall item's footprint (and its wall-side depth offset) from this
        // rotation as a PLAN-space yaw. `cursorRotationY` is the 3D world cursor
        // yaw, which is π off from the plan rotation on a wall face — feeding it
        // raw flips the footprint to the far side of the wall during placement.
        // Publish the plan rotation (wall angle + the item's wall-local yaw) so
        // the preview matches what the committed node resolves to.
        let liveRotation = result.cursorRotationY
        const liveWallId = placementState.current.wallId
        const liveWall = liveWallId ? useScene.getState().nodes[liveWallId as AnyNodeId] : undefined
        if (liveWall?.type === 'wall') {
          const w = liveWall as WallNode
          const wallPlanRotation = -Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0])
          liveRotation = wallPlanRotation + (draft.rotation[1] ?? 0)
        }
        useLiveTransforms.getState().set(draft.id, {
          position: result.cursorPosition,
          rotation: liveRotation,
        })
      }
    }

    const onWallClick = (event: WallEvent) => {
      const result = wallStrategy.click(getContext(), event, getActiveValidators())
      if (!result) return

      event.stopPropagation()
      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      const committedId = draftNode.current?.id ?? null
      const wasAdopted = draftNode.isAdopted
      const finalId = draftNode.commit(result.nodeUpdate)
      if (result.dirtyNodeId) {
        useScene.getState().dirtyNodes.add(result.dirtyNodeId)
      }

      finishCommittedPlacement(finalId ?? committedId, wasAdopted, () => {
        const nodes = useScene.getState().nodes
        const enterResult = wallStrategy.enter(
          getContext(),
          event,
          resolveLevelId,
          nodes,
          validators,
        )
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      })
    }

    const onWallLeave = (event: WallEvent) => {
      wallDragAnchor = null
      const result = wallStrategy.leave(getContext())
      if (!result) return

      event.stopPropagation()

      if (asset.attachTo) {
        if (draftNode.isAdopted) {
          // Move mode: keep draft alive, reparent to level
          const oldWallId = placementState.current.wallId
          applyTransition(result)
          const draft = draftNode.current
          if (draft) {
            useScene
              .getState()
              .updateNode(draft.id, { parentId: result.nodeUpdate.parentId as string })
          }
          if (oldWallId) {
            useScene.getState().dirtyNodes.add(oldWallId as AnyNodeId)
          }
        } else {
          // Create mode: destroy transient and reset state
          draftNode.destroy()
          Object.assign(placementState.current, result.stateUpdate)
        }
      } else {
        applyTransition(result)
      }
    }

    // ---- Roof Wall Handlers ----
    // Wall-attach items also host on the vertical wall faces a roof
    // segment generates (base walls + coplanar gable ends). Unlike walls,
    // crossing between segments inside ONE roof never re-fires
    // `roof:enter` (events come from the roof group), so the move handler
    // re-enters whenever the strategy reports a segment change.

    const enterRoofWall = (event: RoofEvent): boolean => {
      const result = roofWallStrategy.enter(getContext(), event, altFreeRef.current)
      if (!result) return false

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to the segment
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
      }
      return true
    }

    const onRoofWallEnter = (event: RoofEvent) => {
      has3DPointerDrivenMoveRef.current = true
      enterRoofWall(event)
    }

    const onRoofWallMove = (event: RoofEvent) => {
      releaseCommit = () => onRoofWallClick(event)
      has3DPointerDrivenMoveRef.current = true
      if (!cursorGroupRef.current) return
      const ctx = getContext()

      if (ctx.state.surface !== 'roof-wall' || !draftNode.current) {
        enterRoofWall(event)
        return
      }

      const result = roofWallStrategy.move(ctx, event, altFreeRef.current)
      if (!result) {
        // Different segment under the pointer (or no placeable face) —
        // try a fresh enter; a null resolve leaves the draft where it is.
        enterRoofWall(event)
        return
      }

      event.stopPropagation()

      const posChanged =
        gridPosition.current.x !== result.gridPosition[0] ||
        gridPosition.current.y !== result.gridPosition[1] ||
        gridPosition.current.z !== result.gridPosition[2]

      if (posChanged) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      gridPosition.current.set(...result.gridPosition)
      const wc = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(wc.x, wc.y, wc.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft && result.nodeUpdate) {
        if ('side' in result.nodeUpdate) draft.side = result.nodeUpdate.side
        if ('rotation' in result.nodeUpdate)
          draft.rotation = result.nodeUpdate.rotation as [number, number, number]
      }

      const placeable = revalidate()

      if (draft && placeable) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) {
          mesh.position.copy(gridPosition.current)
          // Wall-side items sit on the outer surface: mirror ItemSystem's
          // push (z = thickness/2 off the face frame's mid-plane) so the
          // drag preview doesn't sink into the wall until commit.
          if (asset.attachTo === 'wall-side' && placementState.current.roofSegmentId) {
            const segment =
              useScene.getState().nodes[placementState.current.roofSegmentId as AnyNodeId]
            if (segment?.type === 'roof-segment') {
              mesh.position.z = (segment.wallThickness ?? 0.1) / 2
            }
          }
          const rot = result.nodeUpdate?.rotation
          if (rot) mesh.rotation.y = rot[1]
        }
        // The 2D floor-plan live frame is wall-local; a segment-local
        // value would render garbage — clear instead of publishing.
        useLiveTransforms.getState().clear(draft.id)
      }
    }

    const onRoofWallClick = (event: RoofEvent) => {
      const result = roofWallStrategy.click(getContext(), event, altFreeRef.current)
      if (!result) return

      event.stopPropagation()
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      const committedId = draftNode.current?.id ?? null
      const wasAdopted = draftNode.isAdopted
      const finalId = draftNode.commit(result.nodeUpdate)

      finishCommittedPlacement(finalId ?? committedId, wasAdopted, () => {
        const enterResult = roofWallStrategy.enter(getContext(), event, altFreeRef.current)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      })
    }

    const onRoofWallLeave = (event: RoofEvent) => {
      const result = roofWallStrategy.leave(getContext())
      if (!result) return

      event.stopPropagation()

      if (draftNode.isAdopted) {
        // Move mode: keep draft alive, reparent to level
        applyTransition(result)
        const draft = draftNode.current
        if (draft) {
          useScene.getState().updateNode(draft.id, {
            parentId: result.nodeUpdate.parentId as string,
            roofSegmentId: undefined,
          })
        }
      } else {
        // Create mode: destroy transient and reset state
        draftNode.destroy()
        Object.assign(placementState.current, result.stateUpdate)
      }
    }

    // ---- Item Surface Handlers ----

    const detachItemSurfaceToFloor = (event: ItemEvent) => {
      hostSurfaceDragAnchor = null
      // Coming back from a host: forget the floor grab too, so the item
      // centers under the cursor instead of restoring the pre-drag offset —
      // and landing on the floor is "anchoring elsewhere", so a later return
      // to the grabbed host centers as well.
      relativeFloorStart = null
      floorDragAnchor = null
      grabForgotten = true
      const buildingLocalPoint = worldToBuildingLocal(
        event.position[0],
        event.position[1],
        event.position[2],
      )
      // Mode-aware snap (raw in Off / non-grid); Alt is force-place, not bypass.
      const wx = snapToHalf(buildingLocalPoint.x)
      const wz = snapToHalf(buildingLocalPoint.z)
      const floorPos: [number, number, number] = [wx, 0, wz]

      Object.assign(placementState.current, {
        surface: 'floor',
        surfaceItemId: null,
        shelfId: null,
      })
      gridPosition.current.set(wx, 0, wz)
      const levelId = useViewer.getState().selection.levelId as AnyNodeId | null
      const floorVisualPosition = getFloorVisualPosition(
        floorPos,
        levelId ? { parentId: levelId } : undefined,
      )
      if (cursorGroupRef.current) {
        cursorGroupRef.current.position.set(...floorVisualPosition)
      }

      const draft = draftNode.current
      if (draft) {
        // The stored yaw is still HOST-local — the surface enter counter-
        // rotated it against the host's world yaw so the item wouldn't spin
        // when attaching. Re-express the same world yaw in the level frame
        // before re-parenting, or the item visibly spins by the host's
        // rotation the moment it returns to the floor.
        let rotation = draft.rotation
        const draftMesh = sceneRegistry.nodes.get(draft.id)
        if (draftMesh) {
          const quat = new Quaternion()
          draftMesh.getWorldQuaternion(quat)
          const worldYaw = new Euler().setFromQuaternion(quat, 'YXZ').y
          const levelMesh = levelId ? sceneRegistry.nodes.get(levelId) : null
          let levelYaw = 0
          if (levelMesh) {
            levelMesh.getWorldQuaternion(quat)
            levelYaw = new Euler().setFromQuaternion(quat, 'YXZ').y
          }
          rotation = [draft.rotation[0], worldYaw - levelYaw, draft.rotation[2]]
          draft.rotation = rotation
        }
        draft.position = floorPos
        // Sync the ref's parent too (the store-only write left the ref
        // pointing at the host, so `getFloorPlacedElevation` bailed on its
        // parent-must-be-a-level guard and the item + grid stopped following
        // slab elevations for the rest of the drag).
        if (levelId) draft.parentId = levelId
        useScene.getState().updateNode(draft.id, {
          parentId: useViewer.getState().selection.levelId as string,
          position: floorPos,
          rotation,
        })
      }

      revalidate()
    }

    const onItemEnter = (event: ItemEvent) => {
      if (event.node.id === draftNode.current?.id) return
      has3DPointerDrivenMoveRef.current = true
      const result = itemSurfaceStrategy.enter(getContext(), event)
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to surface item
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
      }
    }

    const onItemMove = (event: ItemEvent) => {
      if (event.node.id === draftNode.current?.id) return
      releaseCommit = () => onItemClick(event)
      has3DPointerDrivenMoveRef.current = true
      if (!cursorGroupRef.current) return
      const ctx = getContext()

      if (ctx.state.surface !== 'item-surface') {
        // Try entering surface mode
        const enterResult = itemSurfaceStrategy.enter(ctx, event)
        if (!enterResult) return

        event.stopPropagation()
        applyTransition(enterResult)
        if (draftNode.current && enterResult.nodeUpdate.parentId) {
          useScene.getState().updateNode(draftNode.current.id, enterResult.nodeUpdate)
        }
        return
      }

      if (ctx.state.surface === 'item-surface' && event.node.id !== ctx.state.surfaceItemId) {
        const enterResult = itemSurfaceStrategy.enter(
          { ...ctx, state: { ...ctx.state, surface: 'floor', surfaceItemId: null } },
          event,
        )

        event.stopPropagation()
        if (enterResult) {
          applyTransition(enterResult)
          if (draftNode.current && enterResult.nodeUpdate.parentId) {
            useScene.getState().updateNode(draftNode.current.id, enterResult.nodeUpdate)
          }
        } else {
          detachItemSurfaceToFloor(event)
        }
        return
      }

      if (!draftNode.current) {
        const enterResult = itemSurfaceStrategy.enter(getContext(), event)
        if (!enterResult) return
        event.stopPropagation()
        ensureDraft(enterResult)
        return
      }

      const surfaceWorld =
        ctx.state.surfaceItemId !== null
          ? resolveHostSurfaceWorld(ctx.state.surfaceItemId, event.position)
          : null
      const itemMoveEvent = surfaceWorld ? { ...event, position: surfaceWorld } : event
      lastRawPos.current.set(
        itemMoveEvent.position[0],
        itemMoveEvent.position[1],
        itemMoveEvent.position[2],
      )
      const result = itemSurfaceStrategy.move(ctx, itemMoveEvent)
      if (!result) return

      event.stopPropagation()

      gridPosition.current.set(...result.gridPosition)
      const ic = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(ic.x, ic.y, ic.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.position.set(...result.gridPosition)

        // Publish live transform for 2D floorplan
        useLiveTransforms.getState().set(draft.id, {
          position: result.cursorPosition,
          rotation: result.cursorRotationY,
        })
      }

      revalidate()
    }

    const onItemLeave = (event: ItemEvent) => {
      if (event.node.id === draftNode.current?.id) return
      if (placementState.current.surface !== 'item-surface') return

      event.stopPropagation()

      // `event.localPosition` from useNodeEvents is in the LEAVING item's
      // local space (the sofa/table the draft is detaching from), not
      // building-local. Convert from world via worldToBuildingLocal instead,
      // otherwise the wireframe jumps to a surface-local-coordinate ghost
      // position until the next mouse move.
      detachItemSurfaceToFloor(event)
    }

    const onItemClick = (event: ItemEvent) => {
      // Click on the draft item itself. R3F dispatches click events to
      // the closest intersected mesh only — when the draft is hovering
      // on a host (shelf / table / etc.) the draft's mesh is *above*
      // the host's mesh, so the host's `${kind}:click` never fires.
      // If we're currently hosting on a shelf-surface, treat the
      // self-click as a commit on the active shelf so the user doesn't
      // have to aim around the cursor preview to drop the item.
      if (event.node.id === draftNode.current?.id) {
        const ctx = getContext()
        if (ctx.state.surface === 'shelf-surface' && ctx.state.shelfId) {
          const shelfNode = useScene.getState().nodes[ctx.state.shelfId as AnyNodeId]
          if (shelfNode && shelfNode.type === 'shelf') {
            const synthetic = { ...event, node: shelfNode } as unknown as ItemEvent
            const result = shelfSurfaceStrategy.click(ctx, synthetic as never)
            if (result) {
              event.stopPropagation()
              if (draftNode.current) {
                useLiveTransforms.getState().clear(draftNode.current.id)
              }
              const committedId = draftNode.current?.id ?? null
              const wasAdopted = draftNode.isAdopted
              const finalId = draftNode.commit(result.nodeUpdate)
              finishCommittedPlacement(finalId ?? committedId, wasAdopted, () => {
                const enterResult = shelfSurfaceStrategy.enter(ctx, synthetic as never)
                if (enterResult) {
                  applyTransition(enterResult)
                } else {
                  revalidate()
                }
              })
              return
            }
          }
        }
        // Same self-click forwarding for item-surface hosts (tables,
        // counters) — the draft mesh sits on top of the host mesh, so
        // the host's own click event is blocked by the cursor preview.
        if (ctx.state.surface === 'item-surface' && ctx.state.surfaceItemId) {
          const hostNode = useScene.getState().nodes[ctx.state.surfaceItemId as AnyNodeId]
          if (hostNode && hostNode.type === 'item') {
            const synthetic = { ...event, node: hostNode } as ItemEvent
            const result = itemSurfaceStrategy.click(ctx, synthetic)
            if (result) {
              event.stopPropagation()
              if (draftNode.current) {
                useLiveTransforms.getState().clear(draftNode.current.id)
              }
              const committedId = draftNode.current?.id ?? null
              const wasAdopted = draftNode.isAdopted
              const finalId = draftNode.commit(result.nodeUpdate)
              finishCommittedPlacement(finalId ?? committedId, wasAdopted, () => {
                const enterResult = itemSurfaceStrategy.enter(ctx, synthetic)
                if (enterResult) {
                  applyTransition(enterResult)
                } else {
                  revalidate()
                }
              })
              return
            }
          }
        }
        // Ceiling-hosted draft: when placing a ceiling-attached item the
        // draft hangs below the ceiling and intercepts the click ray
        // before the ceiling-grid mesh does — so `ceiling:click` never
        // fires and the user's commit click is dropped. Forward the
        // self-click to `ceilingStrategy.click` so placement commits the
        // same way it would from a click on the ceiling itself.
        if (ctx.state.surface === 'ceiling' && ctx.state.ceilingId) {
          const ceilingNode = useScene.getState().nodes[ctx.state.ceilingId as AnyNodeId]
          if (ceilingNode && ceilingNode.type === 'ceiling') {
            const synthetic = { ...event, node: ceilingNode } as unknown as CeilingEvent
            const result = ceilingStrategy.click(ctx, synthetic, getActiveValidators())
            if (result) {
              event.stopPropagation()
              if (draftNode.current) {
                useLiveTransforms.getState().clear(draftNode.current.id)
              }
              const committedId = draftNode.current?.id ?? null
              const wasAdopted = draftNode.isAdopted
              const finalId = draftNode.commit(result.nodeUpdate)
              finishCommittedPlacement(finalId ?? committedId, wasAdopted, () => {
                const nodes = useScene.getState().nodes
                const enterResult = ceilingStrategy.enter(
                  getContext(),
                  synthetic,
                  resolveLevelId,
                  nodes,
                )
                if (enterResult) {
                  applyTransition(enterResult)
                } else {
                  revalidate()
                }
              })
              return
            }
          }
        }
        return
      }

      const result = itemSurfaceStrategy.click(getContext(), event)
      if (!result) return

      event.stopPropagation()
      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      const committedId = draftNode.current?.id ?? null
      const wasAdopted = draftNode.isAdopted
      const finalId = draftNode.commit(result.nodeUpdate)

      finishCommittedPlacement(finalId ?? committedId, wasAdopted, () => {
        // Try to set up next draft on the same surface
        const enterResult = itemSurfaceStrategy.enter(getContext(), event)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      })
    }

    // ---- Ceiling Handlers ----

    const onCeilingEnter = (event: CeilingEvent) => {
      has3DPointerDrivenMoveRef.current = true
      const nodes = useScene.getState().nodes
      const result = ceilingStrategy.enter(getContext(), event, resolveLevelId, nodes)
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to new ceiling
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
        if (result.stateUpdate.ceilingId) {
          useScene.getState().dirtyNodes.add(result.stateUpdate.ceilingId as AnyNodeId)
        }
      }
    }

    const onCeilingMove = (event: CeilingEvent) => {
      releaseCommit = () => onCeilingClick(event)
      has3DPointerDrivenMoveRef.current = true
      if (!cursorGroupRef.current) return
      if (!draftNode.current && placementState.current.surface === 'ceiling') {
        const nodes = useScene.getState().nodes
        const setup = ceilingStrategy.enter(getContext(), event, resolveLevelId, nodes)
        if (!setup) return

        event.stopPropagation()
        ensureDraft(setup)
        return
      }

      let ceilingMoveEvent = event
      if (preserveDragOffset && draftNode.current) {
        const rawX = event.localPosition[0]
        const rawZ = event.localPosition[2]
        if (!ceilingDragAnchor || ceilingDragAnchor.ceilingId !== event.node.id) {
          // Same rule as the wall grab anchor: only the grabbed ceiling
          // preserves the offset, any other ceiling centers under the cursor.
          const preserveGrab = preserveGrabOn(event.node.id, grabCeilingId)
          ceilingDragAnchor = {
            ceilingId: event.node.id,
            rawX,
            rawZ,
            startX: preserveGrab && grabStartPosition ? grabStartPosition[0] : rawX,
            startZ: preserveGrab && grabStartPosition ? grabStartPosition[2] : rawZ,
          }
        }
        ceilingMoveEvent = {
          ...event,
          localPosition: [
            ceilingDragAnchor.startX + (rawX - ceilingDragAnchor.rawX),
            event.localPosition[1],
            ceilingDragAnchor.startZ + (rawZ - ceilingDragAnchor.rawZ),
          ],
        }
      }
      lastRawPos.current.set(
        ceilingMoveEvent.localPosition[0],
        ceilingMoveEvent.localPosition[1],
        ceilingMoveEvent.localPosition[2],
      )
      const result = ceilingStrategy.move(getContext(), ceilingMoveEvent)
      if (!result) return

      event.stopPropagation()

      // Play snap sound when grid position changes
      const posChanged =
        gridPosition.current.x !== result.gridPosition[0] ||
        gridPosition.current.y !== result.gridPosition[1] ||
        gridPosition.current.z !== result.gridPosition[2]

      if (posChanged) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      gridPosition.current.set(...result.gridPosition)
      const cc = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(cc.x, cc.y, cc.z)

      revalidate()

      const draft = draftNode.current
      if (draft) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.position.copy(gridPosition.current)

        // Publish live transform for 2D floorplan. The item override in
        // `floorplan-registry-layer` treats `live.position` as building-local
        // plan coords (parentId forced to null so the resolver renders it
        // directly), so publish the building-local cursor — not the
        // world-space `result.cursorPosition`, which otherwise lands the 2D
        // visual off the cursor whenever the building isn't at the origin
        // with zero rotation.
        useLiveTransforms.getState().set(draft.id, {
          position: [cc.x, cc.y, cc.z],
          rotation: cursorGroupRef.current.rotation.y,
        })
      }
    }

    const onCeilingClick = (event: CeilingEvent) => {
      const result = ceilingStrategy.click(getContext(), event, getActiveValidators())
      if (!result) return

      event.stopPropagation()
      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      const committedId = draftNode.current?.id ?? null
      const wasAdopted = draftNode.isAdopted
      const finalId = draftNode.commit(result.nodeUpdate)

      finishCommittedPlacement(finalId ?? committedId, wasAdopted, () => {
        const nodes = useScene.getState().nodes
        const enterResult = ceilingStrategy.enter(getContext(), event, resolveLevelId, nodes)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      })
    }

    const onCeilingLeave = (event: CeilingEvent) => {
      ceilingDragAnchor = null
      const result = ceilingStrategy.leave(getContext())
      if (!result) return

      event.stopPropagation()

      if (asset.attachTo) {
        if (draftNode.isAdopted) {
          // Move mode: keep draft alive, reparent to level
          const oldCeilingId = placementState.current.ceilingId
          applyTransition(result)
          const draft = draftNode.current
          if (draft) {
            useScene
              .getState()
              .updateNode(draft.id, { parentId: result.nodeUpdate.parentId as string })
          }
          if (oldCeilingId) {
            useScene.getState().dirtyNodes.add(oldCeilingId as AnyNodeId)
          }
        } else {
          // Create mode: destroy transient and reset state
          draftNode.destroy()
          Object.assign(placementState.current, result.stateUpdate)
        }
      } else {
        applyTransition(result)
      }
    }

    // ---- Shelf Handlers ----
    //
    // Items can host on shelves the same way they host on tables and
    // counters (item-surface). The shelf's `surfaces.custom` exposes one
    // candidate Y per row; `shelfSurfaceStrategy` picks the closest one
    // to the cursor's local-Y so the user can target a specific row.

    const onShelfEnter = (event: ShelfEvent) => {
      has3DPointerDrivenMoveRef.current = true
      const result = shelfSurfaceStrategy.enter(getContext(), event)
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
      }
    }

    const onShelfMove = (event: ShelfEvent) => {
      releaseCommit = () => onShelfClick(event)
      has3DPointerDrivenMoveRef.current = true
      // A shelf event can fire before the cursor group mounts or after
      // teardown, leaving the ref null; bail before dereferencing it below.
      if (!cursorGroupRef.current) return
      const ctx = getContext()
      if (ctx.state.surface !== 'shelf-surface') {
        // Cursor entered via a move event without an enter — try
        // transitioning in so the user doesn't need to mouse out + back
        // in to start hosting.
        const enterResult = shelfSurfaceStrategy.enter(ctx, event)
        if (!enterResult) return
        event.stopPropagation()
        applyTransition(enterResult)
        if (!draftNode.current) {
          ensureDraft(enterResult)
        } else if (enterResult.nodeUpdate.parentId) {
          useScene.getState().updateNode(draftNode.current.id, enterResult.nodeUpdate)
        }
        return
      }
      const shelfWorld =
        ctx.state.shelfId !== null
          ? resolveHostSurfaceWorld(ctx.state.shelfId, event.position)
          : null
      const shelfMoveEvent = shelfWorld ? { ...event, position: shelfWorld } : event
      const result = shelfSurfaceStrategy.move(ctx, shelfMoveEvent)
      if (!result) return

      event.stopPropagation()

      gridPosition.current.set(...result.gridPosition)
      const ic = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(ic.x, ic.y, ic.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.position.set(...result.gridPosition)
        useLiveTransforms.getState().set(draft.id, {
          position: result.cursorPosition,
          rotation: result.cursorRotationY,
        })
      }

      revalidate()
    }

    const onShelfLeave = (event: ShelfEvent) => {
      if (placementState.current.surface !== 'shelf-surface') return
      if (event.node.id !== placementState.current.shelfId) return
      // Intentionally do NOT detach to the floor here. `shelf:leave` fires
      // constantly while hosting because the cursor ray slips off the shelf's
      // thin boards and through its gaps — detaching on each of those would
      // thrash the item between the shelf row and the floor. The grid handler
      // owns the real shelf→floor transition (see `isOverActiveShelfFootprint`
      // in `onGridMove`): it detaches only once the cursor is clearly off the
      // shelf footprint, which is the genuine "left the shelf" signal.
      event.stopPropagation()
    }

    const onShelfClick = (event: ShelfEvent) => {
      const result = shelfSurfaceStrategy.click(getContext(), event)
      if (!result) return

      event.stopPropagation()
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      const committedId = draftNode.current?.id ?? null
      const wasAdopted = draftNode.isAdopted
      const finalId = draftNode.commit(result.nodeUpdate)

      finishCommittedPlacement(finalId ?? committedId, wasAdopted, () => {
        const enterResult = shelfSurfaceStrategy.enter(getContext(), event)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      })
    }

    // ---- Keyboard rotation ----

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        altFreeRef.current = true
        revalidate()
        return
      }

      // Don't intercept keys when focus is inside a text input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.metaKey || event.ctrlKey) return
      // Z / C turn the held item, so its once / repeat toggle is Q (the
      // helpers list it as such) — only for a fresh placement, never a move.
      if (event.code === 'KeyQ' && !event.altKey && !event.shiftKey) {
        const moving = getMovingNode()
        if (
          !event.repeat &&
          getActiveContinuationContext() === 'point' &&
          !(moving && !isFreshPlacementMetadata(moving.metadata))
        ) {
          event.preventDefault()
          event.stopImmediatePropagation()
          useEditor.getState().cycleContinuation('point')
          sfxEmitter.emit('sfx:grid-snap')
        }
        return
      }
      // Alt+R on macOS types '®', so match the physical key too.
      const key = event.key.toLowerCase()
      // inZOI's Z / C turn the held object left / right. While an item is held
      // they must not reach the global Z (zone tool) / C (continuation) keys.
      const zc = event.code === 'KeyZ' ? -1 : event.code === 'KeyC' ? 1 : 0
      if (zc !== 0) event.stopImmediatePropagation()
      const direction =
        zc !== 0
          ? zc
          : key === 'r' || event.code === 'KeyR'
            ? 1
            : key === 't' || event.code === 'KeyT'
              ? -1
              : 0
      if (direction === 0 || !draftNode.current) return
      event.preventDefault()
      rotateDraft(direction, event.altKey)
    }

    // R / T and a quick right click turn the draft 45° (rounded onto the 45°
    // grid); with Alt held they turn it 5° freely (inZOI).
    const rotateDraft = (rotationDir: 1 | -1, fine: boolean) => {
      const draft = draftNode.current
      if (!draft) return
      // Wall and roof-wall items face out of their host (yaw 0 in its frame) —
      // manual rotation would skew them off the wall plane.
      if (
        asset.attachTo === 'wall' ||
        asset.attachTo === 'wall-side' ||
        placementState.current.surface === 'roof-wall'
      ) {
        return
      }
      sfxEmitter.emit('sfx:item-rotate')
      const currentRotation = draft.rotation
      const newRotationY = turnRotation(currentRotation[1] ?? 0, rotationDir, fine)
      draft.rotation = [currentRotation[0], newRotationY, currentRotation[2]]

      // Ref + cursor mesh + item mesh — no store update during drag
      if (cursorGroupRef.current) {
        cursorGroupRef.current.rotation.y = newRotationY
      }
      const mesh = sceneRegistry.nodes.get(draft.id)
      if (mesh) mesh.rotation.y = newRotationY

      // Re-snap position immediately with updated rotation (dimX/dimZ may swap at 90°)
      const surface = placementState.current.surface
      if (surface === 'floor' || surface === 'ceiling') {
        const dims = getScaledDimensions(draft)
        const [dimX, , dimZ] = dims
        const swapDims = Math.abs(Math.sin(newRotationY)) > 0.9
        const x = snapToGrid(lastRawPos.current.x, swapDims ? dimZ : dimX)
        const z = snapToGrid(lastRawPos.current.z, swapDims ? dimX : dimZ)
        gridPosition.current.set(x, gridPosition.current.y, z)
        draft.position = [x, gridPosition.current.y, z]
        if (cursorGroupRef.current) {
          if (surface === 'floor') {
            cursorGroupRef.current.position.set(
              ...getFloorVisualPosition([x, gridPosition.current.y, z]),
            )
          } else {
            cursorGroupRef.current.position.x = x
            cursorGroupRef.current.position.z = z
          }
        }
        if (mesh) {
          mesh.position.x = x
          mesh.position.z = z
          if (surface === 'floor') {
            mesh.position.y = getFloorVisualPosition([x, gridPosition.current.y, z])[1]
          }
        }
      } else if (surface === 'item-surface' && placementState.current.surfaceItemId) {
        const surfaceMesh = sceneRegistry.nodes.get(placementState.current.surfaceItemId)
        if (surfaceMesh) {
          const localPos = surfaceMesh.worldToLocal(lastRawPos.current.clone())
          const dims = getScaledDimensions(draft)
          const [dimX, , dimZ] = dims
          const swapDims = Math.abs(Math.sin(newRotationY)) > 0.9
          const x = snapToGrid(localPos.x, swapDims ? dimZ : dimX)
          const z = snapToGrid(localPos.z, swapDims ? dimX : dimZ)
          const y = gridPosition.current.y
          gridPosition.current.set(x, y, z)
          draft.position = [x, y, z]
          const worldSnapped = surfaceMesh.localToWorld(new Vector3(x, y, z))
          const localSnapped = worldToBuildingLocal(worldSnapped.x, worldSnapped.y, worldSnapped.z)
          const surfaceQuat = new Quaternion()
          surfaceMesh.getWorldQuaternion(surfaceQuat)
          const surfaceWorldY = new Euler().setFromQuaternion(surfaceQuat, 'YXZ').y
          if (cursorGroupRef.current) {
            cursorGroupRef.current.position.set(localSnapped.x, localSnapped.y, localSnapped.z)
            // The box lives in building-local space while the mesh is parented to the host
            // item, so add the host's world yaw: the box must track the item's true
            // orientation, not its host-local `rotation[1]`.
            cursorGroupRef.current.rotation.y = newRotationY + surfaceWorldY
          }
          if (mesh) mesh.position.set(x, y, z)
        }
      }

      // Update live transform for 2D floorplan with post-snap position
      const currentLive = useLiveTransforms.getState().get(draft.id)
      if (currentLive) {
        const livePosition: [number, number, number] =
          surface === 'floor'
            ? [draft.position[0], draft.position[1], draft.position[2]]
            : cursorGroupRef.current
              ? [
                  cursorGroupRef.current.position.x,
                  cursorGroupRef.current.position.y,
                  cursorGroupRef.current.position.z,
                ]
              : [draft.position[0], draft.position[1], draft.position[2]]
        useLiveTransforms.getState().set(draft.id, {
          ...currentLive,
          position: livePosition,
          rotation: newRotationY,
        })
      }

      revalidate()
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        altFreeRef.current = false
        revalidate()
      }
    }

    // Capture phase so Z / C are claimed before the global shortcut handler.
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp)

    // ---- tool:cancel (Escape / programmatic) ----
    const onCancel = () => {
      useAlignmentGuides.getState().clear()
      if (configRef.current.onCancel) {
        configRef.current.onCancel()
      }
    }
    emitter.on('tool:cancel', onCancel)

    // ---- Right-click rotate (inZOI: a quick right click turns the held
    // object 45°; Esc cancels). A right-drag stays the camera orbit. ----
    const unsubscribeRightClick = subscribeQuickRightClick(
      () => !!draftNode.current,
      (event) => rotateDraft(1, event.altKey),
    )

    // ---- Bounding box geometry ----
    // Always derive the wireframe from `asset.dimensions × scale` rather than
    // the rendered mesh bounds. Asset dimensions describe the item's footprint
    // (e.g. only the trunk for a palm tree), while the mesh bbox would include
    // foliage or other visual overhang the snap logic intentionally ignores.

    const draft = draftNode.current
    const previewBounds = expandBoundsToGrid(
      getFallbackPreviewBounds(draft, asset, asset.attachTo),
      asset.attachTo,
      gridSnapStep,
    )
    updatePreviewGeometry(previewBounds)
    updateDimensionGuides(previewBounds)

    // ---- Undo protection ----
    // Undo replaces the entire `nodes` object with a previous snapshot, which doesn't
    // include the draft (created while temporal was paused). Re-insert it so the mesh
    // doesn't disappear mid-placement.
    // We defer via queueMicrotask to avoid nested setState during the undo callback.
    // Temporal is already paused during placement, so createNode won't enter the undo stack.
    let tearingDown = false
    const unsubDraftWatch = useScene.subscribe((state) => {
      if (tearingDown) return
      const draft = draftNode.current
      if (draft === null) return
      if (draft.id in state.nodes) return

      queueMicrotask(() => {
        if (tearingDown) return
        const draft = draftNode.current
        if (draft === null) return
        if (draft.id in useScene.getState().nodes) return
        // Temporal is paused during placement, createNode won't be tracked
        useScene.getState().createNode(draft, draft.parentId as AnyNodeId)
      })
    })

    // ---- Subscribe ----

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('item:enter', onItemEnter)
    emitter.on('item:move', onItemMove)
    emitter.on('item:leave', onItemLeave)
    emitter.on('item:click', onItemClick)
    emitter.on('wall:enter', onWallEnter)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('roof:enter', onRoofWallEnter)
    emitter.on('roof:move', onRoofWallMove)
    emitter.on('roof:click', onRoofWallClick)
    emitter.on('roof:leave', onRoofWallLeave)
    emitter.on('ceiling:enter', onCeilingEnter)
    emitter.on('ceiling:move', onCeilingMove)
    emitter.on('ceiling:click', onCeilingClick)
    emitter.on('ceiling:leave', onCeilingLeave)
    emitter.on('shelf:enter', onShelfEnter)
    emitter.on('shelf:move', onShelfMove)
    emitter.on('shelf:click', onShelfClick)
    emitter.on('shelf:leave', onShelfLeave)

    // A floor placement commits at the tracked floor cursor (`gridPosition`),
    // which keeps following the floor even when the click ray lands on a wall
    // (grid:move uses a separate ground-plane raycast). Without this, a commit
    // click whose ray hits a wall fires only `wall:click` — whose handler
    // declines for a floor item — and the click is silently eaten (the user
    // has to click again until the ray happens to clear the wall). Route every
    // surface click to the floor commit too; `floorStrategy.click` guards on
    // `surface === 'floor'` (and a non-attach draft), so it no-ops while the
    // draft is actually resting on that surface.
    const commitFloorOnSurfaceClick = (event: { stopPropagation: () => void }) => {
      if (placementState.current.surface !== 'floor') return
      onGridClick(event as unknown as GridEvent)
    }
    emitter.on('wall:click', commitFloorOnSurfaceClick as never)
    emitter.on('item:click', commitFloorOnSurfaceClick as never)
    emitter.on('ceiling:click', commitFloorOnSurfaceClick as never)
    emitter.on('roof:click', commitFloorOnSurfaceClick as never)
    emitter.on('shelf:click', commitFloorOnSurfaceClick as never)
    if (dragMode) window.addEventListener('pointerup', onReleaseCommit)

    return () => {
      tearingDown = true
      usePlacementFeedback.getState().setBlocked(false)
      if (dragMode) window.removeEventListener('pointerup', onReleaseCommit)
      unsubDraftWatch()
      useAlignmentGuides.getState().clear()
      // Clear live transform for any remaining draft
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      draftNode.destroy()
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('item:enter', onItemEnter)
      emitter.off('item:move', onItemMove)
      emitter.off('item:leave', onItemLeave)
      emitter.off('item:click', onItemClick)
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('roof:enter', onRoofWallEnter)
      emitter.off('roof:move', onRoofWallMove)
      emitter.off('roof:click', onRoofWallClick)
      emitter.off('roof:leave', onRoofWallLeave)
      emitter.off('ceiling:enter', onCeilingEnter)
      emitter.off('ceiling:move', onCeilingMove)
      emitter.off('ceiling:click', onCeilingClick)
      emitter.off('ceiling:leave', onCeilingLeave)
      emitter.off('shelf:enter', onShelfEnter)
      emitter.off('shelf:move', onShelfMove)
      emitter.off('shelf:click', onShelfClick)
      emitter.off('shelf:leave', onShelfLeave)
      emitter.off('wall:click', commitFloorOnSurfaceClick as never)
      emitter.off('item:click', commitFloorOnSurfaceClick as never)
      emitter.off('ceiling:click', commitFloorOnSurfaceClick as never)
      emitter.off('roof:click', commitFloorOnSurfaceClick as never)
      emitter.off('shelf:click', commitFloorOnSurfaceClick as never)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp)
      unsubscribeRightClick()
    }
  }, [
    asset,
    canPlaceOnFloor,
    canPlaceOnWall,
    canPlaceOnCeiling,
    draftNode,
    getFloorVisualPosition,
    gridSnapStep,
    updateDimensionGuides,
    updatePreviewGeometry,
  ])

  // Refresh the ghost box when the grid step changes mid-placement so it snaps
  // to the new cell size right away.
  useEffect(() => {
    if (!asset) return
    const draft = draftNode.current
    const previewBounds = expandBoundsToGrid(
      getFallbackPreviewBounds(draft, asset, asset.attachTo),
      asset.attachTo,
      gridSnapStep,
    )
    updatePreviewGeometry(previewBounds)
    updateDimensionGuides(previewBounds)
  }, [gridSnapStep, asset, draftNode, updateDimensionGuides, updatePreviewGeometry])
  // Wall/ceiling items are managed by their own surface entry events (ensureDraft / reparent).
  const viewerLevelId = useViewer((s) => s.selection.levelId)
  useEffect(() => {
    if (!asset) return
    const draft = draftNode.current
    if (!(draft && viewerLevelId) || asset.attachTo) return
    if (draft.parentId === viewerLevelId) return
    // A non-attach item resting on a host surface (table / counter / shelf) is
    // intentionally parented to that host while it's moved — the surface move
    // handlers keep it hosted and the commit writes the host parent back. Only
    // free floor items get re-homed to the level here; yanking a hosted item
    // onto the level would re-interpret its host-local position in level space
    // and float the dragged mesh off the host toward the building origin.
    const draftParent = draft.parentId
      ? useScene.getState().nodes[draft.parentId as AnyNodeId]
      : undefined
    if (draftParent?.type === 'item' || draftParent?.type === 'shelf') return
    draft.parentId = viewerLevelId
    useScene.getState().updateNode(draft.id as AnyNodeId, { parentId: viewerLevelId })
  }, [viewerLevelId, draftNode, asset])

  // Disable raycasting on the live draft mesh (and restore it when the draft
  // changes or goes away) so the cursor ray passes through the item being
  // moved and lands on the surface beneath it.
  const reconcileDraftRaycast = useCallback((mesh: Object3D | null) => {
    if (raycastDisabledMeshRef.current !== mesh) {
      // New draft root (or cleared): restore the prior mesh and reset tracking.
      for (const restore of restoreRaycastsRef.current) restore()
      restoreRaycastsRef.current = []
      raycastDisabledChildrenRef.current = new WeakSet()
      raycastDisabledMeshRef.current = mesh
    }
    if (!mesh) return
    // Disable any descendant not handled yet. Item drafts are GLB models whose
    // child meshes mount asynchronously (Suspense), so a one-shot traverse
    // misses them — those late children keep intercepting the ray and corrupt
    // the shelf-row hit the moment the item moves onto a row. Re-walking each
    // frame is cheap: the WeakSet makes it idempotent, so only new children pay.
    mesh.traverse((child) => {
      if (raycastDisabledChildrenRef.current.has(child)) return
      raycastDisabledChildrenRef.current.add(child)
      const original = child.raycast
      child.raycast = () => {}
      restoreRaycastsRef.current.push(() => {
        child.raycast = original
      })
    })
  }, [])

  // Restore the draft mesh's raycast when the coordinator unmounts (tool change).
  useEffect(() => () => reconcileDraftRaycast(null), [reconcileDraftRaycast])

  // Publish the ghost's surface (contact point + normal) so the grid's snap
  // patch sits at the item's resolved height (e.g. a shelf top) and orients to
  // the surface (vertical in a wall plane), AND publish the forward-facing
  // triangle pose to the single editor-side overlay (`<FacingPoseIndicator>`)
  // instead of drawing an inline triangle. Only this coordinator publishes — a
  // moving existing node has no draft here, so the grid reads that case straight
  // off the node's mesh. Cleared when idle.
  const surfaceNormalRef = useRef(new Vector3(0, 1, 0))
  const facingForwardRef = useRef(new Vector3(0, 0, 1))
  const facingQuatRef = useRef(new Quaternion())
  const wallOutwardSignRef = useRef<1 | -1>(1)
  useFrame(() => {
    const ghost = cursorGroupRef.current
    if (!(asset && ghost)) {
      clearPlacementSurface()
      useFacingPose.getState().clear()
      return
    }
    const surf = placementState.current.surface
    const n = surfaceNormalRef.current
    const shape = facingShapeRef.current
    // Triangle yaw / Y default to the floor case: the cursor group's own yaw is
    // the item's forward on the floor, and the triangle rides at the ghost's Y.
    let facingYaw = ghost.rotation.y
    let facingY = ghost.position.y
    if (surf === 'wall' || surf === 'roof-wall') {
      // Wall/roof-segment faces: the cursor group's yaw is the symmetric
      // wireframe yaw (π off the real facing for a wall, and a different frame
      // for a roof face), so derive the item's TRUE outward facing from the
      // draft mesh's world orientation — its local +Z faces out of the host
      // surface. This keeps BOTH the grid normal and the triangle correct for
      // wall and roof-segment hosts alike, rather than the old quaternion read
      // that pointed the wrong way.
      const mesh = draftNode.current ? sceneRegistry.nodes.get(draftNode.current.id) : null
      if (mesh) {
        mesh.getWorldQuaternion(facingQuatRef.current)
        const fwd = facingForwardRef.current.set(0, 0, 1).applyQuaternion(facingQuatRef.current)
        fwd.y = 0
        if (fwd.lengthSq() > 1e-6) facingYaw = Math.atan2(fwd.x, fwd.z)
      }
      // The forward triangle is a floor aid; drop it to the building-local floor
      // under the wall (the ghost Y is up on the wall).
      facingY = 0
      n.set(Math.sin(facingYaw), 0, Math.cos(facingYaw))
    } else {
      n.set(0, 1, 0)
    }
    publishPlacementSurface(ghost.position, n)
    // Which side of the cursor group's local z = 0 plane faces the room (the
    // wall face's grid / tiles sit just off it on that side).
    wallOutwardSignRef.current = Math.cos(facingYaw - ghost.rotation.y) >= 0 ? 1 : -1

    // A wall / ceiling item with no host yet only shows the floor marker.
    if (shape.depth > 0 && !(asset.attachTo && surf === 'floor')) {
      useFacingPose.getState().set({
        position: [ghost.position.x, facingY, ghost.position.z],
        rotationY: facingYaw,
        depth: shape.depth,
        width: shape.width,
        center: shape.center,
      })
    } else {
      useFacingPose.getState().clear()
    }
  })
  useEffect(
    () => () => {
      clearPlacementSurface()
      useFacingPose.getState().clear()
      usePlacementFeedback.getState().setAnchor(null)
    },
    [],
  )

  // inZOI ghost states, toggled per frame: the cyan hologram + white box while
  // the drop is valid; red footprint tiles + a glowing white box when it
  // overlaps; only the floor marker for a wall / ceiling item with no host
  // yet; and for a ceiling item a hologram column down to the floor plus the
  // mount outline on the ceiling.
  const ceilingSignatureRef = useRef('')
  const wallGridSignatureRef = useRef('')
  const wallFrameScratch = useRef({ a: new Vector3(), b: new Vector3(), c: new Vector3() })
  // The host wall's face on the item's side, in the cursor group's frame: the
  // face plane's local z (nudged off it), which way is out of the wall, and
  // the wall's along-length / floor-to-top extent.
  const resolveHostWallFrame = (ghost: Group, draft: ItemNode | null) => {
    const wallId = placementState.current.wallId
    const wall = wallId ? useScene.getState().nodes[wallId as AnyNodeId] : undefined
    const wallMesh = wallId ? sceneRegistry.nodes.get(wallId as AnyNodeId) : undefined
    if (wall?.type !== 'wall' || !wallMesh) return null
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const height = wall.height ?? DEFAULT_WALL_HEIGHT
    const halfT = ((wall.thickness ?? 0.1) / 2) * (draft?.side === 'back' ? -1 : 1)
    const { a, b, c } = wallFrameScratch.current
    ghost.updateWorldMatrix(true, false)
    ghost.worldToLocal(wallMesh.localToWorld(a.set(0, 0, 0)))
    ghost.worldToLocal(wallMesh.localToWorld(b.set(0, 0, halfT)))
    ghost.worldToLocal(wallMesh.localToWorld(c.set(length, height, halfT)))
    const outward: 1 | -1 = b.z >= a.z ? 1 : -1
    return {
      faceZ: b.z + outward * 0.004,
      outward,
      x0: Math.min(b.x, c.x),
      x1: Math.max(b.x, c.x),
      y0: Math.min(b.y, c.y),
      y1: Math.max(b.y, c.y),
    }
  }
  useFrame(() => {
    const ghost = cursorGroupRef.current
    const bounds = ghostBoundsRef.current
    if (!(asset && ghost && bounds)) return
    const surf = placementState.current.surface
    const blocked = usePlacementFeedback.getState().blocked
    const draft = draftNode.current
    const draftMesh = draft ? sceneRegistry.nodes.get(draft.id) : null
    const markerMode = !!asset.attachTo && surf === 'floor'

    if (hologramRef.current) hologramRef.current.visible = !(markerMode || blocked)
    if (edgesRef.current) edgesRef.current.visible = !markerMode
    if (edgesGlowRef.current) edgesGlowRef.current.visible = !markerMode && blocked
    if (modelGhostRef.current) {
      // The draft node already renders the real model; the clone only stands
      // in until it mounts.
      modelGhostRef.current.visible = !markerMode && !draftMesh?.visible
    }
    if (markerRef.current) {
      markerRef.current.visible = markerMode
      // Hostless wall / ceiling previews ride lifted off the floor.
      markerRef.current.position.y = draft ? 0 : -getDetachedAttachmentPreviewLift(asset.attachTo)
    }

    const wallFace = isWallAttach(asset.attachTo) && (surf === 'wall' || surf === 'roof-wall')
    // The cursor sits on the grid-snapped hit point, not on the wall face, so
    // the face planes (drawn with scene depth) are placed on the host wall's
    // real face and clipped to its extent.
    const hostWall = wallFace && surf === 'wall' ? resolveHostWallFrame(ghost, draft) : null
    const faceZ = hostWall?.faceZ ?? wallOutwardSignRef.current * 0.004
    if (basePlaneRef.current) {
      basePlaneRef.current.visible = !markerMode && blocked
      basePlaneRef.current.position.z = wallFace ? faceZ : 0
    }

    const wallGrid = wallGridRef.current
    if (wallGrid) {
      wallGrid.visible = wallFace && !blocked
      if (wallGrid.visible) {
        // The lattice spans the item plus a margin, clipped to the host wall.
        const [w] = bounds.dimensions
        let left = bounds.center[0] - w / 2 - WALL_GRID_MARGIN
        let right = bounds.center[0] + w / 2 + WALL_GRID_MARGIN
        let bottom = bounds.min[1] - WALL_GRID_MARGIN
        let top = bounds.max[1] + WALL_GRID_MARGIN
        if (hostWall) {
          left = Math.max(left, hostWall.x0)
          right = Math.min(right, hostWall.x1)
          bottom = Math.max(bottom, hostWall.y0)
          top = Math.min(top, hostWall.y1)
        } else {
          const levelId = useViewer.getState().selection.levelId
          const levelY = (levelId && sceneRegistry.nodes.get(levelId)?.position.y) || 0
          bottom = Math.max(bottom, levelY - ghost.position.y)
          top = Math.min(top, levelY + DEFAULT_WALL_HEIGHT - ghost.position.y)
        }
        const width = Math.max(right - left, 0.01)
        const height = Math.max(top - bottom, 0.01)
        const signature = [left, right, bottom, top].map((v) => v.toFixed(3)).join(':')
        if (wallGridSignatureRef.current !== signature) {
          wallGridSignatureRef.current = signature
          const size: [number, number] = [width, height]
          const geometry = new PlaneGeometry(...size)
          geometry.translate((left + right) / 2, (top + bottom) / 2, 0)
          wallGrid.geometry.dispose()
          wallGrid.geometry = geometry
          // Keep the lattice registered to the footprint's edges.
          const offset: [number, number] = [
            (left + right) / 2 - bounds.center[0],
            (top + bottom) / 2 - bounds.center[1],
          ]
          ghostMaterials.wallGrid.setSize(size, [w, bounds.dimensions[1]], offset)
        }
        wallGrid.position.z = faceZ + (hostWall?.outward ?? wallOutwardSignRef.current) * 0.002
      }
    }

    const column = ceilingColumnRef.current
    const floorSquare = ceilingFloorRef.current
    const outline = ceilingOutlineRef.current
    const onCeiling = surf === 'ceiling' && !!draft
    if (column && floorSquare && outline) {
      column.visible = onCeiling && !blocked
      floorSquare.visible = onCeiling && !blocked
      outline.visible = onCeiling
      if (onCeiling) {
        const levelId = useViewer.getState().selection.levelId
        const levelY = (levelId && sceneRegistry.nodes.get(levelId)?.position.y) || 0
        const drop = Math.max(ghost.position.y - levelY, 0.01)
        const ceilingY = -gridPosition.current.y
        const [w, , d] = bounds.dimensions
        const [cx, , cz] = bounds.center
        const signature = `${Math.round(drop * 100)}:${w}:${d}:${cx}:${cz}:${ceilingY.toFixed(3)}`
        if (ceilingSignatureRef.current !== signature) {
          ceilingSignatureRef.current = signature
          const columnGeometry = new BoxGeometry(w, drop, d)
          columnGeometry.translate(cx, -drop / 2, cz)
          column.geometry.dispose()
          column.geometry = columnGeometry
          const squareGeometry = new PlaneGeometry(w, d)
          squareGeometry.rotateX(-Math.PI / 2)
          squareGeometry.translate(cx, -drop + 0.01, cz)
          floorSquare.geometry.dispose()
          floorSquare.geometry = squareGeometry
          outline.geometry.dispose()
          outline.geometry = createRectOutlineGeometry(w * 1.3, d * 1.3, cx, cz, ceilingY - 0.005)
        }
      }
    }
  })

  // Anchor the cursor key list beside the ghost's projected screen box
  // (inZOI keeps it glued to the object, never the raw cursor).
  const anchorCorner = useRef(new Vector3())
  useFrame(({ camera, size: rect }) => {
    const ghost = cursorGroupRef.current
    const bounds = ghostBoundsRef.current
    const feedback = usePlacementFeedback.getState()
    if (!(asset && ghost && bounds) || rect.width < 10 || rect.height < 10) {
      ghostScreenBoxRef.current = null
      feedback.setAnchor(null)
      return
    }
    const markerMode = !!asset.attachTo && placementState.current.surface === 'floor'
    const markerY = markerRef.current?.position.y ?? 0
    const min = markerMode ? [-0.16, markerY + 0.2, -0.16] : bounds.min
    const max = markerMode ? [0.16, markerY + 0.46, 0.16] : bounds.max
    let left = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    let visible = false
    const v = anchorCorner.current
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? max[0]! : min[0]!, i & 2 ? max[1]! : min[1]!, i & 4 ? max[2]! : min[2]!)
      v.applyMatrix4(ghost.matrixWorld).project(camera)
      if (v.z > 1) continue
      visible = true
      const x = rect.left + ((v.x + 1) / 2) * rect.width
      const y = rect.top + ((1 - v.y) / 2) * rect.height
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
    ghostScreenBoxRef.current = visible ? { left, right, top, bottom } : null
    feedback.setAnchor(visible ? { left, right, top } : null)
  })

  const isRoomGridActive = useCallback(
    () => !asset?.attachTo && placementState.current.surface === 'floor',
    [asset],
  )

  useFrame(() => {
    if (!asset) {
      reconcileDraftRaycast(null)
      return
    }
    if (!draftNode.current) {
      reconcileDraftRaycast(null)
      return
    }
    const mesh = sceneRegistry.nodes.get(draftNode.current.id) ?? null
    reconcileDraftRaycast(mesh)
    // mitt listeners outlive the cursor group's mount; bail if it's gone
    // (mount/teardown race, #323). Placed after reconcileDraftRaycast so the
    // draft's raycast is still restored during that window.
    if (!cursorGroupRef.current) return
    // The mesh-position lerp below only makes sense once this coordinator
    // owns the move via a 3D pointer event. Skip until then so that
    // external drivers (e.g. the 2D `FloorplanRegistryMoveOverlay`
    // writing scene.position directly) aren't fought by useFrame pulling
    // the mesh back to its pre-move location.
    if (!has3DPointerDrivenMoveRef.current) return
    if (!mesh) return

    // Hide wall/ceiling-attached items when between surfaces (only cursor visible)
    if (asset.attachTo && placementState.current.surface === 'floor') {
      mesh.visible = false
      return
    }
    mesh.visible = true

    if (placementState.current.surface === 'floor') {
      // Track the cursor 1:1. An earlier per-frame lerp (delta*20) made an
      // active move visibly trail the cursor and — combined with React
      // re-renders momentarily pulling the mesh back toward its committed
      // position — read as a laggy snap-back on every move. Copying each frame
      // locks placement/move to the cursor and overrides any stray reset
      // within a single frame, so it feels precise instead of dragging.
      mesh.position.copy(gridPosition.current)

      // Adjust Y for slab elevation (floor items on top of slabs)
      if (!asset.attachTo) {
        const visualPosition = getFloorVisualPosition([
          gridPosition.current.x,
          gridPosition.current.y,
          gridPosition.current.z,
        ])
        mesh.position.y = visualPosition[1]
        cursorGroupRef.current.position.y = visualPosition[1]
      }
    }
  })

  const initialDraft = draftNode.current
  const initialAttachTo = config.asset?.attachTo
  const initialDimensionBounds = expandBoundsToGrid(
    getFallbackPreviewBounds(initialDraft, config.asset, initialAttachTo),
    initialAttachTo,
    gridSnapStep,
  )
  const initialEdgeGeometry = useMemo(
    () => createLineGeometry(getBoxEdgePoints(initialDimensionBounds)),
    [
      initialDimensionBounds.center[0],
      initialDimensionBounds.center[1],
      initialDimensionBounds.center[2],
      initialDimensionBounds.dimensions[0],
      initialDimensionBounds.dimensions[1],
      initialDimensionBounds.dimensions[2],
      initialDimensionBounds,
    ],
  )
  const initialAttachKey = initialAttachTo ?? null
  const initialBoundsKey = [
    ...initialDimensionBounds.min,
    ...initialDimensionBounds.max,
    initialAttachKey,
  ].join(':')
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the bounds values
  const basePlaneGeometry = useMemo(
    () => createFootprintGeometry(initialDimensionBounds, initialAttachTo).geometry,
    [initialBoundsKey],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the bounds values
  const hologramGeometry = useMemo(
    () => createHologramGeometry(initialDimensionBounds),
    [initialBoundsKey],
  )
  const initialWidthGuideGeometry = useMemo(() => createLineGeometry(), [])
  const initialDepthGuideGeometry = useMemo(() => createLineGeometry(), [])
  const initialHeightGuideGeometry = useMemo(() => createLineGeometry(), [])
  const placementGhostScale =
    initialDraft?.scale ?? config.defaultScale ?? ([1, 1, 1] as [number, number, number])
  // The dimension pills only label src-less (box) assets; a model asset's
  // hologram box already reads as its size.
  const showFallbackBounds = !config.asset?.src
  const currentDimensionBounds = dimensionBounds ?? initialDimensionBounds
  // Feed the footprint shape to the per-frame surface publisher, which orients
  // and positions the forward-facing triangle via `useFacingPose`.
  facingShapeRef.current = {
    depth: currentDimensionBounds.dimensions[2],
    width: currentDimensionBounds.dimensions[0],
    center: [currentDimensionBounds.center[0], currentDimensionBounds.center[2]],
  }
  ghostBoundsRef.current = currentDimensionBounds
  const widthLabel = formatLinearMeasurement(currentDimensionBounds.dimensions[0], unit)
  const depthLabel = formatLinearMeasurement(currentDimensionBounds.dimensions[2], unit)
  const heightLabel = formatLinearMeasurement(currentDimensionBounds.dimensions[1], unit)
  const widthLabelPosition: [number, number, number] = [
    currentDimensionBounds.center[0],
    0.04,
    currentDimensionBounds.center[2] + currentDimensionBounds.dimensions[2] / 2 + 0.24,
  ]
  const depthLabelPosition: [number, number, number] = [
    currentDimensionBounds.center[0] + currentDimensionBounds.dimensions[0] / 2 + 0.24,
    0.04,
    currentDimensionBounds.center[2],
  ]
  const heightLabelPosition: [number, number, number] = [
    currentDimensionBounds.center[0] - currentDimensionBounds.dimensions[0] / 2 - 0.24,
    currentDimensionBounds.dimensions[1] / 2,
    currentDimensionBounds.center[2] - currentDimensionBounds.dimensions[2] / 2,
  ]
  const measurementContent = (
    <>
      <lineSegments
        geometry={initialWidthGuideGeometry}
        layers={EDITOR_LAYER}
        material={measurementMaterial}
        ref={measurementWidthRef}
        renderOrder={998}
      />
      <lineSegments
        geometry={initialDepthGuideGeometry}
        layers={EDITOR_LAYER}
        material={measurementMaterial}
        ref={measurementDepthRef}
        renderOrder={998}
      />
      <lineSegments
        geometry={initialHeightGuideGeometry}
        layers={EDITOR_LAYER}
        material={measurementMaterial}
        ref={measurementHeightRef}
        renderOrder={998}
      />
      <Html center position={widthLabelPosition} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.86)',
            border: '1px solid rgba(15, 23, 42, 0.65)',
            borderRadius: '999px',
            color: '#f8fafc',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '11px',
            fontWeight: 600,
            lineHeight: 1,
            padding: '4px 8px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {widthLabel}
        </div>
      </Html>
      <Html center position={depthLabelPosition} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.86)',
            border: '1px solid rgba(15, 23, 42, 0.65)',
            borderRadius: '999px',
            color: '#f8fafc',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '11px',
            fontWeight: 600,
            lineHeight: 1,
            padding: '4px 8px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {depthLabel}
        </div>
      </Html>
      <Html center position={heightLabelPosition} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.86)',
            border: '1px solid rgba(15, 23, 42, 0.65)',
            borderRadius: '999px',
            color: '#f8fafc',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '11px',
            fontWeight: 600,
            lineHeight: 1,
            padding: '4px 8px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {heightLabel}
        </div>
      </Html>
    </>
  )

  return (
    <>
      <group ref={cursorGroupRef}>
        {config.asset && (
          <group ref={modelGhostRef}>
            <PlacementModelGhost asset={config.asset} nodeScale={placementGhostScale} />
          </group>
        )}
        <mesh
          geometry={hologramGeometry}
          layers={EDITOR_LAYER}
          material={ghostMaterials.hologram}
          raycast={NO_RAYCAST}
          ref={hologramRef}
          renderOrder={996}
        />
        <lineSegments
          geometry={initialEdgeGeometry}
          layers={EDITOR_LAYER}
          material={ghostMaterials.edge}
          raycast={NO_RAYCAST}
          ref={edgesRef}
          renderOrder={999}
        />
        <lineSegments
          geometry={initialEdgeGeometry}
          layers={EDITOR_LAYER}
          material={ghostMaterials.edgeGlow}
          raycast={NO_RAYCAST}
          ref={edgesGlowRef}
          renderOrder={999}
          scale={1.012}
          visible={false}
        />
        <mesh
          geometry={basePlaneGeometry}
          layers={GRID_LAYER}
          material={ghostMaterials.footprint}
          raycast={NO_RAYCAST}
          ref={basePlaneRef}
          renderOrder={997}
          visible={false}
        />
        <mesh
          layers={GRID_LAYER}
          material={ghostMaterials.wallGrid}
          raycast={NO_RAYCAST}
          ref={wallGridRef}
          renderOrder={995}
          visible={false}
        />
        <mesh
          layers={EDITOR_LAYER}
          material={ghostMaterials.hologram}
          raycast={NO_RAYCAST}
          ref={ceilingColumnRef}
          renderOrder={996}
          visible={false}
        />
        <mesh
          layers={EDITOR_LAYER}
          material={ghostMaterials.ceilingFloor}
          raycast={NO_RAYCAST}
          ref={ceilingFloorRef}
          renderOrder={996}
          visible={false}
        />
        <lineSegments
          layers={EDITOR_LAYER}
          material={ghostMaterials.ceilingOutline}
          raycast={NO_RAYCAST}
          ref={ceilingOutlineRef}
          renderOrder={999}
          visible={false}
        />
        <PlacementCursorMarker ref={markerRef} visible={false} />
        {showFallbackBounds ? measurementContent : null}
      </group>
      <PlacementRoomGrid isActive={isRoomGridActive} />
    </>
  )
}
