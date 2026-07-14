// @ts-nocheck
import type { Point } from '../types/Point';
import type { Wall } from '../types/Wall';
import type { Room } from '../types/Room';
import type { Door } from '../types/Door';
import type { Window } from '../types/Window';
import { Floorplan } from '../../floorplan/blueprint/floorplan';
import { eventBus } from '../events/EventBus';
import { FloorEvents } from '../events/FloorEvents';

/**
 * BlueprintObjectManager - Adapter that wraps blueprint Floorplan
 * Provides same interface as ObjectManager for backward compatibility
 */
export class BlueprintObjectManager {
  private floorplan: Floorplan;
  private doors: Map<string, Door> = new Map();
  private windows: Map<string, Window> = new Map();
  private detectedRooms: Room[] = []; // Store rooms from RoomDetectionService

  constructor() {
    this.floorplan = new Floorplan();

    // Listen to blueprint events and forward to existing event system
    this.floorplan.fireOnNewCorner((corner) => {
      const point: Point = {
        id: corner.id,
        x: corner.x,
        y: corner.y,
      };
      console.log('[BlueprintObjectManager] Blueprint corner created, emitting POINT_ADDED:', point);
      eventBus.emit(FloorEvents.POINT_ADDED, { point });
    });

    this.floorplan.fireOnNewWall((wall) => {
      const wallData: Wall = {
        id: wall.id,
        startPointId: wall.getStart().id,
        endPointId: wall.getEnd().id,
        thickness: wall.thickness,
        height: wall.height,
      };
      console.log('[BlueprintObjectManager] Blueprint wall created, emitting WALL_ADDED:', wallData);
      eventBus.emit(FloorEvents.WALL_ADDED, { wall: wallData });
    });

    this.floorplan.fireOnUpdatedRooms(() => {
      const rooms = this.getAllRooms();
      rooms.forEach(room => {
        eventBus.emit(FloorEvents.ROOM_DETECTED, { room });
      });
    });
  }

  getFloorplan(): Floorplan {
    return this.floorplan;
  }

  // Point management (maps to blueprint Corner)
  addPoint(point: Point): Point {
    console.log('[BlueprintObjectManager] addPoint called:', point);
    // Use larger tolerance (150mm) to match snap threshold
    // Prevents duplicate corners at same location, especially when zoomed in
    const existing = this.floorplan.overlappedCorner(point.x, point.y, 150);
    if (!existing) {
      const corner = this.floorplan.newCorner(point.x, point.y, point.id);
      console.log('[BlueprintObjectManager] Created corner:', corner.id, 'at', corner.x, corner.y);
      return { id: corner.id, x: corner.x, y: corner.y };
    } else {
      console.log('[BlueprintObjectManager] Using existing corner:', existing.id);
      return { id: existing.id, x: existing.x, y: existing.y };
    }
  }

  // Force add a new point even if one exists at the same location
  // Used for detaching walls from shared corners
  forceAddPoint(point: Point): Point {
    console.log('[BlueprintObjectManager] forceAddPoint called:', point);
    const corner = this.floorplan.newCorner(point.x, point.y, point.id);
    console.log('[BlueprintObjectManager] Force created corner:', corner.id, 'at', corner.x, corner.y);
    return { id: corner.id, x: corner.x, y: corner.y };
  }

  getPoint(id: string): Point | undefined {
    const corner = this.floorplan.getCorners().find(c => c.id === id);
    if (!corner) return undefined;
    return {
      id: corner.id,
      x: corner.x,
      y: corner.y,
    };
  }

  getAllPoints(): Point[] {
    return this.floorplan.getCorners().map(corner => ({
      id: corner.id,
      x: corner.x,
      y: corner.y,
    }));
  }

  updatePoint(id: string, updates: Partial<Point>): void {
    const corner = this.floorplan.getCorners().find(c => c.id === id);
    if (corner && updates.x !== undefined && updates.y !== undefined) {
      corner.moveAbs(updates.x, updates.y);
      eventBus.emit(FloorEvents.POINT_MOVED, {
        point: { id: corner.id, x: corner.x, y: corner.y }
      });
    }
  }

  removePoint(id: string): void {
    const corner = this.floorplan.getCorners().find(c => c.id === id);
    if (corner) {
      corner.removeAll();
      eventBus.emit(FloorEvents.POINT_REMOVED, {
        point: { id, x: corner.x, y: corner.y }
      });
    }
  }

