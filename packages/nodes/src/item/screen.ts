import type { Mesh, Object3D } from 'three'
import { create } from 'zustand'

/**
 * The material slot a TV or monitor model gives its display surface
 * (`slot_screen`), as the item renderer records it in `userData.slotId`.
 */
export const SCREEN_SLOT = 'screen'

/**
 * What a screen shows:
 *  - `idle`: the switched-on standby picture;
 *  - `video`: a playing video element (a file, or a shared screen's stream);
 *  - `slides`: presentation pages (image URLs), one at a time.
 */
export type ScreenContent =
  | { kind: 'idle' }
  | { kind: 'video'; video: HTMLVideoElement; label: string }
  | { kind: 'slides'; pages: string[]; index: number; label: string }

export type ItemScreen = { content: ScreenContent }

/**
 * The walkthrough's screens (TVs, monitors) that are switched on, by item id,
 * and the one last used — the one the remote controls. A view state: not saved.
 */
export const useItemScreens = create<{
  screens: Record<string, ItemScreen>
  activeId: string | null
  setOn: (id: string, on: boolean) => void
  setContent: (id: string, content: ScreenContent) => void
  /** Steps the slides of a screen showing them (+1 next, -1 previous). */
  step: (id: string, by: number) => void
  goTo: (id: string, index: number) => void
}>((set, get) => ({
  screens: {},
  activeId: null,
  setOn: (id, on) => {
    const screens = { ...get().screens }
    if (on) screens[id] = screens[id] ?? { content: { kind: 'idle' } }
    else {
      releaseContent(screens[id]?.content)
      delete screens[id]
    }
    set({ screens, activeId: on ? id : get().activeId === id ? null : get().activeId })
  },
  setContent: (id, content) => {
    const current = get().screens[id]?.content
    if (current !== content) releaseContent(current)
    set({ screens: { ...get().screens, [id]: { content } }, activeId: id })
  },
  step: (id, by) => {
    const content = get().screens[id]?.content
    if (content?.kind !== 'slides') return
    get().goTo(id, content.index + by)
  },
  goTo: (id, index) => {
    const content = get().screens[id]?.content
    if (content?.kind !== 'slides') return
    const clamped = Math.max(0, Math.min(content.pages.length - 1, index))
    if (clamped === content.index) return
    set({ screens: { ...get().screens, [id]: { content: { ...content, index: clamped } } } })
  },
}))

/** Stops a video (and a shared screen's capture), or frees slides, that nothing shows any more. */
function releaseContent(content: ScreenContent | undefined) {
  if (content?.kind === 'slides') {
    for (const page of content.pages) if (page.startsWith('blob:')) URL.revokeObjectURL(page)
    return
  }
  if (content?.kind !== 'video') return
  content.video.pause()
  const stream = content.video.srcObject as MediaStream | null
  for (const track of stream?.getTracks() ?? []) track.stop()
  if (content.video.src.startsWith('blob:')) URL.revokeObjectURL(content.video.src)
}

/** Whether each of a mesh's material slots is a display surface (one entry per material). */
export function screenSlots(mesh: Mesh): boolean[] {
  const slotId = mesh.userData.slotId as string | null | (string | null)[] | undefined
  return (Array.isArray(slotId) ? slotId : [slotId]).map((id) => id === SCREEN_SLOT)
}

/** The display-surface meshes in an item's model. */
export function screenMeshes(object: Object3D): Mesh[] {
  const found: Mesh[] = []
  object.traverse((child) => {
    const mesh = child as Mesh
    if (mesh.isMesh && screenSlots(mesh).some(Boolean)) found.push(mesh)
  })
  return found
}
