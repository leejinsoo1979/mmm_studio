'use client'

import {
  FACE_HANDLE,
  type FaceHandleId,
  faceAnchors,
  type HeadFrame,
  headFrame,
  headOf,
} from '@pascal-app/editor'
import { useFrame } from '@react-three/fiber'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  type BufferGeometry,
  Matrix3,
  Matrix4,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  type SkinnedMesh,
  Vector3,
} from 'three'
import { cn } from '@/lib/utils'
import {
  dragDelta,
  facingOpacity,
  type GrabFrame,
  grabFrame,
  hitRadius,
  KEY_NUDGE_FAST,
  nearestHandle,
  nudgePixels,
  type ProjectedHandle,
  ringPixels,
  type ScreenMove,
} from './sculpt-gesture'
import type { SculptEvent, SculptSettings } from './stage-contract'

/**
 * The face's handles: points on the head the player drags to sculpt it.
 * Inside the canvas, a projector finds where each handle's vertex is every
 * frame and writes it straight into the DOM overlay's elements (no React
 * state per frame); the overlay draws them, and the stage's gestures grab
 * and drag them through the board both share.
 */

/** The overlay's state: what React draws (changes on gestures, not per frame). */
export type HandleState = {
  /** The handles the head has, in the catalogue's order. */
  ids: readonly FaceHandleId[]
  hover: FaceHandleId | null
  /** The handle the keyboard is on. */
  focus: FaceHandleId | null
  /** The handle being dragged (by the pointer or the keys). */
  active: FaceHandleId | null
  /** The turntable is being dragged: the handles step back. */
  turning: boolean
}

/** A handle as projected last frame. */
type HandlePoint = ProjectedHandle & {
  /** Where its vertex is (world). */
  world: Vector3
  /** The sculpt's radius on the screen (CSS px); 0 for an ear. */
  ring: number
  opacity: number
}

/** A handle in hand: its grab frame, where it showed when taken (CSS px) and the move since. */
type HandleDrag = {
  handle: FaceHandleId
  frame: GrabFrame
  x: number
  y: number
  move: ScreenMove
  moved: boolean
  /** A move not yet told (the projector tells it once a frame). */
  pending: boolean
  keyboard: boolean
  pointerId: number | null
}

export type HandleBoard = {
  sculpt: SculptSettings | null
  /** The character's face landmarks (packed front-view points); null: a covered face; undefined: loading. */
  target: readonly number[] | null | undefined
  state: HandleState
  listeners: Set<() => void>
  points: Map<FaceHandleId, HandlePoint>
  drag: HandleDrag | null
  /** The camera is still easing in on a new framing: the handles wait, rather than pile up on a face still small. */
  settling: boolean
  /** Where the active handle is drawn while the pointer drags it (CSS px); null: at its vertex. */
  pointer: { x: number; y: number } | null
  /** The head as last projected: its bind-to-world matrix as the head bone carries it, and its front view's size. */
  skin: Matrix4
  size: number
  camera: PerspectiveCamera | null
  height: number
  elements: Map<FaceHandleId, HTMLElement>
  ring: SVGCircleElement | null
  ringBox: SVGSVGElement | null
  line: HTMLElement | null
  onSculpt: (event: SculptEvent) => void
  onHover: (handle: FaceHandleId | null) => void
}

export function createHandleBoard(): HandleBoard {
  return {
    sculpt: null,
    target: undefined,
    state: {
      ids: [],
      hover: null,
      focus: null,
      active: null,
      turning: false,
    },
    listeners: new Set(),
    points: new Map(),
    drag: null,
    settling: false,
    pointer: null,
    skin: new Matrix4(),
    size: 1,
    camera: null,
    height: 1,
    elements: new Map(),
    ring: null,
    ringBox: null,
    line: null,
    onSculpt: () => {},
    onHover: () => {},
  }
}

export function setHandleState(board: HandleBoard, patch: Partial<HandleState>) {
  const next = { ...board.state, ...patch }
  const changed = (Object.keys(patch) as (keyof HandleState)[]).some(
    (key) => next[key] !== board.state[key],
  )
  if (!changed) return
  board.state = next
  for (const listener of board.listeners) listener()
}

