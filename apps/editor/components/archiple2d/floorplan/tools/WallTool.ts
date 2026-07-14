// @ts-nocheck
import { AddWallCommand } from '../../core/commands/AddWallCommand'
import type { SceneManager } from '../../core/engine/SceneManager'
import { eventBus } from '../../core/events/EventBus'
import { FloorEvents } from '../../core/events/FloorEvents'
import { Vector2 } from '../../core/math/Vector2'
import type { Point } from '../../core/types/Point'
import type { Wall } from '../../core/types/Wall'
import { uuidv4 } from '../../core/utils/uuid'
import type { SnapService } from '../services/SnapService'
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

  // Drawing state
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
    console.log('[WallTool] Activated')
    this.resetState()
  }

  protected onDeactivate(): void {
    console.log('[WallTool] Deactivated')
    this.finishChain()
    this.resetState()
  }

  handleMouseDown(position: Vector2, event: MouseEvent): void {
    this.lastMousePosition = position

    if (event.button === 2) {
      // Right-click: finish chain
      this.finishChain()
      return
    }

    if (event.button !== 0) return // Only handle left-click

    // Snap position
    const snapResult = this.snapService.snap(position)
    const snappedPos = snapResult.position

    if (!this.isDrawing) {
      // First click - start new wall
      this.startDrawing(snappedPos, snapResult.snapPoint)
    } else {
      // Subsequent clicks - confirm wall and continue
      this.confirmWall(snappedPos, snapResult.snapPoint)
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

  private updatePreview(position: Vector2, isShiftPressed: boolean): void {
    const hasActiveStart = this.isDrawing && !!this.startPoint

    // Update snap service with all existing points and walls
    this.snapService.setPoints(this.sceneManager.objectManager.getAllPoints())
    this.snapService.setWalls(this.sceneManager.objectManager.getAllWalls())

    // Enable orthogonal snap only when Shift key is pressed
    this.snapService.updateConfig({
      orthogonalSnapEnabled: hasActiveStart && isShiftPressed,
    })

    if (hasActiveStart && this.startPoint) {
      this.snapService.setLastPoint(new Vector2(this.startPoint.x, this.startPoint.y))
    } else {
      this.snapService.setLastPoint(null)
    }

    // Always update snap indicator
    const snapResult = this.snapService.snap(position)

    // Emit snap indicator
    if (snapResult.snapPoint) {
      eventBus.emit(FloorEvents.SNAP_POINT_UPDATED, {
        point: snapResult.snapPoint,
      })
    }

    if (!hasActiveStart || !this.startPoint) return

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
    console.log('[WallTool] Cancelled')
    this.finishChain()
    this.resetState()

    // Clear preview
    eventBus.emit(FloorEvents.WALL_PREVIEW_CLEARED, {})

    // Clear snap indicators and guides
    eventBus.emit(FloorEvents.SNAP_POINT_UPDATED, { point: null })
    eventBus.emit(FloorEvents.VERTICAL_GUIDE_CLEARED, {})
    eventBus.emit(FloorEvents.HORIZONTAL_GUIDE_CLEARED, {})
    eventBus.emit(FloorEvents.ANGLE_GUIDE_UPDATED, { from: null, angle: null })
  }

  /**
   * Start drawing a new wall
   */
  private startDrawing(position: Vector2, existingPoint?: Point): void {
    console.log('[WallTool] Start drawing at', position)

    // Use existing point or create new one
    // Check if existingPoint is a temporary wall snap point
    if (
      existingPoint &&
      existingPoint.id !== 'wall-snap-temp' &&
      existingPoint.id !== 'wall-midpoint-snap-temp'
    ) {
      this.startPoint = existingPoint
    } else {
      // Create new point (either no existing point or wall snap temp point)
      const tempPoint = this.createPoint(position)
      this.startPoint = this.sceneManager.objectManager.addPoint(tempPoint)
    }

    this.wallChain.push(this.startPoint)
    this.isDrawing = true

    // Update snap service
    this.snapService.setLastPoint(position)
    this.snapService.setPoints(this.sceneManager.objectManager.getAllPoints())
    this.snapService.setWalls(this.sceneManager.objectManager.getAllWalls())

    // NOTE: POINT_ADDED event is emitted by BlueprintObjectManager, no need to emit here
  }

  /**
   * Confirm wall and continue chain
   * Rooms are detected when loops are closed (either directly or through existing walls)
   */
  private confirmWall(position: Vector2, existingPoint?: Point): void {
    if (!this.startPoint) return

    console.log('[WallTool] Confirm wall to', position)

    // Create or reuse end point
    let endPoint: Point
    let isNewPointOnExistingWall = false
    let existingWallAtPoint: Wall | null = null

    // Check if existingPoint is a temporary wall snap point
    if (
      existingPoint &&
      existingPoint.id !== 'wall-snap-temp' &&
      existingPoint.id !== 'wall-midpoint-snap-temp'
    ) {
      endPoint = existingPoint
    } else {
      // Create new point (either no existing point or wall snap temp point)
      const tempPoint = this.createPoint(position)
      endPoint = this.sceneManager.objectManager.addPoint(tempPoint)

      // If this was a midpoint snap, find which wall it's on
      if (existingPoint && existingPoint.id === 'wall-midpoint-snap-temp') {
        isNewPointOnExistingWall = true
        // Find the wall that this midpoint is on
        const allWalls = this.sceneManager.objectManager.getAllWalls()
        existingWallAtPoint = this.findWallAtPoint(position, allWalls)
      }
      // NOTE: POINT_ADDED event is emitted by BlueprintObjectManager, no need to emit here
    }

    // NO WALL SPLITTING - Walls connect at midpoints without splitting the existing wall
    // The T-junction rendering is handled by WallLayer's corner calculation

    // If point was created on existing wall's midpoint, add connection to that wall
    if (isNewPointOnExistingWall && existingWallAtPoint) {
      if (!endPoint.connectedWalls) endPoint.connectedWalls = []
      endPoint.connectedWalls.push(existingWallAtPoint.id)
      console.log('[WallTool] Connected new point to existing wall at midpoint')
    }

    // Create wall and execute through command pattern for undo/redo support
    const wall = this.createWall(this.startPoint, endPoint)
    const command = new AddWallCommand(
      wall,
      this.startPoint,
      endPoint,
      this.sceneManager.objectManager,
    )
    this.sceneManager.historyManager.execute(command)
    // NOTE: WALL_ADDED event is emitted by BlueprintObjectManager via command execution

    // Clear preview of confirmed wall
    eventBus.emit(FloorEvents.WALL_PREVIEW_CLEARED, {})
    this.currentPreviewEnd = null

    // Check if closing loop - ENHANCED LOGIC
    // Important: Check with wallChain.length >= 2 because after adding 2 walls (3 points),
    // we can close a loop by connecting to an existing wall
    let isClosingLoop = false
    let loopPoints: Point[] = []

    if (this.wallChain.length >= 2) {
      const firstPoint = this.wallChain[0]

      console.log('[WallTool] Checking loop closure:', {
        wallChainLength: this.wallChain.length,
        endPointId: endPoint.id,
        firstPointId: firstPoint.id,
        endPointConnections: endPoint.connectedWalls?.length || 0,
      })

      // Direct closure - clicking on the first point
      if (endPoint.id === firstPoint.id) {
        isClosingLoop = true
        loopPoints = [...this.wallChain]
        console.log('[WallTool] Direct loop closure detected')
      }
      // Smart closure - connecting to any existing point that has a path back to first point
      // The newly created wall is already in connectedWalls thanks to createWall()
      else if (endPoint.connectedWalls && endPoint.connectedWalls.length > 0) {
        console.log('[WallTool] Searching for path from', endPoint.id, 'to', firstPoint.id)
        const pathToStart = this.findPathBetweenPoints(endPoint, firstPoint)
        console.log(
          '[WallTool] Path result:',
          pathToStart?.map((p) => p.id),
        )

        if (pathToStart && pathToStart.length > 0) {
          isClosingLoop = true
          // Combine wallChain with the path back to start (excluding duplicate endPoint)
          loopPoints = [...this.wallChain, ...pathToStart.slice(1)]
          console.log('[WallTool] Smart loop closure detected through existing walls')
        }
      }
    }

    if (isClosingLoop) {
      console.log('[WallTool] Loop closed with', loopPoints.length, 'points')

      // Reset state
      this.wallChain = []
      this.isDrawing = false
      this.startPoint = null
      this.snapService.setLastPoint(null)
      this.snapService.updateConfig({ orthogonalSnapEnabled: false })

      // Emit potential room with all points in the closed loop
      eventBus.emit(FloorEvents.POTENTIAL_ROOM_DETECTED, {
        points: loopPoints,
      })
      return
    }

    // Continue chain from end point
    this.startPoint = endPoint
    this.wallChain.push(endPoint)

    // Update snap service
    this.snapService.setLastPoint(position)
    this.snapService.setPoints(this.sceneManager.objectManager.getAllPoints())
    this.snapService.setWalls(this.sceneManager.objectManager.getAllWalls())
  }

  /**
   * Find which wall a point is on (for midpoint connections)
   */
  private findWallAtPoint(position: Vector2, walls: Wall[]): Wall | null {
    const allPoints = this.sceneManager.objectManager.getAllPoints()
    const pointMap = new Map(allPoints.map((p) => [p.id, p]))

    for (const wall of walls) {
      const startPt = pointMap.get(wall.startPointId)
      const endPt = pointMap.get(wall.endPointId)
      if (!startPt || !endPt) continue

      // Check if position is at midpoint of this wall
      const midX = (startPt.x + endPt.x) / 2
      const midY = (startPt.y + endPt.y) / 2
      const distance = Math.sqrt((position.x - midX) ** 2 + (position.y - midY) ** 2)

      // Within 10mm tolerance
      if (distance < 10) {
        return wall
      }
    }

    return null
  }

  /**
   * Find path between two points through existing walls (BFS)
   * Returns array of points forming the path, or null if no path exists
   */
  private findPathBetweenPoints(from: Point, to: Point): Point[] | null {
    if (from.id === to.id) return [from]

    const visited = new Set<string>()
    const queue: { point: Point; path: Point[] }[] = []

    // Start BFS from 'from' point
    queue.push({ point: from, path: [from] })
    visited.add(from.id)

    while (queue.length > 0) {
      const { point, path } = queue.shift()!

      // Get all walls connected to this point
      const connectedWalls = point.connectedWalls || []

      for (const wallId of connectedWalls) {
        // Get the wall object
        const walls = this.sceneManager.objectManager.getAllWalls()
        const wall = walls.find((w) => w.id === wallId)
        if (!wall) continue

        // Find the other point in this wall
        const otherPointId = wall.startPointId === point.id ? wall.endPointId : wall.startPointId

        // Skip if already visited
        if (visited.has(otherPointId)) continue

        // Get the other point
        const allPoints = this.sceneManager.objectManager.getAllPoints()
        const otherPoint = allPoints.find((p) => p.id === otherPointId)
        if (!otherPoint) continue

        // Check if we reached the target
        if (otherPoint.id === to.id) {
          return [...path, otherPoint]
        }

        // Add to queue for further exploration
        visited.add(otherPoint.id)
        queue.push({ point: otherPoint, path: [...path, otherPoint] })
      }
    }

    // No path found
    return null
  }

  /**
   * Finish wall chain
   * Rooms are detected automatically when walls form closed loops
   */
  private finishChain(): void {
    if (this.wallChain.length === 0) return

    console.log('[WallTool] Finished chain with', this.wallChain.length, 'points')

    // Check if we formed a closed loop
    if (this.wallChain.length >= 3) {
      const firstPoint = this.wallChain[0]
      const lastPoint = this.wallChain[this.wallChain.length - 1]

      if (firstPoint.id === lastPoint.id) {
        // Closed loop detected - trigger room detection
        console.log('[WallTool] Closed loop detected, triggering room detection')
        eventBus.emit(FloorEvents.POTENTIAL_ROOM_DETECTED, {
          points: this.wallChain,
        })
      }
    }

    this.wallChain = []
    this.isDrawing = false
    this.startPoint = null

    this.snapService.setLastPoint(null)
    this.snapService.updateConfig({ orthogonalSnapEnabled: false })
  }

  /**
   * Reset tool state
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

  /**
   * Create a new wall
   */
  private createWall(startPoint: Point, endPoint: Point): Wall {
    const wall: Wall = {
      id: uuidv4(),
      startPointId: startPoint.id,
      endPointId: endPoint.id,
      thickness: this.defaultWallThickness,
      height: this.defaultWallHeight,
    }

    // Update point connections
    if (!startPoint.connectedWalls) startPoint.connectedWalls = []
    if (!endPoint.connectedWalls) endPoint.connectedWalls = []

    startPoint.connectedWalls.push(wall.id)
    endPoint.connectedWalls.push(wall.id)

    return wall
  }

  getCursor(): string {
    return 'crosshair'
  }
}
