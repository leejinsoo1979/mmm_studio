import { useScene } from '@pascal-app/core'
import { Camera, ChevronLeft } from 'lucide-react'
import Image from 'next/image'
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
    <header className="flex h-11 shrink-0 items-center gap-1 border-border border-b bg-white px-2">
      <Link
        aria-label="대시보드로 돌아가기"
        className="flex h-8 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1 text-neutral-600 text-xs hover:bg-neutral-100 hover:text-neutral-900"
        href="/dashboard"
        title="대시보드"
      >
        <ChevronLeft className="h-4 w-4" />
        <Image
          alt=""
          aria-hidden="true"
          className="h-[11px] w-auto"
          height={23}
          src="/mmmlogo.svg"
          width={71}
        />
      </Link>
      <span className="h-4 w-px shrink-0 bg-neutral-300" />
      <input
        aria-label="프로젝트 이름"
        className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 font-semibold text-[13px] text-neutral-800 outline-none transition hover:border-border/60 focus:border-border focus:bg-white disabled:opacity-60"
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
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        onClick={saveCamera}
        title={`시점 저장 (저장된 시점 ${experience.cameras.length}개)`}
        type="button"
      >
        <Camera className="h-4 w-4" />
      </button>
      <ExportCenter sceneId={sceneId} sceneName={sceneName} />
    </header>
  )
}
