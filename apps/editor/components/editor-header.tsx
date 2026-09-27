import { useScene } from '@pascal-app/core'
import { useUiTheme } from '@pascal-app/editor'
import { Camera, ChevronLeft, Moon, Sun } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ExportCenter } from './export-center'

interface EditorHeaderProps {
  sceneName: string
  sceneId: string
  onRename: (name: string) => Promise<void>
}

export function EditorHeader({ sceneId, sceneName, onRename }: EditorHeaderProps) {
  const [draftName, setDraftName] = useState(sceneName)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const experience = useScene((state) => state.experience)
  const setExperience = useScene((state) => state.setExperience)
  const uiTheme = useUiTheme((state) => state.theme)
  const toggleUiTheme = useUiTheme((state) => state.toggle)

  useEffect(() => setDraftName(sceneName), [sceneName])

  const commitName = async () => {
    const nextName = draftName.trim()
    if (!nextName || nextName === sceneName) {
      setDraftName(sceneName)
      return
    }
    setIsSaving(true)
    try {
      await onRename(nextName)
    } catch {
      setDraftName(sceneName)
    } finally {
      setIsSaving(false)
    }
  }

  const saveCamera = () => {
    window.dispatchEvent(
      new CustomEvent('mmm-camera-capture', {
        detail: (snapshot: {
          position: [number, number, number]
          target: [number, number, number]
          fov?: number
        }) => {
          const nextIndex = experience.cameras.length + 1
          setExperience({
            ...experience,
            cameras: [
              ...experience.cameras,
              { id: crypto.randomUUID(), label: `Camera ${nextIndex}`, ...snapshot },
            ],
          })
        },
      }),
    )
  }

  // inZOI "‹ Go Back | Customize Architecture": a slim row on top of the
  // floating build panel instead of a full-width web header.
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-black/5 border-b px-2 dark:border-white/10">
      <Link
        aria-label="대시보드로 돌아가기"
        className="flex h-8 shrink-0 items-center rounded-md px-1 text-neutral-600 dark:text-neutral-300 text-xs hover:bg-neutral-100 dark:hover:bg-white/10 hover:text-neutral-900 dark:hover:text-white"
        href="/dashboard"
        title="대시보드"
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>
      <input
        aria-label="프로젝트 이름"
        className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 font-semibold text-[13px] text-neutral-800 dark:text-neutral-100 outline-none transition hover:border-border/60 focus:border-border focus:bg-white disabled:opacity-60"
        disabled={isSaving}
        maxLength={200}
        onBlur={() => void commitName()}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraftName(sceneName)
            event.currentTarget.blur()
          }
        }}
        ref={inputRef}
        value={draftName}
      />
      <button
        aria-label="시점 저장"
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/10 hover:text-neutral-900 dark:hover:text-white"
        onClick={saveCamera}
        title={`시점 저장 (저장된 시점 ${experience.cameras.length}개)`}
        type="button"
      >
        <Camera className="h-4 w-4" />
      </button>
      <button
        aria-label={uiTheme === 'dark' ? '밝은 화면' : '어두운 화면'}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/10 hover:text-neutral-900 dark:hover:text-white"
        onClick={toggleUiTheme}
        title={uiTheme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}
        type="button"
      >
        {uiTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <ExportCenter sceneId={sceneId} sceneName={sceneName} />
    </header>
  )
}
