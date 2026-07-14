// @ts-nocheck
import { CallbackList } from './callbacks';
import { HalfEdge } from './half_edge';
import type { Corner } from './corner';
import type { Floorplan } from './floorplan';

export interface RoomTexture {
  url: string;
  scale: number;
}

const defaultRoomTexture: RoomTexture = {
  url: '',
  scale: 400,
};

/**
 * Room - Combination of a Floorplan with a floor plane
 * Automatically detected from closed wall loops
 */
export class Room {
  interiorCorners: { x: number; y: number }[] = [];
  private edgePointer: HalfEdge | null = null;
  private floorChangeCallbacks = new CallbackList();
  private floorplan: Floorplan;
  corners: Corner[];

  constructor(
    floorplan: Floorplan,
    corners: Corner[]
  ) {
    this.floorplan = floorplan;
    this.corners = corners;
    this.updateWalls();
    this.updateInteriorCorners();
  }

  private getUuid(): string {
    const cornerIds = this.corners.map(c => c.id);
    cornerIds.sort();
    return cornerIds.join('-');
  }

  fireOnFloorChange(cb: () => void): void {
    this.floorChangeCallbacks.add(cb);
  }

  getTexture(): RoomTexture {
    const uuid = this.getUuid();
    const tex = this.floorplan.getFloorTexture(uuid);
    return tex || defaultRoomTexture;
  }

  setTexture(textureUrl: string, textureScale: number): void {
    const uuid = this.getUuid();
    this.floorplan.setFloorTexture(uuid, textureUrl, textureScale);
    this.floorChangeCallbacks.fire();
  }

  private updateInteriorCorners(): void {
    this.interiorCorners = [];
    if (!this.edgePointer) return;

    let edge = this.edgePointer;
    do {
      this.interiorCorners.push(edge.interiorStart());
      edge.generatePlane();
      edge = edge.next!;
    } while (edge && edge !== this.edgePointer);
  }

  /**
   * Populates each wall's half edge relating to this room
   * Creates a doubly connected edge list (DCEL)
   */
  private updateWalls(): void {
    let prevEdge: HalfEdge | null = null;
    let firstEdge: HalfEdge | null = null;

    for (let i = 0; i < this.corners.length; i++) {
      const firstCorner = this.corners[i];
      const secondCorner = this.corners[(i + 1) % this.corners.length];
      if (!(firstCorner && secondCorner)) continue;

      // Find if wall is heading in that direction
      const wallTo = firstCorner.wallTo(secondCorner);
      const wallFrom = firstCorner.wallFrom(secondCorner);

      let edge: HalfEdge;
      if (wallTo) {
        edge = new HalfEdge(this, wallTo, true);
      } else if (wallFrom) {
        edge = new HalfEdge(this, wallFrom, false);
      } else {
        console.error('Corners are not connected by a wall');
        continue;
      }

      if (i === 0) {
        firstEdge = edge;
      } else {
        edge.prev = prevEdge;
        if (prevEdge) prevEdge.next = edge;

        if (i + 1 === this.corners.length && firstEdge) {
          firstEdge.prev = edge;
          edge.next = firstEdge;
        }
      }

      prevEdge = edge;
    }

    // Hold on to an edge reference
    this.edgePointer = firstEdge;
  }
}
