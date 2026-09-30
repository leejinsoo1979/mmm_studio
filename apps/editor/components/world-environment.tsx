'use client'

import { Slider, useEditor } from '@pascal-app/editor'
import { getSceneTheme, useViewer, type Weather } from '@pascal-app/viewer'
import {
  ChevronDown,
  Cloud,
  CloudFog,
  CloudRain,
  Moon,
  Snowflake,
  Sun,
  SunMedium,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatClock, setClock, useClock } from '@/lib/time-of-day'
import { cn } from '@/lib/utils'

export const WEATHER_OPTIONS: { id: Weather; label: string; icon: typeof Sun }[] = [
  { id: 'clear', label: '맑음', icon: Sun },
  { id: 'cloudy', label: '흐림', icon: Cloud },
  { id: 'rain', label: '비', icon: CloudRain },
  { id: 'snow', label: '눈', icon: Snowflake },
  { id: 'fog', label: '안개', icon: CloudFog },
]

/** The daytime looks (night and dusk come with the clock). */
const ATMOSPHERES: { id: string; label: string }[] = [
  { id: 'studio', label: '스튜디오' },
  { id: 'paper', label: '종이' },
  { id: 'sunset', label: '노을' },
  { id: 'overcast', label: '흐린 날' },
  { id: 'mediterranean', label: '지중해' },
  { id: 'verdant', label: '초록' },
]

/** Arrow keys on a focused slider would also walk the character: let go after a drag. */
const releaseFocus = () => (document.activeElement as HTMLElement | null)?.blur()

/**
 * The world's time of day and weather (and, with `atmosphere`, the scene's
 * daytime look), for a walk through the scene. `tone` matches the panel it
 * sits in.
 */
export function EnvironmentControls({
  tone,
  atmosphere = false,
}: {
  tone: 'dark' | 'light'
  atmosphere?: boolean
}) {
  const clock = useClock()
  const weather = useViewer((state) => state.weather)
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const dark = tone === 'dark'
  const muted = dark ? 'text-white/55' : 'text-muted-foreground'

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className={cn('mb-1.5 flex items-center justify-between text-[11px]', muted)}>
          <span>시간</span>
          <span className={cn('font-mono', dark ? 'text-white/85' : 'text-foreground')}>
            {formatClock(clock)}
          </span>
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
        <p className={cn('mb-1.5 text-[11px]', muted)}>날씨</p>
        <div className="grid grid-cols-5 gap-1">
          {WEATHER_OPTIONS.map(({ id, label, icon: Icon }) => (
            <button
              aria-pressed={weather === id}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] transition-colors',
                weather === id
                  ? dark
                    ? 'bg-white text-black'
                    : 'bg-foreground text-background'
                  : dark
                    ? 'text-white/70 hover:bg-white/10'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
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

      {atmosphere && (
        <div>
          <p className={cn('mb-1.5 text-[11px]', muted)}>분위기</p>
          <div className="grid grid-cols-3 gap-1">
            {ATMOSPHERES.map(({ id, label }) => {
              const theme = getSceneTheme(id)
              const active = sceneTheme === id
              return (
                <button
                  aria-pressed={active}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] transition-colors',
                    active
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  key={id}
                  onClick={(event) => {
                    useViewer.getState().setSceneTheme(id)
                    event.currentTarget.blur()
                  }}
                  type="button"
                >
                  <span
                    className="size-3.5 shrink-0 rounded-full ring-1 ring-black/10"
                    style={{
                      background: `linear-gradient(135deg, ${theme.background}, ${theme.lights[0]?.color ?? theme.background})`,
                    }}
                  />
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The editor's walkthrough environment: a chip under the tour's controls
 * (the clock and the weather) that opens the time, weather and look.
 */
export function TourEnvironment() {
  const inTour = useEditor((state) => state.isFirstPersonMode)
  const clock = useClock()
  const weather = useViewer((state) => state.weather)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])
  if (!inTour) return null
  const current = WEATHER_OPTIONS.find((option) => option.id === weather) ?? WEATHER_OPTIONS[0]!
  const WeatherIcon = current.icon

  return (
    <div
      className="pointer-events-auto absolute top-[60px] right-3 z-50 flex flex-col items-end gap-2"
      ref={rootRef}
    >
      <button
        aria-expanded={open}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-full border border-border/40 bg-background/90 px-3 font-medium text-foreground text-xs shadow-lg backdrop-blur-xl transition-colors hover:bg-background',
          open && 'bg-background',
        )}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <WeatherIcon className="size-3.5 text-[#f5b41e]" />
        <span className="font-mono">{formatClock(clock)}</span>
        <span className="text-muted-foreground">· {current.label}</span>
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="w-[264px] rounded-2xl border border-border/40 bg-background/95 p-3 shadow-xl backdrop-blur-xl">
          <EnvironmentControls atmosphere tone="light" />
        </div>
      )}
    </div>
  )
}
