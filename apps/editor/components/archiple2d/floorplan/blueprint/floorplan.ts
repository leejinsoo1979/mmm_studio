// @ts-nocheck
import { CallbackList } from './callbacks';
import { Corner } from './corner';
import { Wall } from './wall';
import { Room } from './room';
import type { RoomTexture } from './room';
import { HalfEdge } from './half_edge';
import { removeValue, cycle, removeIf, isClockwise, hasValue, map, angle2pi } from './utils';

const defaultFloorPlanTolerance = 10.0;

export interface FloorplanData {
  corners: { [id: string]: { x: number; y: number } };
  walls: Array<{
    corner1: string;
    corner2: string;
    frontTexture?: any;
    backTexture?: any;
  }>;
  newFloorTextures: { [uuid: string]: RoomTexture };
}

/**
 * Floorplan - Manages Corners, Walls, and Rooms
 * Automatically detects rooms from closed wall loops
 */
export class Floorplan {
  private corners: Corner[] = [];
  private walls: Wall[] = [];
  private rooms: Room[] = [];

  private newWallCallbacks = new CallbackList<[Wall]>();
  private newCornerCallbacks = new CallbackList<[Corner]>();
  private redrawCallbacks = new CallbackList();
  private updatedRoomsCallbacks = new CallbackList();
  public roomLoadedCallbacks = new CallbackList();

  /**
   * Floor textures owned by floorplan
   * Room objects are destroyed/recreated when floorplan changes
   */
  private floorTextures: { [uuid: string]: RoomTexture } = {};

  constructor() {}

  // Getters
  getCorners(): Corner[] {
    return this.corners;
  }

  getWalls(): Wall[] {
    return this.walls;
  }

  getRooms(): Room[] {
    return this.rooms;
  }

  wallEdges(): HalfEdge[] {
    const edges: HalfEdge[] = [];
    this.walls.forEach(wall => {
      if (wall.frontEdge) edges.push(wall.frontEdge);
      if (wall.backEdge) edges.push(wall.backEdge);
    });
    return edges;
  }

  // Callbacks
  fireOnNewWall(cb: (wall: Wall) => void): void {
    this.newWallCallbacks.add(cb);
  }

  fireOnNewCorner(cb: (corner: Corner) => void): void {
    this.newCornerCallbacks.add(cb);
  }

  fireOnRedraw(cb: () => void): void {
    this.redrawCallbacks.add(cb);
  }

  fireOnUpdatedRooms(cb: () => void): void {
    this.updatedRoomsCallbacks.add(cb);
  }

  // Create elements
  newCorner(x: number, y: number, id?: string): Corner {
    const corner = new Corner(this, x, y, id);
    this.corners.push(corner);
    corner.fireOnDelete(() => this.removeCorner(corner));
    this.newCornerCallbacks.fire(corner);
    return corner;
  }

  newWall(start: Corner, end: Corner, thickness?: number, height?: number): Wall {
    const wall = new Wall(start, end, thickness, height);
    this.walls.push(wall);
    wall.fireOnDelete((w: Wall) => this.removeWall(w));
    this.newWallCallbacks.fire(wall);
    this.update();
    return wall;
  }

  private removeWall(wall: Wall): void {
    removeValue(this.walls, wall);
    this.update();
  }

  private removeCorner(corner: Corner): void {
    removeValue(this.corners, corner);
  }

  // Finding elements
  overlappedCorner(x: number, y: number, tolerance?: number): Corner | null {
    tolerance = tolerance ?? defaultFloorPlanTolerance;
    for (const corner of this.corners) {
      if (corner.distanceFrom(x, y) < tolerance) {
        return corner;
      }
    }
    return null;
  }

  overlappedWall(x: number, y: number, tolerance?: number): Wall | null {
    tolerance = tolerance ?? defaultFloorPlanTolerance;
    for (const wall of this.walls) {
      if (wall.distanceFrom(x, y) < tolerance) {
        return wall;
      }
    }
    return null;
  }

  // Floor textures
  getFloorTexture(uuid: string): RoomTexture | null {
    return this.floorTextures[uuid] || null;
  }

