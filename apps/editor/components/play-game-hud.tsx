'use client'

import { Slider, useEditor } from '@pascal-app/editor'
import { PROJECTOR_ID, useItemScreens } from '@pascal-app/nodes'
import { useViewer, type Weather } from '@pascal-app/viewer'
import {
  Cloud,
  CloudFog,
  CloudRain,
  Moon,
  Projector,
  Snowflake,
  Sparkles,
  Sun,
  SunMedium,
  UserPlus,
} from 'lucide-react'
import { useState } from 'react'
import { formatClock, setClock, useClock } from '@/lib/time-of-day'
import { cn } from '@/lib/utils'
import { useCharacterStudio } from './character-studio/use-character-studio'

const WEATHER_OPTIONS: { id: Weather; label: string; icon: typeof Sun }[] = [
  { id: 'clear', label: '맑음', icon: Sun },
  { id: 'cloudy', label: '흐림', icon: Cloud },
  { id: 'rain', label: '비', icon: CloudRain },
  { id: 'snow', label: '눈', icon: Snowflake },
  { id: 'fog', label: '안개', icon: CloudFog },
]

/** Arrow keys on a focused slider would also walk the character: let go after a drag. */
const releaseFocus = () => (document.activeElement as HTMLElement | null)?.blur()

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
  const clock = useClock()
  const weather = useViewer((state) => state.weather)
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
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-white/55">
          <span>시간</span>
          <span className="font-mono text-white/85">{formatClock(clock)}</span>
        </div>
        <div className="flex items-center gap-2">
          <SunMedium className="size-4 shrink-0 text-[#f5b41e]" />
          <Slider
            aria-label="시간"
            className="[&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-[#ddd2a3] [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-[linear-gradient(90deg,#7ba6ef,#ebd964_30%,#dedece_60%,#7ba6ef)]"
            max={24}
            min={0}
            onValueChange={([next]) => next !== undefined && setClock(next)}
            onValueCommit={releaseFocus}
            step={0.25}
            value={[clock]}
          />
          <Moon className="size-4 shrink-0 text-[#5f8fe0]" />
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] text-white/55">날씨</p>
        <div className="grid grid-cols-5 gap-1">
          {WEATHER_OPTIONS.map(({ id, label, icon: Icon }) => (
            <button
              aria-pressed={weather === id}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] transition-colors',
                weather === id ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10',
              )}
              key={id}
              onClick={(event) => {
                useViewer.getState().setWeather(id)
                event.currentTarget.blur()
              }}
              type="button"
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

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
