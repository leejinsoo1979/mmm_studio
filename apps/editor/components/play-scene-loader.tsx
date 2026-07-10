'use client'

import { Editor, type SceneGraph, useEditor } from '@pascal-app/editor'
import { useEffect, useState } from 'react'

export function PlaySceneLoader({ scene }: { scene: SceneGraph }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const editor = useEditor.getState()
    editor.setPreviewMode(true)
    setReady(true)
    return () => editor.setPreviewMode(false)
  }, [])

  if (!ready) return <div className="h-screen w-screen bg-[#111]" />

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#111]">
      <Editor isVersionPreviewMode layoutVersion="v2" previewScene={scene} />
    </div>
  )
}
