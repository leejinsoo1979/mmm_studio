// @ts-nocheck
import type { Point } from '../types/Point';
import type { Wall } from '../types/Wall';
import type { Room } from '../types/Room';
import { eventBus } from '../events/EventBus';
import { FloorEvents } from '../events/FloorEvents';

/**
 * ObjectManager - Manages floorplan objects (points, walls, rooms)
 */
export class ObjectManager {
  private points: Map<string, Point> = new Map();
  private walls: Map<string, Wall> = new Map();
  private rooms: Map<string, Room> = new Map();

  /**
   * Point management
   */
  addPoint(point: Point): void {
    this.points.set(point.id, point);
    eventBus.emit(FloorEvents.POINT_ADDED, { point });
  }

  getPoint(id: string): Point | undefined {
    return this.points.get(id);
  }

  getAllPoints(): Point[] {
    return Array.from(this.points.values());
  }

  updatePoint(id: string, updates: Partial<Point>): void {
    const point = this.points.get(id);
    if (point) {
      Object.assign(point, updates);
      eventBus.emit(FloorEvents.POINT_MOVED, { point });
    }
  }

  removePoint(id: string): void {
    const point = this.points.get(id);
    if (point) {
      this.points.delete(id);
      eventBus.emit(FloorEvents.POINT_REMOVED, { point });
    }
  }

  /**
   * Merge sourcePoint into targetPoint
   * All walls connected to source will be reconnected to target
   * Source point will be removed
   */
  mergePoints(sourceId: string, targetId: string): boolean {
    const source = this.points.get(sourceId);
    const target = this.points.get(targetId);

    if (!source || !target || source === target) {
      return false;
    }

    // Update all walls connected to source to connect to target instead
    this.getAllWalls().forEach(wall => {
      if (wall.startPointId === sourceId) {
        // Check for zero-length or duplicate wall
        if (wall.endPointId === targetId) {
          this.removeWall(wall.id);
        } else {
          this.updateWall(wall.id, { startPointId: targetId });
        }
      }
      if (wall.endPointId === sourceId) {
        if (wall.startPointId === targetId) {
          this.removeWall(wall.id);
        } else {
          this.updateWall(wall.id, { endPointId: targetId });
        }
      }
    });

    // Remove source point
    this.removePoint(sourceId);

    return true;
  }

  /**
   * Wall management
   */
  addWall(wall: Wall): void {
    this.walls.set(wall.id, wall);
    eventBus.emit(FloorEvents.WALL_ADDED, { wall });
  }

  getWall(id: string): Wall | undefined {
    return this.walls.get(id);
  }

  getAllWalls(): Wall[] {
    return Array.from(this.walls.values());
  }

  updateWall(id: string, updates: Partial<Wall>): void {
    const wall = this.walls.get(id);
    if (wall) {
      Object.assign(wall, updates);
      eventBus.emit(FloorEvents.WALL_MODIFIED, { wall });
    }
  }

  removeWall(id: string): void {
    const wall = this.walls.get(id);
    if (wall) {
      this.walls.delete(id);
      eventBus.emit(FloorEvents.WALL_REMOVED, { wall });
    }
  }

  /**
   * Room management
   */
  addRoom(room: Room): void {
    this.rooms.set(room.id, room);
    eventBus.emit(FloorEvents.ROOM_CREATED, { room });
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  updateRoom(id: string, updates: Partial<Room>): void {
    const room = this.rooms.get(id);
    if (room) {
      Object.assign(room, updates);
      eventBus.emit(FloorEvents.ROOM_MODIFIED, { room });
    }
  }

  removeRoom(id: string): void {
    const room = this.rooms.get(id);
    if (room) {
      this.rooms.delete(id);
      eventBus.emit(FloorEvents.ROOM_REMOVED, { room });
    }
  }

  /**
   * Utility methods
   */
  getWallsConnectedToPoint(pointId: string): Wall[] {
    return this.getAllWalls().filter(
      wall => wall.startPointId === pointId || wall.endPointId === pointId
    );
  }

  getRoomsContainingWall(wallId: string): Room[] {
    return this.getAllRooms().filter(room => room.walls.includes(wallId));
  }

  clear(): void {
    this.points.clear();
    this.walls.clear();
    this.rooms.clear();
    eventBus.emit(FloorEvents.FLOORPLAN_CLEARED, {});
  }

  /**
   * Get object by ID (any type)
   */
  getObject(id: string): Point | Wall | Room | undefined {
    return this.points.get(id) || this.walls.get(id) || this.rooms.get(id);
  }

  /**
   * Get counts
   */
  getCounts(): { points: number; walls: number; rooms: number } {
    return {
      points: this.points.size,
      walls: this.walls.size,
      rooms: this.rooms.size,
    };
  }
}
