'use client'

import { nodeRegistry } from '@pascal-app/core'
import { useMemo } from 'react'
import { type SnapContext, snapContextOf } from '../lib/snapping-mode'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'

/** The snapping context (wall / item / polygon) of whatever is active, or null. */
export function useActiveSnapContext(): SnapContext | null {
  const mode = useEditor((s) => s.mode)
  const tool = useEditor((s) => s.tool)
  const scope = useInteractionScope((s) => s.scope)
  return useMemo(
    () =>
      snapContextOf({
        scope,
        mode,
        tool,
        profileOf: (typeOrTool) => nodeRegistry.get(typeOrTool)?.snapProfile,
        draftDirectionalOf: (typeOrTool) =>
          nodeRegistry.get(typeOrTool)?.snapDraftDirectional ?? true,
      }),
    [scope, mode, tool],
  )
}
