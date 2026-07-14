// @ts-nocheck
import { CallbackList } from './callbacks';
import { angle, distance } from './utils';
import type { Room } from './room';
import type { Wall } from './wall';
import type { WallTexture } from './wall';

/**
 * HalfEdge - Represents one side of a wall
 * Created by Room for interior walls
 */
export class HalfEdge {
  next: HalfEdge | null = null;
  prev: HalfEdge | null = null;
  offset: number;
  height: number;

  redrawCallbacks = new CallbackList();
  wall: Wall;
  private front: boolean;

  constructor(
    _room: Room | null,
    wall: Wall,
    front: boolean
  ) {
    this.wall = wall;
    this.front = front;
    this.offset = wall.thickness / 2;
    this.height = wall.height;

    if (front) {
      wall.frontEdge = this;
    } else {
      wall.backEdge = this;
    }
  }

  getTexture(): WallTexture {
    return this.front ? this.wall.frontTexture : this.wall.backTexture;
  }

  setTexture(textureUrl: string, textureStretch: boolean, textureScale: number): void {
    const texture = {
      url: textureUrl,
      stretch: textureStretch,
      scale: textureScale,
    };

    if (this.front) {
      this.wall.frontTexture = texture;
    } else {
      this.wall.backTexture = texture;
    }

    this.redrawCallbacks.fire();
  }

  generatePlane(): void {
    // Placeholder for 3D plane generation
    // Will be implemented when connecting to Babylon
  }

  interiorDistance(): number {
    const start = this.interiorStart();
    const end = this.interiorEnd();
    return distance(start.x, start.y, end.x, end.y);
  }

  distanceTo(x: number, y: number): number {
    return this.wall.distanceFrom(x, y);
  }

  private getStart() {
    return this.front ? this.wall.getStart() : this.wall.getEnd();
  }

  private getEnd() {
    return this.front ? this.wall.getEnd() : this.wall.getStart();
  }

  interiorEnd(): { x: number; y: number } {
    const vec = this.halfAngleVector(this, this.next);
    const end = this.getEnd();
    return {
      x: end.x + vec.x,
      y: end.y + vec.y,
    };
  }

  interiorStart(): { x: number; y: number } {
    const vec = this.halfAngleVector(this.prev, this);
    const start = this.getStart();
    return {
      x: start.x + vec.x,
      y: start.y + vec.y,
    };
  }

  interiorCenter(): { x: number; y: number } {
    const start = this.interiorStart();
    const end = this.interiorEnd();
    return {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
  }

  exteriorEnd(): { x: number; y: number } {
    const vec = this.halfAngleVector(this, this.next);
    const end = this.getEnd();
    return {
      x: end.x - vec.x,
      y: end.y - vec.y,
    };
  }

  exteriorStart(): { x: number; y: number } {
    const vec = this.halfAngleVector(this.prev, this);
    const start = this.getStart();
    return {
      x: start.x - vec.x,
      y: start.y - vec.y,
    };
  }

  corners(): { x: number; y: number }[] {
    return [
      this.interiorStart(),
      this.interiorEnd(),
      this.exteriorEnd(),
      this.exteriorStart(),
    ];
  }

  /**
   * Gets CCW angle from v1 to v2
   */
  private halfAngleVector(
    v1: HalfEdge | null,
    v2: HalfEdge | null
  ): { x: number; y: number } {
    // Handle missing prev or next
    let v1startX: number, v1startY: number, v1endX: number, v1endY: number;
    let v2startX: number, v2startY: number, v2endX: number, v2endY: number;

    if (!v1) {
      v1startX = v2!.getStart().x - (v2!.getEnd().x - v2!.getStart().x);
      v1startY = v2!.getStart().y - (v2!.getEnd().y - v2!.getStart().y);
      v1endX = v2!.getStart().x;
      v1endY = v2!.getStart().y;
    } else {
      v1startX = v1.getStart().x;
      v1startY = v1.getStart().y;
      v1endX = v1.getEnd().x;
      v1endY = v1.getEnd().y;
    }

    if (!v2) {
      v2startX = v1!.getEnd().x;
      v2startY = v1!.getEnd().y;
      v2endX = v1!.getEnd().x + (v1!.getEnd().x - v1!.getStart().x);
      v2endY = v1!.getEnd().y + (v1!.getEnd().y - v1!.getStart().y);
    } else {
      v2startX = v2.getStart().x;
      v2startY = v2.getStart().y;
      v2endX = v2.getEnd().x;
      v2endY = v2.getEnd().y;
    }

    // CCW angle between edges
    const theta = angle(
      v1startX - v1endX,
      v1startY - v1endY,
      v2endX - v1endX,
      v2endY - v1endY
    );

    // Normalize theta to [0, 2π]
    const normalizedTheta = theta < 0 ? theta + 2 * Math.PI : theta;

    // Cosine and sine of half angle
    const cs = Math.cos(normalizedTheta / 2);
    const sn = Math.sin(normalizedTheta / 2);

    // Rotate v2
    const v2dx = v2endX - v2startX;
    const v2dy = v2endY - v2startY;

    const vx = v2dx * cs - v2dy * sn;
    const vy = v2dx * sn + v2dy * cs;

    // Normalize
    const mag = distance(0, 0, vx, vy);
    const desiredMag = this.offset / sn;
    const scalar = desiredMag / mag;

    return {
      x: vx * scalar,
      y: vy * scalar,
    };
  }
}
