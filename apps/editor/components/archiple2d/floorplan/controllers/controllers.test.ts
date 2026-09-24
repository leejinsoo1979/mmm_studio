import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { KeyboardController } from './KeyboardController'
import { MouseController } from './MouseController'

function fakeCanvas() {
  const canvas = new EventTarget() as EventTarget & {
    getBoundingClientRect: () => { left: number; top: number }
    style: Record<string, string>
  }
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0 })
  canvas.style = {}
  return canvas
}

function recordingToolManager() {
  const calls = { down: 0, move: 0, up: 0, keyDown: 0 }
  return {
    calls,
    handleMouseDown: () => calls.down++,
    handleMouseMove: () => calls.move++,
    handleMouseUp: () => calls.up++,
    handleKeyDown: () => calls.keyDown++,
    handleKeyUp: () => {},
    getCursor: () => 'crosshair',
    getActiveTool: () => null,
  }
}

function mouse(type: string, button = 0) {
  return Object.assign(new Event(type), { clientX: 10, clientY: 20, button, shiftKey: false })
}

describe('MouseController', () => {
  test('dispose removes every listener it added', () => {
    const canvas = fakeCanvas()
    const tools = recordingToolManager()
    const controller = new MouseController(canvas as never, tools as never)
    controller.dispose()

    for (const type of ['mousedown', 'mousemove', 'mouseup', 'contextmenu']) {
      canvas.dispatchEvent(mouse(type))
    }

    expect(tools.calls).toEqual({ down: 0, move: 0, up: 0, keyDown: 0 })
  })

  test('re-initialising on the same canvas handles each input once', () => {
    const canvas = fakeCanvas()
    const previous = recordingToolManager()
    new MouseController(canvas as never, previous as never).dispose()
    const current = recordingToolManager()
    new MouseController(canvas as never, current as never)

    canvas.dispatchEvent(mouse('mousedown'))
    canvas.dispatchEvent(mouse('mousemove'))

    expect(previous.calls.down + previous.calls.move).toBe(0)
    expect(current.calls).toMatchObject({ down: 1, move: 1 })
  })
})

describe('KeyboardController', () => {
  const originalWindow = (globalThis as { window?: unknown }).window
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = new EventTarget()
  })
  afterEach(() => {
    ;(globalThis as { window?: unknown }).window = originalWindow
  })

  function recordingSceneManager() {
    const history = { undo: 0, redo: 0 }
    return {
      history,
      historyManager: { undo: () => history.undo++, redo: () => history.redo++ },
      setTool: () => {},
    }
  }

  function key(init: Record<string, unknown>) {
    return Object.assign(new Event('keydown'), {
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...init,
    })
  }

  test('dispose stops undo shortcuts from reaching the shared history', () => {
    const scene = recordingSceneManager()
    const tools = recordingToolManager()
    new KeyboardController(tools as never, scene as never).dispose()

    ;(globalThis as { window: EventTarget }).window.dispatchEvent(key({ key: 'z', ctrlKey: true }))

    expect(scene.history.undo).toBe(0)
    expect(tools.calls.keyDown).toBe(0)
  })

  test('Ctrl+Shift+Z (key "Z") redoes', () => {
    const scene = recordingSceneManager()
    new KeyboardController(recordingToolManager() as never, scene as never)

    ;(globalThis as { window: EventTarget }).window.dispatchEvent(
      key({ key: 'Z', ctrlKey: true, shiftKey: true }),
    )

    expect(scene.history).toEqual({ undo: 0, redo: 1 })
  })

  test('reopening the floor plan undoes once per Ctrl+Z', () => {
    const scene = recordingSceneManager()
    new KeyboardController(recordingToolManager() as never, scene as never).dispose()
    new KeyboardController(recordingToolManager() as never, scene as never)

    ;(globalThis as { window: EventTarget }).window.dispatchEvent(key({ key: 'z', ctrlKey: true }))

    expect(scene.history.undo).toBe(1)
  })
})