  setFloorTexture(uuid: string, url: string, scale: number): void {
    this.floorTextures[uuid] = { url, scale };
  }

  private updateFloorTextures(): void {
    const uuids = this.rooms.map(room => {
      const ids = room.corners.map(c => c.id);
      ids.sort();
      return ids.join('-');
    });

    // Remove obsolete textures
    for (const uuid in this.floorTextures) {
      if (!hasValue(uuids, uuid)) {
        delete this.floorTextures[uuid];
      }
    }
  }

  // Save/Load
  saveFloorplan(): FloorplanData {
    const data: FloorplanData = {
      corners: {},
      walls: [],
      newFloorTextures: this.floorTextures,
    };

    this.corners.forEach(corner => {
      data.corners[corner.id] = { x: corner.x, y: corner.y };
    });

    this.walls.forEach(wall => {
      data.walls.push({
        corner1: wall.getStart().id,
        corner2: wall.getEnd().id,
        frontTexture: wall.frontTexture,
        backTexture: wall.backTexture,
      });
    });

    return data;
  }

  loadFloorplan(floorplan: FloorplanData): void {
    this.reset();

    if (!floorplan || !floorplan.corners || !floorplan.walls) {
      return;
    }

    const corners: { [id: string]: Corner } = {};
    for (const id in floorplan.corners) {
      const corner = floorplan.corners[id];
      if (!corner) continue;
      corners[id] = this.newCorner(corner.x, corner.y, id);
    }

    floorplan.walls.forEach(wallData => {
      const corner1 = corners[wallData.corner1];
      const corner2 = corners[wallData.corner2];
      if (!(corner1 && corner2)) return;
      const newWall = this.newWall(corner1, corner2);
      if (wallData.frontTexture) {
        newWall.frontTexture = wallData.frontTexture;
      }
      if (wallData.backTexture) {
        newWall.backTexture = wallData.backTexture;
      }
    });

    if (floorplan.newFloorTextures) {
      this.floorTextures = floorplan.newFloorTextures;
    }

    this.update();
    this.roomLoadedCallbacks.fire();
  }

  private reset(): void {
    const tmpCorners = this.corners.slice();
    const tmpWalls = this.walls.slice();
    tmpCorners.forEach(corner => corner.remove());
    tmpWalls.forEach(wall => wall.remove());
    this.corners = [];
    this.walls = [];
  }

  // Room detection
  update(): void {
    console.log('[Floorplan] update() called, corners:', this.corners.length, 'walls:', this.walls.length);

    // Reset wall edges
    this.walls.forEach(wall => wall.resetFrontBack());

    console.log('[Floorplan] Starting findRooms...');
    // Find rooms
    const roomCorners = this.findRooms(this.corners);
    console.log('[Floorplan] findRooms done, found:', roomCorners.length, 'rooms');
    this.rooms = [];
    roomCorners.forEach(corners => {
      this.rooms.push(new Room(this, corners));
    });

    // Assign orphan edges (walls not part of any room)
    this.assignOrphanEdges();

    this.updateFloorTextures();
    this.updatedRoomsCallbacks.fire();
  }

  private assignOrphanEdges(): void {
    // Find orphaned wall segments (not part of rooms) and give them edges
    this.walls.forEach(wall => {
      if (!wall.backEdge && !wall.frontEdge) {
        wall.orphan = true;
        const back = new HalfEdge(null, wall, false);
        back.generatePlane();
        const front = new HalfEdge(null, wall, true);
        front.generatePlane();
      }
    });
  }

