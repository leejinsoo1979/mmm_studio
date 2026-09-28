'use client'

import { useScene } from '@pascal-app/core'
import {
  CatalogCard,
  CatalogSection,
  SegmentedControl,
  SliderControl,
  ToggleControl,
  useEditor,
} from '@pascal-app/editor'
import type { ReactNode } from 'react'
import { FLOWER_PRESET_LIST } from './flower-presets'
import type { FlowerPreset } from './flower-schema'
import { GRASS_PRESET_LIST } from './grass-presets'
import type { GrassPreset } from './grass-schema'
import { TREE_PRESET_LIST } from './presets'
import type { TreePreset } from './schema'
import { type TreesPanelMode as Mode, useTreesStore } from './store'

const KIND: Record<Mode, string> = {
  trees: 'trees:tree',
  flowers: 'trees:flower',
  grass: 'trees:grass',
}
const NOUN: Record<Mode, string> = { trees: '나무를', flowers: '꽃을', grass: '풀을' }
const TITLE: Record<Mode, string> = { trees: '나무', flowers: '꽃', grass: '풀' }

/**
 * The plugin's left-rail panel. A Trees / Flowers / Grass segmented control
 * switches the brush; picking a preset arms placement for that kind
 * (`setTool('trees:*')` + build mode). The count chip reads the scene reactively,
 * closing the triangle: panel → store → tool → scene → panel. It composes the
 * host's exported controls (`SegmentedControl`/`SliderControl`/`ToggleControl`)
 * so the brush matches the right-hand inspector pixel-for-pixel.
 */
export default function TreesPanel() {
  // Section lives in the plugin store (not local state) so "find in catalog"
  // can point the panel at the found node's section — see find-sync.ts.
  const mode = useTreesStore((s) => s.mode)
  const setMode = useTreesStore((s) => s.setMode)
  const activeTool = useEditor((s) => s.tool)
  const count = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === KIND[mode]).length,
  )

  const arming = activeTool === KIND[mode]

  // The host's catalogue already titles the category (the 자연 hero chip), so
  // the panel opens straight on its brush switch.
  return (
    <div className="flex flex-col pb-3 text-[var(--panel-card-fg,#333)]">
      <header className="flex flex-col gap-2 px-2.5 pt-2.5">
        <SegmentedControl
          onChange={setMode}
          options={[
            { label: '나무', value: 'trees' },
            { label: '꽃', value: 'flowers' },
            { label: '풀', value: 'grass' },
          ]}
          value={mode}
        />
        <div className="flex items-center justify-between gap-2 px-0.5 text-[11px]">
          <p className="opacity-80">
            {arming
              ? '땅을 클릭해 심습니다. Esc로 종료합니다.'
              : `${NOUN[mode]} 고른 뒤 땅을 클릭하세요.`}
          </p>
          <span className="shrink-0 rounded-full bg-[var(--panel-card,#f3f3f3)] px-2 py-0.5 tabular-nums">
            {count}개 심음
          </span>
        </div>
      </header>

      {mode === 'trees' && <TreesSection arming={arming} />}
      {mode === 'flowers' && <FlowersSection arming={arming} />}
      {mode === 'grass' && <GrassSection arming={arming} />}

      <footer className="mt-3 px-3 text-[10.5px] leading-relaxed opacity-70">
        나무 모델은{' '}
        <a
          className="underline decoration-dotted underline-offset-2 hover:opacity-100"
          href="https://x.com/dangreenheck"
          rel="noreferrer"
          target="_blank"
        >
          Daniel Greenheck
        </a>
        의{' '}
        <a
          className="underline decoration-dotted underline-offset-2 hover:opacity-100"
          href="https://github.com/dgreenheck/ez-tree"
          rel="noreferrer"
          target="_blank"
        >
          ez-tree
        </a>
        (MIT 라이선스)로 만듭니다.
      </footer>
    </div>
  )
}

/** Sliders and toggles under a preset grid, on a catalogue card. */
function Controls({ children }: { children: ReactNode }) {
  return (
    <div className="mx-2.5 mt-2 flex flex-col gap-2 rounded-[10px] bg-[var(--panel-card,#f3f3f3)] p-3">
      {children}
    </div>
  )
}

