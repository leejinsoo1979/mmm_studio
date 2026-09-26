// @ts-nocheck

import type { BlueprintObjectManager, FloorplanSnapshot } from '../engine/BlueprintObjectManager'
import { Command } from './Command'

/**
 * FloorplanEditCommand - one confirmed edit as a single undo step.
 *
 * `apply` runs once; the drawing is snapshotted before and after it, so the
 * step also covers whatever the edit triggered synchronously (T-junction
 * splits, duplicate cleanup). Undo / redo restore those snapshots.
 */
export class FloorplanEditCommand extends Command {
  private before: FloorplanSnapshot | null = null
  private after: FloorplanSnapshot | null = null

  constructor(
    private objectManager: BlueprintObjectManager,
    private description: string,
    private apply: () => void,
  ) {
    super()
  }

  execute(): void {
    if (!this.canExecute()) return
    if (this.after) {
      this.objectManager.restore(this.after)
    } else {
      this.before = this.objectManager.snapshot()
      this.apply()
      this.after = this.objectManager.snapshot()
    }
    this.markExecuted()
  }

  undo(): void {
    if (!(this.canUndo() && this.before)) return
    this.objectManager.restore(this.before)
    this.markUndone()
  }

  getDescription(): string {
    return this.description
  }
}
