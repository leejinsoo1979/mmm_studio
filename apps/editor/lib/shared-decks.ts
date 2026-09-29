import { doc, type Firestore, getDoc, setDoc } from 'firebase/firestore'

/** Longest side of a shared page: still sharp on a TV across the room. */
const SHARED_PAGE_SIZE = 1600
/** A Firestore document holds up to 1 MiB: pages stay under it, with room to spare. */
const MAX_PAGE_CHARS = 900_000

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`page image failed: ${url}`))
    image.src = url
  })
}

/** A page as a JPEG data URL small enough to go in one document. */
async function pageDataUrl(url: string): Promise<string> {
  const image = await loadImage(url)
  let scale = Math.min(1, SHARED_PAGE_SIZE / Math.max(image.width, image.height))
  for (;;) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.7, 0.55]) {
      const data = canvas.toDataURL('image/jpeg', quality)
      if (data.length <= MAX_PAGE_CHARS) return data
    }
    scale *= 0.75
  }
}

const pageRef = (db: Firestore, sceneId: string, deck: string, page: number) =>
  doc(db, 'runtimeSessions', sceneId, 'state', `deck_${deck}_${page}`)

/** Shares presentation pages with the session's players; resolves to the deck's id. */
export async function uploadDeck(db: Firestore, sceneId: string, pages: readonly string[]) {
  const deck = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  await Promise.all(
    pages.map(async (url, page) =>
      setDoc(pageRef(db, sceneId, deck, page), { data: await pageDataUrl(url) }),
    ),
  )
  return deck
}

/** A shared deck's pages (data URLs). */
export async function downloadDeck(db: Firestore, sceneId: string, deck: string, count: number) {
  return Promise.all(
    Array.from({ length: count }, async (_, page) => {
      const snapshot = await getDoc(pageRef(db, sceneId, deck, page))
      const data = snapshot.data()?.data
      if (typeof data !== 'string') throw new Error(`deck ${deck} page ${page} missing`)
      return data
    }),
  )
}
