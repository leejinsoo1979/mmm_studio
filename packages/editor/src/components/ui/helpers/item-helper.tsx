import type { ContinuationContext } from '../../../lib/continuation'
import type { SnapContext } from '../../../lib/snapping-mode'
import { ContextualHelperPanel } from './contextual-helper-panel'

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

// Snapping mode is the chip on the right (Shift cycles it), so it's not repeated
// as a key hint. Rotate is the two keys; Alt forces an invalid (red) drop.
export function ItemHelper({
  showEsc,
  snapContext,
  showForce,
  continuationContext = null,
  rightClickRotates = false,
}: ItemHelperProps) {
  return (
    <ContextualHelperPanel
      continuationContext={continuationContext}
      hints={[
        { keys: ['Left click'], label: 'Place' },
        rightClickRotates
          ? { keys: [['R', 'T', 'Right click']], label: '45° 회전' }
          : { keys: ['R', 'T'], label: 'Rotate' },
        ...(rightClickRotates ? [{ keys: ['Alt', ['R', 'T']], label: '5° 미세 회전' }] : []),
        ...(showForce ? [{ keys: ['Alt'], label: 'Force place' }] : []),
        { keys: [showEsc ? 'Esc' : 'Right click'], label: 'Cancel' },
      ]}
      snapContext={snapContext}
    />
  )
}