/** The handle under a point on the stage (CSS px), within reach of the pointer kind. */
export function hitHandle(
  board: HandleBoard,
  point: { x: number; y: number },
  pointerType: string,
): FaceHandleId | null {
  if (!board.sculpt) return null
  return nearestHandle(board.points.values(), point, hitRadius(pointerType))
}

export function hoverHandle(board: HandleBoard, handle: FaceHandleId | null) {
  if (board.state.hover === handle) return
  setHandleState(board, { hover: handle })
  board.onHover(handle)
}

/**
 * Takes a handle: fixes its grab frame and tells `start`. `pointer` is the
 * pointer's place and id for a pointer drag (the handle is then drawn
 * following it); none for the keyboard's.
 */
export function grabHandle(
  board: HandleBoard,
  handle: FaceHandleId,
  pointer: { x: number; y: number; id: number } | null,
): boolean {
  const point = board.points.get(handle)
  if (!(point?.visible && board.camera && board.sculpt)) return false
  if (board.drag) dropHandle(board, false)
  board.drag = {
    handle,
    frame: grabFrame(board.camera, point.world, board.skin, board.size, board.height),
    x: point.x,
    y: point.y,
    move: { dx: 0, dy: 0, dz: 0 },
    moved: false,
    pending: false,
    keyboard: !pointer,
    pointerId: pointer?.id ?? null,
  }
  board.pointer = pointer ? { x: point.x, y: point.y } : null
  setHandleState(board, { active: handle })
  board.onSculpt({ phase: 'start', handle })
  return true
}

/** Moves the handle in hand by the whole screen move since it was taken; told once a frame. */
export function dragHandle(
  board: HandleBoard,
  move: ScreenMove,
  drawnAt?: { x: number; y: number },
) {
  const drag = board.drag
  if (!drag) return
  drag.move = move
  drag.moved = true
  drag.pending = true
  if (drawnAt) board.pointer = drawnAt
}

/** Lets the handle go: `end` with its whole move when it moved and `commit`, `cancel` otherwise. */
export function dropHandle(board: HandleBoard, commit: boolean) {
  const drag = board.drag
  if (!drag) return
  board.drag = null
  board.pointer = null
  const { handle } = drag
  const keep = commit && drag.moved
  setHandleState(board, { active: null })
  if (keep) board.onSculpt({ phase: 'end', handle, delta: dragDelta(drag.frame, drag.move) })
  else board.onSculpt({ phase: 'cancel', handle })
}

/** The handles that show now, in the catalogue's order. */
const shown = (board: HandleBoard) =>
  board.state.ids.filter((id) => (board.points.get(id)?.opacity ?? 0) > 0)

/**
 * The handle group's keys (a toolbar with one tab stop): arrows step
 * through the handles; Enter or Space takes one, the arrows (Shift: four
 * times as far) and PageUp/PageDown move it, Enter or Space lets it go and
 * Esc puts it back. Returns whether the key was the group's.
 */
export function handleKey(board: HandleBoard, event: KeyboardEvent): boolean {
  const drag = board.drag
  if (drag?.keyboard) {
    const step = nudgePixels(drag.frame) * (event.shiftKey ? KEY_NUDGE_FAST : 1)
    const move = { ...drag.move }
    switch (event.key) {
      case 'ArrowLeft':
        move.dx -= step
        break
      case 'ArrowRight':
        move.dx += step
        break
      case 'ArrowUp':
        move.dy -= step
        break
      case 'ArrowDown':
        move.dy += step
        break
      case 'PageUp':
        move.dz -= step
        break
      case 'PageDown':
        move.dz += step
        break
      case 'Enter':
      case ' ':
        dropHandle(board, true)
        return true
      case 'Escape':
        dropHandle(board, false)
        return true
      default:
        return false
    }
    dragHandle(board, move)
    board.onSculpt({ phase: 'move', handle: drag.handle, delta: dragDelta(drag.frame, move) })
    drag.pending = false
    return true
  }
  const at = board.state.focus
  if (!at) return false
  if (event.key === 'Enter' || event.key === ' ') {
    grabHandle(board, at, null)
    return true
  }
  const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
  const ahead = event.key === 'ArrowRight' || event.key === 'ArrowDown'
  if (!(back || ahead)) return false
  const list = shown(board)
  if (list.length === 0) return true
  const index = list.indexOf(at)
  const next = index < 0 ? list[0]! : list[(index + (ahead ? 1 : list.length - 1)) % list.length]!
  board.elements.get(next)?.focus()
  return true
}

