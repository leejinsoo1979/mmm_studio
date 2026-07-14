// @ts-nocheck
import { BaseTool } from './Tool';
import { Vector2 } from '../../core/math/Vector2';
import type { Point } from '../../core/types/Point';
import type { Wall } from '../../core/types/Wall';
import type { Door } from '../../core/types/Door';
import { SceneManager } from '../../core/engine/SceneManager';
import { SnapService } from '../services/SnapService';
import type { SnapGuide } from '../services/SnapService';
import { eventBus } from '../../core/events/EventBus';
import { FloorEvents } from '../../core/events/FloorEvents';

/**
 * SelectTool - Select and drag points or walls to adjust positions
 *
 * Features:
 * - Click on point to select and drag
 * - Click on wall to select and drag (ghost preview, then create new wall)
 * - Snap to vertical/horizontal alignment with other points
 * - Connected walls stretch automatically when wall is moved
 */
export class SelectTool extends BaseTool {
  private sceneManager: SceneManager;
  private snapService: SnapService;

  // Selection and drag state
  private selectedPoint: Point | null = null;
  private selectedWall: Wall | null = null;
  private selectedDoor: Door | null = null;
  private selectedDoorHandle: 'start' | 'end' | 'body' | null = null;
  private isDragging = false;
  private dragStartPos: Vector2 | null = null;

  // Wall drag ghost state - for preview before committing
  private wallDragGhostStart: Vector2 | null = null;
  private wallDragGhostEnd: Vector2 | null = null;
  private originalWallStartPoint: Point | null = null;
  private originalWallEndPoint: Point | null = null;

  // Connected walls for L/U shape dragging
  // Structure: { wall, sharedPointId, otherPointId, originalOtherPoint }
  private connectedWallsInfo: Array<{
    wall: Wall;
    sharedPointId: string;
    otherPointId: string;
    originalOtherPoint: Point;
  }> = [];

  // Hover state
  private hoveredPoint: Point | null = null;
  private hoveredWall: Wall | null = null;

  // Config
  private pointSelectRadius = 200; // 200mm selection radius (easier to click)
  private doorHandleRadius = 300; // 300mm radius for door handle selection
  private doorBodyRadius = 500; // 500mm radius for door body selection

  constructor(sceneManager: SceneManager, snapService: SnapService) {
    super('select');
    this.sceneManager = sceneManager;
    this.snapService = snapService;
  }

  protected onActivate(): void {
    this.resetState();
  }

  protected onDeactivate(): void {
    this.resetState();
  }

