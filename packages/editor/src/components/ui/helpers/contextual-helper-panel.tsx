import { Icon } from '@iconify/react'
import { Fragment } from 'react'
import {
  CONTINUATION_PROFILES,
  type ContinuationContext,
} from '../../../lib/continuation'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { hasActivePaintMaterial } from '../../../lib/material-paint'
import type { PaintHoverInfo, PaintScope } from '../../../lib/paint-scope'
import { sfxEmitter } from '../../../lib/sfx-bus'
import {
  cycleSnappingModeIn,
  resolveSnapFlags,
  type SnapContext,
} from '../../../lib/snapping-mode'
import { cn } from '../../../lib/utils'
import useEditor, { type GridSnapStep } from '../../../store/use-editor'
import useFenceCurveDraft from '../../../store/use-fence-curve-draft'
import { ShortcutToken } from '../primitives/shortcut-token'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'

// One muted container holds every row — passive key hints and interactive chips
// alike — so the HUD reads as a single panel, not a stack of floating pills. The
// background is near-opaque (`bg-background/95`) with a single backdrop blur so
// active rows stay readable over the 3D scene even while a modifier is held.
// A 2-track grid: column 1 sizes to `max-content` (the widest key across ALL
// rows), column 2 (`1fr`) is the label. Every row is a subgrid sharing those
// tracks, so labels align even when keys differ in width (⌘ vs Shift) or wrap to
// two lines. Near-opaque bg + single backdrop blur keeps active rows readable.
const CONTAINER_CLASS =
  'pointer-events-none fixed right-4 bottom-4 z-40 grid max-w-[240px] grid-cols-[max-content_1fr] gap-x-2 gap-y-1 rounded-xl bg-white/80 px-2.5 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.12)] backdrop-blur-md dark:bg-neutral-900/80'

const TOKEN_CLASS = 'h-5 px-1.5 text-[10px]'

// Each row spans both columns as its own subgrid, inheriting the container's
// tracks so its key/label cells land on the shared column lines.
const ROW_CLASS = 'col-span-2 grid grid-cols-subgrid'

// The key cell (column 1). `items-center` centres the token; the row's
// `items-start` keeps it on the label's first line when the label wraps.
const KEY_CELL_CLASS = 'flex items-center gap-1'

// Keys pressed together join with "+"; an entry that is itself an array is a
// group of alternatives and joins with "/" — so [['Cmd/Ctrl', 'Shift'],
// 'Left click'] reads "⌘ / ⇧ + click".
function ShortcutSequence({ keys }: { keys: Array<string | string[]> }) {
  return (
    <div className={KEY_CELL_CLASS}>
      {keys.map((entry, index) => (
        <Fragment key={`${String(entry)}-${index}`}>
          {index > 0 ? (
            <span className="font-medium text-[12px] text-muted-foreground/80 leading-none">
              +
            </span>
          ) : null}
          {Array.isArray(entry) ? (
            entry.map((alternative, altIndex) => (
              <Fragment key={`${alternative}-${altIndex}`}>
                {altIndex > 0 ? (
                  <span className="text-[9px] text-muted-foreground/70">/</span>
                ) : null}
                <ShortcutToken className={TOKEN_CLASS} value={alternative} />
              </Fragment>
            ))
          ) : (
            <ShortcutToken className={TOKEN_CLASS} value={entry} />
          )}
        </Fragment>
      ))}
    </div>
  )
}

