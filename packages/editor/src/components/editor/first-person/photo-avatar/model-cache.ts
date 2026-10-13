'use client'

import { useGLTF } from '@react-three/drei/core/Gltf'
import { useEffect } from 'react'
import type { Material, Mesh, Object3D, Texture } from 'three'

/**
 * A photo avatar's file let go of once its avatar is (a preview thrown
 * away, an avatar deleted): drei keeps every file it loads, by URL, for the
 * page's life, and a photo avatar's decoded pictures come to about 60 MB.
 * The file is taken out of drei's cache, its pictures and meshes freed on
 * the GPU and its object URL revoked, but only once no body on the page
 * draws it any more: until then a body still drawing it could ask for it
 * again (any render does), and a revoked URL can't be read twice.
 */

type Held = { scene: Object3D | null; users: number; released: boolean }

const held = new Map<string, Held>()

const entryOf = (url: string): Held => {
  let entry = held.get(url)
  if (!entry) {
    entry = { scene: null, users: 0, released: false }
    held.set(url, entry)
  }
  return entry
}

/** Marks the file at `url` (its loaded `scene`) as drawn by the calling body while it is mounted. */
export function useHeldModel(url: string, scene: Object3D) {
  useEffect(() => holdModel(url, scene), [url, scene])
}

/** Marks the file at `url` as drawn until the returned function is called. */
export function holdModel(url: string, scene: Object3D): () => void {
  const entry = entryOf(url)
  entry.scene = scene
  entry.users++
  return () => {
    entry.users--
    if (entry.users === 0 && entry.released) free(url, entry)
  }
}

/** Lets go of the file at `url` (an object URL): now if nothing draws it, else when the last body that does goes. */
export function releaseModel(url: string) {
  const entry = entryOf(url)
  entry.released = true
  if (entry.users === 0) free(url, entry)
}

function free(url: string, entry: Held) {
  held.delete(url)
  useGLTF.clear(url)
  if (entry.scene) disposeScene(entry.scene)
  URL.revokeObjectURL(url)
}

/** Frees a loaded file's meshes, materials and pictures on the GPU. */
export function disposeScene(scene: Object3D) {
  const textures = new Set<Texture>()
  const materials = new Set<Material>()
  scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if ((value as Texture | null)?.isTexture) textures.add(value as Texture)
      }
    }
  })
  for (const texture of textures) texture.dispose()
  for (const material of materials) material.dispose()
}
