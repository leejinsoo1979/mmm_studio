'use client'

import { Editor, type SceneGraph, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { RuntimeCollaboration } from './runtime-collaboration'
import { RuntimeConfigurator } from './runtime-configurator'

export function PlaySceneLoader({ scene, sceneId }: { scene: SceneGraph; sceneId: string }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const editor = useEditor.getState()
    const viewer = useViewer.getState()
    const previous = {
      shading: viewer.shading,
      textures: viewer.textures,
      edges: viewer.edges,
      shadows: viewer.shadows,
      showGrid: viewer.showGrid,
      showGuides: viewer.showGuides,
      showZones: viewer.showZones,
    }
    editor.setPreviewMode(true)
    viewer.setShading('hyper')
    viewer.setTextures(true)
    viewer.setEdges('soft')
    viewer.setShadows(true)
    viewer.setShowGrid(false)
    viewer.setShowGuides(false)
    viewer.setShowZones(false)
    setReady(true)
    return () => {
      editor.setPreviewMode(false)
      viewer.setShading(previous.shading)
      viewer.setTextures(previous.textures)
      viewer.setEdges(previous.edges)
      viewer.setShadows(previous.shadows)
      viewer.setShowGrid(previous.showGrid)
      viewer.setShowGuides(previous.showGuides)
      viewer.setShowZones(previous.showZones)
    }
  }, [])

  if (!ready) return <div className="h-screen w-screen bg-[#111]" />

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#111]">
      <Editor isVersionPreviewMode layoutVersion="v2" previewScene={scene} />
      <RuntimeConfigurator />
      <RuntimeCollaboration
        chatEnabled={scene.experience?.multiplayer.chat ?? true}
        enabled={scene.experience?.multiplayer.enabled ?? true}
        sceneId={sceneId}
        visibility={scene.experience?.multiplayer.visibility ?? 'public'}
      />
    </div>
  )
}
