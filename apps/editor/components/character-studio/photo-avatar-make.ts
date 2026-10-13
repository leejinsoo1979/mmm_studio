import {
  type AvatarGender,
  buildPhotoAvatar,
  type CaptureSlot,
  EXPOSURE,
  EXPRESSION,
  MIN_BALANCE,
  type PhotoAvatarProgress,
  type StoredPhotoAvatar,
} from '@pascal-app/editor'
import {
  cardPicture,
  finishPhotos,
  photoLight,
  type ReadPhoto,
  readPhoto,
} from '@/lib/photo-capture'

/**
 * Making a photo avatar, all in this browser: the photos read (landmarks,
 * outline, skin), the head fitted to every one of them at once and its skin
 * laid from them in a worker, and the result, ready to be shown on the
 * stage and kept. A real person's photo never becomes its card: the card is
 * a placeholder until the avatar is kept, then a render of the avatar
 * (`stageCard`); only an AI 인물's fictional portrait is cropped for one.
 */

export type PhotoInput = {
  picture: HTMLImageElement | HTMLCanvasElement | ImageBitmap
  slot: CaptureSlot
}

export type MakeProgress = { fraction: number; text: string }

/** A photo avatar that could not be made; its message is the player's (Korean). */
export class PhotoAvatarError extends Error {}

/** A photo avatar made, and what the player should know about how it was made (Korean). */
export type MadeAvatar = { avatar: StoredPhotoAvatar; notes: string[] }

const STAGE_TEXT: Record<PhotoAvatarProgress['stage'], string> = {
  fit: '얼굴 모양을 사진에 맞추고 있어요 (옆모습 포함)',
  texture: '사진에서 피부를 입히고 있어요',
  pack: '아바타 파일을 만들고 있어요',
}

/** The card pictures' size (twice the cards' 128 × 208). */
const CARD = { width: 256, height: 416 }

/** The first photo with a face, the front one if it has one: the colours come from it. */
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
  if (photos.some((photo) => photo.faces > 1))
    return '사진에 얼굴이 여러 개 있어요. 한 사람만 나온 사진을 써 주세요.'
  const { exposure } = photoLight(front)
  if (exposure !== null && exposure < EXPOSURE.least)
    return '사진이 너무 어두워요. 밝은 곳에서 얼굴에 빛이 고르게 닿게 다시 찍어 주세요.'
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

/** What will show in the avatar from photos that are usable but not ideal (Korean). */
export function photoNotes(photos: ReadPhoto[]): string[] {
  const notes: string[] = []
  const front = frontOf(photos)
  if (!photos.some((photo) => photo.view.slot !== 'front' && photo.view.slot !== 'free')) {
    notes.push(
      '옆모습 추정: 사진 한 장으로는 코 높이·이마·턱 같은 옆모습을 알 수 없어 평균 얼굴로 추정했어요. 3D 얼굴 촬영으로 옆에서도 찍으면 실제 모양이 돼요.',
    )
  } else if (!photos.some((photo) => photo.view.slot === 'left90' || photo.view.slot === 'right90')) {
    notes.push('옆얼굴(90°) 사진이 없어 코·턱 옆모습이 덜 정확할 수 있어요.')
  }
  const shapes = front?.view.blendshapes
  if (shapes) {
    const most = (...names: string[]) => Math.max(...names.map((name) => shapes[name] ?? 0))
    if (most('mouthSmileLeft', 'mouthSmileRight') > EXPRESSION.smile || most('jawOpen') > EXPRESSION.jawOpen)
      notes.push('정면 사진이 웃거나 입을 벌린 얼굴이라 입 모양이 실제와 다를 수 있어요.')
    if (most('eyeBlinkLeft', 'eyeBlinkRight') > EXPRESSION.blink)
      notes.push('정면 사진에서 눈을 감고 있어 눈동자 색은 기본색으로 했어요.')
  }
  const balance = front ? photoLight(front).balance : null
  if (balance !== null && balance < MIN_BALANCE)
    notes.push('정면 사진의 얼굴 한쪽이 어두워 피부색이 고르지 않을 수 있어요.')
  return notes
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
}): Promise<MadeAvatar> {
  const stopped = () => {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  }
  const read: ReadPhoto[] = []
  for (const [k, photo] of photos.entries()) {
    onProgress({
      fraction: (0.15 * k) / photos.length,
      text: `사진을 읽고 있어요 (${k + 1}/${photos.length})`,
    })
    read.push(await readPhoto(photo.picture, photo.slot))
    stopped()
  }
  const problem = photoProblem(read)
  if (problem) throw new PhotoAvatarError(problem)
  const colors = finishPhotos(read)
  const front = frontOf(read)
  if (!colors || !front)
    throw new PhotoAvatarError(
      '사진에서 피부색을 읽지 못했어요. 밝은 곳에서 찍은 사진으로 다시 해 주세요.',
    )
  const thumbnail = source === 'ai' ? await cardPicture(front) : await blankCard()
  stopped()
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
  stopped()
  const profileEstimated = !read.some((photo) => photo.view.slot !== 'front')
  return {
    avatar: {
      id: crypto.randomUUID(),
      name,
      gender,
      source,
      profileEstimated,
      createdAt: Date.now(),
      glb: new Blob([built.glb as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }),
      thumbnail,
    },
    notes: photoNotes(read),
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('card picture'))),
      type,
      quality,
    ),
  )

function cardCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = CARD.width
  canvas.height = CARD.height
  return { canvas, context: canvas.getContext('2d')! }
}

/** A card with no picture of anyone on it: an outline of a head and shoulders. */
async function blankCard(): Promise<Blob> {
  const { canvas, context } = cardCanvas()
  context.fillStyle = '#1c1c1f'
  context.fillRect(0, 0, CARD.width, CARD.height)
  context.fillStyle = 'rgba(255,255,255,0.18)'
  context.beginPath()
  context.arc(CARD.width / 2, 140, 52, 0, Math.PI * 2)
  context.fill()
  context.beginPath()
  context.ellipse(CARD.width / 2, 330, 104, 112, 0, Math.PI, 0)
  context.fill()
  return toBlob(canvas, 'image/png')
}

/**
 * The card of a kept avatar from the stage's shot of it, standing full
 * length (2:3): scaled to the card's height and cut to its width.
 */
export async function stageCard(shot: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(shot)
  try {
    const { canvas, context } = cardCanvas()
    const scale = CARD.height / bitmap.height
    const width = bitmap.width * scale
    context.drawImage(bitmap, (CARD.width - width) / 2, 0, width, CARD.height)
    return await toBlob(canvas, 'image/jpeg', 0.88)
  } finally {
    bitmap.close()
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
