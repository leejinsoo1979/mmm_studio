// The running length of the wall / room being drawn, shown next to the cursor
// in the tool hint block (where inZOI shows the build cost). Ephemeral.

import { create } from 'zustand'

type DraftReadoutState = {
  text: string | null
  set(text: string | null): void
}

const useDraftReadout = create<DraftReadoutState>((set, get) => ({
  text: null,
  set: (text) => {
    if (get().text !== text) set({ text })
  },
}))

export default useDraftReadout
