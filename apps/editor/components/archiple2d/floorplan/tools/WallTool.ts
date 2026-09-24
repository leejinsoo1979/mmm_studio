// @ts-nocheck
import { FloorplanEditCommand } from '../../core/commands/FloorplanEditCommand'
import type { SceneManager } from '../../core/engine/SceneManager'
import { eventBus } from '../../core/events/EventBus'
import { FloorEvents } from '../../core/events/FloorEvents'
import { Vector2 } from '../../core/math/Vector2'
import type { Point } from '../../core/types/Point'
import { uuidv4 } from '../../core/utils/uuid'
import type { SnapResult, SnapService } from '../services/SnapService'
import { BaseTool } from './Tool'

/**
 * WallTool - Coohom-style wall drawing tool
 *
 * Features:
 * - Click to place start point
 * - Move to preview wall (dashed line)
 * - Click to confirm end point
 * - Continue chain from end point
 * - ESC to cancel
 * - Right-click to finish chain
 * - Advanced snapping (point, grid, angle)
 */
export class WallTool extends BaseTool {
  private sceneManager: SceneManager
  private snapService: SnapService

  // Drawing state. The start of the open segment is plain tool state until a
  // wall is confirmed — cancelling a draft leaves nothing in the drawing.
  private isDrawing = false
  private startPoint: Point | null = null
  private currentPreviewEnd: Vector2 | null = null
  private wallChain: Point[] = []
  private lastMousePosition: Vector2 | null = null

  // Config (units: mm)
  private defaultWallThickness = 100 // 100mm = 10cm
  private defaultWallHeight = 2400 // 2400mm = 2.4m (일반 주거용 천장 높이)

  constructor(sceneManager: SceneManager, snapService: SnapService) {
    super('wall')
    this.sceneManager = sceneManager
    this.snapService = snapService
  }

  /**
   * Update wall thickness setting
   */
  setWallThickness(thickness: number): void {
    this.defaultWallThickness = thickness
  }

  /**
   * Update wall height setting
   */
  setWallHeight(height: number): void {
    this.defaultWallHeight = height
  }

  protected onActivate(): void {
    this.resetState()
  }

  protected onDeactivate(): void {
    this.resetState()
  }

  handleMouseDown(position: Vector2, event: MouseEvent): void {
    this.lastMousePosition = position

    if (event.button === 2) {
      // Right-click: finish chain
      this.resetState()
      return
    }

    if (event.button !== 0) return // Only handle left-click

    // Same snap as the preview for this cursor, so the click confirms
    // exactly the point that was shown.
    const snapResult = this.resolveSnap(position, event.shiftKey)

    if (!this.isDrawing) {
      this.startDrawing(snapResult)
    } else {
      this.confirmWall(snapResult)
    }
  }

  handleMouseMove(position: Vector2, event: MouseEvent): void {
    this.lastMousePosition = position
    this.updatePreview(position, event.shiftKey)
  }

  handleKeyDown(event: KeyboardEvent): void {
    // Call parent to handle Escape key
    super.handleKeyDown(event)

    if (event.key === 'Shift') {
      if (this.lastMousePosition) {
        this.updatePreview(this.lastMousePosition, true)
      }
    }
  }

  handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift') {
      if (this.lastMousePosition) {
        this.updatePreview(this.lastMousePosition, false)
      }
    }
  }

  /**
   * The one snap for both the preview and the click: refreshes the snap
   * inputs (existing points and walls, the open segment's start, the Shift
   * orthogonal lock) and snaps `position`.
   */
  private resolveSnap(position: Vector2, isShiftPressed: boolean): SnapResult {
    const drawingFrom = this.isDrawing ? this.startPoint : null
    const points = this.sceneManager.objectManager.getAllPoints()
    const startIsPending = drawingFrom && !points.some((point) => point.id === drawingFrom.id)
    this.snapService.setPoints(startIsPending ? [...points, drawingFrom] : points)
    this.snapService.setWalls(this.sceneManager.objectManager.getAllWalls())
    this.snapService.updateConfig({ orthogonalSnapEnabled: !!drawingFrom && isShiftPressed })
    this.snapService.setLastPoint(drawingFrom ? new Vector2(drawingFrom.x, drawingFrom.y) : null)
    return this.snapService.snap(position)
  }

  private updatePreview(position: Vector2, isShiftPressed: boolean): void {
    const snapResult = this.resolveSnap(position, isShiftPressed)

    // Emit snap indicator
    if (snapResult.snapPoint) {
      eventBus.emit(FloorEvents.SNAP_POINT_UPDATED, {
        point: snapResult.snapPoint,
      })
    }

    if (!(this.isDrawing && this.startPoint)) return

    // Update preview
    this.currentPreviewEnd = snapResult.position

    // Emit preview event for rendering
    eventBus.emit(FloorEvents.WALL_PREVIEW_UPDATED, {
      start: this.startPoint,
      end: {
        x: this.currentPreviewEnd.x,
        y: this.currentPreviewEnd.y,
        id: 'preview',
      },
    })

    // Emit distance measurement event
    eventBus.emit(FloorEvents.DISTANCE_MEASUREMENT_UPDATED, {
      from: this.startPoint,
      to: {
        x: this.currentPreviewEnd.x,
        y: this.currentPreviewEnd.y,
        id: 'preview',
      },
    })

    // Emit angle measurement event if there's a previous wall
    if (this.wallChain.length >= 2) {
      const prevPoint = this.wallChain[this.wallChain.length - 2]
      const currentPoint = this.wallChain[this.wallChain.length - 1]

      // Calculate angle between previous wall and current preview wall
      const prevDx = currentPoint.x - prevPoint.x
      const prevDy = currentPoint.y - prevPoint.y
      const currentDx = this.currentPreviewEnd.x - currentPoint.x
      const currentDy = this.currentPreviewEnd.y - currentPoint.y

      const prevAngle = Math.atan2(prevDy, prevDx)
      const currentAngle = Math.atan2(currentDy, currentDx)
      let angleDiff = ((currentAngle - prevAngle) * 180) / Math.PI

      // Normalize to -180 to 180 range
      while (angleDiff > 180) angleDiff -= 360
      while (angleDiff < -180) angleDiff += 360

      eventBus.emit(FloorEvents.ANGLE_MEASUREMENT_UPDATED, {
        point: currentPoint,
        angle: angleDiff,
      })
    } else {
      // Clear angle measurement if no previous wall
      eventBus.emit(FloorEvents.ANGLE_MEASUREMENT_CLEARED, {})
    }
  }

  handleMouseUp(_position: Vector2, _event: MouseEvent): void {
    // Wall tool uses click mode, not drag mode
    // Do nothing on mouse up
  }

  cancel(): void {
    this.resetState()

    // Clear snap indicators and guides
    eventBus.emit(FloorEvents.SNAP_POINT_UPDATED, { point: null })
    eventBus.emit(FloorEvents.VERTICAL_GUIDE_CLEARED, {})
    eventBus.emit(FloorEvents.HORIZONTAL_GUIDE_CLEARED, {})
    eventBus.emit(FloorEvents.ANGLE_GUIDE_UPDATED, { from: null, angle: null })
  }

  /**
   * Snapped point as a drawing point: an existing point when the snap locked
   * onto one, otherwise a new (not yet added) point.
   */
  private toDraftPoint(snapResult: SnapResult): Point {
    const snapPoint = snapResult.snapPoint
    const isExisting =
      snapPoint &&
      snapPoint.id !== 'wall-snap-temp' &&
      snapPoint.id !== 'wall-midpoint-snap-temp' &&
      !!this.sceneManager.objectManager.getPoint(snapPoint.id)
    if (isExisting) return { id: snapPoint.id, x: snapPoint.x, y: snapPoint.y }
    return this.createPoint(snapResult.position)
  }

  /**
   * Start drawing a new wall
   */
  private startDrawing(snapResult: SnapResult): void {
    this.startPoint = this.toDraftPoint(snapResult)
    this.wallChain = [this.startPoint]
    this.isDrawing = true
    this.snapService.setLastPoint(new Vector2(this.startPoint.x, this.startPoint.y))
  }

  /**
   * Id of the existing point `point` resolves to on commit
   * (`BlueprintObjectManager.addPoint` merges within 150mm), or null.
   */
  private existingPointId(point: Point): string | null {
    const objectManager = this.sceneManager.objectManager
    if (objectManager.getPoint(point.id)) return point.id
    return objectManager.getFloorplan().overlappedCorner(point.x, point.y, 150)?.id ?? null
  }

  /**
   * Confirm wall and continue chain. The wall, its T-junction splits and any
   * duplicate cleanup are one undo step (FloorplanEditCommand).
   */
  private confirmWall(snapResult: SnapResult): void {
    const start = this.startPoint
    if (!start) return
    const end = this.toDraftPoint(snapResult)
    const objectManager = this.sceneManager.objectManager

    const startId = this.existingPointId(start)
    const endId = this.existingPointId(end)
    // A click on the start itself (e.g. a double click) is not a wall.
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1 || (startId && startId === endId)) return

    const wallsBefore = objectManager.getAllWalls()
    const alreadyWalled =
      !!startId &&
      !!endId &&
      wallsBefore.some(
        (wall) =>
          (wall.startPointId === startId && wall.endPointId === endId) ||
          (wall.startPointId === endId && wall.endPointId === startId),
      )

    let committedEnd: Point = end
    if (!alreadyWalled) {
      this.sceneManager.historyManager.execute(
        new FloorplanEditCommand(objectManager, 'Add wall', () => {
          const startCorner = objectManager.addPoint(start)
          const endCorner = objectManager.addPoint(end)
          objectManager.addWall({
            id: `${startCorner.id}-${endCorner.id}`,
            startPointId: startCorner.id,
            endPointId: endCorner.id,
            thickness: this.defaultWallThickness,
            height: this.defaultWallHeight,
          })
          committedEnd = endCorner
        }),
      )
    }
    // Duplicate cleanup may have merged the end into a neighbouring point.
    committedEnd =
      objectManager.getPoint(committedEnd.id) ??
      (this.existingPointId(committedEnd) &&
        objectManager.getPoint(this.existingPointId(committedEnd))) ??
      committedEnd

    // Clear preview of confirmed wall
    eventBus.emit(FloorEvents.WALL_PREVIEW_CLEARED, {})
    this.currentPreviewEnd = null

    // The loop closes when the segment returns to the chain's first point, or
    // ends on a point already connected back to it by the walls that existed
    // before this segment.
    const firstId = this.existingPointId(this.wallChain[0])
    const closesLoop =
      !!firstId && !!endId && (endId === firstId || this.isConnected(endId, firstId, wallsBefore))
    if (closesLoop) {
      eventBus.emit(FloorEvents.POTENTIAL_ROOM_DETECTED, {
        points: [...this.wallChain, committedEnd],
      })
      this.resetState()
      return
    }

    // Continue chain from end point
    this.startPoint = committedEnd
    this.wallChain.push(committedEnd)
    this.snapService.setLastPoint(new Vector2(committedEnd.x, committedEnd.y))
  }

  /** Whether `fromId` reaches `toId` through `walls` (BFS). */
  private isConnected(
    fromId: string,
    toId: string,
    walls: { startPointId: string; endPointId: string }[],
  ): boolean {
    const visited = new Set([fromId])
    const queue = [fromId]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === toId) return true
      for (const wall of walls) {
        const next =
          wall.startPointId === current
            ? wall.endPointId
            : wall.endPointId === current
              ? wall.startPointId
              : null
        if (next && !visited.has(next)) {
          visited.add(next)
          queue.push(next)
        }
      }
    }
    return false
  }

  /**
   * Reset tool state — drops the open draft (it was never added to the
   * drawing, so nothing needs removing).
   */
  private resetState(): void {
    this.isDrawing = false
    this.startPoint = null
    this.currentPreviewEnd = null
    this.wallChain = []

    eventBus.emit(FloorEvents.WALL_PREVIEW_CLEARED, {})
    eventBus.emit(FloorEvents.DISTANCE_MEASUREMENT_CLEARED, {})
    eventBus.emit(FloorEvents.ANGLE_MEASUREMENT_CLEARED, {})

    this.snapService.setLastPoint(null)
    this.snapService.updateConfig({ orthogonalSnapEnabled: false })
  }

  /**
   * Create a new point
   */
  private createPoint(position: Vector2): Point {
    return {
      id: uuidv4(),
      x: position.x,
      y: position.y,
      connectedWalls: [],
    }
  }

  getCursor(): string {
    return 'crosshair'
  }
}
