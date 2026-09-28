import { type AnyNodeId, nodeRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { memo, useCallback, useState } from 'react'
import { resolveNodeSnapTarget, SnapTargetIcon } from '../../../snap-target-badge'
import { InlineRenameInput } from './inline-rename-input'
import {
  focusTreeNode,
  handleTreeSelection,
  routeTreeSelectionToNode,
  TreeNodeWrapper,
} from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

/** Korean row names for the kinds routed here (the registry labels are English). */
const KIND_NAMES: Record<string, string> = {
  'box-vent': '박스 환기구',
  cupola: '큐폴라',
  downspout: '선홈통',
  'eyebrow-vent': '눈썹 환기구',
  'ridge-vent': '용마루 환기구',
  skylight: '천창',
  'turbine-vent': '터빈 환기구',
}

interface RegistryTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

/**
 * Generic, leaf tree-node row driven entirely by the kind's
 * `def.presentation` (icon + label). Replaces the per-kind boilerplate
 * components that differed only in their default name and icon — today the
 * roof vents (box / ridge / turbine / cupola / eyebrow). Register a kind in
 * `treeNodeByType` against this component instead of authoring another copy.
 */
export const RegistryTreeNode = memo(function RegistryTreeNode({
  nodeId,
  depth,
  isLast,
}: RegistryTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const node = useScene((s) => s.nodes[nodeId])
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(nodeId))
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  const presentation = node ? nodeRegistry.get(node.type)?.presentation : undefined
  const icon = presentation?.icon
  const iconSrc = icon?.kind === 'url' ? icon.src : '/icons/roof.webp'
  const snapTarget = resolveNodeSnapTarget(node)
  const defaultName = (node && KIND_NAMES[node.type]) || presentation?.label || '요소'

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleTreeSelection(
        e,
        nodeId,
        useViewer.getState().selection.selectedIds,
        setSelection,
      )
      routeTreeSelectionToNode(node)
    },
    [node, nodeId, setSelection],
  )

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={
        snapTarget ? (
          <SnapTargetIcon target={snapTarget}>
            <Image
              alt=""
              className="object-contain opacity-60"
              height={14}
              src={iconSrc}
              width={14}
            />
          </SnapTargetIcon>
        ) : (
          <Image
            alt=""
            className="object-contain opacity-60"
            height={14}
            src={iconSrc}
            width={14}
          />
        )
      }
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={isVisible}
      label={
        <InlineRenameInput
          defaultName={defaultName}
          isEditing={isEditing}
          nodeId={nodeId}
          onStartEditing={() => setIsEditing(true)}
          onStopEditing={() => setIsEditing(false)}
        />
      }
      nodeId={nodeId}
      onClick={handleClick}
      onDoubleClick={() => focusTreeNode(nodeId)}
      onMouseEnter={() => setHoveredId(nodeId)}
      onMouseLeave={() => setHoveredId(null)}
      onToggle={() => {}}
    />
  )
})