/** A head's front view (found once per head: it reads every vertex). */
const frames = new WeakMap<BufferGeometry, HeadFrame>()
/** Ear vertices' outward axis in the bind pose, per head and vertex. */
const earAxes = new WeakMap<Mesh, Map<number, Vector3>>()

function frameOf(head: Mesh): HeadFrame {
  const geometry = (head.userData.shapeOriginal as BufferGeometry | undefined) ?? head.geometry
  let frame = frames.get(geometry)
  if (!frame) {
    frame = headFrame(head)
    frames.set(geometry, frame)
  }
  return frame
}

/** Which way an ear stands out of the skull (bind pose): from the head's middle out through the vertex, level. */
function earAxis(head: Mesh, vertex: number): Vector3 {
  let axes = earAxes.get(head)
  if (!axes) {
    axes = new Map()
    earAxes.set(head, axes)
  }
  let axis = axes.get(vertex)
  if (!axis) {
    const geometry = (head.userData.shapeOriginal as BufferGeometry | undefined) ?? head.geometry
    const skinned = head as SkinnedMesh
    const place = new Vector3().fromBufferAttribute(geometry.getAttribute('position')!, vertex)
    if (skinned.isSkinnedMesh) place.applyMatrix4(skinned.bindMatrix)
    const { neck } = frameOf(head)
    axis = new Vector3(place.x - neck.x, 0, place.z - neck.z)
    if (axis.lengthSq() < 1e-12) axis.set(Math.sign(place.x - neck.x) || 1, 0, 0)
    axis.normalize()
    axes.set(vertex, axis)
  }
  return axis
}

const HEAD_BONE = /Head$/

/**
 * How much further round a handle on the face's middle (the nose, the
 * lips, the chin) stays shown: it lies on the profile's outline, where its
 * skin faces across the view, and the side view is where it is pulled
 * forward or back.
 */
const MIDLINE_LEAD = 0.3

const place = new Vector3()
const normal = new Vector3()
const view = new Vector3()
const forward = new Vector3()
const screen = new Vector3()
const column = new Vector3()
const normalMatrix = new Matrix3()
const earMatrix = new Matrix3()
const bound = new Matrix4()

function hide(element: HTMLElement | SVGElement | null | undefined) {
  if (element && element.style.visibility !== 'hidden') element.style.visibility = 'hidden'
}

function show(element: HTMLElement | SVGElement) {
  if (element.style.visibility !== 'visible') element.style.visibility = 'visible'
}

function hideAll(board: HandleBoard) {
  for (const element of board.elements.values()) hide(element)
  hide(board.ringBox)
  hide(board.line)
  board.points.clear()
}

/**
 * Projects the handles once a frame, after the pose: where each one's
 * vertex is on the reshaped, posed head, whether its skin faces the
 * camera, and how wide its sculpt reaches on the screen. Tells a drag's
 * move once a frame too.
 */
