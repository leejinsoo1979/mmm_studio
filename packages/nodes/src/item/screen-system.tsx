'use client'

import { type AnyNodeId, sceneRegistry } from '@pascal-app/core'
import { nearestHit, registerWalkthroughInteraction } from '@pascal-app/editor'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  CanvasTexture,
  type Material,
  type Mesh,
  SRGBColorSpace,
  type Texture,
  VideoTexture,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { type ScreenContent, screenMeshes, screenSlots, useItemScreens } from './screen'

/** Pictures are fitted onto a 16:9 panel, letterboxed. */
const PANEL = { width: 1600, height: 900 }

function panelCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = PANEL.width
  canvas.height = PANEL.height
  return canvas
}

/** glTF models map their UVs with images the right way up (no flip). */
function screenTexture<T extends Texture>(texture: T): T {
  texture.flipY = false
  texture.colorSpace = SRGBColorSpace
  return texture
}

let standby: CanvasTexture | null = null
/** The switched-on picture before anything is put on: a soft glow and the remote's hint. */
function standbyTexture() {
  if (standby) return standby
  const canvas = panelCanvas()
  const g = canvas.getContext('2d')!
  const gradient = g.createLinearGradient(0, 0, PANEL.width, PANEL.height)
  gradient.addColorStop(0, '#27457e')
  gradient.addColorStop(1, '#5b2f7a')
  g.fillStyle = gradient
  g.fillRect(0, 0, PANEL.width, PANEL.height)
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.font = '600 96px sans-serif'
  g.textAlign = 'center'
  g.fillText('TV', PANEL.width / 2, PANEL.height / 2 - 20)
  g.fillStyle = 'rgba(255,255,255,0.6)'
  g.font = '40px sans-serif'
  g.fillText(
    '리모컨에서 화면 공유 · 동영상 · 발표 자료를 고르세요',
    PANEL.width / 2,
    PANEL.height / 2 + 60,
  )
  standby = screenTexture(new CanvasTexture(canvas))
  return standby
}

const videoTextures = new WeakMap<HTMLVideoElement, VideoTexture>()
function videoTexture(video: HTMLVideoElement) {
  let texture = videoTextures.get(video)
  if (!texture) {
    texture = screenTexture(new VideoTexture(video))
    videoTextures.set(video, texture)
  }
  return texture
}

const pageTextures = new Map<string, CanvasTexture | 'loading'>()
/** A slide fitted onto the panel; null until its image has loaded. */
function pageTexture(url: string): CanvasTexture | null {
  const known = pageTextures.get(url)
  if (known === 'loading') return null
  if (known) return known
  pageTextures.set(url, 'loading')
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => {
    const canvas = panelCanvas()
    const g = canvas.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, PANEL.width, PANEL.height)
    const fit = Math.min(PANEL.width / image.width, PANEL.height / image.height)
    const w = image.width * fit
    const h = image.height * fit
    g.drawImage(image, (PANEL.width - w) / 2, (PANEL.height - h) / 2, w, h)
    pageTextures.set(url, screenTexture(new CanvasTexture(canvas)))
  }
  image.onerror = () => pageTextures.delete(url)
  image.src = url
  return null
}

function contentTexture(content: ScreenContent): Texture | null {
  if (content.kind === 'video') return videoTexture(content.video)
  if (content.kind === 'slides') {
    const url = content.pages[content.index]
    return url ? pageTexture(url) : null
  }
  return standbyTexture()
}

/**
 * Puts `material` on a mesh's screen slot(s), keeping the model's own to
 * restore. The item renderer may put new materials on meanwhile (a shading
 * change): those become the ones to restore.
 */
function showOnScreen(mesh: Mesh, material: Material) {
  if (mesh.material === mesh.userData.screenShown) return
  const original = mesh.material
  const slots = screenSlots(mesh)
  const shown = Array.isArray(original)
    ? original.map((slot, index) => (slots[index] ? material : slot))
    : material
  mesh.userData.screenOriginal = original
  mesh.userData.screenShown = shown
  mesh.material = shown
}

function restoreScreen(mesh: Mesh) {
  if (mesh.material === mesh.userData.screenShown) mesh.material = mesh.userData.screenOriginal
  delete mesh.userData.screenOriginal
  delete mesh.userData.screenShown
}

/**
 * TVs and monitors in the walkthrough: E switches the one in the aim on or
 * off, and a switched-on screen shows its standby picture, a video, a shared
 * screen or presentation slides on its `slot_screen` surface.
 */
export function ItemScreenSystem() {
  const materials = useRef(new Map<string, MeshBasicNodeMaterial>())
  const lit = useRef(new Set<string>())

  useEffect(
    () =>
      registerWalkthroughInteraction('item-screen', {
        resolve: (raycaster) => {
          const hit = nearestHit(
            raycaster,
            [...(sceneRegistry.byType.item ?? [])].map(
              (id) => [id, sceneRegistry.nodes.get(id)] as const,
            ),
          )
          if (!(hit && screenMeshes(hit.object).length > 0)) return null
          const on = Boolean(useItemScreens.getState().screens[hit.key])
          return { id: hit.key, distance: hit.distance, label: on ? 'TV 끄기' : 'TV 켜기' }
        },
        activate: (id) => {
          const screens = useItemScreens.getState()
          screens.setOn(id, !screens.screens[id])
        },
      }),
    [],
  )

  useFrame(() => {
    const { screens } = useItemScreens.getState()
    for (const id of lit.current) {
      if (screens[id]) continue
      const object = sceneRegistry.nodes.get(id as AnyNodeId)
      if (object) for (const mesh of screenMeshes(object)) restoreScreen(mesh)
      lit.current.delete(id)
    }
    for (const [id, screen] of Object.entries(screens)) {
      const object = sceneRegistry.nodes.get(id as AnyNodeId)
      if (!object) continue
      let material = materials.current.get(id)
      if (!material) {
        material = new MeshBasicNodeMaterial({ toneMapped: false })
        materials.current.set(id, material)
      }
      const texture = contentTexture(screen.content)
      if (texture && material.map !== texture) {
        material.map = texture
        material.needsUpdate = true
      }
      for (const mesh of screenMeshes(object)) showOnScreen(mesh, material)
      lit.current.add(id)
    }
  })

  useEffect(
    () => () => {
      for (const material of materials.current.values()) material.dispose()
    },
    [],
  )

  return null
}
