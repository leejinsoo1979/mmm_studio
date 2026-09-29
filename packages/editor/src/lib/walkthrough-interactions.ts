import type { Raycaster } from 'three'
import { create } from 'zustand'

/** Something the walker can use from where they stand: what E would do to it, and how far it is. */
export type WalkthroughTarget = { id: string; label: string; distance: number }

/**
 * A kind of usable thing in the walkthrough — a cabinet, a lamp, a light
 * switch, a TV. Node kinds register one from their system, so the walkthrough
 * controls stay unaware of them: each frame the nearest thing any registered
 * interaction finds under the aim is offered, and E uses it.
 */
export type WalkthroughInteraction = {
  /**
   * The nearest thing of this kind the aim ray hits, within the ray's `far`
   * reach (already set, from the walker's eyes).
   */
  resolve: (raycaster: Raycaster) => WalkthroughTarget | null
  activate: (id: string) => void
}

const interactions = new Map<string, WalkthroughInteraction>()

/** Registers `interaction` under `key`; the returned function unregisters it. */
export function registerWalkthroughInteraction(key: string, interaction: WalkthroughInteraction) {
  interactions.set(key, interaction)
  return () => {
    if (interactions.get(key) === interaction) interactions.delete(key)
  }
}

export type ResolvedWalkthroughTarget = WalkthroughTarget & { key: string }

/** The nearest thing any registered interaction offers under the aim. */
export function resolveWalkthroughTarget(raycaster: Raycaster): ResolvedWalkthroughTarget | null {
  let nearest: ResolvedWalkthroughTarget | null = null
  for (const [key, interaction] of interactions) {
    const target = interaction.resolve(raycaster)
    if (target && (!nearest || target.distance < nearest.distance)) nearest = { ...target, key }
  }
  return nearest
}

export function activateWalkthroughTarget(target: { key: string; id: string }) {
  interactions.get(target.key)?.activate(target.id)
}

/** What E does to the thing in the walker's aim, for the overlay's prompt ("TV 켜기"). */
export const useWalkthroughPrompt = create<{ label: string | null }>(() => ({ label: null }))
