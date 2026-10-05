import { create } from 'zustand'

/** The NPC whose look the inspector asked the app's character studio to edit. */
type NpcStudioRequestState = {
  nodeId: string | null
  request(nodeId: string): void
  clear(): void
}

export const useNpcStudioRequest = create<NpcStudioRequestState>((set) => ({
  nodeId: null,
  request: (nodeId) => set({ nodeId }),
  clear: () => set({ nodeId: null }),
}))
