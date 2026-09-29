import {
  type AnyNodeId,
  type ControlValue,
  type DoorInteractiveState,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { moveDoorTo, moveWindowTo } from '@pascal-app/editor'
import { useCabinetDoors, useItemScreens } from '@pascal-app/nodes'
import { useViewer, WEATHERS, type Weather } from '@pascal-app/viewer'
import { getClock, setClock } from './time-of-day'
import type { WorldEntries, WorldValue } from './world-sync'

/**
 * What a TV shows, shared: another player can't receive a local video or a
 * screen capture, only that one is playing; slides travel as a shared deck
 * (`deck` is null while its pages are still being shared).
 */
export type SharedScreen =
  | { k: 'idle' }
  | { k: 'video'; label: string }
  | { k: 'slides'; deck: string | null; count: number; index: number; label: string }

/** The shared deck each set of slide pages was shared as, or came from. */
export const sharedDecks = new WeakMap<readonly string[], string>()

/** This player's world, as the entries the players share. */
export function readWorld(): WorldEntries {
  const entries: WorldEntries = {
    clock: Math.round(getClock() * 1000) / 1000,
    weather: useViewer.getState().weather,
  }
  const interactive = useInteractive.getState()
  for (const id of new Set([
    ...Object.keys(interactive.doors),
    ...Object.keys(interactive.doorAnimations),
  ])) {
    const animation = interactive.doorAnimations[id as AnyNodeId]
    const state = interactive.doors[id as AnyNodeId]
    const field: keyof DoorInteractiveState =
      animation?.field ?? (state?.swingAngle !== undefined ? 'swingAngle' : 'operationState')
    const value = animation?.to ?? state?.[field]
    if (value !== undefined) entries[`door:${id}`] = { f: field, v: value }
  }
  for (const id of new Set([
    ...Object.keys(interactive.windows),
    ...Object.keys(interactive.windowAnimations),
  ])) {
    const value =
      interactive.windowAnimations[id as AnyNodeId]?.to ??
      interactive.windows[id as AnyNodeId]?.operationState
    if (value !== undefined) entries[`window:${id}`] = value
  }
  for (const [id, item] of Object.entries(interactive.items)) {
    entries[`item:${id}`] = [...item.controlValues]
  }
  for (const [id, open] of Object.entries(useCabinetDoors.getState().cabinetOpen)) {
    entries[`cabinet:${id}`] = open
  }
  for (const node of Object.values(useScene.getState().nodes)) {
    if (node.type === 'light-switch') {
      entries[`switch:${node.id}`] = Array.from(
        { length: node.gangs },
        (_, g) => node.on[g] === true,
      )
    }
  }
  for (const [id, screen] of Object.entries(useItemScreens.getState().screens)) {
    const content = screen.content
    const shared: SharedScreen =
      content.kind === 'slides'
        ? {
            k: 'slides',
            deck: sharedDecks.get(content.pages) ?? null,
            count: content.pages.length,
            index: content.index,
            label: content.label,
          }
        : content.kind === 'video'
          ? { k: 'video', label: content.label }
          : { k: 'idle' }
    entries[`screen:${id}`] = shared
  }
  return entries
}

/** Pages of a shared deck: fetched once, then kept for its page turns. */
export type DeckLoader = (deck: string, count: number) => Promise<string[]>

/** The deck each screen should show once loaded (the latest one asked for wins). */
const wantedDecks = new Map<string, SharedScreen & { k: 'slides' }>()

/**
 * Applies another player's change to this player's world. A TV switched on
 * elsewhere doesn't take this player's remote.
 */
export function applyWorldEntry(key: string, value: WorldValue, loadDeck: DeckLoader) {
  if (key === 'clock') {
    if (typeof value === 'number') setClock(value)
    return
  }
  if (key === 'weather') {
    if (WEATHERS.includes(value as Weather)) useViewer.getState().setWeather(value as Weather)
    return
  }
  const split = key.indexOf(':')
  const kind = key.slice(0, split)
  const id = key.slice(split + 1) as AnyNodeId
  if (kind === 'door') {
    const door = value as { f?: unknown; v?: unknown } | null
    if ((door?.f === 'swingAngle' || door?.f === 'operationState') && typeof door.v === 'number') {
      moveDoorTo(id, door.f, door.v)
    }
  } else if (kind === 'window') {
    if (typeof value === 'number') moveWindowTo(id, value)
  } else if (kind === 'cabinet') {
    if (typeof value === 'boolean') {
      const doors = useCabinetDoors.getState()
      useCabinetDoors.setState({ cabinetOpen: { ...doors.cabinetOpen, [id]: value } })
    }
  } else if (kind === 'item') {
    applyItem(id, value)
  } else if (kind === 'switch') {
    const node = useScene.getState().nodes[id]
    if (node?.type === 'light-switch' && Array.isArray(value)) {
      useScene.getState().updateNode(id, { on: value.map((on) => on === true) })
    }
  } else if (kind === 'screen') {
    const screens = useItemScreens.getState()
    const activeId = screens.activeId
    applyScreen(id, value as SharedScreen | null, loadDeck)
    const now = useItemScreens.getState()
    if (now.activeId !== activeId) {
      useItemScreens.setState({ activeId: activeId && now.screens[activeId] ? activeId : null })
    }
  }
}

function applyItem(id: AnyNodeId, value: WorldValue) {
  const node = useScene.getState().nodes[id]
  if (node?.type !== 'item' || !Array.isArray(value)) return
  const interactive = useInteractive.getState()
  if (!interactive.items[id] && node.asset.interactive) {
    interactive.initItem(id, node.asset.interactive)
  }
  const current = useInteractive.getState().items[id]?.controlValues
  if (!current) return
  value.forEach((control, index) => {
    if (
      (typeof control === 'boolean' || typeof control === 'number') &&
      index < current.length &&
      current[index] !== control
    ) {
      useInteractive.getState().setControlValue(id, index, control as ControlValue)
    }
  })
}

function applyScreen(id: string, value: SharedScreen | null, loadDeck: DeckLoader) {
  const screens = useItemScreens.getState()
  const current = screens.screens[id]?.content
  if (value?.k !== 'slides') wantedDecks.delete(id)
  if (!value) {
    if (current) screens.setOn(id, false)
    return
  }
  if (value.k === 'slides' && value.deck) {
    if (current?.kind === 'slides' && sharedDecks.get(current.pages) === value.deck) {
      screens.goTo(id, value.index)
      return
    }
    const loading = wantedDecks.get(id)?.deck === value.deck
    wantedDecks.set(id, value)
    if (loading) return
    const deck = value.deck
    void loadDeck(deck, value.count).then(
      (pages) => {
        const wanted = wantedDecks.get(id)
        if (wanted?.deck !== deck) return
        wantedDecks.delete(id)
        sharedDecks.set(pages, deck)
        const activeId = useItemScreens.getState().activeId
        useItemScreens.getState().setContent(id, {
          kind: 'slides',
          pages,
          index: Math.min(wanted.index, pages.length - 1),
          label: wanted.label,
        })
        useItemScreens.setState({ activeId })
      },
      () => wantedDecks.delete(id),
    )
  }
  // A video, or slides still on their way: the TV stands by.
  if (!current) screens.setOn(id, true)
  else if (current.kind !== 'idle' && !(value.k === 'slides' && current.kind === 'slides')) {
    screens.setContent(id, { kind: 'idle' })
  }
}
