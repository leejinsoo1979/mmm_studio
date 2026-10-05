'use client'

import {
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  emitter,
  type FloorplanGeometry,
  type GridEvent,
  useScene,
} from '@pascal-app/core'
import {
  avatarThumbnailUrl,
  CursorSphere,
  getFloorStackPreviewPosition,
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  subscribeQuickRightClick,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useFacingPose,
  usePlacementPreview,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import {
  type FloorPlacementClickTriggerEvent,
  getLevelLocalSnappedPosition,
  resolveAlignedFloorPlacement,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { getNpcChatTransport } from './dialogue/chat-transport'
import NpcPatrolTool from './patrol-tool'
import { getNpcPreset, NPC_PRESETS, NPC_ROLE_COLORS } from './presets'
import { NpcNode } from './schema'

/** Each NPC is a skinned, animated avatar in play; more than this gets slow. */
export const NPC_LIMIT = 24
const ROTATE_STEP = Math.PI / 4
const FOOTPRINT = 0.6
const LIMIT_COLOR = '#ef4444'
const NAME_MAX = 24

export function countNpcs(nodes: Record<string, { type: string }>): number {
  let count = 0
  for (const node of Object.values(nodes)) if (node.type === 'npc') count++
  return count
}

/** `base` without its number, numbered past the NPCs already named so: 주민 → 주민 2 → 주민 3. */
export function nextNpcName(base: string, nodes: Record<string, { type: string }>): string {
  const stem = base.replace(/\s\d+$/, '')
  const taken = new Set<string>()
  for (const node of Object.values(nodes)) {
    if (node.type === 'npc') taken.add((node as NpcNode).name)
  }
  if (!taken.has(stem)) return stem
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`
    const name = stem.slice(0, NAME_MAX - suffix.length) + suffix
    if (!taken.has(name)) return name
  }
}

/** Drawn once at creation and saved: every client derives the NPC's schedule from it. */
const randomNpcSeed = () => 1 + Math.floor(Math.random() * (2 ** 31 - 2))

/** `toolDefaults.npc`: the build tab's preset card, or the NPC whose patrol path is drawn. */
type NpcToolDefaults = { preset?: string; patrolFor?: string }

const npcToolDefaults = (defaults: unknown) => (defaults ?? {}) as NpcToolDefaults

/** "No entry" plan ghost while the scene is full. */
const blockedGhost = (x: number, z: number): FloorplanGeometry => ({
  kind: 'group',
  transform: { translate: [x, z] },
  children: [
    {
      kind: 'circle',
      cx: 0,
      cy: 0,
      r: 0.28,
      fill: 'none',
      stroke: LIMIT_COLOR,
      strokeWidth: 2,
      vectorEffect: 'non-scaling-stroke',
    },
    {
      kind: 'line',
      x1: -0.2,
      y1: -0.2,
      x2: 0.2,
      y2: 0.2,
      stroke: LIMIT_COLOR,
      strokeWidth: 2,
      vectorEffect: 'non-scaling-stroke',
      strokeLinecap: 'round',
    },
  ],
})

/**
 * Registry tool for `tool === 'npc'`. Places the preset from
 * `toolDefaults.npc.preset` (the 2D plan forwards grid events, so the same
 * code places in both views), or draws a patrol path when the inspector armed
 * `patrolFor`.
 */
export default function NpcTool() {
  const patrolFor = useEditor((s) => npcToolDefaults(s.toolDefaults.npc).patrolFor)
  const patrolNode = useScene((s) => {
    const node = patrolFor ? (s.nodes[patrolFor as AnyNodeId] as unknown as NpcNode) : undefined
    return node?.type === 'npc' ? node : undefined
  })

  // Seeded per activation, so a later plain activation starts from the default preset.
  useEffect(() => () => useEditor.getState().setToolDefaults('npc', null), [])

  if (patrolFor) return patrolNode ? <NpcPatrolTool node={patrolNode} /> : null
  return <NpcPlacementTool />
}

/**
 * Stays armed for several NPCs; R (or a quick right click) turns the next one
 * by 45°, Esc ends. A full scene shows why nothing is placed.
 */
function NpcPlacementTool() {
  const levelId = useViewer((s) => s.selection.levelId)
  const presetId = useEditor((s) => npcToolDefaults(s.toolDefaults.npc).preset)
  const preset = getNpcPreset(presetId ?? '') ?? NPC_PRESETS[0]!
  const full = useScene((s) => countNpcs(s.nodes) >= NPC_LIMIT)
  const previewNode = useMemo(() => NpcNode.parse(preset.fields), [preset])
  const cursorRef = useRef<Group>(null)
  const [visible, setVisible] = useState(false)
  // drei's Html ignores its parent's visibility, and the plan hides the 3D cursor.
  const floorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const rotationRef = useRef(0)
  const fullRef = useRef(full)
  fullRef.current = full
  // Guides and consultants come with AI on; it stays off where the server has no AI.
  const aiAvailableRef = useRef(false)

  useEffect(() => {
    let live = true
    getNpcChatTransport()
      ?.status()
      .then((status) => {
        if (live) aiAvailableRef.current = status.available
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  // R turns the cursor here, and the editor's R would turn a selected node with it.
  useEffect(() => {
    useViewer.getState().setSelection({ selectedIds: [] })
  }, [])

  useEffect(() => {
    if (!levelId) return
    const preview = previewNode as unknown as AnyNode
    let last: [number, number, number] | null = null
    let lastKey = ''
    let candidates = collectAlignmentAnchors(useScene.getState().nodes, previewNode.id)

    const show = () => {
      if (!last) return
      const rotation = rotationRef.current
      const visual = getFloorStackPreviewPosition({
        node: preview,
        position: last,
        rotation,
        levelId,
      })
      cursorRef.current?.position.set(...visual)
      useFacingPose
        .getState()
        .set({ position: visual, rotationY: rotation, depth: FOOTPRINT, width: FOOTPRINT })
      const placement = usePlacementPreview.getState()
      if (fullRef.current) {
        placement.set(null)
        placement.setGeometry(blockedGhost(last[0], last[2]))
      } else {
        placement.setGeometry(null)
        placement.set({ ...previewNode, position: last, rotation } as unknown as AnyNode)
      }
    }

    const onMove = (event: GridEvent) => {
      const { position, guides } = resolveAlignedFloorPlacement({
        node: preview,
        rawX: event.localPosition[0],
        rawZ: event.localPosition[2],
        gridStep: useEditor.getState().gridSnapStep,
        candidates,
        showAlignment: isAlignmentGuideActive(),
        applyAlignmentSnap: isMagneticSnapActive(),
        bypassGrid: !isGridSnapActive(),
        rotationY: rotationRef.current,
      })
      useAlignmentGuides.getState().set(guides)
      last = position
      setVisible(true)
      show()
      const key = `${position[0]},${position[2]}`
      if (key !== lastKey) {
        triggerSFX('sfx:grid-snap')
        lastKey = key
      }
    }

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      stopPlacementCommitPropagation(event)
      const nodes = useScene.getState().nodes
      if (countNpcs(nodes) >= NPC_LIMIT) return
      const position =
        last ??
        getLevelLocalSnappedPosition(
          levelId,
          event,
          useEditor.getState().gridSnapStep,
          !isGridSnapActive(),
        )
      const { fields } = preset
      const npc = NpcNode.parse({
        ...fields,
        name: nextNpcName(fields.name ?? preset.label, nodes),
        position,
        rotation: rotationRef.current,
        behavior: { ...fields.behavior, seed: randomNpcSeed() },
        ai: { ...fields.ai, enabled: fields.ai?.enabled === true && aiAvailableRef.current },
      })
      useScene.getState().createNode(npc as unknown as AnyNode, levelId as AnyNodeId)
      triggerSFX('sfx:item-place')
      candidates = collectAlignmentAnchors(useScene.getState().nodes, previewNode.id)
    }

    const rotate = () => {
      rotationRef.current = (rotationRef.current + ROTATE_STEP) % (2 * Math.PI)
      triggerSFX('sfx:item-rotate')
      show()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'r' && event.key !== 'R') return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return
      rotate()
    }
    const unsubscribeRightClick = subscribeQuickRightClick(() => true, rotate)

    emitter.on('grid:move', onMove)
    const unsubscribeClicks = subscribeFloorPlacementClicks(onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      emitter.off('grid:move', onMove)
      unsubscribeClicks()
      window.removeEventListener('keydown', onKey)
      unsubscribeRightClick()
      usePlacementPreview.getState().clear()
      useFacingPose.getState().clear()
      useAlignmentGuides.getState().clear()
    }
  }, [levelId, preset, previewNode])

  if (!levelId) return null

  return (
    <group ref={cursorRef} visible={visible}>
      <CursorSphere
        color={full ? LIMIT_COLOR : NPC_ROLE_COLORS[previewNode.role]}
        height={1.8}
        tooltipContent={
          <img
            alt=""
            className="size-full rounded-md object-cover object-top"
            src={avatarThumbnailUrl(previewNode.avatar)}
          />
        }
      />
      {full && visible && !floorplanHovered && (
        <Html
          center
          position={[0, 2.45, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div className="whitespace-nowrap rounded-full bg-red-500/90 px-3 py-1 font-medium text-white text-xs shadow">
            NPC는 한 장면에 최대 {NPC_LIMIT}명까지 둘 수 있어요
          </div>
        </Html>
      )}
    </group>
  )
}
