// @ts-nocheck
import { Vector2 } from '../../core/math/Vector2';

/**
 * Tool - Base interface for all drawing tools
 *
 * All tools follow the same lifecycle:
 * 1. activate() - Tool becomes active
 * 2. handleMouseDown/Move/Up - User interaction
 * 3. deactivate() - Tool is deactivated
 */
export interface Tool {
  /**
   * Tool identifier
   */
  readonly name: string;

  /**
   * Tool is currently active
   */
  readonly isActive: boolean;

  /**
   * Activate the tool
   */
  activate(): void;

  /**
   * Deactivate the tool
   */
  deactivate(): void;

  /**
   * Handle mouse down event
   */
  handleMouseDown(position: Vector2, event: MouseEvent): void;

  /**
   * Handle mouse move event
   */
  handleMouseMove(position: Vector2, event: MouseEvent): void;

  /**
   * Handle mouse up event
   */
  handleMouseUp(position: Vector2, event: MouseEvent): void;

  /**
   * Handle key down event
   */
  handleKeyDown(event: KeyboardEvent): void;

  /**
   * Handle key up event
   */
  handleKeyUp(event: KeyboardEvent): void;

  /**
   * Cancel current operation (ESC key)
   */
  cancel(): void;

  /**
   * Get cursor style for this tool
   */
  getCursor(): string;
}

/**
 * BaseTool - Abstract base class for tools
 */
export abstract class BaseTool implements Tool {
  protected _isActive = false;
  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  activate(): void {
    this._isActive = true;
    this.onActivate();
  }

  deactivate(): void {
    this._isActive = false;
    this.onDeactivate();
  }

  protected onActivate(): void {
    // Override in subclass
  }

  protected onDeactivate(): void {
    // Override in subclass
  }

  abstract handleMouseDown(position: Vector2, event: MouseEvent): void;
  abstract handleMouseMove(position: Vector2, event: MouseEvent): void;
  abstract handleMouseUp(position: Vector2, event: MouseEvent): void;

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    }
  }

  handleKeyUp(_event: KeyboardEvent): void {
    // Override in subclass if needed
  }

  cancel(): void {
    // Override in subclass
  }

  getCursor(): string {
    return 'crosshair';
  }
}