  /**
   * Merge sourcePoint into targetPoint
   * All walls connected to source will be reconnected to target
   * Source point will be removed
   */
  mergePoints(sourceId: string, targetId: string): boolean {
    const corners = this.floorplan.getCorners();
    const source = corners.find(c => c.id === sourceId);
    const target = corners.find(c => c.id === targetId);

    if (!source || !target || source === target) {
      console.log('[BlueprintObjectManager] Cannot merge points:', { sourceId, targetId });
      return false;
    }

    console.log('[BlueprintObjectManager] Merging point', sourceId, 'into', targetId);

    // Get all walls connected to source
    const wallStarts = [...source.getWallStarts()];
    const wallEnds = [...source.getWallEnds()];

    // Reconnect walls that start from source to start from target
    wallStarts.forEach(wall => {
      // Skip if this would create a zero-length wall (wall to itself)
      if (wall.getEnd() === target) {
        wall.remove();
        return;
      }
      // Skip if there's already a wall between target and wall.end (check both directions)
      const existingWall1 = target.wallTo(wall.getEnd());
      const existingWall2 = target.wallFrom(wall.getEnd());
      if (existingWall1 || existingWall2) {
        wall.remove();
        return;
      }
      wall.setStart(target);
    });

    // Reconnect walls that end at source to end at target
    wallEnds.forEach(wall => {
      // Skip if this would create a zero-length wall
      if (wall.getStart() === target) {
        wall.remove();
        return;
      }
      // Skip if there's already a wall between wall.start and target (check both directions)
      const existingWall1 = wall.getStart().wallTo(target);
      const existingWall2 = wall.getStart().wallFrom(target);
      if (existingWall1 || existingWall2) {
        wall.remove();
        return;
      }
      wall.setEnd(target);
    });

    // Remove the source corner (it should have no walls now)
    source.remove();

    // Update floorplan to recalculate rooms
    this.floorplan.update();

    eventBus.emit(FloorEvents.POINT_REMOVED, {
      point: { id: sourceId, x: source.x, y: source.y }
    });

    console.log('[BlueprintObjectManager] Points merged successfully');
    return true;
  }

  // Wall management
  addWall(wall: Wall): void {
    console.log('[BlueprintObjectManager] addWall called:', wall);
    console.log('[BlueprintObjectManager] Available corners:', this.floorplan.getCorners().map(c => c.id));

    const start = this.floorplan.getCorners().find(c => c.id === wall.startPointId);
    const end = this.floorplan.getCorners().find(c => c.id === wall.endPointId);

    console.log('[BlueprintObjectManager] Found corners:', { start: start?.id, end: end?.id });

    if (!start) {
      console.error('[BlueprintObjectManager] Wall start corner not found:', wall.startPointId);
      return;
    }
    if (!end) {
      console.error('[BlueprintObjectManager] Wall end corner not found:', wall.endPointId);
      return;
    }

    const blueprintWall = this.floorplan.newWall(start, end, wall.thickness, wall.height);
    console.log('[BlueprintObjectManager] Created wall:', blueprintWall.id, 'from', start.id, 'to', end.id, 'height:', wall.height);
  }

  getWall(id: string): Wall | undefined {
    const wall = this.floorplan.getWalls().find(w => w.id === id);
    if (!wall) return undefined;
    return {
      id: wall.id,
      startPointId: wall.getStart().id,
      endPointId: wall.getEnd().id,
      thickness: wall.thickness,
      height: wall.height,
    };
  }

  getAllWalls(): Wall[] {
    return this.floorplan.getWalls().map(wall => ({
      id: wall.id,
      startPointId: wall.getStart().id,
      endPointId: wall.getEnd().id,
      thickness: wall.thickness,
      height: wall.height,
    }));
  }

  updateWall(id: string, updates: Partial<Wall>): void {
    const wall = this.floorplan.getWalls().find(w => w.id === id);
    if (wall) {
      if (updates.thickness !== undefined) wall.thickness = updates.thickness;
      if (updates.height !== undefined) wall.height = updates.height;
      wall.fireMoved();
    }
  }

  /**
   * Change a wall's start or end corner to a new corner
   * This detaches the wall from the old corner and attaches to the new one
   */
  changeWallEndpoint(wallId: string, endpoint: 'start' | 'end', newCornerId: string): boolean {
    const wall = this.floorplan.getWalls().find(w => w.id === wallId);
    const newCorner = this.floorplan.getCorners().find(c => c.id === newCornerId);

    if (!wall || !newCorner) {
      console.error('[BlueprintObjectManager] changeWallEndpoint failed: wall or corner not found');
      return false;
    }

    if (endpoint === 'start') {
      wall.setStart(newCorner);
    } else {
      wall.setEnd(newCorner);
    }

    console.log('[BlueprintObjectManager] Changed wall', wallId, endpoint, 'to corner', newCornerId);
    return true;
  }

