'use client'

import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ColorPicker } from '../color-picker'

const SAVED_KEY = 'pascal:customize-recent-colors'
const MAX_SAVED = 5

function readSaved(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === 'string').slice(0, MAX_SAVED)
      : []
  } catch {
    return []
  }
}

function writeSaved(colors: string[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(colors))
  } catch {}
}

/**
 * inZOI's leftmost column: the always-open colour picker, with the colours
 * saved with '+' in a small grid beside the hue bar.
 */
export function ColorSection({
  value,
  original,
  onPreview,
  onCommit,
  onClear,
}: {
  value: string
  original?: string
  onPreview: (hex: string) => void
  onCommit: (hex: string) => void
  onClear?: () => void
}) {
  const [saved, setSaved] = useState(readSaved)
  const [picked, setPicked] = useState(value)
  useEffect(() => setPicked(value), [value])
  const save = () => {
    const hex = picked.toUpperCase()
    const next = [hex, ...saved.filter((c) => c !== hex)].slice(0, MAX_SAVED)
    setSaved(next)
    writeSaved(next)
  }

  return (
    <div className="flex w-[180px] shrink-0 flex-col px-3 pt-2.5 pb-2">
      <ColorPicker
        extra={
          <div className="grid h-fit grid-cols-2 gap-1">
            {saved.map((hex) => (
              <button
                aria-label={`저장한 색 ${hex}`}
                className="size-4 rounded-[3px] ring-1 ring-black/10 transition-transform hover:scale-110"
                key={hex}
                onClick={() => {
                  setPicked(hex)
                  onCommit(hex)
                }}
                style={{ background: hex }}
                title={hex}
                type="button"
              />
            ))}
            <button
              aria-label="지금 색 저장"
              className="grid size-4 place-items-center rounded-[4px] border border-[#cfcfcf] text-[#9a9a9a] transition-colors hover:border-[#9a9a9a] hover:text-[#555] dark:border-white/25 dark:text-neutral-400"
              onClick={save}
              title="지금 색 저장"
              type="button"
            >
              <Plus className="size-3" strokeWidth={2} />
            </button>
          </div>
        }
        onClear={onClear}
        onCommit={(hex) => {
          setPicked(hex)
          onCommit(hex)
        }}
        onPreview={(hex) => {
          setPicked(hex)
          onPreview(hex)
        }}
        original={original}
        value={value}
      />
    </div>
  )
}
