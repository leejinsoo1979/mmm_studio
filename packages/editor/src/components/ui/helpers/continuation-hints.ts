'use client'

import { CONTINUATION_PROFILES, type ContinuationContext } from '../../../lib/continuation'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import useEditor from '../../../store/use-editor'
import useFenceCurveDraft from '../../../store/use-fence-curve-draft'

/**
 * The once / repeat (C) and fence type (T) state as cursor key rows, so the
 * draw mode reads beside the cursor like inZOI's other tool keys.
 */
export function useContinuationHints(
  context: ContinuationContext | null,
): ContextualShortcutHint[] {
  const mode = useEditor((s) => (context ? s.getContinuation(context) : null))
  const curveStarted = useFenceCurveDraft((s) => s.pointCount > 0)
  if (!(context && mode)) return []
  if (context !== 'fence') {
    return [{ keys: ['C'], label: CONTINUATION_PROFILES[context].labels[mode] ?? mode }]
  }
  const curved = mode === 'curved'
  return [
    { keys: ['T'], label: curved ? '종류: 곡선' : '종류: 직선' },
    ...(curved
      ? curveStarted
        ? [{ keys: ['Enter'], label: '곡선 완성 (또는 더블클릭)' }]
        : []
      : [{ keys: ['C'], label: mode === 'single' ? '직선: 한 번' : '직선: 이어서' }]),
  ]
}