// Shared single-line chip row (key cell + icon/label cell). Rendered either as a
// passive row (no `onClick`) or a clickable button. The outer container is
// `pointer-events-none`, so clickable chips opt back in.
function ChipRow({
  ariaLabel,
  disabled = false,
  icon,
  label,
  onClick,
  shortcut,
  tooltip,
}: {
  ariaLabel?: string
  disabled?: boolean
  icon?: string
  label: string
  onClick?: () => void
  shortcut?: string
  tooltip?: string
}) {
  const body = (
    <>
      <span className={KEY_CELL_CLASS}>
        {shortcut ? <ShortcutToken className={TOKEN_CLASS} value={shortcut} /> : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
        {icon ? <Icon className="shrink-0" height={13} icon={icon} width={13} /> : null}
        <span className="truncate">{label}</span>
      </span>
    </>
  )

  if (!onClick) {
    return (
      <div className={cn(ROW_CLASS, 'items-center', disabled && 'opacity-45 saturate-0')}>{body}</div>
    )
  }

  const button = (
    <button
      aria-label={ariaLabel ?? label}
      className={cn(
        ROW_CLASS,
        'pointer-events-auto cursor-pointer items-center rounded-md text-left transition-colors hover:bg-muted/60',
        disabled && 'opacity-45 saturate-0',
      )}
      onClick={onClick}
      type="button"
    >
      {body}
    </button>
  )

  if (!tooltip) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="left">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

const SNAPPING_MODE_ICONS = {
  grid: 'lucide:grid-2x2',
  lines: 'lucide:magnet',
  angles: 'lucide:triangle',
  off: 'lucide:ban',
} as const

const SNAPPING_MODE_LABELS = {
  grid: '격자',
  lines: '선',
  angles: '각도',
  off: '끔',
} as const

const GRID_SNAP_STEPS: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05]

function nextGridSnapStep(step: GridSnapStep): GridSnapStep {
  const index = GRID_SNAP_STEPS.indexOf(step)
  return GRID_SNAP_STEPS[(index + 1) % GRID_SNAP_STEPS.length] ?? GRID_SNAP_STEPS[0]!
}

// The active interaction's snapping controls, scoped to its context (wall / item
// / polygon) so each action shows only the modes that make sense for it.
function SnappingChips({ context }: { context: SnapContext }) {
  const snappingMode = useEditor((s) => s.snappingModeByContext[context])
  const setSnappingMode = useEditor((s) => s.setSnappingMode)
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  const setGridSnapStep = useEditor((s) => s.setGridSnapStep)

  const gridActive = resolveSnapFlags(snappingMode).grid

  return (
    <>
      <ChipRow
        ariaLabel={`스냅: ${SNAPPING_MODE_LABELS[snappingMode]}`}
        icon={SNAPPING_MODE_ICONS[snappingMode]}
        label={`스냅: ${SNAPPING_MODE_LABELS[snappingMode]}`}
        onClick={() => {
          setSnappingMode(context, cycleSnappingModeIn(context, snappingMode))
          sfxEmitter.emit('sfx:grid-snap')
        }}
        shortcut="Shift"
        tooltip={
          context === 'wall'
            ? 'Snapping mode — click or tap Shift to cycle (hold Shift: 90° lock)'
            : 'Snapping mode — click or press Shift to cycle'
        }
      />
      {gridActive ? (
        <ChipRow
          ariaLabel={`Grid step: ${gridSnapStep.toFixed(2)} m`}
          label={`격자 간격: ${gridSnapStep.toFixed(2)} m`}
          onClick={() => {
            setGridSnapStep(nextGridSnapStep(gridSnapStep))
            sfxEmitter.emit('sfx:grid-snap')
          }}
          shortcut="Ctrl"
          tooltip="격자 간격 — 클릭하거나 Ctrl로 전환"
        />
      ) : null}
    </>
  )
}

function ContinuationChip({ context }: { context: ContinuationContext }) {
  const mode = useEditor((s) => s.getContinuation(context))
  const cycleContinuation = useEditor((s) => s.cycleContinuation)
  const profile = CONTINUATION_PROFILES[context]
  const label = profile.labels[mode] ?? mode
  const icon = profile.icons[mode] ?? 'lucide:repeat'

  return (
    <ChipRow
      ariaLabel={`Continuation: ${label}`}
      icon={icon}
      label={label}
      onClick={() => cycleContinuation(context)}
      shortcut="C"
      tooltip="이어 그리기 — 클릭하거나 C로 전환"
    />
  )
}

function FenceContinuationChips() {
  const mode = useEditor((s) => s.getContinuation('fence'))
  const setContinuation = useEditor((s) => s.setContinuation)
  const curveStarted = useFenceCurveDraft((s) => s.pointCount > 0)

  const isCurved = mode === 'curved'
  const straightMode = isCurved ? 'continuous' : mode
  const straightLabel = straightMode === 'single' ? '직선: 한 번' : '직선: 이어서'
  const straightIcon = straightMode === 'single' ? 'lucide:minus' : 'lucide:waypoints'
  const typeLabel = isCurved ? '종류: 곡선' : '종류: 직선'
  const typeIcon = isCurved ? 'lucide:spline' : 'lucide:minus'

  return (
    <>
      <ChipRow
        ariaLabel={`Fence type: ${isCurved ? 'Curved' : 'Straight'}`}
        icon={typeIcon}
        label={typeLabel}
        onClick={() => setContinuation('fence', isCurved ? 'continuous' : 'curved')}
        shortcut="T"
        tooltip="울타리 종류 — 클릭하거나 T로 직선 / 곡선 전환"
      />
      <ChipRow
        ariaLabel={`Fence continuation: ${straightLabel}`}
        disabled={isCurved}
        icon={straightIcon}
        label={straightLabel}
        onClick={
          isCurved
            ? undefined
            : () => setContinuation('fence', straightMode === 'single' ? 'continuous' : 'single')
        }
        shortcut="C"
        tooltip={
          isCurved
            ? '곡선 울타리에서는 직선 이어 그리기를 쓸 수 없습니다'
            : '직선 이어 그리기 — 클릭하거나 C로 전환'
        }
      />
      {/* Curved fences are committed by a closing gesture rather than per-click,
          so the finish keys aren't discoverable on their own — surface them, but
          only once the user has placed a point and a curve is actually in flight. */}
      {isCurved && curveStarted ? (
        <ChipRow
          icon="lucide:circle-check"
          label="곡선 완성 (또는 더블클릭)"
          shortcut="Enter"
        />
      ) : null}
    </>
  )
}

const PAINT_SCOPE_ICONS: Record<PaintScope, string> = {
  single: 'lucide:square',
  object: 'lucide:box',
  matching: 'lucide:copy',
  room: 'lucide:scan',
}

// The painter's application-scope chip. Driven entirely by the hovered node's
// derived `paintHover` (scopes + labels), so it works for any kind without a
// per-target table.
function PaintScopeChip() {
  // What the cursor is over (that's what the next click paints). `null` when not
  // over a paintable surface — including an item with no slots.
  const paintHover = useEditor((s) => s.paintHover)
  const paintScope = useEditor((s) => s.paintScope)
  const cyclePaintScope = useEditor((s) => s.cyclePaintScope)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  const paintEraser = useEditor((s) => s.paintEraser)

  // Nothing to paint with yet (no material picked, not erasing) → the first step
  // is choosing a material, so say that before anything about scope or hovering.
  if (!(paintEraser || hasActivePaintMaterial(activePaintMaterial))) {
    return <ChipRow icon="lucide:palette" label="칠할 재질을 고르세요" />
  }

  // Not over anything paintable → guide the user to hover, still teaching Shift.
  if (!paintHover) {
    return (
      <ChipRow icon="lucide:mouse-pointer-click" label="칠할 면에 커서를 올리세요" shortcut="Shift" />
    )
  }

  const { scopes } = paintHover
  // A scope carried over from another node (the mode is global) falls back to
  // the narrowest for both display and — via the apply-time resolver — behaviour.
  const effective: PaintScope = scopes.includes(paintScope) ? paintScope : 'single'

  // Paintable but with no scope choice (roof, a one-slot node, …) → a passive
  // row that still names the surface, so the user always sees what they'll paint.
  if (scopes.length <= 1) {
    return (
      <ChipRow
        icon={PAINT_SCOPE_ICONS[effective]}
        label={`칠하기: ${paintScopeLabelKo(effective, paintHover)}`}
      />
    )
  }

  return (
    <ChipRow
      ariaLabel={`칠하기 범위: ${paintScopeLabelKo(effective, paintHover)}`}
      icon={PAINT_SCOPE_ICONS[effective]}
      label={`칠하기: ${paintScopeLabelKo(effective, paintHover)}`}
      onClick={() => cyclePaintScope()}
      shortcut="Shift"
      tooltip="칠하기 범위 — 클릭하거나 Shift로 전환"
    />
  )
}

/** Korean copy for the select-mode / rotate hints `contextual-help` resolves. */
const HINT_LABELS_KO: Record<string, string> = {
  'Add or remove objects from the selection': '선택에 추가 / 빼기',
  'Drag selected movable object': '선택한 사물 끌어서 옮기기',
  'Drag left or right to rotate selected object': '좌우로 끌어 회전',
  'Click a handle dot to show move arrows': '핸들 점을 클릭해 이동 화살표 표시',
  'Detach the joint while dragging an arrow': '화살표를 끄는 동안 연결 분리',
  'Click the handle dot to show move + rotate handles': '핸들 점을 클릭해 이동 · 회전 핸들 표시',
  'Rotate ±45°': '±45° 회전',
  'Switch the rotation axis (Y → X → Z)': '회전 축 전환 (Y → X → Z)',
  'Rotating freely (no angle step)': '자유 회전 중 (각도 단계 없음)',
  'Hold to rotate freely': '누른 채 자유 회전',
}

function paintScopeLabelKo(scope: PaintScope, info: PaintHoverInfo): string {
  switch (scope) {
    case 'object':
      return '사물 전체'
    case 'matching':
      return '같은 재질 모두'
    case 'room':
      return '방 전체'
    default:
      return info.slotLabel || '이 면'
  }
}

export function ContextualHelperPanel({
  hints,
  snapContext = null,
  showPaintScope = false,
  continuationContext = null,
}: {
  hints: ContextualShortcutHint[]
  // The active snapping context drives the snapping chips (which mode set). Null
  // → no snapping chips for this interaction.
  snapContext?: SnapContext | null
  showPaintScope?: boolean
  continuationContext?: ContinuationContext | null
}) {
  if (hints.length === 0 && !snapContext && !showPaintScope && !continuationContext)
    return null

  return (
    <div className={CONTAINER_CLASS}>
      {snapContext ? <SnappingChips context={snapContext} /> : null}
      {continuationContext === 'fence' ? <FenceContinuationChips /> : null}
      {continuationContext && continuationContext !== 'fence' ? (
        <ContinuationChip context={continuationContext} />
      ) : null}
      {showPaintScope ? <PaintScopeChip /> : null}
      {hints.map((hint) => (
        <div
          className={cn(ROW_CLASS, 'items-start', hint.active && 'rounded-md bg-primary/10')}
          key={`${hint.keys.join('+')}:${hint.label}`}
        >
          <ShortcutSequence keys={hint.keys} />
          <div className="min-w-0">
            <div
              className={cn(
                'text-xs leading-5',
                hint.active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {HINT_LABELS_KO[hint.label] ?? hint.label}
            </div>
            {hint.subtitle ? (
              <div className="text-[10px] text-muted-foreground/70 leading-snug">
                {hint.subtitle}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
