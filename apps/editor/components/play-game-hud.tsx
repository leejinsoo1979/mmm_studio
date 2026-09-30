'use client'

import { useEditor } from '@pascal-app/editor'
import { PROJECTOR_ID, useItemScreens } from '@pascal-app/nodes'
import { Projector, Sparkles, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useCharacterStudio } from './character-studio/use-character-studio'
import { EnvironmentControls } from './world-environment'

/**
 * The projector (no TV needed) takes the remote; switched on for the first
 * time, it starts aiming its picture.
 */
function takeProjector() {
  const screens = useItemScreens.getState()
  const screen = screens.screens[PROJECTOR_ID]
  if (!screen) screens.setOn(PROJECTOR_ID, true)
  else useItemScreens.setState({ activeId: PROJECTOR_ID })
  if (!screen?.projection) useItemScreens.getState().startPlacing(PROJECTOR_ID)
}

/**
 * The game's world panel: the time of day, the weather, and an invite to the
 * same scene. Shown while walking the scene.
 */
export function PlayGameHud() {
  const inGame = useEditor((state) => state.isFirstPersonMode)
  const [invited, setInvited] = useState(false)
  const projectorOn = useItemScreens((state) => Boolean(state.screens[PROJECTOR_ID]))

  if (!inGame) return null

  const invite = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setInvited(true)
    window.setTimeout(() => setInvited(false), 2000)
  }

  return (
    <div className="dark pointer-events-auto fixed top-4 left-4 z-[60] flex w-[260px] flex-col gap-3 rounded-2xl border border-white/10 bg-[#141414]/85 p-3 text-white shadow-xl backdrop-blur-xl">
      <EnvironmentControls tone="dark" />

      <button
        aria-pressed={projectorOn}
        className={cn(
          'flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2 text-sm transition',
          projectorOn ? 'bg-white text-black' : 'text-white/85 hover:bg-white/10',
        )}
        onClick={(event) => {
          event.currentTarget.blur()
          takeProjector()
        }}
        type="button"
      >
        <Projector className="size-4" />빔 프로젝터
      </button>

      <button
        className="flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2 text-sm text-white/85 transition hover:bg-white/10"
        onClick={(event) => {
          event.currentTarget.blur()
          useCharacterStudio.getState().show()
        }}
        type="button"
      >
        <Sparkles className="size-4" />
        캐릭터 꾸미기
      </button>

      <button
        className="flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2 text-sm text-white/85 transition hover:bg-white/10"
        onClick={invite}
        type="button"
      >
        <UserPlus className="size-4" />
        {invited ? '초대 링크를 복사했어요' : '친구 초대하기'}
      </button>
    </div>
  )
}
