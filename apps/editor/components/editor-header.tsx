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
    <>
      <header className="flex h-11 items-center gap-2">
        <Link
          aria-label="대시보드로 돌아가기"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow-[0_2px_10px_rgba(0,0,0,0.15)] ring-1 ring-black/5 transition-colors hover:bg-white hover:text-neutral-900 dark:bg-neutral-900/90 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-neutral-800"
          href="/dashboard"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <Link
          className="shrink-0 font-medium text-[15px] text-neutral-800 [text-shadow:0_0_4px_rgba(255,255,255,0.95)] hover:underline"
          href="/dashboard"
        >
          돌아가기
        </Link>
        <span className="h-4 w-px shrink-0 bg-neutral-500/60" />
        <input
          aria-label="프로젝트 이름"
          className="h-8 w-44 rounded-md border border-transparent bg-transparent px-1.5 font-medium text-[15px] text-neutral-800 outline-none transition [text-shadow:0_0_4px_rgba(255,255,255,0.95)] hover:border-black/10 focus:border-black/15 focus:bg-white/90 disabled:opacity-60"
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
      </header>
      {/* inZOI's 소지금 card: a strip under the build panel for the project actions. */}
      <div
        className="fixed bottom-3 left-3 z-40 flex h-11 items-center gap-1 rounded-full border border-white/70 bg-white/90 py-1.5 pr-1.5 pl-4 shadow-[0_6px_24px_rgba(0,0,0,0.16)] backdrop-blur-md dark:border-white/10 dark:bg-neutral-900/90"
        style={{ width: 'calc(var(--viewer-left-inset, 0px) - 12px)' }}
      >
        <span className="mr-auto text-muted-foreground text-xs">프로젝트</span>
        <button
          aria-label="시점 저장"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-900/[0.06] hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={saveCamera}
          title={`시점 저장 (저장된 시점 ${experience.cameras.length}개)`}
          type="button"
        >
          <Camera className="h-4 w-4" />
        </button>
        <button
          aria-label={uiTheme === 'dark' ? '밝은 화면' : '어두운 화면'}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-900/[0.06] hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={toggleUiTheme}
          title={uiTheme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}
          type="button"
        >
          {uiTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <ExportCenter sceneId={sceneId} sceneName={sceneName} />
      </div>
    </>
  )
}
