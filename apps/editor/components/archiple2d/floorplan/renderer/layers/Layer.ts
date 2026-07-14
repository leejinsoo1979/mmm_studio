// @ts-nocheck
/**
 * Layer - Base interface for rendering layers
 *
 * Layers are rendered in z-index order:
 * 0. Grid (background)
 * 1. Room fills
 * 2. Walls
 * 3. Points
 * 4. Selection overlay
 * 5. UI elements (measurements, labels)
 */
export interface Layer {
  /**
   * Z-index for rendering order (lower = background)
   */
  readonly zIndex: number;

  /**
   * Layer visibility
   */
  visible: boolean;

  /**
   * Render the layer to canvas
   */
  render(ctx: CanvasRenderingContext2D): void;

  /**
   * Clear layer contents
   */
  clear(): void;

  /**
   * Update layer state (called before render)
   */
  update(): void;

  /**
   * Set layer opacity (0.0 - 1.0)
   */
  setOpacity(opacity: number): void;
}

/**
 * Abstract base class for layers
 */
export abstract class BaseLayer implements Layer {
  public visible = true;
  protected opacity = 1.0;
  public readonly zIndex: number;

  constructor(zIndex: number) {
    this.zIndex = zIndex;
  }

  abstract render(ctx: CanvasRenderingContext2D): void;

  clear(): void {
    // Base implementation does nothing
  }

  update(): void {
    // Base implementation does nothing
  }

  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));
  }

  protected applyOpacity(ctx: CanvasRenderingContext2D): void {
    ctx.globalAlpha = this.opacity;
  }

  protected resetOpacity(ctx: CanvasRenderingContext2D): void {
    ctx.globalAlpha = 1.0;
  }
}