  removeWall(id: string): void {
    const wall = this.floorplan.getWalls().find(w => w.id === id);
    if (wall) {
      console.log('[BlueprintObjectManager] Removing wall:', id);
      wall.remove();

      // Emit WALL_REMOVED event to update UI
      eventBus.emit(FloorEvents.WALL_REMOVED, { wallId: id });
      console.log('[BlueprintObjectManager] Wall removed event emitted');
    }
  }

  // Room management
  addRoom(room: Room): void {
    // Store room from RoomDetectionService
    this.detectedRooms.push(room);
    console.log('[BlueprintObjectManager] Added detected room:', room.id, 'Total rooms:', this.detectedRooms.length);

    // Emit room added event
    eventBus.emit(FloorEvents.ROOM_DETECTED, { room });
  }

  /**
   * Replace all rooms at once (batch update without intermediate events)
   * This prevents flickering and incorrect intermediate states
   */
  setRooms(rooms: Room[]): void {
    this.detectedRooms = [...rooms];
    console.log('[BlueprintObjectManager] Set', rooms.length, 'rooms (batch update)');
  }

  getRoom(id: string): Room | undefined {
    const rooms = this.getAllRooms();
    return rooms.find(r => r.id === id);
  }

  getAllRooms(): Room[] {
    // Return rooms detected by RoomDetectionService instead of blueprint's auto-detection
    console.log('[BlueprintObjectManager] getAllRooms returning', this.detectedRooms.length, 'detected rooms');
    return this.detectedRooms;

    // OLD: Use blueprint's auto-detected rooms (doesn't handle T-junctions well)
    /*
    return this.floorplan.getRooms().map((room, idx) => {
      const points = room.corners.map(c => c.id);

      // Find walls that connect consecutive corners
      const walls: string[] = [];
      const allWalls = this.floorplan.getWalls();

      for (let i = 0; i < room.corners.length; i++) {
        const curr = room.corners[i];
        const next = room.corners[(i + 1) % room.corners.length];

        // Find wall connecting curr and next
        const wall = allWalls.find(w =>
          (w.getStart().id === curr.id && w.getEnd().id === next.id) ||
          (w.getStart().id === next.id && w.getEnd().id === curr.id)
        );

        if (wall) {
          walls.push(wall.id);
        }
      }

      // Calculate area (mm² -> m²)
      let area = 0;
      if (room.corners.length >= 3) {
        for (let i = 0; i < room.corners.length; i++) {
          const curr = room.corners[i];
          const next = room.corners[(i + 1) % room.corners.length];
          area += curr.x * next.y - next.x * curr.y;
        }
        area = Math.abs(area / 2);
      }
      area = area / 1000000; // mm² to m²

      return {
        id: `room-${idx}`,
        name: `Room ${idx + 1}`,
        points,
        walls,
        area,
      };
    });
    */
  }

  updateRoom(id: string, updates: Partial<Room>): void {
    // Find and update room in detectedRooms
    const room = this.detectedRooms.find(r => r.id === id);
    if (room) {
      Object.assign(room, updates);
      console.log('[BlueprintObjectManager] Room updated:', id, updates);
      eventBus.emit(FloorEvents.ROOM_DETECTED, { rooms: this.detectedRooms });
    }
  }

  removeRoom(id: string): void {
    // Remove room from detectedRooms
    const index = this.detectedRooms.findIndex(r => r.id === id);
    if (index !== -1) {
      this.detectedRooms.splice(index, 1);
      console.log('[BlueprintObjectManager] Removed room:', id, 'Remaining rooms:', this.detectedRooms.length);
    }
  }

  // Door management
  addDoor(door: Door): void {
    console.log('[BlueprintObjectManager] addDoor called:', door);
    this.doors.set(door.id, door);
    eventBus.emit(FloorEvents.DOOR_ADDED, { door });
  }

  getDoor(id: string): Door | undefined {
    return this.doors.get(id);
  }

  getAllDoors(): Door[] {
    return Array.from(this.doors.values());
  }

  updateDoor(id: string, updates: Partial<Door>): void {
    const door = this.doors.get(id);
    if (door) {
      Object.assign(door, updates);
      eventBus.emit(FloorEvents.DOOR_MODIFIED, { door });
    }
  }

  removeDoor(id: string): void {
    const door = this.doors.get(id);
    if (door) {
      this.doors.delete(id);
      eventBus.emit(FloorEvents.DOOR_REMOVED, { door });
    }
  }

