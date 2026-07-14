import { useScene } from '@pascal-app/core'
import { Camera } from 'lucide-react'
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

  return (
    <header className="relative flex h-12 shrink-0 items-center justify-between bg-sidebar px-4">
      <div className="flex min-w-0 items-center">
        <Link aria-label="MMM Studio home" className="flex shrink-0 items-center gap-2.5" href="/">
          <Image
            alt=""
            aria-hidden="true"
            className="h-[13px] w-auto invert"
            height={23}
            src="/mmmlogo.svg"
            width={71}
          />
          <span className="whitespace-nowrap font-[family-name:var(--font-barlow)] text-[17px] text-foreground tracking-[0.08em]">
            mmm studio
          </span>
        </Link>
      </div>
      <div className="absolute left-1/2 w-[36%] max-w-md -translate-x-1/2">
        <input
          aria-label="Project name"
          className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-center font-medium text-foreground/90 text-sm outline-none transition hover:border-border/60 hover:bg-background/30 focus:border-border focus:bg-background/70 disabled:opacity-60"
          disabled={isSaving}
          maxLength={200}
          onBlur={() => void commitName()}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setDraftName(sceneName)
              event.currentTarget.blur()
            }
          }}
          ref={inputRef}
          value={draftName}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
          onClick={saveCamera}
          title={`${experience.cameras.length} saved cameras`}
          type="button"
        >
          <Camera className="h-3.5 w-3.5" />
          Save view
        </button>
        <ExportCenter sceneId={sceneId} sceneName={sceneName} />
        <Link
          className="rounded-md border border-border bg-background/60 px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
          href="/dashboard"
        >
          Dashboard
        </Link>
      </div>
    </header>
  )
}