export function HandleProjector({
  board,
  model,
}: {
  board: HandleBoard
  model: { current: Object3D | null }
}) {
  const heads = useMemo(() => new WeakMap<Object3D, Mesh | null>(), [])
  useFrame(({ camera, size, scene }) => {
    const body = model.current
    const sculpt = board.sculpt
    if (!(sculpt && body) || (board.settling && !board.drag)) {
      if (board.state.ids.length > 0) setHandleState(board, { ids: [] })
      hideAll(board)
      return
    }
    let head = heads.get(body)
    if (head === undefined) {
      head = headOf(body)
      heads.set(body, head)
    }
    const skinned = head as SkinnedMesh | null
    const skeleton = skinned?.isSkinnedMesh ? skinned.skeleton : null
    const bone = skeleton?.bones.findIndex((each) => HEAD_BONE.test(each.name)) ?? -1
    if (!(head && skinned && skeleton && bone >= 0)) {
      if (board.state.ids.length > 0) setHandleState(board, { ids: [] })
      hideAll(board)
      return
    }
    const anchors = faceAnchors(head, board.target ?? null)
    const ids = anchors.map((anchor) => anchor.handle)
    if (ids.join() !== board.state.ids.join()) setHandleState(board, { ids })

    const lens = camera as PerspectiveCamera
    scene.updateMatrixWorld()
    lens.updateMatrixWorld()
    board.camera = lens
    board.height = size.height
    board.size = frameOf(head).size
    // The head bone's skinning, bind pose to world.
    board.skin
      .copy(head.matrixWorld)
      .multiply(skinned.bindMatrixInverse)
      .multiply(skeleton.bones[bone]!.matrixWorld)
      .multiply(skeleton.boneInverses[bone]!)
    normalMatrix.getNormalMatrix(bound.copy(board.skin).multiply(skinned.bindMatrix))
    earMatrix.getNormalMatrix(board.skin)
    const scale = column.setFromMatrixColumn(board.skin, 0).length()
    lens.getWorldDirection(forward)
    const tan = Math.tan((lens.fov * Math.PI) / 360)
    const normals = head.geometry.getAttribute('normal')
    const drag = board.drag
    const hot = drag?.handle ?? board.state.hover ?? board.state.focus

    for (const { handle, vertex } of anchors) {
      const kind = FACE_HANDLE[handle]
      skinned.getVertexPosition(vertex, place).applyMatrix4(head.matrixWorld)
      if (kind.kind === 'ear') normal.copy(earAxis(head, vertex)).applyMatrix3(earMatrix)
      else if (normals) normal.fromBufferAttribute(normals, vertex).applyMatrix3(normalMatrix)
      else normal.set(0, 0, 1)
      normal.normalize()
      view.copy(lens.position).sub(place).normalize()
      const facing =
        normal.dot(view) + (kind.kind === 'landmark' && !kind.mirror ? MIDLINE_LEAD : 0)
      const opacity = facingOpacity(facing)
      screen.copy(place).project(lens)
      const x = ((screen.x + 1) / 2) * size.width
      const y = ((1 - screen.y) / 2) * size.height
      const depth = Math.max(1e-6, view.copy(place).sub(lens.position).dot(forward))
      const perPixel = (2 * depth * tan) / Math.max(1, size.height)
      const ring =
        kind.kind === 'landmark'
          ? ringPixels(kind.radius * sculpt.radiusScale, board.size, scale, perPixel)
          : 0
      let point = board.points.get(handle)
      if (!point) {
        point = { handle, x, y, visible: false, world: new Vector3(), ring, opacity }
        board.points.set(handle, point)
      }
      point.x = x
      point.y = y
      point.visible = opacity > 0
      point.world.copy(place)
      point.ring = ring
      point.opacity = opacity

      const element = board.elements.get(handle)
      if (!element) continue
      const held = drag?.handle === handle && board.pointer
      const drawX = held ? board.pointer!.x : x
      const drawY = held ? board.pointer!.y : y
      element.style.transform = `translate3d(${drawX}px, ${drawY}px, 0)`
      element.style.opacity = String(held ? 1 : opacity)
      if (opacity > 0 || held) show(element)
      else hide(element)

      if (handle === hot && board.ringBox && board.ring) {
        if (ring > 0 && (opacity > 0 || held)) {
          board.ringBox.style.transform = `translate3d(${drawX}px, ${drawY}px, 0)`
          board.ring.setAttribute('r', ring.toFixed(1))
          show(board.ringBox)
        } else {
          hide(board.ringBox)
        }
      }
      if (handle === drag?.handle && board.line && held) {
        const length = Math.hypot(x - drawX, y - drawY)
        board.line.style.transform = `translate3d(${drawX}px, ${drawY}px, 0) rotate(${Math.atan2(y - drawY, x - drawX)}rad)`
        board.line.style.width = `${length}px`
        show(board.line)
      }
    }
    for (const [handle] of board.points) {
      if (!ids.includes(handle)) {
        board.points.delete(handle)
        hide(board.elements.get(handle))
      }
    }
    if (!hot || !board.points.has(hot)) hide(board.ringBox)
    if (!(drag && board.pointer)) hide(board.line)

    if (drag?.pending) {
      drag.pending = false
      board.onSculpt({
        phase: 'move',
        handle: drag.handle,
        delta: dragDelta(drag.frame, drag.move),
      })
    }
  }, 1)
  return null
}

