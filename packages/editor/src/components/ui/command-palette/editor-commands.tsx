'use client'

import type { AnyNodeId } from '@pascal-app/core'
import { LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  AppWindow,
  ArrowRight,
  Box,
  Building2,
  Camera,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  FileJson,
  Gem,
  Grid3X3,
  Hexagon,
  Layers,
  Map,
  Maximize2,
  Minimize2,
  Moon,
  MousePointer2,
  Package,
  PaintBucket,
  PencilLine,
  Plus,
  Redo2,
  Sparkles,
  Square,
  SquareStack,
  Sun,
  Trash2,
  Undo2,
  Video,
} from 'lucide-react'
import { useEffect } from 'react'
import { runRedo, runUndo } from '../../../lib/history'
import { deleteLevelWithFallbackSelection } from '../../../lib/level-selection'
import { useCommandRegistry } from '../../../store/use-command-registry'
import type { StructureTool } from '../../../store/use-editor'
import useEditor from '../../../store/use-editor'
import { useCommandPalette } from './index'

export function EditorCommands() {
  const register = useCommandRegistry((s) => s.register)
  const { navigateTo, setInputValue, setOpen } = useCommandPalette()

  const setPhase = useEditor((s) => s.setPhase)
  const setMode = useEditor((s) => s.setMode)
  const setTool = useEditor((s) => s.setTool)
  const setStructureLayer = useEditor((s) => s.setStructureLayer)
  const primeMaterialPaintFromSelection = useEditor((s) => s.primeMaterialPaintFromSelection)
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const setPreviewMode = useEditor((s) => s.setPreviewMode)

  const exportScene = useViewer((s) => s.exportScene)

  // Re-register when exportScene availability changes (it's a conditional action)
  useEffect(() => {
    const run = (fn: () => void) => {
      fn()
      setOpen(false)
    }

    const activateTool = (tool: StructureTool) => {
      run(() => {
        setPhase('structure')
        setMode('build')
        if (tool === 'zone') setStructureLayer('zones')
        setTool(tool)
      })
    }

    return register([
      // ── Scene ────────────────────────────────────────────────────────────
      {
        id: 'editor.tool.wall',
        label: '벽 그리기',
        group: '장면',
        icon: <Square className="h-4 w-4" />,
        keywords: ['draw', 'build', 'structure'],
        execute: () => activateTool('wall'),
      },
      {
        id: 'editor.tool.slab',
        label: '바닥 그리기',
        group: '장면',
        icon: <Layers className="h-4 w-4" />,
        keywords: ['floor', 'build'],
        execute: () => activateTool('slab'),
      },
      {
        id: 'editor.tool.ceiling',
        label: '천장 그리기',
        group: '장면',
        icon: <Grid3X3 className="h-4 w-4" />,
        keywords: ['top', 'build'],
        execute: () => activateTool('ceiling'),
      },
      {
        id: 'editor.tool.door',
        label: '문 달기',
        group: '장면',
        icon: <DoorOpen className="h-4 w-4" />,
        keywords: ['opening', 'entrance'],
        execute: () => activateTool('door'),
      },
      {
        id: 'editor.tool.window',
        label: '창문 달기',
        group: '장면',
        icon: <AppWindow className="h-4 w-4" />,
        keywords: ['opening', 'glass'],
        execute: () => activateTool('window'),
      },
      {
        id: 'editor.tool.item',
        label: '사물 배치',
        group: '장면',
        icon: <Package className="h-4 w-4" />,
        keywords: ['furniture', 'object', 'asset', 'furnish'],
        execute: () => activateTool('item'),
      },
      {
        id: 'editor.tool.stair',
        label: '계단 놓기',
        group: '장면',
        icon: <ArrowRight className="h-4 w-4" />,
        keywords: ['stairs', 'staircase', 'flight', 'landing', 'steps'],
        execute: () => activateTool('stair'),
      },
      {
        id: 'editor.tool.zone',
        label: '방 · 구역',
        group: '장면',
        icon: <Hexagon className="h-4 w-4" />,
        keywords: ['area', 'room', 'space'],
        execute: () => activateTool('zone'),
      },
      {
        id: 'editor.delete-selection',
        label: '선택 항목 삭제',
        group: '장면',
        icon: <Trash2 className="h-4 w-4" />,
        keywords: ['remove', 'erase'],
        shortcut: ['⌫'],
        when: () => useViewer.getState().selection.selectedIds.length > 0,
        execute: () =>
          run(() => {
            const { selectedIds } = useViewer.getState().selection
            useScene.getState().deleteNodes(selectedIds as any[])
          }),
      },
      {
        id: 'editor.mode.material-paint',
        label: '재질 칠하기',
        group: '장면',
        icon: <PaintBucket className="h-4 w-4" />,
        keywords: ['paint', 'material', 'texture', 'bucket', 'surface'],
        shortcut: ['P'],
        execute: () =>
          run(() => {
            primeMaterialPaintFromSelection()
            setPhase('structure')
            setStructureLayer('elements')
            setMode('material-paint')
          }),
      },

      // ── Levels ───────────────────────────────────────────────────────────
      {
        id: 'editor.level.goto',
        label: '층 이동',
        group: '층',
        icon: <ArrowRight className="h-4 w-4" />,
        keywords: ['level', 'floor', 'go', 'navigate', 'switch', 'select'],
        navigate: true,
        when: () => Object.values(useScene.getState().nodes).some((n) => n.type === 'level'),
        execute: () => navigateTo('goto-level'),
      },
      {
        id: 'editor.level.add',
        label: '층 추가',
        group: '층',
        icon: <Plus className="h-4 w-4" />,
        keywords: ['level', 'floor', 'add', 'create', 'new'],
        execute: () =>
          run(() => {
            const { nodes } = useScene.getState()
            const building = Object.values(nodes).find((n) => n.type === 'building')
            if (!building) return
            const levelCount = building.children.filter(
              (childId) => nodes[childId as keyof typeof nodes]?.type === 'level',
            ).length
            const newLevel = LevelNode.parse({
              level: levelCount,
              children: [],
              parentId: building.id,
            })
            useScene.getState().createNode(newLevel, building.id)
            useViewer.getState().setSelection({ levelId: newLevel.id })
          }),
      },
      {
        id: 'editor.level.rename',
        label: '층 이름 바꾸기',
        group: '층',
        icon: <PencilLine className="h-4 w-4" />,
        keywords: ['level', 'floor', 'rename', 'name'],
        navigate: true,
        when: () => !!useViewer.getState().selection.levelId,
        execute: () => {
          const activeLevelId = useViewer.getState().selection.levelId
          if (!activeLevelId) return
          const level = useScene.getState().nodes[activeLevelId as AnyNodeId] as LevelNode
          setInputValue(level?.name ?? '')
          navigateTo('rename-level')
        },
      },
      {
        id: 'editor.level.delete',
        label: '층 삭제',
        group: '층',
        icon: <Trash2 className="h-4 w-4" />,
        keywords: ['level', 'floor', 'delete', 'remove'],
        when: () => {
          const levelId = useViewer.getState().selection.levelId
          if (!levelId) return false
          const node = useScene.getState().nodes[levelId as AnyNodeId] as LevelNode
          return node?.type === 'level' && node.level !== 0
        },
        execute: () =>
          run(() => {
            const activeLevelId = useViewer.getState().selection.levelId
            if (!activeLevelId) return
            deleteLevelWithFallbackSelection(activeLevelId as AnyNodeId)
          }),
      },

      // ── Viewer Controls ──────────────────────────────────────────────────
      {
        id: 'editor.viewer.wall-mode',
        label: '벽 보기',
        group: '보기 조절',
        icon: <Layers className="h-4 w-4" />,
        keywords: ['wall', 'cutaway', 'up', 'down', 'translucent', 'view'],
        badge: () => {
          const mode = useViewer.getState().wallMode
          return { cutaway: '벽 자르기', up: '벽 올리기', down: '벽 내리기', translucent: '반투명 벽' }[mode]
        },
        navigate: true,
        execute: () => navigateTo('wall-mode'),
      },
      {
        id: 'editor.viewer.level-mode',
        label: '층 보기',
        group: '보기 조절',
        icon: <SquareStack className="h-4 w-4" />,
        keywords: ['level', 'floor', 'exploded', 'stacked', 'solo'],
        badge: () => {
          const mode = useViewer.getState().levelMode
          return { manual: '직접', stacked: '층 쌓기', exploded: '층 펼치기', solo: '한 층만' }[mode]
        },
        navigate: true,
        execute: () => navigateTo('level-mode'),
      },
      {
        id: 'editor.viewer.camera-mode',
        label: () => {
          const mode = useViewer.getState().cameraMode
          return `카메라: ${mode === 'perspective' ? '평행 투영으로' : '원근으로'} 바꾸기`
        },
        group: '보기 조절',
        icon: <Video className="h-4 w-4" />,
        keywords: ['camera', 'ortho', 'perspective', '2d', '3d', 'view'],
        execute: () =>
          run(() => {
            const { cameraMode, setCameraMode } = useViewer.getState()
            setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
          }),
      },
      {
        id: 'editor.viewer.shading-solid',
        label: '렌더: 단색',
        group: '보기 조절',
        icon: <Box className="h-4 w-4" />,
        keywords: ['solid', 'shading', 'render', 'mode', 'performance'],
        execute: () => run(() => useViewer.getState().setShading('solid')),
      },
      {
        id: 'editor.viewer.shading-rendered',
        label: '렌더: 기본',
        group: '보기 조절',
        icon: <Sparkles className="h-4 w-4" />,
        keywords: ['rendered', 'shading', 'render', 'mode', 'quality'],
        execute: () => run(() => useViewer.getState().setShading('rendered')),
      },
      {
        id: 'editor.viewer.shading-hyper',
        label: '렌더: 고품질',
        group: '보기 조절',
        icon: <Gem className="h-4 w-4" />,
        keywords: ['hyper', 'shading', 'render', 'mode', 'quality', 'ultra'],
        execute: () => run(() => useViewer.getState().setShading('hyper')),
      },
      {
        id: 'editor.viewer.camera-snapshot',
        label: '카메라 스냅샷 찍기',
        group: '보기 조절',
        icon: <Camera className="h-4 w-4" />,
        keywords: ['camera', 'snapshot', 'capture', 'save', 'view', 'bookmark'],
        execute: () => {
          setOpen(false)
          useEditor.getState().setCaptureMode(true)
        },
      },

      // ── View ─────────────────────────────────────────────────────────────
      {
        id: 'editor.view.preview',
        label: () => (isPreviewMode ? '미리보기 끝내기' : '미리보기'),
        group: '보기',
        icon: isPreviewMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />,
        keywords: ['preview', 'view', 'read-only', 'present'],
        execute: () => run(() => setPreviewMode(!isPreviewMode)),
      },
      {
        id: 'editor.view.fullscreen',
        label: '전체 화면 전환',
        group: '보기',
        icon: <Maximize2 className="h-4 w-4" />,
        keywords: ['fullscreen', 'maximize', 'expand', 'window'],
        execute: () =>
          run(() => {
            if (document.fullscreenElement) document.exitFullscreen()
            else document.documentElement.requestFullscreen()
          }),
      },

      // ── History ──────────────────────────────────────────────────────────
      {
        id: 'editor.history.undo',
        label: '되돌리기',
        group: '기록',
        icon: <Undo2 className="h-4 w-4" />,
        keywords: ['undo', 'revert', 'back'],
        execute: () => run(() => runUndo()),
      },
      {
        id: 'editor.history.redo',
        label: '다시하기',
        group: '기록',
        icon: <Redo2 className="h-4 w-4" />,
        keywords: ['redo', 'forward', 'repeat'],
        execute: () => run(() => runRedo()),
      },

      // ── Export & Share ───────────────────────────────────────────────────
      {
        id: 'editor.export.json',
        label: '장면 내보내기 (JSON)',
        group: '내보내기 · 공유',
        icon: <FileJson className="h-4 w-4" />,
        keywords: ['export', 'download', 'json', 'save', 'data'],
        execute: () =>
          run(() => {
            const { nodes, rootNodeIds } = useScene.getState()
            const blob = new Blob([JSON.stringify({ nodes, rootNodeIds }, null, 2)], {
              type: 'application/json',
            })
            const url = URL.createObjectURL(blob)
            Object.assign(document.createElement('a'), {
              href: url,
              download: `scene_${new Date().toISOString().split('T')[0]}.json`,
            }).click()
            URL.revokeObjectURL(url)
          }),
      },
      ...(exportScene
        ? [
            {
              id: 'editor.export.glb',
              label: '3D 모델 내보내기 (GLB)',
              group: '내보내기 · 공유',
              icon: <Box className="h-4 w-4" />,
              keywords: ['export', 'glb', 'gltf', '3d', 'model', 'download'],
              execute: () => run(() => exportScene()),
            },
          ]
        : []),
      {
        id: 'editor.export.share-link',
        label: '공유 링크 복사',
        group: '내보내기 · 공유',
        icon: <Copy className="h-4 w-4" />,
        keywords: ['share', 'copy', 'url', 'link'],
        execute: () => run(() => navigator.clipboard.writeText(window.location.href)),
      },
      {
        id: 'editor.export.screenshot',
        label: '스크린샷 찍기',
        group: '내보내기 · 공유',
        icon: <Camera className="h-4 w-4" />,
        keywords: ['screenshot', 'capture', 'image', 'photo', 'png'],
        execute: () =>
          run(() => {
            const canvas = document.querySelector('canvas')
            if (!canvas) return
            Object.assign(document.createElement('a'), {
              href: canvas.toDataURL('image/png'),
              download: `screenshot_${new Date().toISOString().split('T')[0]}.png`,
            }).click()
          }),
      },
    ])
  }, [
    register,
    navigateTo,
    setInputValue,
    setOpen,
    setPhase,
    setMode,
    setTool,
    setStructureLayer,
    isPreviewMode,
    setPreviewMode,
    exportScene,
  ])

  return null
}
