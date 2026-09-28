import { ToolCursorHints } from './tool-cursor-hints'

interface BuildingHelperProps {
  showRotate?: boolean
}

// Rotate is one hint with both keys (R / T) — never two separate
// counterclockwise / clockwise rows — to match every other placement helper.
export function BuildingHelper({ showRotate }: BuildingHelperProps) {
  return (
    <ToolCursorHints
      hints={[
        { keys: ['Left click'], label: '건물 놓기' },
        ...(showRotate ? [{ keys: [['R', 'T']], label: '회전' }] : []),
        { keys: ['Esc'], label: '취소' },
      ]}
    />
  )
}
