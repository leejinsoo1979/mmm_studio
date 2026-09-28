'use client'

import { type AnyNode, emitter, type NodeEvent, nodeRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import type { BufferGeometry, Mesh, Object3D } from 'three'

function materialIndexOf(object: Object3D | undefined, faceIndex: number | undefined) {
  const groups = (object as Mesh | undefined)?.geometry?.groups as
    | BufferGeometry['groups']
    | undefined
  if (faceIndex === undefined || !groups?.length) return null
  const start = faceIndex * 3
  return groups.find((g) => start >= g.start && start < g.start + g.count)?.materialIndex ?? null
}

function roleAt(node: AnyNode, event: NodeEvent): string | null {
  const paint = nodeRegistry.get(node.type)?.capabilities?.paint
  if (!paint) return null
  const object = (event as NodeEvent & { object?: Object3D }).object ?? event.nativeEvent.object
  return paint.resolveRole({
    node,
    materialIndex: materialIndexOf(object, event.faceIndex),
    normal: event.normal,
    localPosition: event.localPosition,
    hitObjectName: event.nativeEvent.object?.name,
    hitObject: object,
    ray: event.nativeEvent.ray,
  })
}

/**
 * inZOI's paint cursor: a white pin standing on the surface point under the
 * pointer while the customized object is hovered. Clicking the object
 * reports the part under the pointer (null when none resolves).
 */
export function PaintPickPin({
  node,
  onFaceClick,
}: {
  node: AnyNode
  onFaceClick: (role: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pick = useRef(onFaceClick)
  pick.current = onFaceClick
  const cameraDragging = useViewer((s) => s.cameraDragging)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const hide = () => {
      el.style.display = 'none'
      root.removeAttribute('data-paint-pin')
    }
    const onMove = (event: NodeEvent) => {
      if (event.node.id !== node.id) return
      const pointer = event.nativeEvent.nativeEvent as PointerEvent
      el.style.display = 'block'
      el.style.transform = `translate(${pointer.clientX}px, ${pointer.clientY}px)`
      root.setAttribute('data-paint-pin', '')
    }
    const onLeave = (event: NodeEvent) => {
      if (event.node.id === node.id) hide()
    }
    const onClick = (event: NodeEvent) => {
      if (event.node.id !== node.id) return
      pick.current(roleAt(event.node, event))
    }
    const type = node.type
    emitter.on(`${type}:enter` as never, onMove as never)
    emitter.on(`${type}:move` as never, onMove as never)
    emitter.on(`${type}:leave` as never, onLeave as never)
    emitter.on(`${type}:click` as never, onClick as never)
    return () => {
      emitter.off(`${type}:enter` as never, onMove as never)
      emitter.off(`${type}:move` as never, onMove as never)
      emitter.off(`${type}:leave` as never, onLeave as never)
      emitter.off(`${type}:click` as never, onClick as never)
      hide()
    }
  }, [node.id, node.type])

  return (
    <>
      {/* The pin replaces the OS cursor over the canvas while it shows. */}
      {!cameraDragging && <style>{'html[data-paint-pin] canvas{cursor:none!important}'}</style>}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 z-40"
        ref={ref}
        style={{ display: 'none', visibility: cameraDragging ? 'hidden' : 'visible' }}
      >
        <svg
          className="-translate-x-1/2 absolute bottom-0 left-0 overflow-visible drop-shadow-[0_0_1.5px_rgba(0,0,0,0.45)]"
          fill="none"
          height="58"
          viewBox="0 0 24 58"
          width="24"
        >
          <path
            d="M5.2 17.8A10 10 0 1 1 18.8 17.8"
            stroke="rgba(255,255,255,0.92)"
            strokeLinecap="round"
            strokeWidth="1.5"
          />
          <circle cx="12" cy="11" fill="rgba(255,255,255,0.95)" r="6.5" />
          <path d="M10 8.2 14.2 11 10 13.8Z" fill="#4a4a4a" transform="rotate(-90 12 11)" />
          <path d="M12 17.5V58" stroke="rgba(255,255,255,0.92)" strokeWidth="1.5" />
        </svg>
      </div>
    </>
  )
}