function TreesSection({ arming }: { arming: boolean }) {
  const selected = useTreesStore((s) => s.preset)
  const size = useTreesStore((s) => s.size)
  const height = useTreesStore((s) => s.height)
  const foliageDensity = useTreesStore((s) => s.foliageDensity)
  const trunkThickness = useTreesStore((s) => s.trunkThickness)
  const leafless = useTreesStore((s) => s.leafless)

  const activate = (preset: TreePreset) => {
    useTreesStore.getState().setPreset(preset)
    useEditor.getState().setTool('trees:tree')
    useEditor.getState().setMode('build')
  }

  return (
    <>
      <PresetGrid
        items={TREE_PRESET_LIST}
        onPick={activate}
        selected={arming ? selected : null}
        title={TITLE.trees}
      />
      <Controls>
        {selected !== 'trellis' && (
          <SegmentedControl
            onChange={useTreesStore.getState().setSize}
            options={[
              { label: '작게', value: 'small' },
              { label: '보통', value: 'medium' },
              { label: '크게', value: 'large' },
            ]}
            value={size}
          />
        )}
        <SliderControl
          label="높이"
          max={15}
          min={1}
          onChange={useTreesStore.getState().setHeight}
          precision={1}
          restoreOnCommit={false}
          step={0.5}
          unit="m"
          value={height}
        />
        {!leafless && (
          <SliderControl
            label="잎 밀도"
            max={1.5}
            min={0}
            onChange={useTreesStore.getState().setFoliageDensity}
            precision={1}
            restoreOnCommit={false}
            step={0.1}
            value={foliageDensity}
          />
        )}
        <SliderControl
          label="줄기 굵기"
          max={2.5}
          min={0.3}
          onChange={useTreesStore.getState().setTrunkThickness}
          precision={1}
          restoreOnCommit={false}
          step={0.1}
          value={trunkThickness}
        />
        <ToggleControl
          checked={leafless}
          label="잎 없는 나무"
          onChange={useTreesStore.getState().setLeafless}
        />
      </Controls>
    </>
  )
}

function FlowersSection({ arming }: { arming: boolean }) {
  const selected = useTreesStore((s) => s.flowerPreset)
  const height = useTreesStore((s) => s.flowerHeight)

  const activate = (preset: FlowerPreset) => {
    useTreesStore.getState().setFlowerPreset(preset)
    useEditor.getState().setTool('trees:flower')
    useEditor.getState().setMode('build')
  }

  return (
    <>
      <PresetGrid
        items={FLOWER_PRESET_LIST}
        onPick={activate}
        selected={arming ? selected : null}
        title={TITLE.flowers}
      />
      <Controls>
        <SliderControl
          label="높이"
          max={2}
          min={0.2}
          onChange={useTreesStore.getState().setFlowerHeight}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={height}
        />
      </Controls>
    </>
  )
}

function GrassSection({ arming }: { arming: boolean }) {
  const selected = useTreesStore((s) => s.grassPreset)
  const height = useTreesStore((s) => s.grassHeight)

  const activate = (preset: GrassPreset) => {
    useTreesStore.getState().setGrassPreset(preset)
    useEditor.getState().setTool('trees:grass')
    useEditor.getState().setMode('build')
  }

  return (
    <>
      <PresetGrid
        items={GRASS_PRESET_LIST}
        onPick={activate}
        selected={arming ? selected : null}
        title={TITLE.grass}
      />
      <Controls>
        <SliderControl
          label="높이"
          max={2}
          min={0.1}
          onChange={useTreesStore.getState().setGrassHeight}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={height}
        />
      </Controls>
    </>
  )
}

/** The presets as catalogue cards (the host's 4-up grid under a header bar). */
function PresetGrid<T extends string>({
  items,
  selected,
  onPick,
  title,
}: {
  items: ReadonlyArray<{ id: T; label: string; thumbnail: string }>
  selected: T | null
  onPick: (id: T) => void
  title: string
}) {
  return (
    <CatalogSection title={title}>
      {items.map((item) => (
        <CatalogCard
          active={selected === item.id}
          hover={{ description: '고른 뒤 땅을 클릭해 심습니다.' }}
          image={item.thumbnail}
          imageFit="cover"
          key={item.id}
          label={item.label}
          meta={item.label}
          onClick={() => onPick(item.id)}
        />
      ))}
    </CatalogSection>
  )
}
