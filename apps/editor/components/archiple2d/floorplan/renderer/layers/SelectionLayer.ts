// @ts-nocheck
import { BaseLayer } from './Layer';
import type { Point } from '../../../core/types/Point';

export interface SelectionLayerConfig {
  selectionBoxColor?: string;
  selectionBoxFillColor?: string;
  selectionBoxFillOpacity?: number;
}

/**
 * SelectionLayer - Renders selection overlays
 *
 * Features:
 * - Rectangular selection box (drag selection)
 * - Selection bounds visualization
 */
export class SelectionLayer extends BaseLayer {
  private selectionBox: { start: Point; end: Point } | null = null;

  private config: Required<SelectionLayerConfig>;

  constructor(config?: SelectionLayerConfig) {
    super(4); // z-index: 4

    this.config = {
      selectionBoxColor: config?.selectionBoxColor || '#3498db',
      selectionBoxFillColor: config?.selectionBoxFillColor || '#3498db',
      selectionBoxFillOpacity: config?.selectionBoxFillOpacity || 0.1,
    };
  }

  setSelectionBox(start: Point | null, end: Point | null): void {
    if (start && end) {
      this.selectionBox = { start, end };
    } else {
      this.selectionBox = null;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return;

    this.applyOpacity(ctx);

    if (this.selectionBox) {
      this.renderSelectionBox(ctx, this.selectionBox.start, this.selectionBox.end);
    }

    this.resetOpacity(ctx);
  }

  private renderSelectionBox(ctx: CanvasRenderingContext2D, start: Point, end: Point): void {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    ctx.save();

    // Fill
    ctx.fillStyle = this.config.selectionBoxFillColor;
    ctx.globalAlpha = this.config.selectionBoxFillOpacity;
    ctx.fillRect(x, y, width, height);

    // Stroke
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = this.config.selectionBoxColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x, y, width, height);

    ctx.restore();
  }
}
