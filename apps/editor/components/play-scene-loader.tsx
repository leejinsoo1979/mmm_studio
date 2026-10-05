'use client'

import { Editor, type SceneGraph, useEditor } from '@pascal-app/editor'
import { NpcDialoguePanel, NpcInteractionMenu } from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { installNpcSceneServices } from '@/lib/npc-chat-client'
import { CharacterStudio } from './character-studio/character-studio'
import { NpcStudioBridge } from './npc-studio-bridge'
import { PlayEmoteBar } from './play-emote-bar'
import { PlayGameHud } from './play-game-hud'
import { PlayGameLobby } from './play-game-lobby'
import { PlayTvRemote } from './play-tv-remote'
import { RuntimeCollaboration } from './runtime-collaboration'
import { RuntimeConfigurator } from './runtime-configurator'
import { RuntimeWorldSync } from './runtime-world-sync'

export function PlaySceneLoader({
  scene,
  sceneId,
  title,
}: {
  scene: SceneGraph
  sceneId: string
  title: string
}) {
  const [ready, setReady] = useState(false)
  const inGame = useEditor((state) => state.isFirstPersonMode)

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
    // Ink lines are a drafting look: in play they outline every hair strand,
    // eyelid and seam of the characters, drawn white on a night sky.
    viewer.setEdges('off')
    viewer.setShadows(true)
    viewer.setShowGrid(false)
    viewer.setShowGuides(false)
    viewer.setShowZones(false)
    setReady(true)
    return () => {
      editor.setFirstPersonMode(false)
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

  useEffect(() => installNpcSceneServices(sceneId), [sceneId])

  if (!ready) return <div className="h-screen w-screen bg-[#111]" />

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#111]">
      <Editor isVersionPreviewMode layoutVersion="v2" previewScene={scene} />
      {!inGame && <RuntimeConfigurator />}
      <PlayGameLobby title={title} />
      <PlayGameHud />
      <PlayTvRemote />
      <PlayEmoteBar />
      <NpcDialoguePanel />
      <NpcInteractionMenu />
      <CharacterStudio />
      <NpcStudioBridge />
      <RuntimeCollaboration
        chatEnabled={scene.experience?.multiplayer.chat ?? true}
        enabled={scene.experience?.multiplayer.enabled ?? true}
        sceneId={sceneId}
        visibility={scene.experience?.multiplayer.visibility ?? 'public'}
      />
      <RuntimeWorldSync enabled={scene.experience?.multiplayer.enabled ?? true} sceneId={sceneId} />
    </div>
  )
}
