'use client'

import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useReducer, useRef } from 'react'
import { type Group, type Object3D, Vector3 } from 'three'
import { useNpcDialogue } from '../dialogue/store'
import { NPC_ROLE_COLORS } from '../presets'
import { useNpcRuntime } from '../runtime/store'
import { NPC_ROLE_LABELS, type NpcNode } from '../schema'
import { overheadOpacity } from './animation'

const anchorAt = new Vector3()
const cameraAt = new Vector3()

function shownInScene(object: Object3D) {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}

/**
 * The name tag and speech bubble over a live NPC: the local player's line in
 * conversation with it, else its latest bark or remote line. Fades with the
 * camera's distance and hides with the body.
 */
export function NpcOverhead({ node, height }: { node: NpcNode; height: number }) {
  const anchorRef = useRef<Group>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const line = useNpcDialogue((state) => (state.npcId === node.id ? state.line : null))
  const bubble = useNpcRuntime((state) => state.bubbles[node.id])
  const [, expire] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    if (!bubble) return
    const left = bubble.until - Date.now()
    if (left <= 0) return
    const timer = window.setTimeout(expire, left)
    return () => window.clearTimeout(timer)
  }, [bubble])

  useFrame(({ camera }) => {
    const anchor = anchorRef.current
    const box = boxRef.current
    if (!(anchor && box)) return
    const opacity = shownInScene(anchor)
      ? overheadOpacity(
          anchor.getWorldPosition(anchorAt).distanceTo(camera.getWorldPosition(cameraAt)),
        )
      : 0
    const next = String(Math.round(opacity * 50) / 50)
    if (box.style.opacity === next) return
    box.style.opacity = next
    box.style.visibility = opacity > 0 ? 'visible' : 'hidden'
  })

  const text = line ?? (bubble && bubble.until > Date.now() ? bubble.text : null)
  if (!(text || node.showNameTag)) return null

  return (
    <group position={[0, height, 0]} ref={anchorRef}>
      <Html center style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[20, 0]}>
        <div className="flex flex-col items-center gap-1" ref={boxRef} style={{ opacity: 0 }}>
          {text && (
            <div className="w-max max-w-[220px] break-keep rounded-2xl bg-white px-3 py-1.5 text-center text-[13px] text-neutral-900 leading-snug shadow-lg">
              {text}
            </div>
          )}
          {node.showNameTag && (
            <div className="flex items-center gap-1 whitespace-nowrap rounded-full bg-black/55 py-0.5 pr-2 pl-0.5 font-medium text-[11px] text-white backdrop-blur-sm">
              <span
                className="rounded-full px-1.5 text-[10px]"
                style={{ backgroundColor: NPC_ROLE_COLORS[node.role] }}
              >
                {NPC_ROLE_LABELS[node.role]}
              </span>
              {node.name}
            </div>
          )}
        </div>
      </Html>
    </group>
  )
}
