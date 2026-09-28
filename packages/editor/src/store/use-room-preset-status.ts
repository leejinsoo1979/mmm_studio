// The 방 / 플랫폼 preset tool's phase, for the bottom hint line and the cursor
// key list: `editing` from the 3D click that drops the preset into its
// push-pull gizmo until 확인 / Enter commits it or Esc picks it up again.
// Ephemeral; the tool resets it when it unmounts.

import { create } from 'zustand'

type RoomPresetStatusState = {
  editing: boolean
  setEditing(editing: boolean): void
}

const useRoomPresetStatus = create<RoomPresetStatusState>((set, get) => ({
  editing: false,
  setEditing: (editing) => {
    if (get().editing !== editing) set({ editing })
  },
}))

export default useRoomPresetStatus
