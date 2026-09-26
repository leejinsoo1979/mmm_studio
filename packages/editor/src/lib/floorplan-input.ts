// Native events the 2D floor plan re-emits as `grid:*` events. The floor plan
// owns the commit for input it received (in every view mode — the hidden 3D
// canvas keeps its tools mounted), so a 3D tool listening on the shared bus
// must mirror such an event, not act on it a second time.
const floorplanInputEvents = new WeakSet<object>()

export function markFloorplanInputEvent(event: object): void {
  floorplanInputEvents.add(event)
}

export function isFloorplanInputEvent(event: object | null | undefined): boolean {
  return event ? floorplanInputEvents.has(event) : false
}
