// @ts-nocheck
import type { Layer } from '../layers/Layer';
import { Camera2D } from '../Camera2D';

/**
 * Canvas2DRenderer - Main rendering coordinator
 *
 * Features:
 * - Layer-based rendering with z-index sorting
 * - CAD-style camera with zoom/pan
 * - RequestAnimationFrame loop
 * - Performance monitoring
 */
export class Canvas2DRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera2D;
  private layers: Layer[] = [];
  private animationFrameId: number | null = null;
  private isRunning = false;
  private fps = 60;
  private lastFrameTime = 0;

  // Performance tracking
  private frameCount = 0;
  private fpsCounter = 0;
  private lastFpsUpdate = 0;

  // Dirty flag for efficient rendering
  private needsRender = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;

    // Initialize camera with scalePxPerMm = 0.12
    // At 0.12 scale: 1mm = 0.12px (8333mm = 1000px)
    this.camera = new Camera2D(canvas.width, canvas.height, 0.12);

    // Enable smooth rendering
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  /**
   * Add a layer to the renderer
   */
  addLayer(layer: Layer): void {
    this.layers.push(layer);
    this.sortLayers();
  }

  /**
   * Remove a layer from the renderer
   */
  removeLayer(layer: Layer): void {
    const index = this.layers.indexOf(layer);
    if (index !== -1) {
      this.layers.splice(index, 1);
    }
  }

  /**
   * Get all layers
   */
  getLayers(): Layer[] {
    return [...this.layers];
  }

  /**
   * Sort layers by z-index
   */
  private sortLayers(): void {
    this.layers.sort((a, b) => a.zIndex - b.zIndex);
  }

  /**
   * Start the render loop
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.lastFpsUpdate = performance.now();
    this.animationFrameId = requestAnimationFrame(this.renderLoop.bind(this));
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Mark renderer as needing a re-render
   */
  markDirty(): void {
    this.needsRender = true;
  }

  /**
   * Check if renderer needs to render
   */
  isDirty(): boolean {
    return this.needsRender;
  }

  /**
   * Render a single frame
   */
  render(): void {
    // Reset dirty flag
    this.needsRender = false;

    // Clear canvas (physical pixels)
    this.clear();

    this.ctx.save();

    // Apply camera transform (now handles DPI scaling internally)
    this.camera.applyTransform(this.ctx);

    // Update all layers
    this.layers.forEach((layer) => {
      if (layer.visible) {
        layer.update();
      }
    });

    // Render all visible layers in z-index order
    this.layers.forEach((layer) => {
      if (layer.visible) {
        this.ctx.save();
        layer.render(this.ctx);
        this.ctx.restore();
      }
    });

    this.ctx.restore();

    // Reset transform for UI elements (if any were drawn outside the save/restore)
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * Main render loop (60fps capped, only renders when dirty)
   */
  private renderLoop(currentTime: number): void {
    if (!this.isRunning) return;

    // Calculate delta time
    const deltaTime = currentTime - this.lastFrameTime;
    const targetFrameTime = 1000 / this.fps;

    // Throttle to target FPS
    if (deltaTime >= targetFrameTime) {
      this.render();

      this.lastFrameTime = currentTime - (deltaTime % targetFrameTime);
      this.frameCount++;

      // Update FPS counter every second
      if (currentTime - this.lastFpsUpdate >= 1000) {
        this.fpsCounter = this.frameCount;
        this.frameCount = 0;
        this.lastFpsUpdate = currentTime;
      }
    }

    this.animationFrameId = requestAnimationFrame(this.renderLoop.bind(this));
  }

  /**
   * Clear the entire canvas
   */
  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Resize the canvas
   * @param width Logical width (CSS pixels)
   * @param height Logical height (CSS pixels)
   * @param dpr Device Pixel Ratio (default: window.devicePixelRatio)
   */
  resize(width: number, height: number, dpr: number = window.devicePixelRatio || 1): void {
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;

    // Ensure CSS size matches logical size
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    // Update camera size (logical) and DPR
    this.camera.setSize(width, height, dpr);

    // Reset context settings after resize
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    // Mark dirty and trigger render if not running
    this.needsRender = true;
    if (!this.isRunning) {
      this.render();
    }
  }

  /**
   * Get current FPS
   */
  getFPS(): number {
    return this.fpsCounter;
  }

  /**
   * Set target FPS
   */
  setFPS(fps: number): void {
    this.fps = Math.max(1, Math.min(144, fps));
  }

  /**
   * Get canvas context
   */
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * Get canvas element
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Get camera
   */
  getCamera(): Camera2D {
    return this.camera;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.layers.forEach((layer) => layer.clear());
    this.layers = [];
  }
}
