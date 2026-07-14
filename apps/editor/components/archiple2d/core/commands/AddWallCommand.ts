// @ts-nocheck
import { Command } from './Command';
import type { Wall } from '../types/Wall';
import type { Point } from '../types/Point';
import type { BlueprintObjectManager } from '../engine/BlueprintObjectManager';

/**
 * AddWallCommand - Command to add a wall to the floorplan
 */
export class AddWallCommand extends Command {
  private wall: Wall;
  private startPoint: Point;
  private endPoint: Point;
  private objectManager: BlueprintObjectManager;

  constructor(
    wall: Wall,
    startPoint: Point,
    endPoint: Point,
    objectManager: BlueprintObjectManager
  ) {
    super();
    this.wall = wall;
    this.startPoint = startPoint;
    this.endPoint = endPoint;
    this.objectManager = objectManager;
  }

  execute(): void {
    if (!this.canExecute()) return;

    console.log('[AddWallCommand] Executing - adding wall:', this.wall.id);

    // Add points and wall through objectManager
    this.objectManager.addPoint(this.startPoint);
    this.objectManager.addPoint(this.endPoint);
    this.objectManager.addWall(this.wall);

    this.markExecuted();
    console.log('[AddWallCommand] Execute completed');
  }

  undo(): void {
    if (!this.canUndo()) return;

    console.log('[AddWallCommand] Undoing - removing wall:', this.wall.id);

    // Remove wall
    this.objectManager.removeWall(this.wall.id);

    // Note: Points will be cleaned up by objectManager if they have no connections

    this.markUndone();
    console.log('[AddWallCommand] Undo completed');
  }

  getDescription(): string {
    return `Add wall from (${this.startPoint.x}, ${this.startPoint.y}) to (${this.endPoint.x}, ${this.endPoint.y})`;
  }
}
