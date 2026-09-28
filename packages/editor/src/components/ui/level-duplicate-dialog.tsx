'use client'

import type { LevelNode } from '@pascal-app/core'
import { useEffect, useState } from 'react'
import type { LevelDuplicatePreset } from '../../lib/level-duplication'
import { getLevelDisplayName } from '@pascal-app/core'
import { cn } from '../../lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './primitives/dialog'

const DUPLICATE_PRESETS: Array<{
  id: LevelDuplicatePreset
  label: string
  description: string
}> = [
  {
    id: 'everything',
    label: '전부',
    description: '구조, 재질, 가구와 참조 이미지까지 모두 복사합니다.',
  },
  {
    id: 'structure',
    label: '구조만',
    description: '마감 없이 벽, 바닥, 지붕, 계단, 창문과 문만 복사합니다.',
  },
  {
    id: 'structure-materials',
    label: '구조 + 재질',
    description: '구조와 지금 적용된 재질·마감을 복사합니다.',
  },
  {
    id: 'structure-furniture',
    label: '구조 + 가구',
    description: '구조, 마감과 배치한 사물을 복사합니다 (참조 이미지 제외).',
  },
]

function getLevelLabel(level: LevelNode | null) {
  if (!level) return '이 층'
  return getLevelDisplayName(level)
}

export function LevelDuplicateDialog({
  open,
  level,
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  level: LevelNode | null
  onConfirm: (preset: LevelDuplicatePreset) => void
  onOpenChange: (open: boolean) => void
}) {
  const [preset, setPreset] = useState<LevelDuplicatePreset>('everything')

  useEffect(() => {
    if (open) {
      setPreset('everything')
    }
  }, [open])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>층 복제</DialogTitle>
          <DialogDescription>{getLevelLabel(level)}에서 복사할 내용을 고르세요.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {DUPLICATE_PRESETS.map((option) => (
            <button
              className={cn(
                'cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors',
                preset === option.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background hover:bg-accent/40',
              )}
              key={option.id}
              onClick={() => setPreset(option.id)}
              type="button"
            >
              <div className="font-medium text-sm">{option.label}</div>
              <div className="mt-1 text-muted-foreground text-xs">{option.description}</div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <button
            className="cursor-pointer rounded-md px-4 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            취소
          </button>
          <button
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity hover:opacity-90"
            onClick={() => onConfirm(preset)}
            type="button"
          >
            복제
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
