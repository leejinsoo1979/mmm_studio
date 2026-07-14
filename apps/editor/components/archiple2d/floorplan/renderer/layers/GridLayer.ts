// @ts-nocheck
import { BaseLayer } from './Layer';

export interface GridLayerConfig {
  gridSize: number;
  majorGridSize?: number;
  minorColor?: string;
  majorColor?: string;
  backgroundColor?: string;
}

/**
 * GridLayer - Renders background grid
 *
 * Features:
 * - Minor grid lines (every gridSize pixels)
 * - Major grid lines (every majorGridSize pixels)
 * - Customizable colors
 */
export class GridLayer extends BaseLayer {
  private config: Required<GridLayerConfig>;
  private width = 0;
  private height = 0;

  constructor(config: GridLayerConfig) {
    super(0); // z-index: 0 (background)

    this.config = {
      gridSize: config.gridSize,
      majorGridSize: config.majorGridSize || config.gridSize * 5,
      minorColor: config.minorColor || '#888888',
      majorColor: config.majorColor || '#404040',
      backgroundColor: config.backgroundColor || '#ffffff',
    };
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    console.log('[GridLayer] Size set to:', width, 'x', height);
  }

  updateConfig(config: Partial<GridLayerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      majorGridSize: config.majorGridSize || (config.gridSize ? config.gridSize * 5 : this.config.majorGridSize),
    };
    console.log('[GridLayer] Config updated:', this.config);
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible || this.width === 0 || this.height === 0) {
      if (this.width === 0 || this.height === 0) {
        console.warn('[GridLayer] Skipping render - dimensions not set:', this.width, 'x', this.height);
      }
      return;
    }

    this.applyOpacity(ctx);

    // Get current transform to calculate visible bounds in world space
    const transform = ctx.getTransform();
    const zoom = transform.a; // a = scaleX = zoom
    const invZoom = 1 / zoom;

    // Calculate visible world bounds
    const viewLeft = (-transform.e) * invZoom;
    const viewTop = (-transform.f) * invZoom;
    const viewRight = (this.width - transform.e) * invZoom;
    const viewBottom = (this.height - transform.f) * invZoom;

    // Check current theme for color selection
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

    // Fill background - FULLY OPAQUE, 다크모드 대응
    const margin = Math.max(this.width, this.height) * invZoom;
    ctx.fillStyle = isDarkMode ? '#1e1e1e' : this.config.backgroundColor;
    ctx.fillRect(viewLeft - margin, viewTop - margin, (viewRight - viewLeft) + margin * 2, (viewBottom - viewTop) + margin * 2);

    // Adaptive grid rendering based on zoom level
    // Calculate how many pixels one grid cell occupies on screen
    const minorGridPixels = this.config.gridSize * zoom;
    const majorGridPixels = this.config.majorGridSize * zoom;

    // Theme-aware grid colors
    const minorColor = isDarkMode ? '#555555' : this.config.minorColor;
    const majorColor = isDarkMode ? '#707070' : this.config.majorColor;

    // Only show minor grid if it's large enough to be visible (at least 5 pixels per cell)
    // This prevents grid lines from becoming too dense and flickering
    if (minorGridPixels >= 5) {
      // Adaptive opacity based on zoom - fade out as zoom decreases
      const minorOpacity = Math.min(1.0, Math.max(0.3, (minorGridPixels - 5) / 20));
      // Adaptive line width - thinner when zoomed out
      const minorLineWidth = minorGridPixels < 10 ? 0.5 : 1;

      this.drawGrid(ctx, this.config.gridSize, minorColor, minorLineWidth, viewLeft, viewTop, viewRight, viewBottom, minorOpacity);
    }

    // Always show major grid with adaptive styling
    // Increase opacity and line width when minor grid is hidden
    const majorOpacity = minorGridPixels < 5 ? 1.0 : 0.8;
    const majorLineWidth = minorGridPixels < 5 ? 2 : (majorGridPixels < 20 ? 1.5 : 2);

    this.drawGrid(ctx, this.config.majorGridSize, majorColor, majorLineWidth, viewLeft, viewTop, viewRight, viewBottom, majorOpacity);

    this.resetOpacity(ctx);
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    gridSize: number,
    color: string,
    lineWidth: number,
    viewLeft: number,
    viewTop: number,
    viewRight: number,
    viewBottom: number,
    opacity: number = 1.0
  ): void {
    // Parse color and apply opacity
    const rgb = this.hexToRgb(color);
    ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();

    // Calculate grid start positions (snap to grid)
    const startX = Math.floor(viewLeft / gridSize) * gridSize;
    const startY = Math.floor(viewTop / gridSize) * gridSize;

    // Pixel alignment offset for crisp 1px lines (0.5px offset for odd lineWidth)
    const offset = lineWidth % 2 === 1 ? 0.5 : 0;

    // Vertical lines (draw beyond visible area for smooth panning)
    for (let x = startX; x <= viewRight; x += gridSize) {
      const alignedX = Math.floor(x) + offset;
      ctx.moveTo(alignedX, viewTop);
      ctx.lineTo(alignedX, viewBottom);
    }

    // Horizontal lines (draw beyond visible area for smooth panning)
    for (let y = startY; y <= viewBottom; y += gridSize) {
      const alignedY = Math.floor(y) + offset;
      ctx.moveTo(viewLeft, alignedY);
      ctx.lineTo(viewRight, alignedY);
    }

    ctx.stroke();
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    const [, r, g, b] = result ?? [];
    return r && g && b
      ? {
        r: parseInt(r, 16),
        g: parseInt(g, 16),
        b: parseInt(b, 16),
      }
      : { r: 0, g: 0, b: 0 };
  }
}
