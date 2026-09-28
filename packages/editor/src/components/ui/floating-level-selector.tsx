'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  getDefaultLevelName,
  getLevelDisplayName,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { ClipboardPaste, Copy, GripVertical, Plus, Trash2 } from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  buildLevelDuplicateCreateOps,
  type LevelDuplicatePreset,
} from '../../lib/level-duplication'
import { addLevelAbove, deleteLevelWithFallbackSelection } from '../../lib/level-selection'
import {
  getEditorClipboardSnapshot,
  pasteEditorClipboardToLevel,
  subscribeEditorClipboard,
} from '../../lib/scene-clipboard'
import { sfxEmitter, triggerSFX } from '../../lib/sfx-bus'
import { cn } from '../../lib/utils'
import { LevelDuplicateDialog } from './level-duplicate-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './primitives/dialog'
import { Popover, PopoverContent, PopoverTrigger } from './primitives/popover'

// ── Inline rename input for a level row ─────────────────────────────────────

function LevelInlineRename({ level, onStopEditing }: { level: LevelNode; onStopEditing: () => void }) {
  const updateNode = useScene((s) => s.updateNode)
  const [value, setValue] = useState(level.name || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSave = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed !== level.name) {
      updateNode(level.id, { name: trimmed || undefined })
    }
    onStopEditing()
  }, [value, level.id, level.name, updateNode, onStopEditing])

  return (
    <input
      aria-label="층 이름"
      className="m-0 h-8 w-full min-w-0 rounded-lg bg-white px-2.5 font-medium text-[12px] text-neutral-800 outline-none ring-1 ring-[#8ec3f2] dark:bg-neutral-800 dark:text-neutral-100"
      onBlur={handleSave}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        // Keys typed into the name must not reach the editor's shortcuts.
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          handleSave()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onStopEditing()
        }
      }}
      placeholder={getDefaultLevelName(level.level)}
      ref={inputRef}
      type="text"
      value={value}
    />
  )
}

// ── Level row ───────────────────────────────────────────────────────────────

const ROW_ICON_BUTTON =
  'flex size-6 shrink-0 items-center justify-center rounded-full text-neutral-400 opacity-0 transition-all hover:bg-black/[0.06] hover:text-neutral-700 focus-visible:opacity-100 group-hover/level:opacity-100 dark:hover:bg-white/10 dark:hover:text-neutral-100'

function LevelRow({
  level,
  isSelected,
  isDragging,
  dragHandleProps,
  dragHandleRef,
  onSelect,
  onDuplicate,
  onPaste,
  onRequestDelete,
}: {
  level: LevelNode
  isSelected: boolean
  isDragging?: boolean
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>
  dragHandleRef?: (element: HTMLButtonElement | null) => void
  onSelect: () => void
  onDuplicate: () => void
  onPaste?: () => void
  onRequestDelete: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const name = getLevelDisplayName(level)

  if (isEditing) {
    return <LevelInlineRename level={level} onStopEditing={() => setIsEditing(false)} />
  }

  return (
    <div
      className={cn(
        'group/level flex h-8 items-center rounded-lg pr-1 transition-colors',
        isDragging && 'bg-white shadow-lg dark:bg-neutral-800',
        isSelected
          ? 'bg-[#bfe0fa] text-[#2f7fd0]'
          : 'text-neutral-600 hover:bg-black/[0.05] dark:text-neutral-300 dark:hover:bg-white/10',
      )}
    >
      <button
        {...dragHandleProps}
        aria-label={`${name} 순서 바꾸기`}
        className={cn(
          'ml-0.5 flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-neutral-400 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/level:opacity-100',
          isDragging && 'cursor-grabbing opacity-100',
        )}
        ref={dragHandleRef}
        title="끌어서 층 순서 바꾸기"
        type="button"
      >
        <GripVertical className="size-3.5" />
      </button>
      <button
        className="flex h-full min-w-0 flex-1 items-center pr-2 pl-1 font-semibold text-[12px]"
        onClick={onSelect}
        onDoubleClick={() => setIsEditing(true)}
        title={`${name} · 더블클릭으로 이름 바꾸기`}
        type="button"
      >
        <span className="truncate">{name}</span>
      </button>
      {onPaste && (
        <button
          aria-label={`${name}에 붙여넣기`}
          className={ROW_ICON_BUTTON}
          onClick={onPaste}
          title="복사한 항목을 이 층에 붙여넣기"
          type="button"
        >
          <ClipboardPaste className="size-3.5" />
        </button>
      )}
      <button
        aria-label={`${name} 복제`}
        className={ROW_ICON_BUTTON}
        onClick={onDuplicate}
        title="층 복제"
        type="button"
      >
        <Copy className="size-3.5" />
      </button>
      <button
        aria-label={`${name} 삭제`}
        className={cn(ROW_ICON_BUTTON, 'hover:text-red-500 dark:hover:text-red-400')}
        onClick={onRequestDelete}
        title="층 삭제"
        type="button"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

function SortableLevelRow(props: Omit<Parameters<typeof LevelRow>[0], 'dragHandleProps'>) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: props.level.id })

  const style: CSSProperties = {
    opacity: isDragging ? 0.86 : undefined,
    position: 'relative',
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <LevelRow
        {...props}
        dragHandleProps={{ ...attributes, ...listeners }}
        dragHandleRef={setActivatorNodeRef}
        isDragging={isDragging}
      />
    </div>
  )
}

function InsertLevelButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      aria-label={title}
      className="absolute left-1/2 z-10 flex size-4 -translate-x-1/2 items-center justify-center rounded-full border border-black/10 bg-white text-neutral-500 opacity-60 shadow-sm transition-opacity hover:text-neutral-800 hover:opacity-100 dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-300"
      onClick={onClick}
      title={title}
      type="button"
    >
      <Plus className="size-2.5" />
    </button>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

/**
 * The floor list behind the tool bar's floor name: switch floors, add one
 * above / below or between two, drag to reorder, rename (double-click),
 * duplicate, paste the copied selection onto a floor, and delete.
 */
export function FloatingLevelSelector({ children }: { children: ReactNode }) {
  const selectedBuildingId = useViewer((s) => s.selection.buildingId)
  const levelId = useViewer((s) => s.selection.levelId)
  const setSelection = useViewer((s) => s.setSelection)
  const createNode = useScene((s) => s.createNode)
  const createNodes = useScene((s) => s.createNodes)
  const updateNodes = useScene((s) => s.updateNodes)

  const [open, setOpen] = useState(false)
  // The dialogs live outside the popover: focusing them would dismiss it.
  const [deletingLevel, setDeletingLevel] = useState<LevelNode | null>(null)
  const [duplicatingLevel, setDuplicatingLevel] = useState<LevelNode | null>(null)
  const [draggingLevelId, setDraggingLevelId] = useState<string | null>(null)
  const clipboardSnapshot = useSyncExternalStore(
    subscribeEditorClipboard,
    getEditorClipboardSnapshot,
    getEditorClipboardSnapshot,
  )
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const resolvedBuildingId = useScene((state) => {
    if (selectedBuildingId) return selectedBuildingId
    const first = Object.values(state.nodes).find((n) => n?.type === 'building') as
      | BuildingNode
      | undefined
    return first?.id ?? null
  })

  const levels = useScene(
    useShallow((state) => {
      if (!resolvedBuildingId) return [] as LevelNode[]
      const building = state.nodes[resolvedBuildingId]
      if (!building || building.type !== 'building') return [] as LevelNode[]
      return (building as BuildingNode).children
        .map((id) => state.nodes[id])
        .filter((node): node is LevelNode => node?.type === 'level')
        .sort((a, b) => a.level - b.level)
    }),
  )

  const handleAddAbove = useCallback(() => {
    if (resolvedBuildingId) addLevelAbove(resolvedBuildingId as BuildingNode['id'])
  }, [resolvedBuildingId])

  const handleAddBelow = useCallback(() => {
    if (!resolvedBuildingId) return
    const minLevel = levels.length > 0 ? Math.min(...levels.map((l) => l.level)) : 1
    const newLevel = LevelNode.parse({
      level: minLevel - 1,
      children: [],
      parentId: resolvedBuildingId,
    })
    createNode(newLevel, resolvedBuildingId)
    setSelection({ buildingId: resolvedBuildingId, levelId: newLevel.id })
  }, [resolvedBuildingId, levels, createNode, setSelection])

  const handleInsertAbove = useCallback(
    (lower: LevelNode) => {
      if (!resolvedBuildingId) return
      const newLevelNumber = lower.level + 1
      const toShift = levels.filter((l) => l.level >= newLevelNumber)
      if (toShift.length > 0) {
        updateNodes(
          toShift.map((l) => ({
            id: l.id as AnyNodeId,
            data: { level: l.level + 1 } as Partial<AnyNode>,
          })),
        )
      }

      const newLevel = LevelNode.parse({
        level: newLevelNumber,
        children: [],
        parentId: resolvedBuildingId,
      })
      createNode(newLevel, resolvedBuildingId)
      setSelection({ buildingId: resolvedBuildingId, levelId: newLevel.id })
    },
    [resolvedBuildingId, levels, createNode, updateNodes, setSelection],
  )

  const handleConfirmDelete = useCallback(() => {
    if (!deletingLevel) return
    deleteLevelWithFallbackSelection(deletingLevel.id)
    setDeletingLevel(null)
  }, [deletingLevel])

  const handleDuplicateLevel = useCallback(
    (level: LevelNode, preset: LevelDuplicatePreset) => {
      const { createOps, newLevelId, shiftedLevels } = buildLevelDuplicateCreateOps({
        nodes: useScene.getState().nodes,
        level,
        levels,
        preset,
      })

      if (shiftedLevels.length > 0) {
        updateNodes(
          shiftedLevels.map((shiftedLevel) => ({
            id: shiftedLevel.id as AnyNodeId,
            data: { level: shiftedLevel.level } as Partial<AnyNode>,
          })),
        )
      }
      createNodes(createOps)

      setSelection({
        buildingId: resolvedBuildingId ?? undefined,
        levelId: newLevelId as LevelNode['id'],
      })
    },
    [createNodes, levels, resolvedBuildingId, setSelection, updateNodes],
  )

  const handlePasteToLevel = useCallback((level: LevelNode) => {
    const result = pasteEditorClipboardToLevel(level.id)
    if (result?.pastedIds.length) {
      sfxEmitter.emit('sfx:item-place')
    }
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingLevelId(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingLevelId(null)

      const { active, over } = event
      if (!over || active.id === over.id) return

      const visualLevels = [...levels].reverse()
      const oldIndex = visualLevels.findIndex((level) => level.id === active.id)
      const newIndex = visualLevels.findIndex((level) => level.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reorderedVisualLevels = arrayMove(visualLevels, oldIndex, newIndex)
      const levelNumbersDescending = levels.map((level) => level.level).sort((a, b) => b - a)

      const updates = reorderedVisualLevels
        .map((level, index) => ({
          id: level.id as AnyNodeId,
          nextLevel: levelNumbersDescending[index],
          data: { level: levelNumbersDescending[index] } as Partial<AnyNode>,
        }))
        .filter(({ id, nextLevel }) => {
          const currentLevel = levels.find((level) => level.id === id)
          return currentLevel?.level !== nextLevel
        })
        .map(({ id, data }) => ({ id, data }))

      if (updates.length > 0) {
        updateNodes(updates)
      }
    },
    [levels, updateNodes],
  )

  const reversedLevels = [...levels].reverse()

  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          align="center"
          className="w-52 rounded-xl border-0 bg-[#f5f5f5]/95 p-2 shadow-[0_2px_8px_rgba(0,0,0,0.15)] backdrop-blur-md dark:bg-neutral-900/95"
          // Esc closes the list only; the editor would also disarm the tool.
          onEscapeKeyDown={(event) => event.stopPropagation()}
          side="bottom"
          sideOffset={10}
        >
          <p className="px-1.5 pb-2 text-[11px] text-neutral-500">층 관리</p>
          <div className="relative pt-2 pb-2">
            {!draggingLevelId && (
              <div className="absolute inset-x-0 top-0">
                <InsertLevelButton onClick={handleAddAbove} title="맨 위에 층 추가" />
              </div>
            )}
            <DndContext
              collisionDetection={closestCenter}
              onDragCancel={() => setDraggingLevelId(null)}
              onDragEnd={handleDragEnd}
              onDragStart={handleDragStart}
              sensors={sensors}
            >
              <SortableContext
                items={reversedLevels.map((level) => level.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-1">
                  {reversedLevels.map((level, i) => (
                    <div className="relative" key={level.id}>
                      <SortableLevelRow
                        isSelected={level.id === levelId}
                        level={level}
                        onDuplicate={() => {
                          setOpen(false)
                          setDuplicatingLevel(level)
                        }}
                        onPaste={clipboardSnapshot ? () => handlePasteToLevel(level) : undefined}
                        onRequestDelete={() => {
                          setOpen(false)
                          setDeletingLevel(level)
                        }}
                        onSelect={() => {
                          triggerSFX('sfx:menu-click')
                          setSelection(
                            resolvedBuildingId
                              ? { buildingId: resolvedBuildingId, levelId: level.id }
                              : { levelId: level.id },
                          )
                        }}
                      />
                      {i < reversedLevels.length - 1 && !draggingLevelId && (
                        <div className="absolute inset-x-0 bottom-1.5">
                          <InsertLevelButton
                            onClick={() => handleInsertAbove(reversedLevels[i + 1]!)}
                            title="이 사이에 층 추가"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {!draggingLevelId && (
              <div className="absolute inset-x-0 bottom-4">
                <InsertLevelButton onClick={handleAddBelow} title="맨 아래에 층 추가" />
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <LevelDuplicateDialog
        level={duplicatingLevel}
        onConfirm={(preset) => {
          if (duplicatingLevel) handleDuplicateLevel(duplicatingLevel, preset)
          setDuplicatingLevel(null)
        }}
        onOpenChange={(next) => !next && setDuplicatingLevel(null)}
        open={!!duplicatingLevel}
      />

      <Dialog onOpenChange={(next) => !next && setDeletingLevel(null)} open={!!deletingLevel}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>층 삭제</DialogTitle>
            <DialogDescription>
              <strong>{deletingLevel ? getLevelDisplayName(deletingLevel) : ''}</strong>을(를)
              삭제할까요? 이 층의 벽, 바닥과 모든 사물이 함께 지워집니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
              onClick={() => setDeletingLevel(null)}
              type="button"
            >
              취소
            </button>
            <button
              className="rounded-full bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
              onClick={handleConfirmDelete}
              type="button"
            >
              삭제
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
