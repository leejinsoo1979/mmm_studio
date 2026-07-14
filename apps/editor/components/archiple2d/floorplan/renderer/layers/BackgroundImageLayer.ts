// @ts-nocheck
import { BaseLayer } from './Layer';

/**
 * Background image layer for displaying uploaded floor plan images
 *
 * Coordinate system:
 * - Image pixels are converted to world coordinates (mm)
 * - Scale factor determines mm per pixel (default: 1.0mm/px)
 * - Image is centered at origin (0, 0) by default
 */
export class BackgroundImageLayer extends BaseLayer {
  private image: HTMLImageElement | null = null;
  private pixelToMm: number = 100; // Default: 100mm per pixel
  private offsetX: number = 0; // World coordinates (mm)
  private offsetY: number = 0; // World coordinates (mm)
  private imageOpacity: number = 0.5;

  constructor() {
    super(-1); // z-index: -1 (below grid)
  }

  setImage(image: HTMLImageElement | null): void {
    this.image = image;
  }

  /**
   * Set scale as mm per pixel
   * e.g., scale=100 means 1 pixel = 100mm
   */
  setScale(scale: number): void {
    this.pixelToMm = Math.max(10, Math.min(1000, scale));
  }

  setOffset(x: number, y: number): void {
    this.offsetX = x;
    this.offsetY = y;
  }

  setImageOpacity(opacity: number): void {
    this.imageOpacity = Math.max(0, Math.min(1, opacity));
  }

  getScale(): number {
    return this.pixelToMm;
  }

  getImageOpacity(): number {
    return this.imageOpacity;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.image || !this.visible) return;

    ctx.save();

    // Set opacity
    ctx.globalAlpha = this.imageOpacity;

    // Convert image pixel dimensions to world coordinates (mm)
    const widthInMm = this.image.width * this.pixelToMm;
    const heightInMm = this.image.height * this.pixelToMm;

    // Center image at origin by default, with optional offset
    const x = -widthInMm / 2 + this.offsetX;
    const y = -heightInMm / 2 + this.offsetY;

    // Draw image in world coordinates
    // The camera transform is already applied by Canvas2DRenderer
    ctx.drawImage(this.image, x, y, widthInMm, heightInMm);

    ctx.restore();
  }
}