  handleMouseDown(position: Vector2, event: MouseEvent): void {
    if (event.button !== 0) return; // Only handle left-click

    const allPoints = this.sceneManager.objectManager.getAllPoints();
    const allDoors = this.sceneManager.objectManager.getAllDoors();
    const allWalls = this.sceneManager.objectManager.getAllWalls();

    // Check for door first (before points)
    const clickedDoor = this.findDoorNear(position, allDoors, allWalls, allPoints);

    if (clickedDoor) {
      // Select door and start dragging
      this.selectedDoor = clickedDoor.door;
      this.selectedDoorHandle = clickedDoor.handle;
      this.selectedPoint = null;
      this.selectedWall = null;
      this.isDragging = true;
      this.dragStartPos = position.clone();

      // Emit door selection via SelectionManager
      this.sceneManager.selectionManager.select(clickedDoor.door.id);
      return;
    }

    // Try to find point near cursor (after doors)
    const clickedPoint = this.findPointNear(position, allPoints);

    if (clickedPoint) {
      // Select point and start dragging
      this.selectedPoint = clickedPoint;
      this.selectedWall = null;
      this.selectedDoor = null;
      this.selectedDoorHandle = null;
      this.isDragging = true;
      this.dragStartPos = position.clone();

      // Emit selection event
      eventBus.emit(FloorEvents.POINT_SELECTED, {
        point: clickedPoint,
      });
      return;
    }

    // No point or door found - try to find wall near cursor
    const clickedWall = this.findWallNear(position, allWalls, allPoints);

    if (clickedWall) {
      // Select wall and start ghost dragging
      this.selectedWall = clickedWall;
      this.selectedPoint = null;
      this.selectedDoor = null;
      this.selectedDoorHandle = null;
      this.isDragging = true;
      this.dragStartPos = position.clone();

      // Store original wall endpoints for ghost preview
      const startPoint = allPoints.find(p => p.id === clickedWall.startPointId);
      const endPoint = allPoints.find(p => p.id === clickedWall.endPointId);
      if (startPoint && endPoint) {
        this.originalWallStartPoint = { ...startPoint };
        this.originalWallEndPoint = { ...endPoint };
        this.wallDragGhostStart = new Vector2(startPoint.x, startPoint.y);
        this.wallDragGhostEnd = new Vector2(endPoint.x, endPoint.y);

        // Find connected walls at both endpoints
        this.connectedWallsInfo = [];
        const wallEndpoints = [
          { pointId: clickedWall.startPointId, point: startPoint },
          { pointId: clickedWall.endPointId, point: endPoint }
        ];

        for (const endpoint of wallEndpoints) {
          // Find walls connected to this endpoint (excluding the selected wall)
          const connectedWalls = allWalls.filter(w =>
            w.id !== clickedWall.id &&
            (w.startPointId === endpoint.pointId || w.endPointId === endpoint.pointId)
          );

          for (const connWall of connectedWalls) {
            const isStartConnected = connWall.startPointId === endpoint.pointId;
            const otherPointId = isStartConnected ? connWall.endPointId : connWall.startPointId;
            const otherPoint = allPoints.find(p => p.id === otherPointId);

            if (otherPoint) {
              this.connectedWallsInfo.push({
                wall: connWall,
                sharedPointId: endpoint.pointId,
                otherPointId: otherPointId,
                originalOtherPoint: { ...otherPoint }
              });
            }
          }
        }
      }

      // Emit wall selection event
      eventBus.emit(FloorEvents.WALL_SELECTED, {
        wall: clickedWall,
      });
      return;
    }

    // Clicked empty space - deselect everything (including doors)
    this.resetState();
    // Clear any door selection to hide FloatingOptionBar
    this.sceneManager.selectionManager.clearSelection();
  }

