import { useLiveNodeOverrides, useLiveTransforms, useScene } from '@pascal-app/core'

function refreshSceneAfterHistoryJump() {
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()

  const state = useScene.getState()
  for (const node of Object.values(state.nodes)) {
    state.markDirty(node.id)
  }
}

let historyJumpDepth = 0

/**
 * True while an undo / redo applies its snapshot. Scene subscribers run
 * synchronously inside it, so they can tell a deliberate history step from
 * any other change.
 */
export function isApplyingHistoryJump(): boolean {
  return historyJumpDepth > 0
}

function jump(apply: () => void) {
  historyJumpDepth += 1
  try {
    apply()
  } finally {
    historyJumpDepth -= 1
  }
  refreshSceneAfterHistoryJump()
}

export function runUndo() {
  jump(() => useScene.temporal.getState().undo())
}

export function runRedo() {
  jump(() => useScene.temporal.getState().redo())
}
