// @ts-nocheck
import { eventBus } from '../events/EventBus';
import { EditorEvents } from '../events/EditorEvents';

/**
 * SelectionManager - Manages object selection state
 */
export class SelectionManager {
  private selectedIds: Set<string> = new Set();
  private hoveredId: string | null = null;

  /**
   * Select an object
   */
  select(id: string, addToSelection: boolean = false): void {
    if (!addToSelection) {
      this.clearSelection();
    }

    if (!this.selectedIds.has(id)) {
      this.selectedIds.add(id);
      eventBus.emit(EditorEvents.OBJECT_SELECTED, { id });
      eventBus.emit(EditorEvents.SELECTION_CHANGED, {
        selected: Array.from(this.selectedIds),
      });
    }
  }

  /**
   * Select multiple objects
   */
  selectMultiple(ids: string[]): void {
    this.clearSelection();
    ids.forEach(id => this.selectedIds.add(id));
    eventBus.emit(EditorEvents.SELECTION_CHANGED, {
      selected: Array.from(this.selectedIds),
    });
  }

  /**
   * Deselect an object
   */
  deselect(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      eventBus.emit(EditorEvents.OBJECT_DESELECTED, { id });
      eventBus.emit(EditorEvents.SELECTION_CHANGED, {
        selected: Array.from(this.selectedIds),
      });
    }
  }

  /**
   * Toggle selection
   */
  toggle(id: string): void {
    if (this.isSelected(id)) {
      this.deselect(id);
    } else {
      this.select(id, true);
    }
  }

  /**
   * Clear all selections
   */
  clearSelection(): void {
    const previousSelection = Array.from(this.selectedIds);
    this.selectedIds.clear();

    if (previousSelection.length > 0) {
      previousSelection.forEach(id => {
        eventBus.emit(EditorEvents.OBJECT_DESELECTED, { id });
      });
      eventBus.emit(EditorEvents.SELECTION_CHANGED, { selected: [] });
    }
  }

  /**
   * Check if object is selected
   */
  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  /**
   * Get selected object IDs
   */
  getSelection(): string[] {
    return Array.from(this.selectedIds);
  }

  /**
   * Get selection count
   */
  getSelectionCount(): number {
    return this.selectedIds.size;
  }

  /**
   * Set hovered object
   */
  setHovered(id: string | null): void {
    if (this.hoveredId !== id) {
      this.hoveredId = id;
      // Emit hover event if needed
    }
  }

  /**
   * Get hovered object
   */
  getHovered(): string | null {
    return this.hoveredId;
  }

  /**
   * Check if object is hovered
   */
  isHovered(id: string): boolean {
    return this.hoveredId === id;
  }
}