  handleMouseMove(position: Vector2, _event: MouseEvent): void {
    if (!this.isDragging) {
      // Hover feedback - highlight point or wall under cursor
      const allPoints = this.sceneManager.objectManager.getAllPoints();
      const hoveredPoint = this.findPointNear(position, allPoints);

      if (hoveredPoint) {
        this.hoveredPoint = hoveredPoint;
        this.hoveredWall = null;
        eventBus.emit(FloorEvents.POINT_HOVERED, {
          point: hoveredPoint,
        });
        eventBus.emit(FloorEvents.WALL_HOVER_CLEARED, {});
        return;
      } else {
        this.hoveredPoint = null;
        eventBus.emit(FloorEvents.POINT_HOVER_CLEARED, {});
      }

      // If no point found, check for wall hover
      const allWalls = this.sceneManager.objectManager.getAllWalls();
      const hoveredWall = this.findWallNear(position, allWalls, allPoints);

      if (hoveredWall) {
        this.hoveredWall = hoveredWall;
        eventBus.emit(FloorEvents.WALL_HOVERED, {
          wall: hoveredWall,
        });
      } else {
        this.hoveredWall = null;
        eventBus.emit(FloorEvents.WALL_HOVER_CLEARED, {});
      }
      return;
    }

    // Handle door dragging
    if (this.selectedDoor && this.dragStartPos) {
      const allWalls = this.sceneManager.objectManager.getAllWalls();
      const allPoints = this.sceneManager.objectManager.getAllPoints();
      const wall = allWalls.find(w => w.id === this.selectedDoor!.wallId);

      if (wall) {
        const startPoint = allPoints.find(p => p.id === wall.startPointId);
        const endPoint = allPoints.find(p => p.id === wall.endPointId);

        if (startPoint && endPoint) {
          if (this.selectedDoorHandle === 'body') {
            // Drag door body - move along wall
            const wallStart = new Vector2(startPoint.x, startPoint.y);
            const wallEnd = new Vector2(endPoint.x, endPoint.y);
            const wallVec = wallEnd.subtract(wallStart);
            const wallLength = wallVec.length();

            if (wallLength > 0) {
              // Project mouse position onto wall line
              const toMouse = position.subtract(wallStart);
              const t = Math.max(0, Math.min(1, toMouse.dot(wallVec) / (wallLength * wallLength)));

              // Update door position
              this.sceneManager.objectManager.updateDoor(this.selectedDoor.id, {
                position: t
              });
            }
          } else if (this.selectedDoorHandle === 'start' || this.selectedDoorHandle === 'end') {
            // Drag handle - resize door width
            const wallAngle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
            const doorCenterX = startPoint.x + (endPoint.x - startPoint.x) * this.selectedDoor.position;
            const doorCenterY = startPoint.y + (endPoint.y - startPoint.y) * this.selectedDoor.position;

            // Calculate distance from mouse to door center along wall direction
            const toDoorCenter = new Vector2(doorCenterX - position.x, doorCenterY - position.y);
            const wallDir = new Vector2(Math.cos(wallAngle), Math.sin(wallAngle));
            const distAlongWall = Math.abs(toDoorCenter.dot(wallDir));

            // New width is 2 * distance from center
            let newWidth = distAlongWall * 2;

            // Constrain width
            const minWidth = 400; // 400mm minimum
            const wallLength = Math.sqrt(Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2));
            const maxWidth = wallLength * 0.9; // 90% of wall length

            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

            // Update door width
            this.sceneManager.objectManager.updateDoor(this.selectedDoor.id, {
              width: newWidth
            });
          }
        }
      }
    }
    // Handle point dragging
    else if (this.selectedPoint) {
      // Update snap service with all points except the one being dragged
      const allPoints = this.sceneManager.objectManager.getAllPoints();
      const otherPoints = allPoints.filter((p) => p.id !== this.selectedPoint!.id);
      this.snapService.setPoints(otherPoints);

      // Calculate guides from connected walls
      const guides: SnapGuide[] = [];
      const connectedWallIds = this.selectedPoint.connectedWalls || [];
      const allWalls = this.sceneManager.objectManager.getAllWalls();

      connectedWallIds.forEach(wallId => {
        const wall = allWalls.find(w => w.id === wallId);
        if (wall) {
          // Find the OTHER endpoint of this wall (the one NOT being dragged)
          const otherPointId = wall.startPointId === this.selectedPoint!.id ? wall.endPointId : wall.startPointId;
          const otherPoint = allPoints.find(p => p.id === otherPointId);

          if (otherPoint) {
            const otherVec = new Vector2(otherPoint.x, otherPoint.y);

            // Calculate wall angle
            const dx = this.selectedPoint!.x - otherPoint.x;
            const dy = this.selectedPoint!.y - otherPoint.y;
            const angleRad = Math.atan2(dy, dx);
            const angleDeg = (angleRad * 180) / Math.PI;

            // 1. Extension Guide (keep wall straight)
            guides.push({
              origin: otherVec,
              angle: angleDeg,
              type: 'extension'
            });

            // 2. Perpendicular Guide (90 degrees)
            guides.push({
              origin: otherVec,
              angle: angleDeg + 90,
              type: 'perpendicular'
            });
            guides.push({
              origin: otherVec,
              angle: angleDeg - 90,
              type: 'perpendicular'
            });
          }
        }
      });

      // Try snapping to guides first
      let snappedPos = position;
      const guideSnap = this.snapService.snapToGuides(position, guides);

      if (guideSnap) {
        snappedPos = guideSnap.position;
      } else {
        // Fallback to normal snap
        const snapResult = this.snapService.snap(position);
        snappedPos = snapResult.position;
      }

      // Update point using SceneManager's updatePoint method
      this.sceneManager.objectManager.updatePoint(this.selectedPoint.id, {
        x: snappedPos.x,
        y: snappedPos.y,
      });

      // Check for orthogonal alignment of connected walls and show guides
      this.updateOrthogonalGuides(snappedPos, allPoints, allWalls);
    }
    // Handle wall dragging - ghost preview mode
    else if (this.selectedWall && this.dragStartPos && this.originalWallStartPoint && this.originalWallEndPoint) {
      // Calculate wall direction to determine movement axis
      const wallVec = new Vector2(
        this.originalWallEndPoint.x - this.originalWallStartPoint.x,
        this.originalWallEndPoint.y - this.originalWallStartPoint.y
      );
      const wallLength = wallVec.length();
      if (wallLength < 0.001) return;

      // Determine if wall is more horizontal or vertical
      const isHorizontal = Math.abs(wallVec.x) > Math.abs(wallVec.y);

      // Calculate drag delta - constrain to perpendicular axis (X or Y)
      const dragDelta = new Vector2(
        position.x - this.dragStartPos.x,
        position.y - this.dragStartPos.y
      );

      // Move only on the axis perpendicular to the wall
      // Horizontal wall -> move Y only
      // Vertical wall -> move X only
      let moveX = 0;
      let moveY = 0;

      if (isHorizontal) {
        // Wall is horizontal, move vertically (Y axis)
        moveY = dragDelta.y;
      } else {
        // Wall is vertical, move horizontally (X axis)
        moveX = dragDelta.x;
      }

      // Update main wall ghost positions
      this.wallDragGhostStart = new Vector2(
        this.originalWallStartPoint.x + moveX,
        this.originalWallStartPoint.y + moveY
      );
      this.wallDragGhostEnd = new Vector2(
        this.originalWallEndPoint.x + moveX,
        this.originalWallEndPoint.y + moveY
      );

      // Emit single wall ghost preview (main wall)
      eventBus.emit(FloorEvents.WALL_PREVIEW_UPDATED, {
        start: { x: this.wallDragGhostStart.x, y: this.wallDragGhostStart.y },
        end: { x: this.wallDragGhostEnd.x, y: this.wallDragGhostEnd.y },
        thickness: this.selectedWall.thickness,
      });

      // Build multi-wall preview for connected walls (L/U shape)
      // Connected walls stretch from new shared position to their fixed other end
      if (this.connectedWallsInfo.length > 0) {
        const multiWallPreviews: Array<{ start: Point; end: Point }> = [];

        for (const connInfo of this.connectedWallsInfo) {
          // Determine new position for the shared endpoint
          let newSharedPos: Vector2;
          if (connInfo.sharedPointId === this.originalWallStartPoint!.id) {
            newSharedPos = this.wallDragGhostStart;
          } else {
            newSharedPos = this.wallDragGhostEnd;
          }

          // The other endpoint stays at its original position
          const fixedEnd = connInfo.originalOtherPoint;

          // Determine which is start/end based on original wall orientation
          const isStartShared = connInfo.wall.startPointId === connInfo.sharedPointId;

          if (isStartShared) {
            multiWallPreviews.push({
              start: { x: newSharedPos.x, y: newSharedPos.y } as Point,
              end: { x: fixedEnd.x, y: fixedEnd.y } as Point,
            });
          } else {
            multiWallPreviews.push({
              start: { x: fixedEnd.x, y: fixedEnd.y } as Point,
              end: { x: newSharedPos.x, y: newSharedPos.y } as Point,
            });
          }
        }

        eventBus.emit(FloorEvents.MULTI_WALL_PREVIEW_UPDATED, {
          walls: multiWallPreviews,
        });
      }
    }
  }

  handleMouseUp(position: Vector2, event: MouseEvent): void {
    if (!this.isDragging || event.button !== 0) return;

    // Finalize move
    this.isDragging = false;

    // Clear orthogonal guides when dragging ends
    this.clearOrthogonalGuides();

    if (this.selectedPoint) {
      // Check for nearby point to merge with
      const allPoints = this.sceneManager.objectManager.getAllPoints();
      const otherPoints = allPoints.filter((p) => p.id !== this.selectedPoint!.id);
      const nearbyPoint = this.findPointNear(position, otherPoints);

      if (nearbyPoint) {
        // Merge the dragged point into the nearby point
        const merged = this.sceneManager.objectManager.mergePoints(
          this.selectedPoint.id,
          nearbyPoint.id
        );
        if (merged) {
          // Additional cleanup to ensure no duplicate walls remain
          this.sceneManager.objectManager.cleanupDuplicates();
          this.selectedPoint = null;
          return;
        }
      }

      // Emit final update event for point
      eventBus.emit(FloorEvents.POINT_UPDATED, {
        point: this.selectedPoint,
      });
    } else if (this.selectedWall && this.wallDragGhostStart && this.wallDragGhostEnd) {
      // Clear ghost previews
      eventBus.emit(FloorEvents.WALL_PREVIEW_CLEARED, {});
      eventBus.emit(FloorEvents.MULTI_WALL_PREVIEW_CLEARED, {});

      // Calculate how much the wall moved
      const dx = this.wallDragGhostStart.x - this.originalWallStartPoint!.x;
      const dy = this.wallDragGhostStart.y - this.originalWallStartPoint!.y;
      const movedDistance = Math.sqrt(dx * dx + dy * dy);

      if (movedDistance > 10) {
        // Move BOTH endpoints of the main wall by the same delta
        // This makes connected walls stretch automatically (their other end stays fixed)
        this.sceneManager.objectManager.updatePoint(this.selectedWall.startPointId, {
          x: this.wallDragGhostStart.x,
          y: this.wallDragGhostStart.y,
        });

        this.sceneManager.objectManager.updatePoint(this.selectedWall.endPointId, {
          x: this.wallDragGhostEnd.x,
          y: this.wallDragGhostEnd.y,
        });
      }

      // Reset ghost state
      this.wallDragGhostStart = null;
      this.wallDragGhostEnd = null;
      this.originalWallStartPoint = null;
      this.originalWallEndPoint = null;
      this.connectedWallsInfo = [];
    }

    // Keep selection but stop dragging
  }

  cancel(): void {
    this.resetState();
  }

  handleKeyDown(event: KeyboardEvent): void {
    // Call parent to handle Escape
    super.handleKeyDown(event);

    // Handle Delete and Backspace keys
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedWall) {
        // Delete the selected wall
        this.sceneManager.objectManager.removeWall(this.selectedWall.id);
        this.resetState();
        event.preventDefault();
      } else if (this.selectedPoint) {
        // Delete the selected point
        this.sceneManager.objectManager.removePoint(this.selectedPoint.id);
        this.resetState();
        event.preventDefault();
      }
    }
  }

  /**
   * Find point near cursor position
   */
  private findPointNear(position: Vector2, points: Point[]): Point | null {
    let nearestPoint: Point | null = null;
    let minDistance = this.pointSelectRadius;

    for (const point of points) {
      const pointVec = new Vector2(point.x, point.y);
      const distance = position.distanceTo(pointVec);

      if (distance < minDistance) {
        minDistance = distance;
        nearestPoint = point;
      }
    }

    return nearestPoint;
  }

  /**
   * Find wall near cursor position
   * Uses point-to-line-segment distance calculation
   */
  private findWallNear(position: Vector2, walls: Wall[], points: Point[]): Wall | null {
    let nearestWall: Wall | null = null;
    let minDistance = Infinity;

    for (const wall of walls) {
      // Get wall endpoints
      const startPoint = points.find((p) => p.id === wall.startPointId);
      const endPoint = points.find((p) => p.id === wall.endPointId);

      if (!startPoint || !endPoint) {
        continue;
      }

      // Calculate distance from point to line segment
      const distance = this.pointToLineSegmentDistance(
        position,
        new Vector2(startPoint.x, startPoint.y),
        new Vector2(endPoint.x, endPoint.y)
      );

      // Check if inside wall thickness
      const threshold = wall.thickness / 2;

      if (distance <= threshold) {
        // Find the wall closest to its centerline among those we are inside
        if (distance < minDistance) {
          minDistance = distance;
          nearestWall = wall;
        }
      }
    }

    return nearestWall;
  }

  /**
   * Find door near cursor position
   * Checks handles first, then door body
   */
  private findDoorNear(
    position: Vector2,
    doors: Door[],
    walls: Wall[],
    points: Point[]
  ): { door: Door; handle: 'start' | 'end' | 'body'; distance: number } | null {
    let nearestDoor: Door | null = null;
    let nearestHandle: 'start' | 'end' | 'body' = 'body';
    let minDistance = this.doorHandleRadius;

    // First pass: check for handle clicks
    for (const door of doors) {
      const wall = walls.find(w => w.id === door.wallId);
      if (!wall) continue;

      const startPoint = points.find(p => p.id === wall.startPointId);
      const endPoint = points.find(p => p.id === wall.endPointId);
      if (!startPoint || !endPoint) continue;

      // Calculate door center and endpoints
      const wallX = startPoint.x + (endPoint.x - startPoint.x) * door.position;
      const wallY = startPoint.y + (endPoint.y - startPoint.y) * door.position;
      const wallAngle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
      const halfWidth = door.width / 2;

      const openingStart = new Vector2(
        wallX - Math.cos(wallAngle) * halfWidth,
        wallY - Math.sin(wallAngle) * halfWidth
      );
      const openingEnd = new Vector2(
        wallX + Math.cos(wallAngle) * halfWidth,
        wallY + Math.sin(wallAngle) * halfWidth
      );

      // Check start handle
      const distToStart = position.distanceTo(openingStart);
      if (distToStart < minDistance) {
        minDistance = distToStart;
        nearestDoor = door;
        nearestHandle = 'start';
      }

      // Check end handle
      const distToEnd = position.distanceTo(openingEnd);
      if (distToEnd < minDistance) {
        minDistance = distToEnd;
        nearestDoor = door;
        nearestHandle = 'end';
      }
    }

    // If handle found, return it
    if (nearestDoor) {
      return { door: nearestDoor, handle: nearestHandle, distance: minDistance };
    }

    // Second pass: check for door body clicks
    minDistance = this.doorBodyRadius;

    for (const door of doors) {
      const wall = walls.find(w => w.id === door.wallId);
      if (!wall) continue;

      const startPoint = points.find(p => p.id === wall.startPointId);
      const endPoint = points.find(p => p.id === wall.endPointId);
      if (!startPoint || !endPoint) continue;

      // Calculate door center
      const wallX = startPoint.x + (endPoint.x - startPoint.x) * door.position;
      const wallY = startPoint.y + (endPoint.y - startPoint.y) * door.position;
      const doorCenter = new Vector2(wallX, wallY);

      // Check distance to door center
      const dist = position.distanceTo(doorCenter);
      if (dist < minDistance) {
        minDistance = dist;
        nearestDoor = door;
        nearestHandle = 'body';
      }
    }

    if (nearestDoor) {
      return { door: nearestDoor, handle: nearestHandle, distance: minDistance };
    }

    return null;
  }

  /**
   * Calculate distance from point to line segment
   */
  private pointToLineSegmentDistance(point: Vector2, lineStart: Vector2, lineEnd: Vector2): number {
    // Vector from line start to point
    const px = point.x - lineStart.x;
    const py = point.y - lineStart.y;

    // Vector from line start to line end
    const lx = lineEnd.x - lineStart.x;
    const ly = lineEnd.y - lineStart.y;

    // Line segment length squared
    const lineLengthSq = lx * lx + ly * ly;

    if (lineLengthSq === 0) {
      // Line segment is a point
      return point.distanceTo(lineStart);
    }

    // Project point onto line, clamped to [0, 1] (line segment)
    const t = Math.max(0, Math.min(1, (px * lx + py * ly) / lineLengthSq));

    // Find closest point on line segment
    const closestX = lineStart.x + t * lx;
    const closestY = lineStart.y + t * ly;

    // Return distance from point to closest point
    const dx = point.x - closestX;
    const dy = point.y - closestY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private resetState(): void {
    this.selectedPoint = null;
    this.selectedWall = null;
    this.selectedDoor = null;
    this.selectedDoorHandle = null;
    this.isDragging = false;
    this.dragStartPos = null;
    this.hoveredPoint = null;
    this.hoveredWall = null;

    // Clear wall ghost state
    this.wallDragGhostStart = null;
    this.wallDragGhostEnd = null;
    this.originalWallStartPoint = null;
    this.originalWallEndPoint = null;
    this.connectedWallsInfo = [];

    // Clear ghost previews
    eventBus.emit(FloorEvents.WALL_PREVIEW_CLEARED, {});
    eventBus.emit(FloorEvents.MULTI_WALL_PREVIEW_CLEARED, {});

    // Clear selection and hover events
    eventBus.emit(FloorEvents.POINT_SELECTION_CLEARED, {});
    eventBus.emit(FloorEvents.POINT_HOVER_CLEARED, {});
    eventBus.emit(FloorEvents.WALL_HOVER_CLEARED, {});
  }

  getCursor(): string {
    if (this.isDragging) {
      if (this.selectedWall) {
        return this.getWallCursor(this.selectedWall);
      }
      return 'grabbing';
    } else if (this.hoveredWall) {
      return this.getWallCursor(this.hoveredWall);
    } else if (this.selectedPoint || this.selectedWall || this.hoveredPoint) {
      return 'grab';
    }
    return 'default';
  }

  /**
   * Get cursor based on wall angle
   */
  private getWallCursor(wall: Wall): string {
    const allPoints = this.sceneManager.objectManager.getAllPoints();
    const startPoint = allPoints.find(p => p.id === wall.startPointId);
    const endPoint = allPoints.find(p => p.id === wall.endPointId);

    if (!startPoint || !endPoint) {
      return 'ew-resize';
    }

    // Calculate wall angle in degrees
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);

    // Normalize angle to 0-180 range
    angle = Math.abs(angle);
    if (angle > 90) {
      angle = 180 - angle;
    }

    if (angle <= 22.5) {
      return 'ns-resize'; // Horizontal wall -> vertical drag
    } else if (angle >= 67.5) {
      return 'ew-resize'; // Vertical wall -> horizontal drag
    } else {
      // Diagonal wall
      const originalAngle = Math.atan2(dy, dx) * (180 / Math.PI);
      if ((originalAngle >= -45 && originalAngle < 45) || (originalAngle >= 135 || originalAngle < -135)) {
        return 'nwse-resize';
      } else {
        return 'nesw-resize';
      }
    }
  }

  /**
   * Check if connected walls are orthogonal (vertical/horizontal) and emit guide events
   */
  private updateOrthogonalGuides(currentPos: Vector2, allPoints: Point[], allWalls: Wall[]): void {
    if (!this.selectedPoint) return;

    const ORTHOGONAL_THRESHOLD = 5; // 5mm tolerance for orthogonal detection
    let hasVerticalGuide = false;
    let hasHorizontalGuide = false;

    // Find walls connected to this point by checking wall endpoints directly
    const connectedWalls = allWalls.filter(
      w => w.startPointId === this.selectedPoint!.id || w.endPointId === this.selectedPoint!.id
    );

    for (const wall of connectedWalls) {
      // Find the OTHER endpoint of this wall
      const otherPointId = wall.startPointId === this.selectedPoint.id ? wall.endPointId : wall.startPointId;
      const otherPoint = allPoints.find(p => p.id === otherPointId);

      if (!otherPoint) continue;

      // Calculate difference
      const dx = Math.abs(currentPos.x - otherPoint.x);
      const dy = Math.abs(currentPos.y - otherPoint.y);

      // Check for vertical wall (x coordinates are nearly equal)
      if (dx <= ORTHOGONAL_THRESHOLD && !hasVerticalGuide) {
        hasVerticalGuide = true;
        const guideX = otherPoint.x;

        eventBus.emit(FloorEvents.VERTICAL_GUIDE_UPDATED, {
          x: guideX,
          fromY: -1000000,
          toY: 1000000
        });
      }

      // Check for horizontal wall (y coordinates are nearly equal)
      if (dy <= ORTHOGONAL_THRESHOLD && !hasHorizontalGuide) {
        hasHorizontalGuide = true;
        const guideY = otherPoint.y;

        eventBus.emit(FloorEvents.HORIZONTAL_GUIDE_UPDATED, {
          y: guideY,
          fromX: -1000000,
          toX: 1000000
        });
      }
    }

    // Clear guides that are no longer valid
    if (!hasVerticalGuide) {
      eventBus.emit(FloorEvents.VERTICAL_GUIDE_CLEARED, {});
    }
    if (!hasHorizontalGuide) {
      eventBus.emit(FloorEvents.HORIZONTAL_GUIDE_CLEARED, {});
    }
  }

  /**
   * Clear orthogonal guides when dragging ends
   */
  private clearOrthogonalGuides(): void {
    eventBus.emit(FloorEvents.VERTICAL_GUIDE_CLEARED, {});
    eventBus.emit(FloorEvents.HORIZONTAL_GUIDE_CLEARED, {});
  }
}
