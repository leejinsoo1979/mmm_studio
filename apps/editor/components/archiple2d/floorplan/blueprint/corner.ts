// @ts-nocheck
import { CallbackList } from './callbacks';
import { guid, distance } from './utils';
import type { Wall } from './wall';
import type { Floorplan } from './floorplan';

const SNAP_TOLERANCE = 20; // mm

export class Corner {
  id: string;
  x: number;
  y: number;

  private wallStarts: Wall[] = [];
  private wallEnds: Wall[] = [];

  private movedCallbacks = new CallbackList<[Corner]>();
  private deletedCallbacks = new CallbackList<[Corner]>();
  private actionCallbacks = new CallbackList<[string]>();

  constructor(_floorplan: Floorplan, x: number, y: number, id?: string) {
    this.id = id ?? guid();
    this.x = x;
    this.y = y;
  }

  fireOnMove(cb: (corner: Corner) => void): void {
    this.movedCallbacks.add(cb);
  }

  fireOnDelete(cb: (corner: Corner) => void): void {
    this.deletedCallbacks.add(cb);
  }

  fireOnAction(cb: (action: string) => void): void {
    this.actionCallbacks.add(cb);
  }

  moveAbs(newX: number, newY: number): void {
    this.x = newX;
    this.y = newY;

    // Snap to axis if close to adjacent corners
    this.snapToAxis(SNAP_TOLERANCE);
    this.mergeWithIntersected();

    this.movedCallbacks.fire(this);

    this.wallStarts.forEach(w => w.fireMoved());
    this.wallEnds.forEach(w => w.fireMoved());
  }

  relativeMove(dx: number, dy: number): void {
    this.moveAbs(this.x + dx, this.y + dy);
  }

  remove(): void {
    this.deletedCallbacks.fire(this);
  }

  removeAll(): void {
    [...this.wallStarts, ...this.wallEnds].forEach(wall => wall.remove());
    this.remove();
  }

  snapToAxis(tolerance: number): { x: boolean; y: boolean } {
    const snapped = { x: false, y: false };

    this.adjacentCorners().forEach(corner => {
      if (Math.abs(corner.x - this.x) < tolerance) {
        this.x = corner.x;
        snapped.x = true;
      }
      if (Math.abs(corner.y - this.y) < tolerance) {
        this.y = corner.y;
        snapped.y = true;
      }
    });

    return snapped;
  }

  adjacentCorners(): Corner[] {
    const neighbours: Corner[] = [];
    this.wallStarts.forEach(w => neighbours.push(w.getEnd()));
    this.wallEnds.forEach(w => neighbours.push(w.getStart()));
    return neighbours;
  }

  wallTo(corner: Corner): Wall | null {
    for (const wall of this.wallStarts) {
      if (wall.getEnd() === corner) return wall;
    }
    return null;
  }

  wallFrom(corner: Corner): Wall | null {
    for (const wall of this.wallEnds) {
      if (wall.getStart() === corner) return wall;
    }
    return null;
  }

  distanceFrom(x: number, y: number): number {
    return distance(x, y, this.x, this.y);
  }

  distanceFromWall(wall: Wall): number {
    return wall.distanceFrom(this.x, this.y);
  }

  detachWall(wall: Wall): void {
    this.removeWall(this.wallStarts, wall);
    this.removeWall(this.wallEnds, wall);
  }

  addWallStart(wall: Wall): void {
    if (!this.wallStarts.includes(wall)) {
      this.wallStarts.push(wall);
    }
  }

  addWallEnd(wall: Wall): void {
    if (!this.wallEnds.includes(wall)) {
      this.wallEnds.push(wall);
    }
  }

  getWallStarts(): Wall[] {
    return this.wallStarts;
  }

  getWallEnds(): Wall[] {
    return this.wallEnds;
  }

  private mergeWithIntersected(): void {
    // TODO: port blueprint merge logic (detect other corners occupying same spot)
  }

  private removeWall(collection: Wall[], wall: Wall): void {
    const idx = collection.indexOf(wall);
    if (idx >= 0) collection.splice(idx, 1);
  }
}