/**
 * The handles drawn over the stage (above the canvas and its filter, under
 * the studio's chrome), positioned by the projector. A composite for the
 * keyboard: one tab stop, its keys handled by the stage (handleKey).
 */
export function FaceHandles({
  board,
  sculpt,
}: {
  board: HandleBoard
  sculpt: SculptSettings | null
}) {
  const subscribe = useCallback(
    (listener: () => void) => {
      board.listeners.add(listener)
      return () => {
        board.listeners.delete(listener)
      }
    },
    [board],
  )
  const read = useCallback(() => board.state, [board])
  const state = useSyncExternalStore(subscribe, read, read)
  const ids = sculpt ? state.ids : []
  const regionStop = ids.find((id) => FACE_HANDLE[id].region === sculpt?.region)
  const stop = state.focus && ids.includes(state.focus) ? state.focus : (regionStop ?? ids[0])
  const hot = state.active ?? state.hover
  const partner = sculpt?.symmetric && hot ? FACE_HANDLE[hot].mirror : null
  const tip = state.active && !board.drag?.keyboard ? null : (state.hover ?? state.focus)
  return (
    <div
      aria-label="얼굴 조각 점"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      hidden={ids.length === 0}
      role="toolbar"
    >
      <svg
        aria-hidden
        className="absolute top-0 left-0 overflow-visible"
        height="1"
        ref={(element) => {
          board.ringBox = element
        }}
        style={{ visibility: 'hidden' }}
        width="1"
      >
        <circle
          className="fill-none stroke-white/50"
          cx="0"
          cy="0"
          r="0"
          ref={(element) => {
            board.ring = element
          }}
          strokeDasharray="4 4"
          strokeWidth="1"
        />
      </svg>
      <div
        aria-hidden
        className="absolute top-0 left-0 h-px origin-left bg-white/40"
        ref={(element) => {
          board.line = element
        }}
        style={{ visibility: 'hidden' }}
      />
      {ids.map((id) => {
        const handle = FACE_HANDLE[id]
        const active = state.active === id
        const hovered = !active && (hot === id || partner === id)
        const dimmed = !active && sculpt?.region != null && handle.region !== sculpt.region
        return (
          <button
            aria-label={handle.label}
            className="group pointer-events-none absolute top-0 left-0 outline-none"
            key={id}
            onBlur={() => {
              if (board.state.focus === id) setHandleState(board, { focus: null })
            }}
            onFocus={() => setHandleState(board, { focus: id })}
            ref={(element) => {
              if (element) board.elements.set(id, element)
              else board.elements.delete(id)
            }}
            style={{ visibility: 'hidden' }}
            tabIndex={id === stop ? 0 : -1}
            type="button"
          >
            <span
              className={cn(
                'absolute block size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.35),0_0_8px_rgba(255,255,255,0.55)] transition duration-200 ease-out motion-reduce:transition-none',
                dimmed && 'scale-[0.8] opacity-45',
                hovered && 'size-3.5 scale-100 opacity-100 ring-2 ring-sky-400',
                active && 'bg-sky-400 ring-2 ring-white',
                state.turning && 'opacity-25',
                'group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-sky-400',
              )}
            />
            {tip === id && (
              <span className="absolute bottom-[14px] left-0 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-md bg-neutral-900/90 px-2 py-1 text-[12px] text-white">
                {handle.label}
                <span className="text-white/50">
                  {handle.kind === 'ear' ? '양쪽 귀가 함께 바뀌어요' : 'Alt를 누르고 끌면 앞뒤로'}
                </span>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
