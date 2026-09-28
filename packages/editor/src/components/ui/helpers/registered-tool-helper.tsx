import type { ToolHint } from '@pascal-app/core'
import type { ContinuationContext } from '../../../lib/continuation'
import type { SnapContext } from '../../../lib/snapping-mode'
import useEditor from '../../../store/use-editor'
import { usePlacementFeedback } from '../../../store/use-placement-feedback'
import { ContextualHelperPanel } from './contextual-helper-panel'
import { formatItemSize } from './item-helper'
import { ToolCursorHints } from './tool-cursor-hints'

/** 'Alt + R / T' → ['Alt', ['R', 'T']]: sequential keys, each with its alternatives. */
function splitHintKey(key: string): Array<string | string[]> {
  return key.split(' + ').map((part) => {
    const alternatives = part.split(' / ')
    return alternatives.length > 1 ? alternatives : part
  })
}

/**
 * Generic helper rendered from `def.toolHints` data. Matches the
 * visual styling of the hand-written `<WallHelper>` / `<ItemHelper>` /
 * etc. so registry-driven kinds get a consistent look without each kind
 * writing its own component.
 *
 * Drops the need for per-kind helper files entirely — kinds declare
 * their hints as static data in their `NodeDefinition`.
 */
export function RegisteredToolHelper({
  hints,
  shiftPressed = false,
  snapContext = null,
  continuationContext = null,
}: {
  hints: ToolHint[]
  shiftPressed?: boolean
  snapContext?: SnapContext | null
  continuationContext?: ContinuationContext | null
}) {
  // Live vertex count of an in-progress polygon draft, so hints gated on a
  // minimum (e.g. "Finish" at ≥ 3) only appear once they're actually possible.
  const draftVertexCount = useEditor((s) => s.draftVertexCount)
  const blocked = usePlacementFeedback((s) => s.blocked)
  const tool = useEditor((s) => s.tool)
  const selectedItem = useEditor((s) => s.selectedItem)
  const title =
    tool === 'item' && selectedItem
      ? {
          name: selectedItem.name,
          size: selectedItem.dimensions ? formatItemSize(selectedItem.dimensions) : undefined,
        }
      : undefined
  // The snapping chip (when a context is active) already shows Shift = cycle, so
  // drop the redundant 'Cycle snapping mode' tool hint to avoid a double pill;
  // also hide draft-gated hints until the draft is far enough along.
  const visible = hints.filter(
    (hint) =>
      !(hint.key === 'Shift' && hint.label === 'Cycle snapping mode') &&
      (hint.minDraftVertices == null || draftVertexCount >= hint.minDraftVertices),
  )
  if (visible.length === 0 && !snapContext && !continuationContext) return null
  // The key hints follow the cursor; the docked panel keeps the clickable
  // snapping / continuation chips.
  return (
    <>
      <ContextualHelperPanel
        continuationContext={continuationContext}
        hints={[]}
        snapContext={snapContext}
      />
      {visible.length > 0 ? (
        <ToolCursorHints
          title={title}
          warning={blocked ? '사물은 서로 겹쳐서 배치할 수 없습니다' : undefined}
          hints={visible.map((hint) => {
            // Shift is a per-kind bypass for opening / zone / duct placement ("Free
            // place", "Free angle", …) — those flip to a bypassed state while held.
            const isBypassHint = hint.key === 'Shift'
            return {
              keys: splitHintKey(hint.key),
              label:
                shiftPressed && isBypassHint
                  ? (hint.heldLabel ?? 'Guided constraints bypassed')
                  : hint.label,
              active: shiftPressed && isBypassHint,
            }
          })}
        />
      ) : null}
    </>
  )
}
