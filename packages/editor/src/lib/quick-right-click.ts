/**
 * A right click (inZOI: turn the held object) as opposed to a right-drag
 * camera orbit: the pointer barely moved between press and release. Not
 * timed — a slow frame can hold the release back well past any short window.
 * While subscribed and `active()`, the OS context menu is suppressed.
 */
const MAX_MOVE_PX = 4

export function subscribeQuickRightClick(
  active: () => boolean,
  onClick: (event: PointerEvent) => void,
): () => void {
  let down: { x: number; y: number } | null = null
  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 2) down = { x: event.clientX, y: event.clientY }
  }
  const onPointerUp = (event: PointerEvent) => {
    if (event.button !== 2) return
    const start = down
    down = null
    if (!(start && active())) return
    const movedSq = (event.clientX - start.x) ** 2 + (event.clientY - start.y) ** 2
    if (movedSq <= MAX_MOVE_PX ** 2) onClick(event)
  }
  const onContextMenu = (event: MouseEvent) => {
    if (active()) event.preventDefault()
  }
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('contextmenu', onContextMenu)
  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('contextmenu', onContextMenu)
  }
}
