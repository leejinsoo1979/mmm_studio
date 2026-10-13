import {
  type AvatarGender,
  buildPhotoAvatar,
  type CaptureSlot,
  type PhotoAvatarProgress,
  type StoredPhotoAvatar,
} from '@pascal-app/editor'
import { cardPicture, finishPhotos, type ReadPhoto, readPhoto } from '@/lib/photo-capture'

/**
 * Making a photo avatar, all in this browser: the photos read (landmarks,
 * outline, skin), the head fitted to every one of them at once and its skin
 * laid from them in a worker, and the result with its card picture, ready
 * to be shown on the stage and kept.
 */

export type PhotoInput = {
  picture: HTMLImageElement | HTMLCanvasElement | ImageBitmap
  slot: CaptureSlot
}

export type MakeProgress = { fraction: number; text: string }

/** A photo avatar that could not be made; its message is the player's (Korean). */
export class PhotoAvatarError extends Error {}

const STAGE_TEXT: Record<PhotoAvatarProgress['stage'], string> = {
  fit: '얼굴 모양을 사진에 맞추고 있어요 (옆모습 포함)',
  texture: '사진에서 피부를 입히고 있어요',
  pack: '아바타 파일을 만들고 있어요',
}

/** The first photo with a face, the front one if it has one: the colours and the card come from it. */
export function frontOf(photos: ReadPhoto[]): ReadPhoto | null {
  return (
    photos.find((photo) => photo.view.slot === 'front' && photo.face) ??
    photos.find((photo) => photo.face) ??
    null
  )
}

/** What is wrong with the photos as read, said to the player; null when they will do. */
export function photoProblem(photos: ReadPhoto[]): string | null {
  const front = frontOf(photos)
  if (!front)
    return '정면 사진에서 얼굴을 찾지 못했어요. 얼굴 전체가 밝고 크게 나온 사진으로 다시 해 주세요.'
  if (front.faces > 1) return '사진에 얼굴이 여러 개 있어요. 한 사람만 나온 사진을 써 주세요.'
  for (const photo of photos) {
    const { mask, width, height } = photo.view
    let person = 0
    if (mask) for (let i = 0; i < mask.length; i++) if (mask[i]! > 127) person++
    if (person < width * height * 0.04) {
      return '사람이 잘 보이지 않는 사진이 있어요. 머리와 어깨가 화면에 들어오게 다시 찍어 주세요.'
    }
  }
  return null
}

export async function makePhotoAvatar({
  photos,
  gender,
  name,
  source,
  onProgress,
  signal,
}: {
  photos: PhotoInput[]
  gender: AvatarGender
  name: string
  source: StoredPhotoAvatar['source']
  onProgress: (progress: MakeProgress) => void
  signal?: AbortSignal
}): Promise<StoredPhotoAvatar> {
  const read: ReadPhoto[] = []
  for (const [k, photo] of photos.entries()) {
    onProgress({
      fraction: (0.15 * k) / photos.length,
      text: `사진을 읽고 있어요 (${k + 1}/${photos.length})`,
    })
    read.push(await readPhoto(photo.picture, photo.slot))
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  }
  const problem = photoProblem(read)
  if (problem) throw new PhotoAvatarError(problem)
  const colors = finishPhotos(read)
  const front = frontOf(read)
  if (!colors || !front)
    throw new PhotoAvatarError(
      '사진에서 피부색을 읽지 못했어요. 밝은 곳에서 찍은 사진으로 다시 해 주세요.',
    )
  const thumbnail = await cardPicture(front)
  onProgress({ fraction: 0.15, text: STAGE_TEXT.fit })
  let built: Awaited<ReturnType<typeof buildPhotoAvatar>>
  try {
    built = await buildPhotoAvatar(
      { gender, views: read.map((photo) => photo.view), colors },
      ({ fraction, stage }) =>
        onProgress({ fraction: 0.15 + 0.85 * fraction, text: STAGE_TEXT[stage] }),
      signal,
    )
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new PhotoAvatarError('아바타를 만들지 못했어요. 다시 시도해 주세요.')
  }
  return {
    id: crypto.randomUUID(),
    name,
    gender,
    source,
    createdAt: Date.now(),
    glb: new Blob([built.glb as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }),
    thumbnail,
  }
}

/** A picture file the player chose, opened for reading. */
export function openPicture(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new PhotoAvatarError('사진을 열 수 없어요. JPG나 PNG 사진을 골라 주세요.'))
    }
    image.src = url
  })
}
