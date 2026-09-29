import { beforeEach, describe, expect, test } from 'bun:test'
import { PROJECTION_WIDTH, type ScreenProjection, useItemScreens } from './screen'

const wall: ScreenProjection = { position: [0, 1.5, -3], quaternion: [0, 0, 0, 1], width: 2.4 }

beforeEach(() => {
  useItemScreens.setState({ screens: {}, activeId: null, placing: null })
})

describe('screen projections', () => {
  test("a projection stays through the screen's content changes and page turns", () => {
    const screens = useItemScreens.getState()
    screens.setOn('tv', true)
    screens.setProjection('tv', wall)
    screens.setContent('tv', { kind: 'slides', pages: ['a', 'b'], index: 0, label: 'deck' })
    useItemScreens.getState().step('tv', 1)
    const screen = useItemScreens.getState().screens.tv
    expect(screen?.projection).toEqual(wall)
    expect(screen?.content).toMatchObject({ kind: 'slides', index: 1 })
  })

  test('a projection keeps to the widths a projector throws', () => {
    const screens = useItemScreens.getState()
    screens.setOn('tv', true)
    screens.setProjection('tv', { ...wall, width: 40 })
    expect(useItemScreens.getState().screens.tv?.projection?.width).toBe(PROJECTION_WIDTH.max)
    useItemScreens.getState().setProjectionWidth('tv', 0.01)
    expect(useItemScreens.getState().screens.tv?.projection?.width).toBe(PROJECTION_WIDTH.min)
  })

  test('only a switched-on screen takes a projection', () => {
    useItemScreens.getState().setProjection('tv', wall)
    expect(useItemScreens.getState().screens.tv).toBeUndefined()
  })

  test('placing starts at the current width and resizes within the limits', () => {
    const screens = useItemScreens.getState()
    screens.setOn('tv', true)
    screens.startPlacing('tv')
    expect(useItemScreens.getState().placing).toEqual({ id: 'tv', width: PROJECTION_WIDTH.initial })
    screens.setProjection('tv', wall)
    screens.startPlacing('tv')
    expect(useItemScreens.getState().placing?.width).toBe(2.4)
    for (let i = 0; i < 100; i++) useItemScreens.getState().resizePlacing(1.1)
    expect(useItemScreens.getState().placing?.width).toBe(PROJECTION_WIDTH.max)
  })

  test('switching the screen off ends its projection and its placing', () => {
    const screens = useItemScreens.getState()
    screens.setOn('tv', true)
    screens.setProjection('tv', wall)
    screens.startPlacing('tv')
    useItemScreens.getState().setOn('tv', false)
    expect(useItemScreens.getState().screens.tv).toBeUndefined()
    expect(useItemScreens.getState().placing).toBeNull()
  })
})
