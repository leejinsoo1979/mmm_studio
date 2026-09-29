'use client'

import { ItemLightSystem, ItemSystem } from '@pascal-app/viewer'
import { ItemScreenSystem } from './screen-system'
import { ItemWalkthroughToggle } from './walkthrough-toggle'

/**
 * Registry-driven item system bundle.
 *
 *  - **`ItemSystem`** — applies attachTo-driven transforms each frame
 *    (wall-side z-offset, slab elevation, ceiling mounting).
 *  - **`ItemLightSystem`** — manages light sources attached to items
 *    (lamps, ceiling lights, etc.).
 *  - **`ItemWalkthroughToggle`** — E in the walkthrough switches the item
 *    in the aim on or off.
 *  - **`ItemScreenSystem`** — TVs and monitors: E switches them on, and they
 *    show a video, a shared screen or slides.
 */
const ItemSystems = () => {
  return (
    <>
      <ItemSystem />
      <ItemLightSystem />
      <ItemWalkthroughToggle />
      <ItemScreenSystem />
    </>
  )
}

export default ItemSystems
