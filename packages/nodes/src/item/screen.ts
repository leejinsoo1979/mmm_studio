import type { Mesh, Object3D } from 'three'
import { create } from 'zustand'
import { releasePageTextures, releaseVideoTexture } from './screen-textures'

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

/**
 * A screen's picture thrown onto a surface, as a beam projector does: its
 * centre, the turn that faces the picture (its +Z) out of the surface, and its
 * width in metres. The height follows the picture's own proportions.
 */
export type ScreenProjection = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  width: number
}

export type ItemScreen = { content: ScreenContent; projection?: ScreenProjection }

/** The screen with no TV behind it: a projector started from the game panel. */
export const PROJECTOR_ID = 'projector'

/** Projection widths (m): from a sheet of paper's worth to a whole wall. */
export const PROJECTION_WIDTH = { min: 0.3, max: 10, initial: 2 } as const

export const clampProjectionWidth = (width: number) =>
  Math.min(PROJECTION_WIDTH.max, Math.max(PROJECTION_WIDTH.min, width))

/**
 * The walkthrough's screens (TVs, monitors, the projector) that are switched
 * on, by id, and the one last used — the one the remote controls. While a
 * projection is being placed, `placing` holds its screen and width. A view
 * state: not saved.
 */
export const useItemScreens = create<{
  screens: Record<string, ItemScreen>
  activeId: string | null
  placing: { id: string; width: number } | null
  setOn: (id: string, on: boolean) => void
  setContent: (id: string, content: ScreenContent) => void
  /** Steps the slides of a screen showing them (+1 next, -1 previous). */
  step: (id: string, by: number) => void
  goTo: (id: string, index: number) => void
  /** Throws a screen's picture onto a surface, or takes it off (null). */
  setProjection: (id: string, projection: ScreenProjection | null) => void
  setProjectionWidth: (id: string, width: number) => void
  /** Aiming a projection for a screen: it starts at the screen's current projection width. */
  startPlacing: (id: string) => void
  /** Scales the projection being aimed (×factor), within the widths a projection takes. */
  resizePlacing: (factor: number) => void
  cancelPlacing: () => void
}>((set, get) => ({
  screens: {},
  activeId: null,
  placing: null,
  setOn: (id, on) => {
    const screens = { ...get().screens }
    if (on) screens[id] = screens[id] ?? { content: { kind: 'idle' } }
    else {
      releaseContent(screens[id]?.content)
      delete screens[id]
    }
    const { activeId, placing } = get()
    set({
      screens,
      activeId: on ? id : activeId === id ? null : activeId,
      placing: !on && placing?.id === id ? null : placing,
    })
  },
  setContent: (id, content) => {
    const current = get().screens[id]
    if (current?.content !== content) releaseContent(current?.content)
    set({ screens: { ...get().screens, [id]: { ...current, content } }, activeId: id })
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
    const screen = get().screens[id]
    set({
      screens: { ...get().screens, [id]: { ...screen, content: { ...content, index: clamped } } },
    })
  },
  setProjection: (id, projection) => {
    const screen = get().screens[id]
    if (!screen) return
    const next: ItemScreen = { content: screen.content }
    if (projection)
      next.projection = { ...projection, width: clampProjectionWidth(projection.width) }
    set({ screens: { ...get().screens, [id]: next } })
  },
  setProjectionWidth: (id, width) => {
    const projection = get().screens[id]?.projection
    if (projection) get().setProjection(id, { ...projection, width })
  },
  startPlacing: (id) => {
    if (!get().screens[id]) return
    const width = get().screens[id]?.projection?.width ?? PROJECTION_WIDTH.initial
    set({ placing: { id, width } })
  },
  resizePlacing: (factor) => {
    const placing = get().placing
    if (placing)
      set({ placing: { ...placing, width: clampProjectionWidth(placing.width * factor) } })
  },
  cancelPlacing: () => set({ placing: null }),
}))

/** Stops a video (and a shared screen's capture), or frees slides, that nothing shows any more. */
function releaseContent(content: ScreenContent | undefined) {
  if (content?.kind === 'slides') {
    releasePageTextures(content.pages)
    for (const page of content.pages) if (page.startsWith('blob:')) URL.revokeObjectURL(page)
    return
  }
  if (content?.kind !== 'video') return
  releaseVideoTexture(content.video)
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
