'use client'

import { useScene } from '@pascal-app/core'
import { Redo2, Undo2 } from 'lucide-react'
import { useStore } from 'zustand'
import { runRedo, runUndo } from '../../../lib/history'
import { ActionButton } from './action-button'

/** inZOI's undo / redo arrows in the build tool bar. */
export function HistoryActions() {
  const canUndo = useStore(useScene.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useScene.temporal, (s) => s.futureStates.length > 0)
  return (
    <div className="flex items-center gap-1">
      <ActionButton
        className="text-muted-foreground hover:text-foreground disabled:opacity-35"
        disabled={!canUndo}
        label="되돌리기"
        onClick={runUndo}
        shortcut="⌘Z"
        size="icon"
        variant="ghost"
      >
        <Undo2 className="h-5 w-5" />
      </ActionButton>
      <ActionButton
        className="text-muted-foreground hover:text-foreground disabled:opacity-35"
        disabled={!canRedo}
        label="다시하기"
        onClick={runRedo}
        shortcut="⇧⌘Z"
        size="icon"
        variant="ghost"
      >
        <Redo2 className="h-5 w-5" />
      </ActionButton>
    </div>
  )
}