  // Window management
  addWindow(window: Window): void {
    console.log('[BlueprintObjectManager] addWindow called:', window);
    this.windows.set(window.id, window);
    eventBus.emit(FloorEvents.WINDOW_ADDED, { window });
  }

  getWindow(id: string): Window | undefined {
    return this.windows.get(id);
  }

  getAllWindows(): Window[] {
    return Array.from(this.windows.values());
  }

  updateWindow(id: string, updates: Partial<Window>): void {
    const window = this.windows.get(id);
    if (window) {
      Object.assign(window, updates);
      eventBus.emit(FloorEvents.WINDOW_MODIFIED, { window });
    }
  }

  removeWindow(id: string): void {
    const window = this.windows.get(id);
    if (window) {
      this.windows.delete(id);
      eventBus.emit(FloorEvents.WINDOW_REMOVED, { window });
    }
  }

  clear(): void {
    const corners = [...this.floorplan.getCorners()];
    const walls = [...this.floorplan.getWalls()];
    corners.forEach(c => c.remove());
    walls.forEach(w => w.remove());
    this.doors.clear();
    this.windows.clear();
  }

  getCounts(): { points: number; walls: number; rooms: number; doors: number; windows: number } {
    return {
      points: this.floorplan.getCorners().length,
      walls: this.floorplan.getWalls().length,
      rooms: this.floorplan.getRooms().length,
      doors: this.doors.size,
      windows: this.windows.size,
    };
  }

  /**
   * Remove duplicate/overlapping walls
   * Walls are duplicates if they connect the same two points (in either direction)
   */
  removeDuplicateWalls(): number {
    const walls = this.floorplan.getWalls();
    const seen = new Map<string, typeof walls[0]>();
    const toRemove: typeof walls[0][] = [];

    walls.forEach(wall => {
      const startId = wall.getStart().id;
      const endId = wall.getEnd().id;

      // Create a canonical key (sorted to handle both directions)
      const key = [startId, endId].sort().join('-');

      if (seen.has(key)) {
        // Duplicate found - mark for removal
        toRemove.push(wall);
        console.log('[BlueprintObjectManager] Found duplicate wall:', wall.id, 'between', startId, 'and', endId);
      } else {
        seen.set(key, wall);
      }
    });

    // Remove duplicates
    toRemove.forEach(wall => {
      wall.remove();
      eventBus.emit(FloorEvents.WALL_REMOVED, { wallId: wall.id });
    });

    if (toRemove.length > 0) {
      console.log('[BlueprintObjectManager] Removed', toRemove.length, 'duplicate walls');
      this.floorplan.update();
    }

    return toRemove.length;
  }

  /**
   * Remove duplicate/overlapping points and merge walls
   * Points are duplicates if they are at the same location (within tolerance)
   */
  removeDuplicatePoints(tolerance: number = 150): number {
    const corners = this.floorplan.getCorners();
    const toMerge: Array<{ source: typeof corners[0], target: typeof corners[0] }> = [];
    const processed = new Set<string>();

    // Find duplicate points
    for (let i = 0; i < corners.length; i++) {
      const corner = corners[i];
      if (!corner || processed.has(corner.id)) continue;

      for (let j = i + 1; j < corners.length; j++) {
        const compareCorner = corners[j];
        if (!compareCorner || processed.has(compareCorner.id)) continue;

        const dx = corner.x - compareCorner.x;
        const dy = corner.y - compareCorner.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < tolerance) {
          console.log('[BlueprintObjectManager] Found duplicate point:', compareCorner.id, 'near', corner.id, 'distance:', dist.toFixed(2));
          toMerge.push({ source: compareCorner, target: corner });
          processed.add(compareCorner.id);
        }
      }
    }

    // Merge duplicates
    let mergedCount = 0;
    toMerge.forEach(({ source, target }) => {
      if (this.mergePoints(source.id, target.id)) {
        mergedCount++;
      }
    });

    if (mergedCount > 0) {
      console.log('[BlueprintObjectManager] Merged', mergedCount, 'duplicate points');
    }

    return mergedCount;
  }

  /**
   * Clean up all duplicates (points and walls)
   */
  cleanupDuplicates(): { points: number, walls: number } {
    console.log('[BlueprintObjectManager] Starting cleanup...');
    const points = this.removeDuplicatePoints();
    const walls = this.removeDuplicateWalls();
    console.log('[BlueprintObjectManager] Cleanup complete:', points, 'points merged,', walls, 'walls removed');
    return { points, walls };
  }
}