  /**
   * Find rooms in the planar straight-line graph
   * Rooms are the smallest (by area) possible cycles
   */
  findRooms(corners: Corner[]): Corner[][] {
    const calculateTheta = (prev: Corner, curr: Corner, next: Corner): number => {
      return angle2pi(
        prev.x - curr.x,
        prev.y - curr.y,
        next.x - curr.x,
        next.y - curr.y
      );
    };

    const removeDuplicateRooms = (roomArray: Corner[][]): Corner[][] => {
      const results: Corner[][] = [];
      const lookup: { [key: string]: boolean } = {};
      const hashFunc = (corner: Corner) => corner.id;
      const sep = '-';

      for (const room of roomArray) {
        let add = true;
        for (let j = 0; j < room.length; j++) {
          const roomShift = cycle(room, j);
          const str = map(roomShift, hashFunc).join(sep);
          if (lookup.hasOwnProperty(str)) {
            add = false;
            break;
          }
        }

        if (add) {
          results.push(room);
          const str = map(room, hashFunc).join(sep);
          lookup[str] = true;
        }
      }

      return results;
    };

    const findTightestCycle = (firstCorner: Corner, secondCorner: Corner): Corner[] => {
      const stack: { corner: Corner; previousCorners: Corner[] }[] = [];
      const visited: { [id: string]: boolean } = {};
      const MAX_ITERATIONS = 10000; // Prevent infinite loops
      let iterations = 0;

      let next: { corner: Corner; previousCorners: Corner[] } | undefined = {
        corner: secondCorner,
        previousCorners: [firstCorner],
      };
      visited[firstCorner.id] = true;

      while (next && iterations < MAX_ITERATIONS) {
        iterations++;
        const currentCorner = next.corner;
        visited[currentCorner.id] = true;

        // Did we make it back to the start corner?
        if (next.corner === firstCorner && currentCorner !== secondCorner) {
          return next.previousCorners;
        }

        const addToStack: Corner[] = [];
        const adjacentCorners = next.corner.adjacentCorners();

        for (const nextCorner of adjacentCorners) {
          // Is this where we came from?
          if (
            nextCorner.id in visited &&
            !(nextCorner === firstCorner && currentCorner !== secondCorner)
          ) {
            continue;
          }
          addToStack.push(nextCorner);
        }

        const previousCorners = next.previousCorners.slice();
        previousCorners.push(currentCorner);

        if (addToStack.length > 1) {
          // Visit the ones with smallest theta first
          const previousCorner = next.previousCorners[next.previousCorners.length - 1];
          if (!previousCorner) continue;
          addToStack.sort(
            (a, b) =>
              calculateTheta(previousCorner, currentCorner, b) -
              calculateTheta(previousCorner, currentCorner, a)
          );
        }

        if (addToStack.length > 0) {
          addToStack.forEach(corner => {
            stack.push({
              corner,
              previousCorners,
            });
          });
        }

        next = stack.pop();
      }

      if (iterations >= MAX_ITERATIONS) {
        console.warn('[Floorplan] findTightestCycle hit max iterations, possible infinite loop');
      }

      return [];
    };

    // Find tightest loops
    const loops: Corner[][] = [];
    corners.forEach(firstCorner => {
      firstCorner.adjacentCorners().forEach(secondCorner => {
        loops.push(findTightestCycle(firstCorner, secondCorner));
      });
    });

    // Remove duplicates
    const uniqueLoops = removeDuplicateRooms(loops);

    // Remove CW loops (keep only CCW)
    const uniqueCCWLoops = removeIf(uniqueLoops, isClockwise);

    return uniqueCCWLoops;
  }

  // Get dimensions
  getCenter(): { x: number; y: number; z: number } {
    return this.getDimensions(true);
  }

  getSize(): { x: number; y: number; z: number } {
    return this.getDimensions(false);
  }

  private getDimensions(center: boolean): { x: number; y: number; z: number } {
    let xMin = Infinity;
    let xMax = -Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;

    this.corners.forEach(corner => {
      if (corner.x < xMin) xMin = corner.x;
      if (corner.x > xMax) xMax = corner.x;
      if (corner.y < zMin) zMin = corner.y;
      if (corner.y > zMax) zMax = corner.y;
    });

    if (xMin === Infinity || xMax === -Infinity || zMin === Infinity || zMax === -Infinity) {
      return { x: 0, y: 0, z: 0 };
    }

    if (center) {
      return {
        x: (xMin + xMax) * 0.5,
        y: 0,
        z: (zMin + zMax) * 0.5,
      };
    } else {
      return {
        x: xMax - xMin,
        y: 0,
        z: zMax - zMin,
      };
    }
  }
}
