// @ts-nocheck
import { CallbackList } from './callbacks';
import type { Corner } from './corner';
import type { HalfEdge } from './half_edge';
import { distance, pointDistanceFromLine } from './utils';

export interface WallTexture {
  url: string;
  stretch: boolean;
  scale: number;
}

const defaultWallTexture: WallTexture = {
  url: '',
  stretch: true,
  scale: 0,
};

/**
 * Wall - Basic element to create Rooms
 * Consists of two half edges
 */
export class Wall {
  id: string;
  frontEdge: HalfEdge | null = null;
  backEdge: HalfEdge | null = null;
  orphan = false;

  frontTexture: WallTexture = { ...defaultWallTexture };
  backTexture: WallTexture = { ...defaultWallTexture };

  thickness: number; // mm
  height: number; // mm

  private movedCallbacks = new CallbackList();
  private deletedCallbacks = new CallbackList<[Wall]>();
  private actionCallbacks = new CallbackList<[string]>();
  private start: Corner;
  private end: Corner;

  constructor(
    start: Corner,
    end: Corner,
    thickness = 200,
    height = 2800
  ) {
    this.start = start;
    this.end = end;
    this.id = this.getUuid();
    this.thickness = thickness;
    this.height = height;

    this.start.addWallStart(this);
    this.end.addWallEnd(this);
  }

  private getUuid(): string {
    return [this.start.id, this.end.id].join('-');
  }

  resetFrontBack(): void {
    this.frontEdge = null;
    this.backEdge = null;
    this.orphan = false;
  }

  fireOnMove(cb: () => void): void {
    this.movedCallbacks.add(cb);
  }

  fireOnDelete(cb: (wall: Wall) => void): void {
    this.deletedCallbacks.add(cb);
  }

  dontFireOnDelete(cb: (wall: Wall) => void): void {
    this.deletedCallbacks.remove(cb);
  }

  fireOnAction(cb: (action: string) => void): void {
    this.actionCallbacks.add(cb);
  }

  fireAction(action: string): void {
    this.actionCallbacks.fire(action);
  }

  relativeMove(dx: number, dy: number): void {
    this.start.relativeMove(dx, dy);
    this.end.relativeMove(dx, dy);
  }

  fireMoved(): void {
    this.movedCallbacks.fire();
  }

  fireRedraw(): void {
    this.frontEdge?.redrawCallbacks.fire();
    this.backEdge?.redrawCallbacks.fire();
  }

  getStart(): Corner {
    return this.start;
  }

  getEnd(): Corner {
    return this.end;
  }

  remove(): void {
    this.start.detachWall(this);
    this.end.detachWall(this);
    this.deletedCallbacks.fire(this);
  }

  setStart(corner: Corner): void {
    this.start.detachWall(this);
    corner.addWallStart(this);
    this.start = corner;
    this.fireMoved();
  }

  setEnd(corner: Corner): void {
    this.end.detachWall(this);
    corner.addWallEnd(this);
    this.end = corner;
    this.fireMoved();
  }

  distanceFrom(x: number, y: number): number {
    return pointDistanceFromLine(
      x,
      y,
      this.start.x,
      this.start.y,
      this.end.x,
      this.end.y
    );
  }

  getLength(): number {
    return distance(this.start.x, this.start.y, this.end.x, this.end.y);
  }

  oppositeCorner(corner: Corner): Corner | null {
    if (this.start === corner) {
      return this.end;
    } else if (this.end === corner) {
      return this.start;
    }
    console.error('Wall does not connect to corner');
    return null;
  }
}
