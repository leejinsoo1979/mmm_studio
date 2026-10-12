import type { MeshStandardMaterial, Texture } from 'three'
import { avatarUrl } from './avatar-catalog'

/**
 * A Rocketbox head's relief and roughness maps (the roughness map's red
 * carries the skin mask) at two sizes. The library bakes them for the
 * studio's close-ups: a 2K normal map and a 1K roughness map. A crowd
 * draws them as the library did before, 1K and 512, a quarter of the
 * memory each; every body loaded is fitted so as it is prepared, and the
 * studio decodes the file's own for the character it shows
 * (loadHeadDetail).
 */

export type HeadMap = 'normalMap' | 'roughnessMap'

/** How large a head's maps are drawn wherever a body is not in the studio. */
export const CROWD_SIZE: Record<HeadMap, number> = { normalMap: 1024, roughnessMap: 512 }

const HEAD = /_head$/
const fitted = new WeakSet<Texture>()

type Picture = { width: number; height: number; close?: () => void }

/**
 * Shrinks a loaded head material's maps to CROWD_SIZE, in place, once per
 * texture (drei's, which every body drawn from the file shares), before
 * any renderer uploads them; its full-size images are let go.
 */
export function fitHeadForCrowd(material: MeshStandardMaterial) {
  if (!HEAD.test(material.name) || typeof OffscreenCanvas === 'undefined') return
  for (const slot of ['normalMap', 'roughnessMap'] as const) {
    const texture = material[slot]
    if (!texture || fitted.has(texture)) continue
    fitted.add(texture)
    const image = texture.image as (CanvasImageSource & Picture) | null
    const size = CROWD_SIZE[slot]
    if (!image?.width || Math.max(image.width, image.height) <= size) continue
    const scale = size / Math.max(image.width, image.height)
    const canvas = new OffscreenCanvas(
      Math.round(image.width * scale),
      Math.round(image.height * scale),
    )
    const context = canvas.getContext('2d')
    if (!context) continue
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    image.close?.()
    texture.image = canvas.transferToImageBitmap()
    texture.needsUpdate = true
  }
}

type GltfJson = {
  materials?: {
    name?: string
    normalTexture?: { index: number }
    pbrMetallicRoughness?: { metallicRoughnessTexture?: { index: number } }
  }[]
  textures?: { source?: number; extensions?: Record<string, { source?: number }> }[]
  images?: { bufferView?: number; mimeType?: string }[]
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[]
}

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

/**
 * The head material's normal and metal-roughness images in a binary glTF,
 * as the bytes it stores (null for one it lacks or keeps elsewhere).
 */
export function headImages(glb: ArrayBuffer): Record<HeadMap, Blob | null> {
  const none = { normalMap: null, roughnessMap: null }
  const view = new DataView(glb)
  if (glb.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) return none
  let json: GltfJson | null = null
  let bin: { offset: number; length: number } | null = null
  for (let at = 12; at + 8 <= glb.byteLength; ) {
    const length = view.getUint32(at, true)
    const type = view.getUint32(at + 4, true)
    if (type === JSON_CHUNK) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, at + 8, length)))
    } else if (type === BIN_CHUNK) {
      bin = { offset: at + 8, length }
    }
    at += 8 + length
  }
  const head = json?.materials?.find((material) => HEAD.test(material.name ?? ''))
  if (!(json && bin && head)) return none
  const bytes = (index: number | undefined) => {
    const texture = index === undefined ? undefined : json.textures?.[index]
    if (!texture) return null
    const source =
      texture.source ??
      Object.values(texture.extensions ?? {}).find((extension) => extension.source !== undefined)
        ?.source
    const image = source === undefined ? undefined : json.images?.[source]
    const bufferView =
      image?.bufferView === undefined ? undefined : json.bufferViews?.[image.bufferView]
    if (!(image && bufferView) || bufferView.buffer !== 0) return null
    const start = bin.offset + (bufferView.byteOffset ?? 0)
    if (start + bufferView.byteLength > bin.offset + bin.length) return null
    return new Blob([new Uint8Array(glb, start, bufferView.byteLength)], {
      type: image.mimeType ?? '',
    })
  }
  return {
    normalMap: bytes(head.normalTexture?.index),
    roughnessMap: bytes(head.pbrMetallicRoughness?.metallicRoughnessTexture?.index),
  }
}

export type HeadDetail = Record<HeadMap, ImageBitmap | null>

/**
 * A character's head maps at the file's own size, decoded as three's glTF
 * loader decodes them: for the studio's close-ups. The file is the one the
 * body came from, so it is in the browser's cache.
 */
export async function loadHeadDetail(avatarId: string): Promise<HeadDetail> {
  const response = await fetch(avatarUrl(avatarId))
  if (!response.ok) throw new Error(`head detail: ${response.status} for ${avatarId}`)
  const images = headImages(await response.arrayBuffer())
  const decode = (blob: Blob | null) =>
    blob
      ? createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      : null
  const [normalMap, roughnessMap] = await Promise.all([
    decode(images.normalMap),
    decode(images.roughnessMap),
  ])
  return { normalMap, roughnessMap }
}
