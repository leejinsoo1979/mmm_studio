import { getScaledDimensions, type ItemNode } from '@pascal-app/core'
import type { ContinuationContext } from '../../../lib/continuation'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { useMovingNode } from '../../../store/use-interaction-scope'
import { usePlacementFeedback } from '../../../store/use-placement-feedback'
import { useContinuationHints } from './continuation-hints'
import { ToolCursorHints } from './tool-cursor-hints'

interface ItemHelperProps {
  // Whether to advertise Alt = force-place. Only meaningful for kinds that
  // collision-validate their drop (structural kinds never reject, so it's hidden).
  showForce?: boolean
  // Set for a fresh point-kind placement (e.g. a positioned preset) so the
  // once/repeat continuation chip shows; null for an existing-node move.
  continuationContext?: ContinuationContext | null
  // Item placement / move: a quick right click turns 45°, Alt + R / T 5°.
  rightClickRotates?: boolean
}

/** Catalog-style size readout (w×h×d in mm, same order as the item cards). */
export function formatItemSize(dimensions: readonly number[]): string {
  return `${dimensions.map((m) => Math.round(m * 1000)).join('×')} mm`
}

/** Wall-mounted items face out of their wall: the placement never turns them. */
export function isWallMountedAsset(asset: { attachTo?: string } | null | undefined): boolean {
  return asset?.attachTo === 'wall' || asset?.attachTo === 'wall-side'
}

/**
 * A held item turns on Z / C, so the placement coordinator moves its once /
 * repeat toggle to Q; the continuation row follows.
 */
export function withItemContinuationKey(hints: ContextualShortcutHint[]): ContextualShortcutHint[] {
  return hints.map((hint) =>
    hint.keys.length === 1 && hint.keys[0] === 'C' ? { ...hint, keys: ['Q'] } : hint,
  )
}

/**
 * inZOI's held-object keys, shared by a fresh catalog placement (the item
 * definition's `toolHints`) and a move so both read the same. Shift (snapping
 * mode) is named on the tool bar's magnet, so it is not repeated here.
 */
function heldItemHints({
  rotation,
  showForce = true,
}: {
  rotation: 'item' | 'keys' | 'none'
  showForce?: boolean
}): ContextualShortcutHint[] {
  return [
    // Items (the placement coordinator) also turn on a quick right click and
    // Z / C, and 5° with Alt; other kinds rotate on R / T only.
    ...(rotation === 'item'
      ? [
          { keys: ['Right click'], label: '오른쪽 45° 회전' },
          { keys: [['Z', 'C']], label: '왼쪽·오른쪽 회전' },
          { keys: ['Alt', ['R', 'T']], label: '5° 미세 회전' },
        ]
      : rotation === 'keys'
        ? [{ keys: [['R', 'T']], label: '회전' }]
        : []),
    ...(showForce ? [{ keys: ['Alt'], label: '자유 배치' }] : []),
    { keys: ['Esc'], label: '선택 취소' },
    { keys: ['Delete'], label: '삭제' },
  ]
}

// inZOI lists the placement keys beside the object and warns in red when it
// overlaps something. Alt forces an invalid (red) drop.
export function ItemHelper({
  showForce,
  continuationContext = null,
  rightClickRotates = false,
}: ItemHelperProps) {
  const blocked = usePlacementFeedback((s) => s.blocked)
  const movingNode = useMovingNode()
  const continuationHints = useContinuationHints(continuationContext)
  const item = movingNode?.type === 'item' ? (movingNode as ItemNode) : null
  const title = item
    ? { name: item.name ?? item.asset.name, size: formatItemSize(getScaledDimensions(item)) }
    : undefined
  const rotation = !rightClickRotates
    ? 'keys'
    : isWallMountedAsset(item?.asset)
      ? 'none'
      : 'item'
  return (
    <ToolCursorHints
      hints={[
        ...heldItemHints({ rotation, showForce }),
        ...(rightClickRotates ? withItemContinuationKey(continuationHints) : continuationHints),
      ]}
      title={title}
      warning={blocked ? '사물은 서로 겹쳐서 배치할 수 없습니다' : undefined}
    />
  )
}
