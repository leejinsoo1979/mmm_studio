import type { ContinuationContext } from '../../../lib/continuation'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import type { SnapContext } from '../../../lib/snapping-mode'
import { usePlacementFeedback } from '../../../store/use-placement-feedback'
import { ContextualHelperPanel } from './contextual-helper-panel'
import { ToolCursorHints } from './tool-cursor-hints'

interface ItemHelperProps {
  showEsc?: boolean
  snapContext?: SnapContext | null
  // Whether to advertise Alt = force-place. Only meaningful for kinds that
  // collision-validate their drop (structural kinds never reject, so it's hidden).
  showForce?: boolean
  // Set for a fresh point-kind placement (e.g. a positioned preset) so the
  // once/repeat continuation chip shows; null for an existing-node move.
  continuationContext?: ContinuationContext | null
  // Item placement / move: a quick right click turns 45°, Alt + R / T 5°.
  rightClickRotates?: boolean
}

// inZOI lists the placement keys beside the object and warns in red when it
// overlaps something; the docked card keeps only the snapping / continuation
// chips. Alt forces an invalid (red) drop.
export function ItemHelper({
  showEsc,
  snapContext,
  showForce,
  continuationContext = null,
  rightClickRotates = false,
}: ItemHelperProps) {
  const blocked = usePlacementFeedback((s) => s.blocked)
  const hints: ContextualShortcutHint[] = [
    { keys: ['Left click'], label: '클릭하여 배치' },
    rightClickRotates
      ? { keys: [['R', 'T', 'Right click']], label: '45° 회전' }
      : { keys: [['R', 'T']], label: '회전' },
    ...(rightClickRotates ? [{ keys: ['Alt', ['R', 'T']], label: '5° 미세 회전' }] : []),
    ...(showForce ? [{ keys: ['Alt'], label: '자유 배치' }] : []),
    { keys: [showEsc ? 'Esc' : 'Right click'], label: '선택 취소' },
  ]
  return (
    <>
      <ContextualHelperPanel
        continuationContext={continuationContext}
        hints={[]}
        snapContext={snapContext}
      />
      <ToolCursorHints
        hints={hints}
        warning={blocked ? '사물은 서로 겹쳐서 배치할 수 없습니다' : undefined}
      />
    </>
  )
}
