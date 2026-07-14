// @ts-nocheck
import { BaseTool } from './Tool';
import { Vector2 } from '../../core/math/Vector2';
import type { Wall } from '../../core/types/Wall';
import type { Door } from '../../core/types/Door';
import type { Point } from '../../core/types/Point';
import { SceneManager } from '../../core/engine/SceneManager';
import { eventBus } from '../../core/events/EventBus';
import { FloorEvents } from '../../core/events/FloorEvents';
import { uuidv4 } from '../../core/utils/uuid';
import { DEFAULT_DOOR } from '../../core/types/Door';

/**
 * DoorTool - Place doors on walls
 *
 * Features:
 * - Click on wall to place door
 * - Preview door position while hovering
 * - Drag along wall to adjust position
 */
export class DoorTool extends BaseTool {
  private sceneManager: SceneManager;

  // Preview state
  private hoveredWall: Wall | null = null;
  private previewPosition: number = 0.5; // 0-1 position along wall

  // Config
  private wallHoverDistance = 100; // 100mm hover detection radius

  constructor(sceneManager: SceneManager) {
    super('door');
    this.sceneManager = sceneManager;
  }

  protected onActivate(): void {
    console.log('[DoorTool] Activated');
    this.resetState();
  }

  protected onDeactivate(): void {
    console.log('[DoorTool] Deactivated');
    this.resetState();
  }

  handleMouseDown(_position: Vector2, event: MouseEvent): void {
    if (event.button !== 0) return; // Only handle left-click

    if (this.hoveredWall) {
      // Place door on hovered wall
      this.placeDoor(this.hoveredWall, this.previewPosition);
    }
  }

  handleMouseMove(position: Vector2, _event: MouseEvent): void {
    // Find nearest wall
    const walls = this.sceneManager.objectManager.getAllWalls();
    const points = this.sceneManager.objectManager.getAllPoints();

    const result = this.findNearestWall(position, walls, points);

    if (result) {
      this.hoveredWall = result.wall;
      this.previewPosition = result.position;

      // Emit door preview event
      eventBus.emit(FloorEvents.DOOR_PREVIEW_UPDATED, {
        wall: result.wall,
        position: result.position,
        width: DEFAULT_DOOR.width,
        height: DEFAULT_DOOR.height,
      });
    } else {
      this.hoveredWall = null;
      eventBus.emit(FloorEvents.DOOR_PREVIEW_CLEARED, {});
    }
  }

  handleMouseUp(_position: Vector2, _event: MouseEvent): void {
    // Door tool uses click mode, not drag mode
  }

  cancel(): void {
    console.log('[DoorTool] Cancelled');
    this.resetState();
    eventBus.emit(FloorEvents.DOOR_PREVIEW_CLEARED, {});
  }

  /**
   * Find nearest wall to cursor position
   */
  private findNearestWall(
    position: Vector2,
    walls: Wall[],
    points: Point[]
  ): { wall: Wall; position: number; distance: number } | null {
    let nearestWall: Wall | null = null;
    let nearestPosition = 0.5;
    let minDistance = this.wallHoverDistance;

    const pointMap = new Map(points.map(p => [p.id, p]));

    for (const wall of walls) {
      const startPoint = pointMap.get(wall.startPointId);
      const endPoint = pointMap.get(wall.endPointId);

      if (!startPoint || !endPoint) continue;

      const start = new Vector2(startPoint.x, startPoint.y);
      const end = new Vector2(endPoint.x, endPoint.y);

      // Calculate closest point on wall line segment
      const wallVec = end.subtract(start);
      const wallLength = wallVec.length();

      if (wallLength === 0) continue;

      const toMouse = position.subtract(start);
      const t = Math.max(0, Math.min(1, toMouse.dot(wallVec) / (wallLength * wallLength)));

      const closestPoint = start.add(wallVec.multiply(t));
      const distance = position.distanceTo(closestPoint);

      if (distance < minDistance) {
        minDistance = distance;
        nearestWall = wall;
        nearestPosition = t;
      }
    }

    if (nearestWall) {
      return {
        wall: nearestWall,
        position: nearestPosition,
        distance: minDistance,
      };
    }

    return null;
  }

  /**
   * Place door on wall
   */
  private placeDoor(wall: Wall, position: number): void {
    const door: Door = {
      id: uuidv4(),
      wallId: wall.id,
      position,
      width: DEFAULT_DOOR.width,
      height: DEFAULT_DOOR.height,
      swing: DEFAULT_DOOR.swing,
      thickness: DEFAULT_DOOR.thickness,
    };

    this.sceneManager.objectManager.addDoor(door);
    console.log('[DoorTool] Door placed:', door);

    // Select the placed door to show option bar
    this.sceneManager.selectionManager.select(door.id);

    // Clear preview after placing
    eventBus.emit(FloorEvents.DOOR_PREVIEW_CLEARED, {});
  }

  private resetState(): void {
    this.hoveredWall = null;
    this.previewPosition = 0.5;
  }

  getCursor(): string {
    return this.hoveredWall ? 'crosshair' : 'default';
  }
}
